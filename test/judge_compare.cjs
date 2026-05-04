#!/usr/bin/env node
'use strict'

// ── Judge Compare Test ────────────────────────────────────────────────────────
// Runs v10/v11/v12/v13 on real data across 4 dates.
// Calls gpt-4o judge to score all 4 outputs.
// Writes results to test/judge_compare_<timestamp>.csv
// Zero writes to Supabase.
//
// Usage (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<srk>"; $env:OPENAI_API_KEY="<key>"; node test/judge_compare.js

const fs   = require('fs')
const path = require('path')

// ── Config ────────────────────────────────────────────────────────────────────

const DATES          = ['2026-04-21', '2026-04-22', '2026-04-24', '2026-04-25']
const SB_URL         = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const SB_KEY         = process.env.SUPABASE_SERVICE_ROLE_KEY
const OAI_KEY        = process.env.OPENAI_API_KEY
const AGENT_MODEL    = 'gpt-4o-mini'
const JUDGE_MODEL    = 'gpt-4o'
const MAX_TOK        = 400
const JUDGE_MAX      = 350
const VERSION_TAGS   = ['v10', 'v11-main', 'v12-picks', 'v13-unique']
const VERSION_PARAMS = {
  'v10':        { temperature: 0.6, seed: 42 },
  'v11-main':   { temperature: 0.6, seed: 42 },
  'v12-picks':  { temperature: 0.5, seed: 43 },
  'v13-unique': { temperature: 0.4, seed: 44 },
}
const PHASE_LABELS = {
  group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarter-Final', sf: 'Semi-Final', third: 'Third Place', final: 'Final',
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

function nextDay(date) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function outcomeDir(h, a) {
  return h > a ? 'home_win' : h < a ? 'away_win' : 'draw'
}

function csvCell(v) {
  if (v === null || v === undefined) return ''
  return '"' + String(v).replace(/"/g, '""') + '"'
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

async function sbGet(endpoint) {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept': 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`GET ${endpoint}: ${res.status} ${txt}`)
  }
  return res.json()
}

async function sbRpc(fn, body) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`RPC ${fn}: ${res.status} ${txt}`)
  }
  return res.json()
}

// ── OpenAI helpers ────────────────────────────────────────────────────────────

async function oaiChat(body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(5000)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return res.json()
    const txt = await res.text()
    if (attempt === 1) throw new Error(`OpenAI ${res.status}: ${txt}`)
    console.warn(`  [oai] retry after ${res.status}`)
  }
}

async function callAgent(sysPr, usrTpl, groupName, payload, temperature, seed) {
  const userMsg = usrTpl
    .replace('{{group_name}}', groupName)
    .replace('{{group_json}}', JSON.stringify(payload))
  const r = await oaiChat({
    model: AGENT_MODEL,
    messages: [{ role: 'system', content: sysPr }, { role: 'user', content: userMsg }],
    max_tokens: MAX_TOK, temperature, top_p: 1, seed,
  })
  return {
    content:           r.choices[0]?.message?.content?.trim() ?? '',
    prompt_tokens:     r.usage?.prompt_tokens      ?? 0,
    completion_tokens: r.usage?.completion_tokens  ?? 0,
  }
}

// ── Judge ─────────────────────────────────────────────────────────────────────

const JUDGE_SYS = `You are a judge evaluating four nightly WhatsApp roast summaries for a World Cup prediction group.
Score each on 4 dimensions (0-10 each) and pick one winner.

ACCURACY VERIFICATION - do this first, before scoring:
For each candidate, check every factual claim against the payload:
  - Every point value stated for a user must match leaderboard[].today_pts exactly. If wrong -> deduct 3 from accuracy.
  - today.global_top[].pts is the global total across all groups - never accept it as a user's today score. If stated as today score -> deduct 3 from accuracy.
  - If the summary claims a user "topped the competition today" but their today_pts = 0 -> deduct 3 from accuracy.
  - The point gap stated between rank 1 and rank 2 must equal leaderboard[0].total_pts - leaderboard[1].total_pts exactly. If wrong -> deduct 3 from accuracy.
  - If the summary claims "competitors got it right" for a game, verify global_upset=false for that game. If global_upset=true -> deduct 3 from accuracy.
  - Any scoreline stated for a user must appear in their predictions[].preds[].pred. If not found -> deduct 2 from accuracy.
Multiple errors stack. Start accuracy at 10, apply deductions.
Hard floor: if final accuracy <= 3, that candidate is disqualified regardless of other scores.

SCORING WEIGHTS:
- accuracy (45%): verified above - no invented facts; streak = abs(streak); scorelines correct; champion result correct
- humor (30%): picks used as rivalry fuel when champion played; specific scoreline for worst performer; P4 unique angle with actual numbers (not template phrase); personal not generic
- compliance (15%): no banned words (journey/remarkable/incredible/exciting); no pronouns he/she/his/her/him; no invented character labels; facts from payload only
- structure (10%): 6 paragraphs; P6 starts "Tomorrow's danger:"; exact point gap appears; streak referenced in P6

Return valid JSON only:
{
  "winner": 1 or 2 or 3 or 4,
  "reasoning": "one sentence explaining why the winner is best",
  "scores": [
    {"agent":1,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":2,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":3,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":4,"accuracy":N,"humor":N,"compliance":N,"structure":N}
  ]
}`

async function callJudge(payload, candidates) {
  const parts  = candidates.map((c, i) => `CANDIDATE ${i + 1} (${c.version}):\n${c.content}`)
  const userMsg = `PAYLOAD:\n${JSON.stringify(payload)}\n\n${parts.join('\n\n')}`
  try {
    const r      = await oaiChat({
      model: JUDGE_MODEL,
      messages: [{ role: 'system', content: JUDGE_SYS }, { role: 'user', content: userMsg }],
      max_tokens: JUDGE_MAX, temperature: 0.1, top_p: 1, seed: 1,
      response_format: { type: 'json_object' },
    })
    const parsed = JSON.parse(r.choices[0]?.message?.content?.trim() ?? '{}')
    return {
      winner:            Number(parsed.winner),
      reasoning:         String(parsed.reasoning ?? ''),
      scores:            parsed.scores ?? [],
      prompt_tokens:     r.usage?.prompt_tokens     ?? 0,
      completion_tokens: r.usage?.completion_tokens ?? 0,
    }
  } catch (e) {
    console.error('  [judge] failed:', e.message)
    return { winner: null, reasoning: 'judge failed: ' + e.message, scores: [], prompt_tokens: 0, completion_tokens: 0 }
  }
}

// ── Payload builder ───────────────────────────────────────────────────────────

function buildPayload({ groupName, date, groupData, finishedGames, globalDistMap, champMap, tsrMap, globalTopUsers, globalZeroUsers }) {
  const gameByKey = {}
  for (const g of finishedGames) gameByKey[`${g.team_home}|${g.team_away}`] = g

  // Champion team → result lookup
  const champTeamResult = {}
  for (const fg of finishedGames) {
    const r = outcomeDir(fg.score_home, fg.score_away)
    champTeamResult[fg.team_home] = { played: true, result: r === 'home_win' ? 'win' : r === 'draw' ? 'draw' : 'loss' }
    champTeamResult[fg.team_away] = { played: true, result: r === 'away_win' ? 'win' : r === 'draw' ? 'draw' : 'loss' }
  }

  // Per-member today pts + today_exact
  const todayPts = {}, todayExact = {}
  for (const m of (groupData.members ?? [])) {
    let pts = 0, exact = 0
    for (const p of (m.predictions ?? [])) {
      pts += (p.points ?? 0)
      if ((p.points ?? 0) === 3) exact++
    }
    todayPts[m.username]   = pts
    todayExact[m.username] = exact
  }

  // Group prediction distribution per game
  const grpDist = {}
  for (const game of (groupData.games ?? [])) {
    const fg = gameByKey[`${game.team_home}|${game.team_away}`]
    if (!fg) continue
    const dist = { home: 0, draw: 0, away: 0, n: 0 }
    for (const m of (groupData.members ?? [])) {
      const pred = (m.predictions ?? []).find(p => p.game_id === fg.id)
      if (!pred) continue
      dist.n++
      if      (pred.pred_home > pred.pred_away)  dist.home++
      else if (pred.pred_home === pred.pred_away) dist.draw++
      else                                        dist.away++
    }
    grpDist[fg.id] = dist
  }

  const groupMemberSet = new Set((groupData.members ?? []).map(m => m.user_id))

  // leaderboard
  const leaderboard = (groupData.leaderboard ?? []).map(row => {
    const member = (groupData.members ?? []).find(m => m.username === row.username)
    return {
      group_rank:  row.group_rank,
      global_rank: null,
      user:        row.username,
      total_pts:   row.total_points,
      total_exact: row.exact_scores,
      today_exact: todayExact[row.username] ?? 0,
      today_pts:   todayPts[row.username]   ?? 0,
      streak:      member?.current_streak   ?? 0,
    }
  })

  // games
  const games = (groupData.games ?? []).map(game => {
    const fg     = gameByKey[`${game.team_home}|${game.team_away}`]
    const gd     = fg ? (globalDistMap[fg.id] ?? null) : null
    const gdTotal = gd?.total ?? 0
    const grp    = fg ? (grpDist[fg.id] ?? null) : null
    const grpN   = grp?.n ?? 0

    let groupExactN = 0
    if (fg) {
      for (const m of (groupData.members ?? [])) {
        const pred = (m.predictions ?? []).find(p => p.game_id === fg.id)
        if (pred && pred.pred_home === fg.score_home && pred.pred_away === fg.score_away) groupExactN++
      }
    }

    let groupUpset = false
    if (fg && grp && grpN > 0) {
      const rDir = outcomeDir(fg.score_home, fg.score_away)
      const mDir = grp.home >= grp.draw && grp.home >= grp.away ? 'home_win'
                 : grp.away > grp.draw && grp.away > grp.home   ? 'away_win' : 'draw'
      groupUpset = rDir !== mDir
    }

    let globalUpset = false
    if (fg && gdTotal > 0) {
      const rDir = outcomeDir(fg.score_home, fg.score_away)
      const mDir = gd.home_win >= gd.draw && gd.home_win >= gd.away_win ? 'home_win'
                 : gd.away_win > gd.draw && gd.away_win > gd.home_win   ? 'away_win' : 'draw'
      globalUpset = rDir !== mDir
    }

    let distGlobal = null
    if (gdTotal > 0) {
      const top   = gd.top_scores?.[0]?.score ?? null
      const topN  = gd.top_scores?.[0]?.count ?? null
      const top2N = gd.top_scores?.[1]?.count ?? null
      const tied  = topN !== null && top2N !== null && topN === top2N
      const groupOnTop = []
      if (top && !tied && fg) {
        for (const m of (groupData.members ?? [])) {
          const pred = (m.predictions ?? []).find(p => p.game_id === fg.id)
          if (pred && `${pred.pred_home}-${pred.pred_away}` === top) groupOnTop.push(m.username)
        }
      }
      distGlobal = {
        home_pct: Math.round(gd.home_win / gdTotal * 100),
        draw_pct: Math.round(gd.draw     / gdTotal * 100),
        away_pct: Math.round(gd.away_win / gdTotal * 100),
        n: gdTotal, exact_hits: gd.exact_count ?? 0,
        top_score: top, top_score_n: topN, top_score_tied: tied,
        group_on_top_score: groupOnTop,
      }
    }

    return {
      match:          fg ? `${fg.team_home} ${fg.score_home}-${fg.score_away} ${fg.team_away}` : `${game.team_home} ?-? ${game.team_away}`,
      home_team:      game.team_home,
      away_team:      game.team_away,
      home_score:     game.score_home,
      away_score:     game.score_away,
      result:         fg ? outcomeDir(fg.score_home, fg.score_away) : null,
      phase_label:    PHASE_LABELS[game.phase] ?? game.phase,
      group_exact_n:  groupExactN,
      global_exact_n: gd ? (gd.exact_count ?? 0) : 0,
      group_upset:    groupUpset,
      global_upset:   globalUpset,
      scorers:        null,
      dist_group:     grpN > 0 ? {
        home_pct: Math.round(grp.home / grpN * 100),
        draw_pct: Math.round(grp.draw / grpN * 100),
        away_pct: Math.round(grp.away / grpN * 100), n: grpN,
      } : null,
      dist_global: distGlobal,
    }
  })

  // predictions
  const predictions = (groupData.members ?? []).map(m => ({
    user:      m.username,
    today_pts: todayPts[m.username] ?? 0,
    preds: (m.predictions ?? []).map(p => {
      const fg           = finishedGames.find(g => g.id === p.game_id)
      const matchStr     = fg ? `${fg.team_home} ${fg.score_home}-${fg.score_away} ${fg.team_away}` : p.game_id
      const actualResult = fg ? outcomeDir(fg.score_home, fg.score_away) : null
      const predResult   = outcomeDir(p.pred_home, p.pred_away)
      const isExact      = fg ? (p.pred_home === fg.score_home && p.pred_away === fg.score_away) : false
      return { game: matchStr, result: actualResult, pred: `${p.pred_home}-${p.pred_away}`, pred_result: predResult, pts: p.points, exact: isExact, auto: p.is_auto }
    }),
  }))

  // picks
  const picksRaw = (groupData.members ?? []).map(m => {
    const champion  = champMap[m.user_id] ?? null
    const topScorer = tsrMap[m.user_id]   ?? null
    const champInfo = champion ? champTeamResult[champion] : null
    const champPlayedToday = champInfo?.played ?? false
    const champResult      = champPlayedToday ? champInfo.result : undefined
    const pick = { user: m.username, champion, top_scorer: topScorer, scorer_goals_today: null, scorer_total_goals: null, scorer_tournament_rank: null }
    if (champion) {
      pick.champion_played_today = champPlayedToday
      if (champPlayedToday) pick.champion_result = champResult
    }
    return pick
  })
  const anyPickSet = picksRaw.some(p => p.champion !== null || p.top_scorer !== null)

  return {
    group: groupName,
    date,
    leaderboard,
    today: {
      global_top:  globalTopUsers.map(u  => ({ user: u.user,  pts: u.pts,      in_group: groupMemberSet.has(u.uid) })),
      global_zero: globalZeroUsers.map(u => ({ user: u.user,  all_auto: u.all_auto, in_group: groupMemberSet.has(u.uid) })),
    },
    games,
    predictions,
    ...(anyPickSet ? { picks: picksRaw } : {}),
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

const CSV_COLS = [
  'date', 'group', 'version', 'agent_num',
  'payload_json',
  'content', 'char_len',
  'prompt_tokens', 'completion_tokens',
  'accuracy', 'humor', 'compliance', 'structure', 'weighted_total',
  'judge_winner_version', 'judge_reasoning',
  'judge_prompt_tokens', 'judge_completion_tokens',
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SB_KEY)  { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1) }
  if (!OAI_KEY) { console.error('ERROR: OPENAI_API_KEY not set'); process.exit(1) }

  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = path.join(__dirname, `judge_compare_${ts}.csv`)
  fs.writeFileSync(outPath, CSV_COLS.map(csvCell).join(',') + '\n')
  console.log(`Output: ${outPath}`)

  // 1. Load all 4 prompt versions
  console.log('\nLoading prompts...')
  const allPrompts = await sbGet('prompt_versions?select=id,version_tag,system_prompt,user_prompt_template')
  const promptMap = {}
  for (const p of allPrompts) {
    if (VERSION_TAGS.includes(p.version_tag)) promptMap[p.version_tag] = p
  }
  for (const tag of VERSION_TAGS) {
    if (!promptMap[tag]) { console.error(`Prompt not found in DB: ${tag}`); process.exit(1) }
  }
  console.log(`Prompts loaded: ${Object.keys(promptMap).join(', ')}`)

  // 2. Qualifying groups
  console.log('Loading groups...')
  const allGroups = await sbGet('groups?select=id,name')
  const qualifying = []
  for (const g of allGroups) {
    const members = await sbGet(`group_members?group_id=eq.${g.id}&is_inactive=eq.false&select=user_id`)
    if (members.length >= 3) qualifying.push(g)
  }
  console.log(`Qualifying groups (${qualifying.length}): ${qualifying.map(g => g.name).join(', ')}`)

  // 3. Process each date
  for (const date of DATES) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`Date: ${date}`)
    console.log('═'.repeat(60))

    const dayStart = `${date}T00:00:00Z`
    const dayEnd   = `${nextDay(date)}T00:00:00Z`

    // Finished games for this date
    const allGames = await sbGet(`games?kick_off_time=gte.${encodeURIComponent(dayStart)}&kick_off_time=lt.${encodeURIComponent(dayEnd)}&select=id,team_home,team_away,score_home,score_away,phase`)
    const finishedGames = allGames.filter(g => g.score_home !== null)
    if (finishedGames.length === 0) { console.log('No finished games — skipping'); continue }
    console.log(`Games: ${finishedGames.map(g => `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away}`).join(' | ')}`)

    const gameIds = finishedGames.map(g => g.id)

    // Global prediction distributions
    const globalDistMap = {}
    for (const g of finishedGames) {
      try {
        const dist = await sbRpc('get_game_prediction_distribution', { p_game_id: g.id })
        if (dist) globalDistMap[g.id] = dist
      } catch (e) { console.warn(`  dist RPC failed for game ${g.id}: ${e.message}`) }
    }

    // Global today pts per user (for global_top / global_zero)
    const predRows = await sbGet(`predictions?game_id=in.(${gameIds.join(',')})&select=user_id,game_id,points_earned,is_auto`)
    const userAgg  = {}
    for (const p of predRows) {
      if (!userAgg[p.user_id]) userAgg[p.user_id] = { uid: p.user_id, pts: 0, count: 0, autoCount: 0 }
      userAgg[p.user_id].pts += (p.points_earned ?? 0)
      userAgg[p.user_id].count++
      if (p.is_auto) userAgg[p.user_id].autoCount++
    }
    const uids = Object.keys(userAgg)
    const profiles = uids.length > 0
      ? await sbGet(`profiles?id=in.(${uids.join(',')})&select=id,username`)
      : []
    const usernameMap = {}
    for (const pr of profiles) usernameMap[pr.id] = pr.username

    const globalSorted = Object.values(userAgg)
      .map(u => ({ uid: u.uid, user: usernameMap[u.uid] ?? u.uid, pts: u.pts, all_auto: u.count > 0 && u.autoCount === u.count }))
      .sort((a, b) => b.pts - a.pts)
    const globalTopUsers  = globalSorted.filter(u => u.pts > 0).slice(0, 3)
    const globalZeroUsers = globalSorted.filter(u => u.pts === 0)

    // Process each qualifying group
    for (const group of qualifying) {
      console.log(`\n  ── ${group.name} ──`)

      const groupData = await sbRpc('get_group_summary_data', { p_group_id: group.id, p_date: date })
      if (!groupData || !groupData.members?.length) { console.warn('  No group data — skipping'); continue }

      const champPicks = await sbGet(`champion_pick?group_id=eq.${group.id}&select=user_id,team`)
      const tsrPicks   = await sbGet(`top_scorer_pick?group_id=eq.${group.id}&select=user_id,player_name`)
      const champMap   = Object.fromEntries(champPicks.map(cp => [cp.user_id, cp.team]))
      const tsrMap     = Object.fromEntries(tsrPicks.map(tp => [tp.user_id, tp.player_name]))

      const payload = buildPayload({ groupName: group.name, date, groupData, finishedGames, globalDistMap, champMap, tsrMap, globalTopUsers, globalZeroUsers })

      // Run all 4 agents
      const candidates = []
      for (let i = 0; i < VERSION_TAGS.length; i++) {
        const tag = VERSION_TAGS[i]
        const prm = promptMap[tag]
        const par = VERSION_PARAMS[tag]
        process.stdout.write(`    [${tag}] ...`)
        try {
          const result = await callAgent(prm.system_prompt, prm.user_prompt_template, group.name, payload, par.temperature, par.seed)
          candidates.push({ version: tag, agent_num: i + 1, ...result })
          console.log(` ${result.content.length} chars | ${result.prompt_tokens}+${result.completion_tokens} tok`)
        } catch (e) {
          console.log(` ERROR: ${e.message}`)
          candidates.push({ version: tag, agent_num: i + 1, content: `ERROR: ${e.message}`, prompt_tokens: 0, completion_tokens: 0 })
        }
        await sleep(1200)
      }

      // Judge
      process.stdout.write(`    [judge] ...`)
      const judgeResult = await callJudge(payload, candidates)
      const winnerVersion = candidates[judgeResult.winner - 1]?.version ?? 'unknown'
      console.log(` winner=${winnerVersion} | ${judgeResult.prompt_tokens}+${judgeResult.completion_tokens} tok`)
      console.log(`           ${judgeResult.reasoning}`)

      // Write CSV rows — one per version
      for (const c of candidates) {
        const scoreObj = (judgeResult.scores ?? []).find(s => s.agent === c.agent_num) ?? {}
        const total    = scoreObj.accuracy !== undefined
          ? Math.round((scoreObj.accuracy * 45 + scoreObj.humor * 30 + scoreObj.compliance * 15 + scoreObj.structure * 10) / 100 * 10) / 10
          : ''
        const row = [
          date, group.name, c.version, c.agent_num,
          JSON.stringify(payload),
          c.content, c.content.length,
          c.prompt_tokens, c.completion_tokens,
          scoreObj.accuracy   ?? '',
          scoreObj.humor      ?? '',
          scoreObj.compliance ?? '',
          scoreObj.structure  ?? '',
          total,
          winnerVersion, judgeResult.reasoning,
          judgeResult.prompt_tokens, judgeResult.completion_tokens,
        ].map(csvCell).join(',') + '\n'
        fs.appendFileSync(outPath, row)
      }

      await sleep(2000)
    }

    await sleep(3000)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Done. Results saved to:\n  ${outPath}`)
}

main().catch(e => { console.error('\nFatal error:', e.message); process.exit(1) })

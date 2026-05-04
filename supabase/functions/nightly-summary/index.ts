// nightly-summary v18
// 4-agent Judge LLM system. Runs v11/v12/v13/v10-baseline in parallel, judge picks winner, saves to ai_summaries.
// POST body: { date: "YYYY-MM-DD", version_id?: "uuid", model?: "gpt-4o-mini" }
//   version_id → TEST MODE: uses that prompt version as agent 1 only (no judge), writes test results back

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

// ─── Constants ───────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  group: 'Group Stage',
  r32:   'Round of 32',
  r16:   'Round of 16',
  qf:    'Quarter-Final',
  sf:    'Semi-Final',
  third: 'Third Place',
  final: 'Final',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FALLBACK_MSG =
  'Our AI analyst called in sick today (probably still recovering from that last-minute equalizer). ' +
  'Summary coming tomorrow — in the meantime, check the leaderboard and start arguing with your group.'

const TIMEOUT_MS    = 120_000
const GROUP_GAP_MS  = 2_000
const OPENAI_MODEL  = 'gpt-4o-mini'
const JUDGE_MODEL   = 'gpt-4o'
const MAX_TOKENS    = 400
const JUDGE_MAX_TOK = 200
const MIN_CONTENT_LEN = 50

// Per-agent parameters
const AGENTS = [
  { slot: 'main',        temperature: 0.6, seed: 42 },
  { slot: 'candidate_2', temperature: 0.5, seed: 43 },
  { slot: 'candidate_3', temperature: 0.4, seed: 44 },
  { slot: 'baseline',    temperature: 0.6, seed: 42 },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function nextUTCDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function outcomeDir(home: number, away: number): 'home_win' | 'draw' | 'away_win' {
  return home > away ? 'home_win' : home < away ? 'away_win' : 'draw'
}

// ─── OpenAI agent call ───────────────────────────────────────────────────────

async function callAgent(
  openai: OpenAI,
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature: number,
  seed: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(5000)
    try {
      const res = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
        max_tokens:  MAX_TOKENS,
        temperature,
        top_p:       1,
        seed,
      })
      const content = res.choices[0]?.message?.content?.trim() ?? ''
      if (content.length >= MIN_CONTENT_LEN) {
        return {
          content,
          promptTokens:     res.usage?.prompt_tokens      ?? 0,
          completionTokens: res.usage?.completion_tokens  ?? 0,
        }
      }
      console.warn(`[agent] response too short (${content.length} chars), attempt ${attempt + 1}`)
    } catch (err: unknown) {
      console.error(`[agent] error attempt ${attempt + 1}:`, (err as Error)?.message)
      if (attempt === 1) throw err
    }
  }
  return { content: FALLBACK_MSG, promptTokens: 0, completionTokens: 0 }
}

// ─── Judge call ──────────────────────────────────────────────────────────────

interface JudgeResult {
  winnerAgent: 1 | 2 | 3 | 4
  reasoning: string
  scores: Array<{
    agent: number
    accuracy: number
    humor: number
    compliance: number
    structure: number
    total: number
  }>
  promptTokens: number
  completionTokens: number
}

const JUDGE_SYSTEM = `You are a judge evaluating four nightly WhatsApp roast summaries for a World Cup prediction group.
Score each on 4 dimensions (0-10 each) and pick one winner.

SCORING WEIGHTS:
- accuracy (45%): No today_exact/total_exact confusion; streak number = abs(streak); no invented facts; scorelines named correctly; champion result correct
- humor (30%): Picks used as rivalry fuel when champion played; specific scoreline named for worst performer; P4 has unique angle with actual numbers (not template); personal not generic
- compliance (15%): No banned words (journey/remarkable/incredible/exciting); no pronouns he/she/his/her; no invented character labels; facts from payload only
- structure (10%): 6 paragraphs; P6 starts "Tomorrow's danger:"; exact point gap between rank 1 and rank 2 appears somewhere; streak referenced in P6

Hard floor: if accuracy <= 3, that candidate is disqualified regardless of other scores.

Return valid JSON only:
{
  "winner": 1 or 2 or 3 or 4,
  "reasoning": "one sentence",
  "scores": [
    {"agent":1,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":2,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":3,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":4,"accuracy":N,"humor":N,"compliance":N,"structure":N}
  ]
}`

async function callJudge(
  openai: OpenAI,
  payload: unknown,
  candidates: Array<{ agent: number; content: string }>,
): Promise<JudgeResult> {
  const candidateBlocks = candidates
    .map(c => `\n\nCANDIDATE ${c.agent} (${c.slot}):\n${c.content}`)
    .join('')
  const userMsg = `PAYLOAD:\n${JSON.stringify(payload)}${candidateBlocks}`

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(3000)
    try {
      const res = await openai.chat.completions.create({
        model:       JUDGE_MODEL,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
        max_tokens:  JUDGE_MAX_TOK,
        temperature: 0.1,
        top_p:       1,
        seed:        1,
        response_format: { type: 'json_object' },
      })
      const raw = res.choices[0]?.message?.content?.trim() ?? '{}'
      const parsed = JSON.parse(raw)
      const winner = Number(parsed.winner) as 1 | 2 | 3 | 4
      if (![1, 2, 3, 4].includes(winner)) throw new Error(`invalid winner: ${winner}`)
      const scores = (parsed.scores ?? []).map((s: Record<string, number>, i: number) => ({
        agent:      s.agent ?? (i + 1),
        accuracy:   s.accuracy   ?? 0,
        humor:      s.humor      ?? 0,
        compliance: s.compliance ?? 0,
        structure:  s.structure  ?? 0,
        total:      Math.round((s.accuracy * 45 + s.humor * 30 + s.compliance * 15 + s.structure * 10) / 100 * 10) / 10,
      }))
      return {
        winnerAgent:      winner,
        reasoning:        String(parsed.reasoning ?? ''),
        scores,
        promptTokens:     res.usage?.prompt_tokens     ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      }
    } catch (err: unknown) {
      console.error(`[judge] error attempt ${attempt + 1}:`, (err as Error)?.message)
      if (attempt === 1) {
        // Fallback: pick agent 1
        return {
          winnerAgent:      1 as 1 | 2 | 3 | 4,
          reasoning:        'Judge failed — defaulted to agent 1',
          scores:           [1,2,3,4].map(a => ({ agent: a, accuracy: 0, humor: 0, compliance: 0, structure: 0, total: 0 })),
          promptTokens:     0,
          completionTokens: 0,
        }
      }
    }
  }
  return { winnerAgent: 1 as 1 | 2 | 3 | 4, reasoning: 'Judge failed', scores: [], promptTokens: 0, completionTokens: 0 }
}

// ─── Payload builder (v17) ────────────────────────────────────────────────────

interface Game {
  id: string
  team_home: string
  team_away: string
  score_home: number
  score_away: number
  phase: string
}

interface GoalEvent {
  game_id: string
  player_name: string | null
  minute: number
  minute_extra: number | null
  detail: string
  team: string
}

interface ChampPick   { user_id: string; team: string }
interface TsrPick     { user_id: string; player_name: string }
// deno-lint-ignore no-explicit-any
type GroupSummaryData = any
// deno-lint-ignore no-explicit-any
type GlobalDist = any

function buildGroupPayload(opts: {
  groupName: string
  date: string
  groupData: GroupSummaryData
  finishedGames: Game[]
  globalDistMap: Record<string, GlobalDist>
  goalScorerMap: Record<string, GoalEvent[]>
  champPicks: ChampPick[]
  tsrPicks: TsrPick[]
  statsReady: boolean
  globalSortedUsers: Array<{ uid: string; user: string; pts: number; all_auto: boolean }>
  globalRankByUserGroup: Record<string, Record<string, number>>
  groupId: string
}) {
  const { groupName, date, groupData, finishedGames, globalDistMap,
          goalScorerMap, champPicks, tsrPicks, statsReady, globalSortedUsers,
          globalRankByUserGroup, groupId } = opts

  const gameByKey: Record<string, Game> = {}
  for (const g of finishedGames) {
    gameByKey[`${g.team_home}|${g.team_away}`] = g
  }

  const champMap: Record<string, string> = {}
  for (const cp of champPicks) champMap[cp.user_id] = cp.team

  const tsrMap: Record<string, string> = {}
  for (const tp of tsrPicks) tsrMap[tp.user_id] = tp.player_name

  // Player goals today
  const playerGoalsToday: Record<string, number> = {}
  if (statsReady) {
    for (const events of Object.values(goalScorerMap)) {
      for (const ev of events) {
        if (ev.detail !== 'Own Goal' && ev.player_name) {
          playerGoalsToday[ev.player_name] = (playerGoalsToday[ev.player_name] ?? 0) + 1
        }
      }
    }
  }

  // Per-member today points + today_exact count
  const memberTodayPts: Record<string, number> = {}
  const memberTodayExact: Record<string, number> = {}
  // deno-lint-ignore no-explicit-any
  for (const m of (groupData.members ?? []) as any[]) {
    let pts = 0; let exact = 0
    // deno-lint-ignore no-explicit-any
    for (const p of (m.predictions ?? []) as any[]) {
      pts += (p.points ?? 0)
      if ((p.points ?? 0) === 3) exact++
    }
    memberTodayPts[m.username]   = pts
    memberTodayExact[m.username] = exact
  }

  // Group-level prediction distribution per game
  const grpDistByGameId: Record<string, { home: number; draw: number; away: number; n: number; scores: Record<string, number> }> = {}
  // deno-lint-ignore no-explicit-any
  for (const game of (groupData.games ?? []) as any[]) {
    const fg = gameByKey[`${game.team_home}|${game.team_away}`]
    if (!fg) continue
    const dist = { home: 0, draw: 0, away: 0, n: 0, scores: {} as Record<string, number> }
    // deno-lint-ignore no-explicit-any
    for (const m of (groupData.members ?? []) as any[]) {
      // deno-lint-ignore no-explicit-any
      const pred = (m.predictions ?? []).find((p: any) => p.game_id === fg.id)
      if (!pred) continue
      dist.n++
      if      (pred.pred_home > pred.pred_away)  dist.home++
      else if (pred.pred_home === pred.pred_away) dist.draw++
      else                                        dist.away++
      const sk = `${pred.pred_home}-${pred.pred_away}`
      dist.scores[sk] = (dist.scores[sk] ?? 0) + 1
    }
    grpDistByGameId[fg.id] = dist
  }

  // Group member set for in_group flag
  // deno-lint-ignore no-explicit-any
  const groupMemberSet = new Set<string>((groupData.members ?? []).map((m: any) => m.user_id as string))

  // Champion team → game result lookup (for champion_played_today + champion_result)
  const champTeamResult: Record<string, { played: boolean; result: 'win' | 'draw' | 'loss' }> = {}
  for (const fg of finishedGames) {
    const result = outcomeDir(fg.score_home, fg.score_away)
    // home team
    champTeamResult[fg.team_home] = {
      played: true,
      result: result === 'home_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
    }
    // away team
    champTeamResult[fg.team_away] = {
      played: true,
      result: result === 'away_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
    }
  }

  // ── Leaderboard ──
  // deno-lint-ignore no-explicit-any
  const leaderboard = (groupData.leaderboard ?? [] as any[]).map((row: any) => {
    // deno-lint-ignore no-explicit-any
    const member = (groupData.members ?? []).find((m: any) => m.username === row.username)
    const uid = member?.user_id as string | undefined
    return {
      group_rank:   row.group_rank,
      global_rank:  uid ? (globalRankByUserGroup[uid]?.[groupId] ?? null) : null,
      user:         row.username,
      total_pts:    row.total_points,
      total_exact:  row.exact_scores,
      today_exact:  memberTodayExact[row.username] ?? 0,
      today_pts:    memberTodayPts[row.username]   ?? 0,
      streak:       member?.current_streak ?? 0,
    }
  })

  // ── Games ──
  // deno-lint-ignore no-explicit-any
  const games = (groupData.games ?? [] as any[]).map((game: any) => {
    const fg     = gameByKey[`${game.team_home}|${game.team_away}`]
    const gameId = fg?.id

    // Goal scorers
    const scorers: string[] = []
    if (statsReady && gameId && goalScorerMap[gameId]) {
      for (const ev of goalScorerMap[gameId]) {
        const min  = ev.minute_extra ? `${ev.minute}+${ev.minute_extra}'` : `${ev.minute}'`
        const type = ev.detail === 'Penalty' ? '(pen)' : ev.detail === 'Own Goal' ? '(og)' : ''
        scorers.push(`${ev.player_name ?? 'Unknown'} ${min}${type}`.trim())
      }
    }

    const gd    = gameId ? (globalDistMap[gameId] ?? null) : null
    const gdTotal = gd?.total ?? 0
    const grp   = gameId ? (grpDistByGameId[gameId] ?? null) : null
    const grpN  = grp?.n ?? 0

    // group_exact_n
    let groupExactN = 0
    if (fg) {
      // deno-lint-ignore no-explicit-any
      for (const m of (groupData.members ?? []) as any[]) {
        // deno-lint-ignore no-explicit-any
        const pred = (m.predictions ?? []).find((p: any) => p.game_id === fg.id)
        if (pred && pred.pred_home === fg.score_home && pred.pred_away === fg.score_away) groupExactN++
      }
    }

    // group_upset
    let groupUpset = false
    if (fg && grp && grpN > 0) {
      const resultDir   = outcomeDir(fg.score_home, fg.score_away)
      const majorityDir = grp.home >= grp.draw && grp.home >= grp.away ? 'home_win'
                        : grp.away > grp.draw && grp.away > grp.home   ? 'away_win'
                        : 'draw'
      groupUpset = resultDir !== majorityDir
    }

    // global_upset
    let globalUpset = false
    if (fg && gdTotal > 0) {
      const resultDir   = outcomeDir(fg.score_home, fg.score_away)
      const majorityDir = gd.home_win >= gd.draw && gd.home_win >= gd.away_win ? 'home_win'
                        : gd.away_win > gd.draw && gd.away_win > gd.home_win   ? 'away_win'
                        : 'draw'
      globalUpset = resultDir !== majorityDir
    }

    // dist_global top_score analysis
    let distGlobal: Record<string, unknown> | null = null
    if (gdTotal > 0) {
      const topScore   = gd.top_scores?.[0]?.score ?? null
      const topScoreN  = gd.top_scores?.[0]?.count ?? null
      const topScore2N = gd.top_scores?.[1]?.count ?? null
      const tied       = topScoreN !== null && topScore2N !== null && topScoreN === topScore2N

      // Which group members predicted the global top_score?
      const groupOnTopScore: string[] = []
      if (topScore && !tied && fg) {
        // deno-lint-ignore no-explicit-any
        for (const m of (groupData.members ?? []) as any[]) {
          // deno-lint-ignore no-explicit-any
          const pred = (m.predictions ?? []).find((p: any) => p.game_id === fg.id)
          if (pred) {
            const predStr = `${pred.pred_home}-${pred.pred_away}`
            if (predStr === topScore) groupOnTopScore.push(m.username)
          }
        }
      }

      distGlobal = {
        home_pct:         Math.round((gd.home_win / gdTotal) * 100),
        draw_pct:         Math.round((gd.draw     / gdTotal) * 100),
        away_pct:         Math.round((gd.away_win / gdTotal) * 100),
        n:                gdTotal,
        exact_hits:       gd.exact_count ?? 0,
        top_score:        topScore,
        top_score_n:      topScoreN,
        top_score_tied:   tied,
        group_on_top_score: groupOnTopScore,
      }
    }

    const result = fg ? outcomeDir(fg.score_home, fg.score_away) : null

    return {
      match:         `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away}`,
      home_team:     game.team_home,
      away_team:     game.team_away,
      home_score:    game.score_home,
      away_score:    game.score_away,
      result,
      phase_label:   PHASE_LABELS[game.phase] ?? game.phase,
      group_exact_n: groupExactN,
      global_exact_n: gd ? (gd.exact_count ?? 0) : 0,
      group_upset:   groupUpset,
      global_upset:  globalUpset,
      scorers:       statsReady ? scorers : null,
      dist_group:    grpN > 0 ? {
        home_pct: Math.round((grp!.home / grpN) * 100),
        draw_pct: Math.round((grp!.draw / grpN) * 100),
        away_pct: Math.round((grp!.away / grpN) * 100),
        n:        grpN,
      } : null,
      dist_global: distGlobal,
    }
  })

  // ── Predictions (per member, per game) ──
  // deno-lint-ignore no-explicit-any
  const predictions = (groupData.members ?? [] as any[]).map((m: any) => ({
    user:      m.username,
    today_pts: memberTodayPts[m.username] ?? 0,
    // deno-lint-ignore no-explicit-any
    preds: (m.predictions ?? []).map((p: any) => {
      const fg = finishedGames.find(g => g.id === p.game_id)
      const matchStr = fg
        ? `${fg.team_home} ${fg.score_home}-${fg.score_away} ${fg.team_away}`
        : p.game_id
      const actualResult = fg ? outcomeDir(fg.score_home, fg.score_away) : null
      const predResult   = outcomeDir(p.pred_home, p.pred_away)
      const isExact      = fg
        ? (p.pred_home === fg.score_home && p.pred_away === fg.score_away)
        : false
      return {
        game:        matchStr,
        result:      actualResult,
        pred:        `${p.pred_home}-${p.pred_away}`,
        pred_result: predResult,
        pts:         p.points,
        exact:       isExact,
        auto:        p.is_auto,
      }
    }),
  }))

  // ── Picks ──
  // deno-lint-ignore no-explicit-any
  const picksRaw = (groupData.members ?? [] as any[]).map((m: any) => {
    const champion  = champMap[m.user_id] ?? null
    const topScorer = tsrMap[m.user_id]   ?? null

    // champion_played_today + champion_result
    const champInfo = champion ? champTeamResult[champion] : null
    const champPlayedToday = champInfo?.played ?? false
    const champResult      = champPlayedToday ? champInfo!.result : undefined

    const scorerGoals = (statsReady && topScorer)
      ? (playerGoalsToday[topScorer] ?? 0)
      : null

    const pick: Record<string, unknown> = {
      user:                 m.username,
      champion,
      top_scorer:           topScorer,
      scorer_goals_today:   scorerGoals,
      scorer_total_goals:   null,    // populated when stats available from player_stats table
      scorer_tournament_rank: null,
    }
    if (champion) {
      pick.champion_played_today = champPlayedToday
      if (champPlayedToday) pick.champion_result = champResult
    }
    return pick
  })

  // Omit picks entirely if all champion + top_scorer are null
  const anyPickSet = picksRaw.some(p => p.champion !== null || p.top_scorer !== null)
  const picks = anyPickSet ? picksRaw : undefined

  return {
    group: groupName,
    date,
    leaderboard,
    today: {
      global_top: globalSortedUsers
        .filter(u => u.pts > 0)
        .slice(0, 3)
        .map(u => ({ user: u.user, pts: u.pts, in_group: groupMemberSet.has(u.uid) })),
      global_zero: globalSortedUsers
        .filter(u => u.pts === 0)
        .map(u => ({ user: u.user, all_auto: u.all_auto, in_group: groupMemberSet.has(u.uid) })),
    },
    games,
    predictions,
    ...(picks ? { picks } : {}),
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const startMs = Date.now()

  let date: string
  let versionId: string | undefined
  let modelOverride: string | undefined
  try {
    const body    = await req.json()
    date          = body.date
    versionId     = body.version_id
    modelOverride = body.model
    if (!date) return json({ error: 'date required' }, 400)
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const testMode       = !!versionId
  const effectiveModel = (testMode && modelOverride) ? modelOverride : OPENAI_MODEL

  const srk      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase  = createClient(Deno.env.get('SUPABASE_URL')!, srk)
  const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('AI_Summary_GPT_Key') || ''
  const openai    = new OpenAI({ apiKey: openaiKey })

  const dayStart = `${date}T00:00:00Z`
  const dayEnd   = `${nextUTCDay(date)}T00:00:00Z`

  // 3. Fetch today's games
  const { data: allGames, error: gamesErr } = await supabase
    .from('games')
    .select('id, team_home, team_away, score_home, score_away, phase')
    .gte('kick_off_time', dayStart)
    .lt ('kick_off_time', dayEnd)

  if (gamesErr) {
    console.error('[guard] games fetch error:', gamesErr.message)
    return json({ error: 'db_error', detail: gamesErr.message }, 500)
  }

  const finishedGames = (allGames ?? []).filter(g => g.score_home !== null) as Game[]

  if (finishedGames.length === 0) return json({ reason: 'no_games_today', processed: 0 })
  if (finishedGames.length < (allGames ?? []).length) {
    return json({ reason: 'games_not_finished', finished: finishedGames.length, total: allGames!.length })
  }

  const gameIds = finishedGames.map(g => g.id)

  // 4. Stats check
  const { count: statsCount } = await supabase
    .from('game_player_stats')
    .select('*', { count: 'exact', head: true })
    .in('game_id', gameIds)
  const statsReady = (statsCount ?? 0) > 0

  // 5. Load prompts by agent_slot (3 agents) — or single prompt in test mode
  let agentPrompts: Array<{ slot: string; promptRow: Record<string, unknown> }> = []

  if (testMode) {
    const { data: pRow, error: pErr } = await supabase
      .from('prompt_versions').select('*').eq('id', versionId!).single()
    if (pErr || !pRow) return json({ error: 'no_prompt_for_version_id' }, 500)
    agentPrompts = [{ slot: 'main', promptRow: pRow }]
  } else {
    const { data: pRows, error: pErr } = await supabase
      .from('prompt_versions')
      .select('*')
      .in('agent_slot', ['main', 'candidate_2', 'candidate_3', 'baseline'])
      .not('agent_slot', 'is', null)
      .order('version_tag', { ascending: false })

    // Fallback: use active prompt if no agent_slot prompts found
    if (pErr || !pRows || pRows.length === 0) {
      console.warn('[prompt] no agent_slot prompts found, falling back to active prompt')
      const { data: fallbackRow, error: fbErr } = await supabase
        .from('prompt_versions').select('*').eq('is_active', true).single()
      if (fbErr || !fallbackRow) return json({ error: 'no_active_prompt' }, 500)
      agentPrompts = [{ slot: 'main', promptRow: fallbackRow }]
    } else {
      // Pick latest version per slot
      const seen = new Set<string>()
      for (const row of pRows) {
        const slot = row.agent_slot as string
        if (!seen.has(slot)) {
          seen.add(slot)
          agentPrompts.push({ slot, promptRow: row })
        }
      }
    }
  }

  // 6. Qualifying groups
  const { data: allGroups } = await supabase.from('groups').select('id, name')
  const qualifyingGroups: { id: string; name: string }[] = []
  for (const g of allGroups ?? []) {
    const { count } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', g.id)
      .eq('is_inactive', false)
    if ((count ?? 0) >= 3) qualifyingGroups.push(g)
  }
  if (qualifyingGroups.length === 0) return json({ reason: 'no_qualifying_groups', processed: 0 })

  // 7. Shared data — fetched once

  // 7a. Goal scorers
  const goalScorerMap: Record<string, GoalEvent[]> = {}
  if (statsReady) {
    const { data: events } = await supabase
      .from('game_events')
      .select('game_id, player_name, minute, minute_extra, detail, team')
      .in('game_id', gameIds)
      .eq('event_type', 'goal')
      .order('minute', { ascending: true })
    for (const ev of events ?? []) {
      if (!goalScorerMap[ev.game_id]) goalScorerMap[ev.game_id] = []
      goalScorerMap[ev.game_id].push(ev as GoalEvent)
    }
  }

  // 7b. Global prediction distributions
  const globalDistMap: Record<string, GlobalDist> = {}
  for (const game of finishedGames) {
    const { data: dist } = await supabase.rpc('get_game_prediction_distribution', { p_game_id: game.id })
    if (dist) globalDistMap[game.id] = dist
  }

  // 7c. Global today's points per user
  const { data: globalPreds } = await supabase
    .from('predictions')
    .select('user_id, game_id, points_earned, is_auto')
    .in('game_id', gameIds)

  // deno-lint-ignore no-explicit-any
  const globalUserAgg: Record<string, { uid: string; gamesPts: Record<string, number>; predCount: number; autoCount: number }> = {}
  // deno-lint-ignore no-explicit-any
  for (const p of (globalPreds ?? []) as any[]) {
    const uid = p.user_id as string
    const gid = p.game_id as string
    if (!globalUserAgg[uid]) globalUserAgg[uid] = { uid, gamesPts: {}, predCount: 0, autoCount: 0 }
    globalUserAgg[uid].gamesPts[gid] = Math.max(globalUserAgg[uid].gamesPts[gid] ?? 0, p.points_earned ?? 0)
    globalUserAgg[uid].predCount++
    if (p.is_auto) globalUserAgg[uid].autoCount++
  }

  const globalUids = Object.keys(globalUserAgg)
  const usernameMap: Record<string, string> = {}
  if (globalUids.length > 0) {
    const { data: profileRows } = await supabase.from('profiles').select('id, username').in('id', globalUids)
    for (const pr of (profileRows ?? []) as { id: string; username: string }[]) {
      usernameMap[pr.id] = pr.username
    }
  }

  const globalSortedUsers = Object.values(globalUserAgg)
    .map(u => ({
      uid:      u.uid,
      user:     usernameMap[u.uid] ?? u.uid,
      pts:      Object.values(u.gamesPts).reduce((s, v) => s + v, 0),
      all_auto: u.predCount > 0 && u.autoCount === u.predCount,
    }))
    .sort((a, b) => b.pts - a.pts)

  // 7d. Global rank per (user × group)
  const [{ data: predTotals }, { data: champTotals }, { data: tsrTotals }] = await Promise.all([
    supabase.from('predictions').select('user_id, group_id, points_earned')
      .not('points_earned', 'is', null).not('group_id', 'is', null),
    supabase.from('champion_pick').select('user_id, group_id, points_earned')
      .not('points_earned', 'is', null),
    supabase.from('top_scorer_pick').select('user_id, group_id, points_earned')
      .not('points_earned', 'is', null),
  ])

  const userGroupPts:   Record<string, Record<string, number>> = {}
  const userGroupExact: Record<string, Record<string, number>> = {}

  function addUGPts(uid: string, gid: string, pts: number) {
    if (!userGroupPts[uid]) userGroupPts[uid] = {}
    userGroupPts[uid][gid] = (userGroupPts[uid][gid] ?? 0) + pts
  }
  // deno-lint-ignore no-explicit-any
  for (const p of (predTotals ?? []) as any[]) {
    addUGPts(p.user_id, p.group_id, p.points_earned ?? 0)
    if ((p.points_earned ?? 0) === 3) {
      if (!userGroupExact[p.user_id]) userGroupExact[p.user_id] = {}
      userGroupExact[p.user_id][p.group_id] = (userGroupExact[p.user_id][p.group_id] ?? 0) + 1
    }
  }
  // deno-lint-ignore no-explicit-any
  for (const p of (champTotals ?? []) as any[]) addUGPts(p.user_id, p.group_id, p.points_earned ?? 0)
  // deno-lint-ignore no-explicit-any
  for (const p of (tsrTotals ?? []) as any[]) addUGPts(p.user_id, p.group_id, p.points_earned ?? 0)

  const allUGPairs = Object.entries(userGroupPts).flatMap(([uid, groups]) =>
    Object.entries(groups).map(([gid, pts]) => ({ uid, gid, pts, exact: userGroupExact[uid]?.[gid] ?? 0 }))
  ).sort((a, b) => b.pts - a.pts || b.exact - a.exact)

  const globalRankByUserGroup: Record<string, Record<string, number>> = {}
  let ugRank = 1
  for (let ri = 0; ri < allUGPairs.length; ri++) {
    if (ri > 0 && (allUGPairs[ri].pts !== allUGPairs[ri-1].pts || allUGPairs[ri].exact !== allUGPairs[ri-1].exact)) ugRank = ri + 1
    const { uid, gid } = allUGPairs[ri]
    if (!globalRankByUserGroup[uid]) globalRankByUserGroup[uid] = {}
    globalRankByUserGroup[uid][gid] = ugRank
  }

  // 8. Process each group
  let processed = 0; let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < qualifyingGroups.length; i++) {
    if (Date.now() - startMs > TIMEOUT_MS) {
      console.warn(`[timeout] stopping at group index ${i}`)
      errors.push(`timeout: only processed ${processed}/${qualifyingGroups.length} groups`)
      break
    }
    if (i > 0) await sleep(GROUP_GAP_MS)

    const group = qualifyingGroups[i]
    console.log(`[group] processing: ${group.name} (${group.id})`)

    try {
      // 8a. Group summary data
      const { data: groupData, error: gdErr } = await supabase.rpc('get_group_summary_data', {
        p_group_id: group.id,
        p_date:     date,
      })
      if (gdErr || !groupData) {
        console.error(`[group] get_group_summary_data failed for ${group.name}:`, gdErr?.message)
        skipped++; errors.push(`${group.name}: group data unavailable`); continue
      }

      // 8b. Picks
      const [{ data: champPicks }, { data: tsrPicks }] = await Promise.all([
        supabase.from('champion_pick').select('user_id, team').eq('group_id', group.id),
        supabase.from('top_scorer_pick').select('user_id, player_name').eq('group_id', group.id),
      ])

      // 8c. Build payload
      const payload = buildGroupPayload({
        groupName:            group.name,
        date,
        groupData,
        finishedGames,
        globalDistMap,
        goalScorerMap,
        champPicks:           (champPicks ?? []) as ChampPick[],
        tsrPicks:             (tsrPicks   ?? []) as TsrPick[],
        statsReady,
        globalSortedUsers,
        globalRankByUserGroup,
        groupId:              group.id,
      })

      // 8d. Run agents
      let candidates: Array<{
        agent: number; slot: string; content: string; model: string
        prompt_tokens: number; completion_tokens: number
        temperature: number; seed: number; char_len: number
        prompt_version_id: string
      }>

      if (testMode || agentPrompts.length === 1) {
        // Single-agent mode (test mode or no agent_slot prompts found)
        const ap = agentPrompts[0]
        const agentCfg = AGENTS[0]
        const userMsg  = (ap.promptRow.user_prompt_template as string)
          .replace('{{group_name}}', group.name)
          .replace('{{group_json}}', JSON.stringify(payload))
        const result = await callAgent(
          openai, ap.promptRow.system_prompt as string, userMsg,
          effectiveModel, agentCfg.temperature, agentCfg.seed,
        )
        candidates = [{
          agent: 1, slot: ap.slot, content: result.content, model: effectiveModel,
          prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens,
          temperature: agentCfg.temperature, seed: agentCfg.seed, char_len: result.content.length,
          prompt_version_id: ap.promptRow.id as string,
        }]
      } else {
        // 3-agent parallel mode
        const agentResults = await Promise.all(
          agentPrompts.map((ap, idx) => {
            const agentCfg = AGENTS.find(a => a.slot === ap.slot) ?? AGENTS[idx] ?? AGENTS[0]
            const userMsg  = (ap.promptRow.user_prompt_template as string)
              .replace('{{group_name}}', group.name)
              .replace('{{group_json}}', JSON.stringify(payload))
            return callAgent(
              openai, ap.promptRow.system_prompt as string, userMsg,
              effectiveModel, agentCfg.temperature, agentCfg.seed,
            ).then(r => ({
              agent: idx + 1, slot: ap.slot, ...r,
              temperature:       agentCfg.temperature,
              seed:              agentCfg.seed,
              prompt_version_id: ap.promptRow.id as string,
            }))
          })
        )
        candidates = agentResults.map(r => ({
          agent:             r.agent,
          slot:              r.slot,
          content:           r.content,
          model:             effectiveModel,
          prompt_tokens:     r.promptTokens,
          completion_tokens: r.completionTokens,
          temperature:       r.temperature,
          seed:              r.seed,
          char_len:          r.content.length,
          prompt_version_id: r.prompt_version_id,
        }))
      }

      // 8e. Judge (only when 3 agents ran)
      let winnerAgent: 1 | 2 | 3 | 4 = 1
      let judgeResult: JudgeResult | null = null
      let judgeRunId: string | null = null

      if (!testMode && candidates.length >= 3) {
        judgeResult = await callJudge(openai, payload, candidates)
        winnerAgent = judgeResult.winnerAgent

        // Insert ai_judge_runs
        const candidatesJsonb = candidates.map((c, idx) => ({
          agent:             c.agent,
          slot:              c.slot,
          prompt_version_id: c.prompt_version_id,
          content:           c.content,
          model:             c.model,
          prompt_tokens:     c.prompt_tokens,
          completion_tokens: c.completion_tokens,
          temperature:       c.temperature,
          seed:              c.seed,
          char_len:          c.char_len,
          ...(judgeResult!.scores[idx] ?? {}),
        }))

        const { data: judgeRun, error: jrErr } = await supabase
          .from('ai_judge_runs')
          .upsert({
            group_id:               group.id,
            date,
            candidates:             candidatesJsonb,
            winner_agent:           winnerAgent,
            judge_reasoning:        judgeResult.reasoning,
            judge_model:            JUDGE_MODEL,
            judge_prompt_tokens:    judgeResult.promptTokens,
            judge_completion_tokens: judgeResult.completionTokens,
          }, { onConflict: 'group_id,date' })
          .select('id')
          .single()

        if (!jrErr && judgeRun) judgeRunId = judgeRun.id
        else console.warn(`[judge_run] insert failed for ${group.name}:`, jrErr?.message)
      }

      // 8f. Upsert winning summary
      const winner = candidates.find(c => c.agent === winnerAgent) ?? candidates[0]
      const winnerPromptRow = agentPrompts.find(ap => ap.slot === winner.slot)?.promptRow
        ?? agentPrompts[0].promptRow

      const summary = {
        group_id:          group.id,
        date,
        content:           winner.content,
        games_count:       finishedGames.length,
        model:             effectiveModel,
        prompt_tokens:     winner.prompt_tokens  || null,
        completion_tokens: winner.completion_tokens || null,
        prompt_version_id: winnerPromptRow.id as string,
        input_json:        payload,
        temperature:       winner.temperature,
        top_p:             1,
        max_tokens:        MAX_TOKENS,
        seed:              winner.seed,
        ...(judgeRunId    ? { judge_run_id: judgeRunId }   : {}),
        ...(candidates.length >= 3 ? { winner_agent: winnerAgent } : {}),
      }

      let { error: upsertErr } = await supabase
        .from('ai_summaries')
        .upsert(summary, { onConflict: 'group_id,date' })

      if (upsertErr) {
        const { error: retryErr } = await supabase
          .from('ai_summaries')
          .upsert(summary, { onConflict: 'group_id,date' })
        upsertErr = retryErr ?? null
      }

      if (upsertErr) {
        console.error(`[upsert] failed for ${group.name}:`, upsertErr.message)
        await supabase.from('failed_summaries').insert({
          group_id: group.id, date, content: winner.content, error_msg: upsertErr.message,
        })
        errors.push(`${group.name}: upsert failed → failed_summaries`)
        skipped++; continue
      }

      // 8g. Write display_data (global ranks per member)
      const globalRanks: Record<string, number> = {}
      // deno-lint-ignore no-explicit-any
      for (const m of (groupData.members ?? []) as any[]) {
        const rank = globalRankByUserGroup[m.user_id as string]?.[group.id]
        if (rank != null) globalRanks[m.username as string] = rank
      }
      await supabase
        .from('ai_summaries')
        .update({ display_data: { global_ranks: globalRanks } })
        .eq('group_id', group.id)
        .eq('date', date)

      // 8h. Test mode: write results back
      if (testMode) {
        await supabase
          .from('prompt_versions')
          .update({
            test_input:       payload,
            test_output:      winner.content,
            test_model:       effectiveModel,
            test_tokens_in:   winner.prompt_tokens,
            test_tokens_out:  winner.completion_tokens,
            test_temperature: winner.temperature,
            test_top_p:       1,
            test_max_tokens:  MAX_TOKENS,
            test_seed:        winner.seed,
            tested_at:        new Date().toISOString(),
          })
          .eq('id', versionId!)
      }

      console.log(`[group] done: ${group.name} (agent ${winnerAgent}, ${winner.content.length} chars)`)
      processed++

    } catch (err: unknown) {
      console.error(`[group] unexpected error for ${group.name}:`, (err as Error)?.message)
      skipped++; errors.push(`${group.name}: ${(err as Error)?.message ?? 'unknown error'}`)
    }
  }

  return json({
    processed,
    skipped,
    total_groups:  qualifyingGroups.length,
    test_mode:     testMode,
    agent_count:   agentPrompts.length,
    errors,
    elapsed_ms:    Date.now() - startMs,
  })
})

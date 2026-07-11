// nightly-summary v35
// v35 (2026-05-28): Global-rank source switched from JS recompute → `get_leaderboard()` RPC.
//   Previously summed predictions/champion_pick/top_scorer_pick in JS to derive rank — hit the
//   Supabase JS-client default 1000-row cap once predictions table grew past it; ranks were silently
//   wrong (verified: Test3 stored Itay=1 vs true 2). Now reads the canonical SQL leaderboard → one
//   source of truth, no cap risk. Defensive `.range(0,99999)` added to the remaining JS-driver
//   queries (`games` match-day, `groups`, `predictions` by game_id IN) for future-proofing.
// v25: Accept group_id in body — single-group mode (per-group cron, Option B). No group_id = legacy loop (manual/test).
// 5-agent Judge LLM system. Runs v11/v12/v13/v10B/v10-baseline in parallel, judge picks winner, saves to ai_summaries.
// v19: Judge verification-first approach (accuracy checklist with per-error deductions). JUDGE_MAX_TOK 200→350.
// v20: Prompt fine-tuning — pronoun "him" ban (all 3), v12 P4 "struggling" ban + hard check, v11 structure fixes (6-para rule, P6 no match data, P5 late-drama removed).
// v22: Judge — expand direction check to cover synonym phrases; add champion-as-team deduction; specific reasoning rule. Prompts — champion confusion guard; v12 direction synonym fix.
// v23: candidates JSONB includes version_tag; ai_summaries includes winner_score.
// v24: Judge — add today_pts vs total_pts explicit check; reasoning must quote winning line. v13 — ban verbatim "not just this group" opener.
// v36 (fact-lock v14): buildGroupPayload output enriched via enrichSummaryPayload() — crowd_line/crowd_correct/missed_by/nailed_by per game, gap fields + standings on leaderboard, champion_line/scorer_line on picks, and a p4{focus_game,angle,locked,recap,members} object. Additive only; prompts updated separately.
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
const JUDGE_MAX_TOK = 350
const MIN_CONTENT_LEN = 50

// Per-agent parameters
const AGENTS = [
  { slot: 'main',        temperature: 0.6, seed: 42 },
  { slot: 'candidate_2', temperature: 0.5, seed: 43 },
  { slot: 'candidate_3', temperature: 0.4, seed: 44 },
  { slot: 'baseline',    temperature: 0.6, seed: 42 },
  { slot: 'candidate_4', temperature: 0.6, seed: 42 },
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

// ─── Summary payload enrichment (fact-lock v14) ──────────────────────────────
// Additive: computes ready-made, polarity-correct facts so the model copies rather than derives.
function outcomeTeamOf(g: any, outcome: string | null): string {
  if (outcome === 'home_win') return g.home_team
  if (outcome === 'away_win') return g.away_team
  return 'a draw'
}
function backedPctOf(dist: any, result: string | null): number {
  if (!dist) return 0
  if (result === 'home_win') return dist.home_pct
  if (result === 'away_win') return dist.away_pct
  return dist.draw_pct
}
function crowdLineOf(g: any, dist: any, pool: string): string | null {
  if (!dist || dist.n == null) return null
  const backed = backedPctOf(dist, g.result)
  const winTxt = outcomeTeamOf(g, g.result)
  const top = Math.max(dist.home_pct, dist.draw_pct, dist.away_pct)
  const topCount = [dist.home_pct, dist.draw_pct, dist.away_pct].filter((x: number) => x === top).length
  if (topCount > 1) return `${pool} was split (${dist.home_pct}/${dist.draw_pct}/${dist.away_pct} home/draw/away); ${backed}% had ${winTxt}`
  const maj = dist.home_pct === top ? 'home_win' : dist.away_pct === top ? 'away_win' : 'draw'
  if (maj === g.result) return `${backed}% of ${pool} backed ${winTxt}, who delivered`
  return `only ${backed}% of ${pool} backed ${winTxt}; ${pool} leaned toward ${outcomeTeamOf(g, maj)} and got it wrong`
}
function computeP4(p: any): any {
  const games = p.games || []
  if (!games.length) return null
  const feat = games.map((g: any) => {
    const dg = g.dist_group || {}, dgl = g.dist_global || {}
    const topShare = Math.max(dg.home_pct || 0, dg.draw_pct || 0, dg.away_pct || 0)
    const topOutcome = (dg.home_pct || 0) === topShare ? 'home_win' : (dg.away_pct || 0) === topShare ? 'away_win' : 'draw'
    const t = Math.max(dgl.home_pct || 0, dgl.draw_pct || 0, dgl.away_pct || 0)
    const fieldTop = (dgl.home_pct || 0) === t ? 'home_win' : (dgl.away_pct || 0) === t ? 'away_win' : 'draw'
    const exact_by = (p.predictions || [])
      .filter((u: any) => (u.preds || []).some((x: any) => x.game === g.match && x.exact === true))
      .map((u: any) => u.user)
    return {
      match: g.match, winnerText: outcomeTeamOf(g, g.result),
      pct_group: backedPctOf(g.dist_group, g.result), pct_field: backedPctOf(g.dist_global, g.result),
      topShare, top_is_result: topOutcome === g.result,
      field_correct: (g.dist_global && g.dist_global.n != null) ? (fieldTop === g.result) : false,
      group_exact_n: g.group_exact_n || 0, global_exact_n: g.global_exact_n || 0,
      exact_score: `${g.home_score}-${g.away_score}`,
      missed_by: g.missed_by || [], nailed_by: g.nailed_by || [], exact_by,
    }
  })
  const flex = feat.filter((f: any) => f.group_exact_n >= 3).sort((a: any, b: any) => b.group_exact_n - a.group_exact_n)[0]
  let pick: any, angle: string
  if (flex) { pick = flex; angle = 'EXACT_FLEX' }
  else {
    const sorted = feat.slice().sort((a: any, b: any) =>
      (b.topShare - a.topShare) ||
      ((a.top_is_result ? 1 : 0) - (b.top_is_result ? 1 : 0)) ||
      (Math.abs(b.pct_group - b.pct_field) - Math.abs(a.pct_group - a.pct_field)))
    pick = sorted[0]; angle = pick.top_is_result ? 'MOST_RIGHT' : 'MOST_WRONG'
  }
  let locked: string
  if (angle === 'EXACT_FLEX') {
    locked = `${pick.group_exact_n} in the group nailed ${pick.exact_score} exactly in ${pick.match} — the whole field only managed ${pick.global_exact_n}.`
  } else if (angle === 'MOST_WRONG') {
    locked = pick.field_correct
      ? `${100 - pick.pct_group}% of the group backed the wrong side in ${pick.match}; the field wasn't fooled — ${pick.pct_field}% had ${pick.winnerText}.`
      : `${100 - pick.pct_group}% of the group got ${pick.match} wrong — but even the field mostly missed it, only ${pick.pct_field}% had ${pick.winnerText}.`
  } else {
    const rel = pick.pct_group > pick.pct_field ? "ahead of the field's" : "vs the field's"
    locked = `${pick.pct_group}% of the group called ${pick.winnerText} in ${pick.match}, ${rel} ${pick.pct_field}%.`
  }
  const recapEntries = (p.predictions || [])
    .map((u: any) => { const pr = (u.preds || []).find((x: any) => x.game === pick.match); return pr ? { user: u.user, pred: pr.pred, pts: pr.pts || 0, auto: !!pr.auto } : null })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.pts - a.pts) || a.user.localeCompare(b.user))
  const recap = recapEntries.length
    ? `${pick.match}: ` + recapEntries.map((e: any) => `${e.user} ${e.pred}${e.auto ? ' auto' : ''} (${e.pts}pt${e.pts === 1 ? '' : 's'})`).join(', ')
    : null
  return {
    focus_game: pick.match, angle, pct_group: pick.pct_group, pct_field: pick.pct_field,
    group_exact_n: pick.group_exact_n, global_exact_n: pick.global_exact_n, exact_score: pick.exact_score,
    locked, recap, members: { missed_by: pick.missed_by, nailed_by: pick.nailed_by, exact_by: pick.exact_by },
  }
}
function enrichSummaryPayload(p: any): void {
  for (const g of (p.games || [])) {
    const dg = g.dist_group, dgl = g.dist_global
    const hasG = dgl && dgl.n != null
    const topG = hasG ? Math.max(dgl.home_pct, dgl.draw_pct, dgl.away_pct) : null
    const splitG = hasG && [dgl.home_pct, dgl.draw_pct, dgl.away_pct].filter((x: number) => x === topG).length > 1
    const majG = hasG && !splitG ? (dgl.home_pct === topG ? 'home_win' : dgl.away_pct === topG ? 'away_win' : 'draw') : null
    g.favorite_team = majG ? outcomeTeamOf(g, majG) : null
    g.crowd_correct = majG ? (majG === g.result) : null
    g.result_backed_pct = hasG ? backedPctOf(dgl, g.result) : null
    g.crowd_line_group = crowdLineOf(g, dg, 'the group')
    g.crowd_line_global = crowdLineOf(g, dgl, 'the field')
    const missed: string[] = [], nailed: string[] = []
    for (const u of (p.predictions || [])) {
      const pr = (u.preds || []).find((x: any) => x.game === g.match)
      if (!pr) continue
      if (pr.pred_result === pr.result) nailed.push(u.user); else missed.push(u.user)
    }
    g.missed_by = missed; g.nailed_by = nailed
  }
  const lb = (p.leaderboard || []).slice().sort((a: any, b: any) => (a.group_rank || 0) - (b.group_rank || 0))
  const leaderPts = lb.length ? lb[0].total_pts : 0
  const maxRank = lb.reduce((m: number, r: any) => Math.max(m, r.group_rank || 0), 0)
  const gapByUser: Record<string, number> = {}
  for (let i = 0; i < lb.length; i++) gapByUser[lb[i].user] = i === 0 ? 0 : (lb[i - 1].total_pts - lb[i].total_pts)
  for (const r of (p.leaderboard || [])) {
    r.pts_behind_leader = leaderPts - r.total_pts
    r.gap_to_above = (r.user in gapByUser) ? gapByUser[r.user] : null
    r.is_leader = r.group_rank === 1
    r.is_last = r.group_rank === maxRank
  }
  let closest: any = null
  for (let i = 1; i < lb.length; i++) { const gap = lb[i - 1].total_pts - lb[i].total_pts; if (!closest || gap < closest.gap) closest = { higher: lb[i - 1].user, lower: lb[i].user, gap } }
  p.closest_pair = closest
  if (lb.length) p.standings = 'Standings: ' + lb.map((r: any, i: number) => i === 0 ? `${r.user} ${r.total_pts} pts (leader)` : `${r.user} ${r.total_pts} (${leaderPts - r.total_pts} back)`).join(' · ')
  if (p.today) p.today.global_zero_count = (p.today.global_zero || []).length
  for (const pk of (p.picks || [])) {
    const status = pk.champion_played_today ? (pk.champion_result || 'not_played') : 'not_played'
    pk.champion_status = status
    if (!pk.champion) pk.champion_line = null
    else if (status === 'not_played') pk.champion_line = `${pk.user}'s champion ${pk.champion} did not play today`
    else { const v = status === 'win' ? 'won' : status === 'draw' ? 'drew' : 'lost'; pk.champion_line = `${pk.user}'s champion ${pk.champion} ${v} today` }
    if (pk.top_scorer) { const goals = pk.scorer_goals_today || 0; pk.scorer_line = goals > 0 ? `${pk.user}'s top-scorer pick ${pk.top_scorer} scored ${goals} today` : `${pk.user}'s top-scorer pick ${pk.top_scorer} did not score today` }
    else pk.scorer_line = null
  }
  p.p4 = computeP4(p)
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
  winnerAgent: 1 | 2 | 3 | 4 | 5
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

const JUDGE_SYSTEM = `You are a judge evaluating five nightly WhatsApp roast summaries for a World Cup prediction group.
Score each on 4 dimensions (0-10 each) and pick one winner.

ACCURACY VERIFICATION - do this first, before scoring:
For each candidate, check every factual claim against the payload:
  - Every point value stated for a user must match leaderboard[].today_pts exactly. If wrong -> deduct 3 from accuracy.
  - COMMON ERROR — today_pts vs total_pts: if P1 opens with a number that matches leaderboard[].total_pts (not today_pts) and presents it as today's performance (e.g. "X points today", "scored X today") -> deduct 3 from accuracy. Always cross-check the opening score against today_pts, not total_pts.
  - today.global_top[].pts is the global total across ALL groups - never accept it as a user's today score. If stated as today score -> deduct 3 from accuracy.
  - If the summary claims a user "topped the competition today" but their today_pts = 0 -> deduct 3 from accuracy.
  - The point gap stated between rank 1 and rank 2 must equal leaderboard[0].total_pts - leaderboard[1].total_pts exactly. If wrong -> deduct 3 from accuracy.
  - If the summary implies competitors/others predicted correctly for a game (any of: "got it right", "had a field day", "saw it coming", "were correct", "got it", "called it"), verify global_upset=false for that game. If global_upset=true -> deduct 3 from accuracy.
  - Any scoreline stated for a user must appear in their predictions[].preds[].pred. If not found -> deduct 2 from accuracy.
Multiple errors stack. Start accuracy at 10, apply deductions.
Hard floor: if final accuracy <= 3, that candidate is disqualified regardless of other scores.

SCORING WEIGHTS:
- accuracy (45%): verified above - no invented facts; streak = abs(streak); scorelines correct; champion result correct
- humor (30%): picks used as rivalry fuel when champion played; specific scoreline for worst performer; P4 unique angle with actual numbers (not template phrase); personal not generic
- compliance (15%): no banned words (journey/remarkable/incredible/exciting); no pronouns he/she/his/her/him; no invented character labels; facts from payload only; picks[].champion is a tournament pick — deduct 2 if referenced as a team playing in today's games (game teams are only in games[].home_team / away_team)
- structure (10%): 6 paragraphs; P6 starts "Tomorrow's danger:"; exact point gap appears; streak referenced in P6

Return valid JSON only:
{
  "winner": 1 or 2 or 3 or 4 or 5,
  "reasoning": "quote the single most effective line from the winning candidate verbatim (in quotes), then in 3-5 words say why it worked — do not use generic phrases like 'most accurate' or 'better structured'",
  "scores": [
    {"agent":1,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":2,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":3,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":4,"accuracy":N,"humor":N,"compliance":N,"structure":N},
    {"agent":5,"accuracy":N,"humor":N,"compliance":N,"structure":N}
  ]
}`

async function callJudge(
  openai: OpenAI,
  payload: unknown,
  candidates: Array<{ agent: number; slot: string; content: string }>,
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
      const winner = Number(parsed.winner) as 1 | 2 | 3 | 4 | 5
      if (![1, 2, 3, 4, 5].includes(winner)) throw new Error(`invalid winner: ${winner}`)
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
        return {
          winnerAgent:      4 as 1 | 2 | 3 | 4 | 5,
          reasoning:        'Judge failed — defaulted to agent 4 (baseline)',
          scores:           [1,2,3,4,5].map(a => ({ agent: a, accuracy: 0, humor: 0, compliance: 0, structure: 0, total: 0 })),
          promptTokens:     0,
          completionTokens: 0,
        }
      }
    }
  }
  return { winnerAgent: 4 as 1 | 2 | 3 | 4 | 5, reasoning: 'Judge failed', scores: [], promptTokens: 0, completionTokens: 0 }
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

  // deno-lint-ignore no-explicit-any
  const groupMemberSet = new Set<string>((groupData.members ?? []).map((m: any) => m.user_id as string))

  const champTeamResult: Record<string, { played: boolean; result: 'win' | 'draw' | 'loss' }> = {}
  for (const fg of finishedGames) {
    const result = outcomeDir(fg.score_home, fg.score_away)
    champTeamResult[fg.team_home] = {
      played: true,
      result: result === 'home_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
    }
    champTeamResult[fg.team_away] = {
      played: true,
      result: result === 'away_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
    }
  }

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

  // deno-lint-ignore no-explicit-any
  const games = (groupData.games ?? [] as any[]).map((game: any) => {
    const fg     = gameByKey[`${game.team_home}|${game.team_away}`]
    const gameId = fg?.id

    const scorers: string[] = []
    if (statsReady && gameId && goalScorerMap[gameId]) {
      for (const ev of goalScorerMap[gameId]) {
        const min  = ev.minute_extra ? `${ev.minute}+${ev.minute_extra}'` : `${ev.minute}'`
        const type = ev.detail === 'Penalty' ? '(pen)' : ev.detail === 'Own Goal' ? '(og)' : ''
        scorers.push(`${ev.player_name ?? 'Unknown'} ${min}${type}`.trim())
      }
    }

    const gd      = gameId ? (globalDistMap[gameId] ?? null) : null
    const gdTotal = gd?.total ?? 0
    const grp     = gameId ? (grpDistByGameId[gameId] ?? null) : null
    const grpN    = grp?.n ?? 0

    let groupExactN = 0
    if (fg) {
      // deno-lint-ignore no-explicit-any
      for (const m of (groupData.members ?? []) as any[]) {
        // deno-lint-ignore no-explicit-any
        const pred = (m.predictions ?? []).find((p: any) => p.game_id === fg.id)
        if (pred && pred.pred_home === fg.score_home && pred.pred_away === fg.score_away) groupExactN++
      }
    }

    let groupUpset = false
    if (fg && grp && grpN > 0) {
      const resultDir   = outcomeDir(fg.score_home, fg.score_away)
      const majorityDir = grp.home >= grp.draw && grp.home >= grp.away ? 'home_win'
                        : grp.away > grp.draw && grp.away > grp.home   ? 'away_win'
                        : 'draw'
      groupUpset = resultDir !== majorityDir
    }

    let globalUpset = false
    if (fg && gdTotal > 0) {
      const resultDir   = outcomeDir(fg.score_home, fg.score_away)
      const majorityDir = gd.home_win >= gd.draw && gd.home_win >= gd.away_win ? 'home_win'
                        : gd.away_win > gd.draw && gd.away_win > gd.home_win   ? 'away_win'
                        : 'draw'
      globalUpset = resultDir !== majorityDir
    }

    let distGlobal: Record<string, unknown> | null = null
    if (gdTotal > 0) {
      const topScore   = gd.top_scores?.[0]?.score ?? null
      const topScoreN  = gd.top_scores?.[0]?.count ?? null
      const topScore2N = gd.top_scores?.[1]?.count ?? null
      const tied       = topScoreN !== null && topScore2N !== null && topScoreN === topScore2N

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
        home_pct:           Math.round((gd.home_win / gdTotal) * 100),
        draw_pct:           Math.round((gd.draw     / gdTotal) * 100),
        away_pct:           Math.round((gd.away_win / gdTotal) * 100),
        n:                  gdTotal,
        exact_hits:         gd.exact_count ?? 0,
        top_score:          topScore,
        top_score_n:        topScoreN,
        top_score_tied:     tied,
        group_on_top_score: groupOnTopScore,
      }
    }

    const result = fg ? outcomeDir(fg.score_home, fg.score_away) : null

    return {
      match:          `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away}`,
      home_team:      game.team_home,
      away_team:      game.team_away,
      home_score:     game.score_home,
      away_score:     game.score_away,
      result,
      phase_label:    PHASE_LABELS[game.phase] ?? game.phase,
      group_exact_n:  groupExactN,
      global_exact_n: gd ? (gd.exact_count ?? 0) : 0,
      group_upset:    groupUpset,
      global_upset:   globalUpset,
      scorers:        statsReady ? scorers : null,
      dist_group:     grpN > 0 ? {
        home_pct: Math.round((grp!.home / grpN) * 100),
        draw_pct: Math.round((grp!.draw / grpN) * 100),
        away_pct: Math.round((grp!.away / grpN) * 100),
        n:        grpN,
      } : null,
      dist_global: distGlobal,
    }
  })

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

  // deno-lint-ignore no-explicit-any
  const picksRaw = (groupData.members ?? [] as any[]).map((m: any) => {
    const champion  = champMap[m.user_id] ?? null
    const topScorer = tsrMap[m.user_id]   ?? null

    const champInfo        = champion ? champTeamResult[champion] : null
    const champPlayedToday = champInfo?.played ?? false
    const champResult      = champPlayedToday ? champInfo!.result : undefined

    const scorerGoals = (statsReady && topScorer)
      ? (playerGoalsToday[topScorer] ?? 0)
      : null

    const pick: Record<string, unknown> = {
      user:                   m.username,
      champion,
      top_scorer:             topScorer,
      scorer_goals_today:     scorerGoals,
      scorer_total_goals:     null,
      scorer_tournament_rank: null,
    }
    if (champion) {
      pick.champion_played_today = champPlayedToday
      if (champPlayedToday) pick.champion_result = champResult
    }
    return pick
  })

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

// ─── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const startMs = Date.now()

  let date: string
  let versionId: string | undefined
  let modelOverride: string | undefined
  let singleGroupId: string | undefined
  try {
    const body    = await req.json()
    date          = body.date
    versionId     = body.version_id
    modelOverride = body.model
    singleGroupId = body.group_id
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

  // Match-day window = 07:30 UTC → next 07:30 UTC (so late US games up to ~04:00 UTC stay in the
  // same match-day, and the boundary sits in the 05:00–13:00 UTC dead zone). Must match the grouping
  // in fn_schedule_ai_summaries: (kick_off_time - interval '7.5 hours')::date.
  const dayStart = `${date}T07:30:00Z`
  const dayEnd   = `${nextUTCDay(date)}T07:30:00Z`

  const { data: allGames, error: gamesErr } = await supabase
    .from('games')
    .select('id, team_home, team_away, score_home, score_away, phase')
    .gte('kick_off_time', dayStart)
    .lt ('kick_off_time', dayEnd)
    .range(0, 99999)   // defensive: avoid Supabase JS-client 1000-row default cap (filter limits to ≤30/day, hygiene only)

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

  const { count: statsCount } = await supabase
    .from('game_player_stats')
    .select('*', { count: 'exact', head: true })
    .in('game_id', gameIds)
  const statsReady = (statsCount ?? 0) > 0

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
      .in('agent_slot', ['main', 'candidate_2', 'candidate_3', 'baseline', 'candidate_4'])
      .not('agent_slot', 'is', null)
      .order('version_tag', { ascending: false })

    if (pErr || !pRows || pRows.length === 0) {
      console.warn('[prompt] no agent_slot prompts found, falling back to active prompt')
      const { data: fallbackRow, error: fbErr } = await supabase
        .from('prompt_versions').select('*').eq('is_active', true).single()
      if (fbErr || !fallbackRow) return json({ error: 'no_active_prompt' }, 500)
      agentPrompts = [{ slot: 'main', promptRow: fallbackRow }]
    } else {
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

  let qualifyingGroups: { id: string; name: string }[]

  if (singleGroupId) {
    const { data: grp, error: grpErr } = await supabase
      .from('groups').select('id, name').eq('id', singleGroupId).single()
    if (grpErr || !grp) return json({ error: 'group_not_found', group_id: singleGroupId }, 404)
    qualifyingGroups = [grp]
  } else {
    const { data: allGroups } = await supabase.from('groups').select('id, name').range(0, 99999)   // defensive: bypass 1000-row JS cap
    qualifyingGroups = []
    for (const g of allGroups ?? []) {
      const { count } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id)
        .eq('is_inactive', false)
      if ((count ?? 0) >= 3) qualifyingGroups.push(g)
    }
    if (qualifyingGroups.length === 0) return json({ reason: 'no_qualifying_groups', processed: 0 })
  }

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

  const globalDistMap: Record<string, GlobalDist> = {}
  for (const game of finishedGames) {
    const { data: dist } = await supabase.rpc('get_game_prediction_distribution', { p_game_id: game.id })
    if (dist) globalDistMap[game.id] = dist
  }

  const { data: globalPreds } = await supabase
    .from('predictions')
    .select('user_id, game_id, points_earned, is_auto')
    .in('game_id', gameIds)
    .range(0, 99999)   // defensive: bypass 1000-row JS cap (~30 preds × ≤10 games × N groups can approach it during WC)

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

  // Global rank per (user × group) — pulled from the canonical SQL leaderboard so the AI summary,
  // Dashboard, Groups page, and any future consumer share one source of truth. Previously this was
  // re-implemented in JS by summing predictions/champion_pick/top_scorer_pick rows client-side, which
  // hit the Supabase JS-client default 1000-row cap once `predictions` exceeded 1000 scored rows —
  // the per-user totals were under-counted by a random fraction and the ranks went wrong (verified
  // 2026-05-28: Test3 stored Itay=1/zac=14/bob=16; true 2/15/20). Using the RPC eliminates the cap
  // AND removes the duplicate leaderboard formula (drift hazard).
  const { data: lbRows, error: lbErr } = await supabase.rpc('get_leaderboard')
  if (lbErr) {
    console.error('[leaderboard] get_leaderboard RPC failed:', lbErr.message)
    return json({ error: 'leaderboard_rpc_failed', detail: lbErr.message }, 500)
  }

  const globalRankByUserGroup: Record<string, Record<string, number>> = {}
  // deno-lint-ignore no-explicit-any
  for (const row of (lbRows ?? []) as any[]) {
    if (!row.user_id || !row.group_id) continue
    if (!globalRankByUserGroup[row.user_id]) globalRankByUserGroup[row.user_id] = {}
    globalRankByUserGroup[row.user_id][row.group_id] = row.rank
  }

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
      const { data: groupData, error: gdErr } = await supabase.rpc('get_group_summary_data', {
        p_group_id: group.id,
        p_date:     date,
      })
      if (gdErr || !groupData) {
        console.error(`[group] get_group_summary_data failed for ${group.name}:`, gdErr?.message)
        skipped++; errors.push(`${group.name}: group data unavailable`); continue
      }

      const [{ data: champPicks }, { data: tsrPicks }] = await Promise.all([
        supabase.from('champion_pick').select('user_id, team').eq('group_id', group.id),
        supabase.from('top_scorer_pick').select('user_id, player_name').eq('group_id', group.id),
      ])

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
      enrichSummaryPayload(payload)

      // 8d. Run agents — candidates now include version_tag
      let candidates: Array<{
        agent: number; slot: string; content: string; model: string
        prompt_tokens: number; completion_tokens: number
        temperature: number; seed: number; char_len: number
        prompt_version_id: string; version_tag: string
      }>

      if (testMode || agentPrompts.length === 1) {
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
          version_tag:       ap.promptRow.version_tag as string,
        }]
      } else {
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
              agent:             idx + 1,
              slot:              ap.slot,
              ...r,
              temperature:       agentCfg.temperature,
              seed:              agentCfg.seed,
              prompt_version_id: ap.promptRow.id as string,
              version_tag:       ap.promptRow.version_tag as string,
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
          version_tag:       r.version_tag,
        }))
      }

      // 8e. Judge
      let winnerAgent: 1 | 2 | 3 | 4 | 5 = 1
      let judgeResult: JudgeResult | null = null
      let judgeRunId: string | null = null

      if (!testMode && candidates.length >= 3) {
        judgeResult = await callJudge(openai, payload, candidates)
        winnerAgent = judgeResult.winnerAgent

        const candidatesJsonb = candidates.map((c, idx) => ({
          agent:             c.agent,
          slot:              c.slot,
          prompt_version_id: c.prompt_version_id,
          version_tag:       c.version_tag,
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
            group_id:                group.id,
            date,
            candidates:              candidatesJsonb,
            winner_agent:            winnerAgent,
            judge_reasoning:         judgeResult.reasoning,
            judge_model:             JUDGE_MODEL,
            judge_prompt_tokens:     judgeResult.promptTokens,
            judge_completion_tokens: judgeResult.completionTokens,
          }, { onConflict: 'group_id,date' })
          .select('id')
          .single()

        if (!jrErr && judgeRun) judgeRunId = judgeRun.id
        else console.warn(`[judge_run] insert failed for ${group.name}:`, jrErr?.message)
      }

      // 8f. Upsert winning summary — now includes winner_score
      const winner = candidates.find(c => c.agent === winnerAgent) ?? candidates[0]
      const winnerPromptRow = agentPrompts.find(ap => ap.slot === winner.slot)?.promptRow
        ?? agentPrompts[0].promptRow
      const winnerScore = judgeResult
        ? (judgeResult.scores.find(s => s.agent === winnerAgent)?.total ?? null)
        : null

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
        ...(judgeRunId    ? { judge_run_id:   judgeRunId   } : {}),
        ...(candidates.length >= 3 ? { winner_agent: winnerAgent } : {}),
        ...(winnerScore !== null    ? { winner_score: winnerScore } : {}),
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

      console.log(`[group] done: ${group.name} (agent ${winnerAgent}, score ${winnerScore}, ${winner.content.length} chars)`)
      processed++

    } catch (err: unknown) {
      const emsg = (err as Error)?.message ?? 'unknown error'
      console.error(`[group] unexpected error for ${group.name}:`, emsg)
      skipped++; errors.push(`${group.name}: ${emsg}`)
      // A hard group failure is otherwise silent (cron discards the response). Log to ef_errors →
      // admin email + daily digest → manual re-run. (Skipped in test mode to avoid spurious alerts.)
      if (!testMode) {
        try {
          await supabase.from('ef_errors').insert({
            ef_name:    'nightly-summary',
            error_type: 'group_failed',
            error_msg:  emsg,
            context:    { group_id: group.id, group_name: group.name, date }
          })
        } catch { /* best-effort */ }
      }
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

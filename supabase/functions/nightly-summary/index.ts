// nightly-summary v1
// Generates AI-powered nightly summaries per qualifying group using OpenAI gpt-4o-mini.
// Triggered by pg_cron 150min after last kickoff of the day.
// POST body: { date: "YYYY-MM-DD", version_id?: "uuid" }
//   version_id → TEST MODE: uses that prompt version and writes test results back

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

// ─── Constants ───────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FALLBACK_MSG =
  'Our AI analyst called in sick today (probably still recovering from that last-minute equalizer). ' +
  'Summary coming tomorrow — in the meantime, check the leaderboard and start arguing with your group.'

const TIMEOUT_MS = 120_000   // abort group loop at 120s (EF hard limit is 150s)
const GROUP_GAP_MS = 2_000   // sequential gap between groups (rate limiting)
const OPENAI_MODEL = 'gpt-4o-mini'
const MAX_TOKENS = 400
const MIN_CONTENT_LEN = 50

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

// ─── OpenAI call with retry ───────────────────────────────────────────────────

async function callOpenAI(
  openai: OpenAI,
  systemPrompt: string,
  userMessage: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(5000)
    try {
      const res = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
        max_tokens: MAX_TOKENS,
      })
      const content = res.choices[0]?.message?.content?.trim() ?? ''
      if (content.length >= MIN_CONTENT_LEN) {
        return {
          content,
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
        }
      }
      console.warn(`[openai] response too short (${content.length} chars), attempt ${attempt + 1}`)
    } catch (err: unknown) {
      console.error(`[openai] error attempt ${attempt + 1}:`, (err as Error)?.message)
      if (attempt === 1) throw err
    }
  }
  return { content: FALLBACK_MSG, promptTokens: 0, completionTokens: 0 }
}

// ─── Payload builder ─────────────────────────────────────────────────────────

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
type GroupSummaryData = any   // jsonb from get_group_summary_data RPC
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
}) {
  const { groupName, date, groupData, finishedGames, globalDistMap,
          goalScorerMap, champPicks, tsrPicks, statsReady } = opts

  // Map game by "TeamA|TeamB" → game object (for matching groupData.games)
  const gameByKey: Record<string, Game> = {}
  for (const g of finishedGames) {
    gameByKey[`${g.team_home}|${g.team_away}`] = g
  }

  // champion and top-scorer pick maps: user_id → value
  const champMap: Record<string, string> = {}
  for (const cp of champPicks) champMap[cp.user_id] = cp.team

  const tsrMap: Record<string, string> = {}
  for (const tp of tsrPicks) tsrMap[tp.user_id] = tp.player_name

  // Player goals today (non-own-goal events only)
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

  // Per-member today points (sum of today's predictions)
  const memberTodayPts: Record<string, number> = {}
  // deno-lint-ignore no-explicit-any
  for (const m of (groupData.members ?? []) as any[]) {
    let pts = 0
    // deno-lint-ignore no-explicit-any
    for (const p of (m.predictions ?? []) as any[]) pts += (p.points ?? 0)
    memberTodayPts[m.username] = pts
  }

  // Group-level prediction distribution per game
  const grpDistByGameId: Record<string, { home: number; draw: number; away: number; n: number }> = {}
  // deno-lint-ignore no-explicit-any
  for (const game of (groupData.games ?? []) as any[]) {
    const fg = gameByKey[`${game.team_home}|${game.team_away}`]
    if (!fg) continue
    const dist = { home: 0, draw: 0, away: 0, n: 0 }
    // deno-lint-ignore no-explicit-any
    for (const m of (groupData.members ?? []) as any[]) {
      // deno-lint-ignore no-explicit-any
      const pred = (m.predictions ?? []).find((p: any) => p.game_id === fg.id)
      if (!pred) continue
      dist.n++
      if      (pred.pred_home > pred.pred_away) dist.home++
      else if (pred.pred_home === pred.pred_away) dist.draw++
      else    dist.away++
    }
    grpDistByGameId[fg.id] = dist
  }

  // ── Leaderboard ──
  // deno-lint-ignore no-explicit-any
  const leaderboard = (groupData.leaderboard ?? [] as any[]).map((row: any) => {
    // deno-lint-ignore no-explicit-any
    const member = (groupData.members ?? []).find((m: any) => m.username === row.username)
    return {
      rank:      row.group_rank,
      user:      row.username,
      total_pts: row.total_points,
      exact:     row.exact_scores,
      today_pts: memberTodayPts[row.username] ?? 0,
      streak:    member?.current_streak ?? 0,
    }
  })

  // ── Today summary ──
  let topScorer: { user: string; pts: number } | null = null
  const zeroPts: { user: string; all_auto: boolean }[] = []

  for (const row of leaderboard) {
    if (topScorer === null || row.today_pts > topScorer.pts) {
      topScorer = { user: row.user, pts: row.today_pts }
    }
    if (row.today_pts === 0) {
      // deno-lint-ignore no-explicit-any
      const member = (groupData.members ?? []).find((m: any) => m.username === row.user)
      // deno-lint-ignore no-explicit-any
      const allAuto = (member?.predictions ?? []).length > 0
        && (member.predictions as any[]).every((p: any) => p.is_auto === true)
      zeroPts.push({ user: row.user, all_auto: allAuto })
    }
  }

  // ── Games ──
  // deno-lint-ignore no-explicit-any
  const games = (groupData.games ?? [] as any[]).map((game: any) => {
    const fg = gameByKey[`${game.team_home}|${game.team_away}`]
    const gameId = fg?.id

    // Goal scorers
    const scorers: string[] = []
    if (statsReady && gameId && goalScorerMap[gameId]) {
      for (const ev of goalScorerMap[gameId]) {
        const min = ev.minute_extra
          ? `${ev.minute}+${ev.minute_extra}'`
          : `${ev.minute}'`
        const type = ev.detail === 'Penalty'  ? '(pen)'
                   : ev.detail === 'Own Goal' ? '(og)'
                   : ''
        scorers.push(`${ev.player_name ?? 'Unknown'} ${min}${type}`.trim())
      }
    }

    // Global distribution
    const gd = gameId ? (globalDistMap[gameId] ?? null) : null
    const gdTotal = gd?.total ?? 0

    // Group distribution
    const grp  = gameId ? (grpDistByGameId[gameId] ?? null) : null
    const grpN = grp?.n ?? 0

    return {
      match:  `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away}`,
      phase:  game.phase,
      scorers: statsReady ? scorers : null,
      dist_group: grpN > 0 ? {
        home_pct: Math.round((grp!.home / grpN) * 100),
        draw_pct: Math.round((grp!.draw / grpN) * 100),
        away_pct: Math.round((grp!.away / grpN) * 100),
        n: grpN,
      } : null,
      dist_global: gdTotal > 0 ? {
        home_pct:    Math.round((gd.home_win / gdTotal) * 100),
        draw_pct:    Math.round((gd.draw     / gdTotal) * 100),
        away_pct:    Math.round((gd.away_win / gdTotal) * 100),
        n:           gdTotal,
        top_score:   gd.top_scores?.[0]?.score ?? null,
        top_score_n: gd.top_scores?.[0]?.count ?? null,
        exact_hits:  gd.exact_count ?? 0,
      } : null,
    }
  })

  // ── Per-member predictions ──
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
      return {
        game: matchStr,
        pred: `${p.pred_home}-${p.pred_away}`,
        pts:  p.points,
        auto: p.is_auto,
      }
    }),
  }))

  // ── Picks ──
  // deno-lint-ignore no-explicit-any
  const picks = (groupData.members ?? [] as any[]).map((m: any) => {
    const champion  = champMap[m.user_id] ?? null
    const topScorer = tsrMap[m.user_id]   ?? null
    const scorerGoals = (statsReady && topScorer)
      ? (playerGoalsToday[topScorer] ?? 0)
      : null
    return {
      user:               m.username,
      champion,
      top_scorer:         topScorer,
      scorer_goals_today: scorerGoals,
    }
  })

  return {
    group: groupName,
    date,
    leaderboard,
    today: { top_scorer: topScorer, zero_pts: zeroPts },
    games,
    predictions,
    picks,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const startMs = Date.now()

  // 1. Auth — service role key required
  const srk  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization')
  if (!auth || auth !== `Bearer ${srk}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // 2. Parse body
  let date: string
  let versionId: string | undefined
  try {
    const body = await req.json()
    date      = body.date
    versionId = body.version_id
    if (!date) return json({ error: 'date required' }, 400)
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const testMode = !!versionId

  // Create clients inside handler (not module scope)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srk)
  const openai   = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })

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

  // Guard A1: no finished games
  if (finishedGames.length === 0) {
    return json({ reason: 'no_games_today', processed: 0 })
  }

  // Guard A3: not all games finished
  if (finishedGames.length < (allGames ?? []).length) {
    return json({
      reason:   'games_not_finished',
      finished: finishedGames.length,
      total:    allGames!.length,
    })
  }

  const gameIds = finishedGames.map(g => g.id)

  // 4. Soft check: stats synced?
  const { count: statsCount } = await supabase
    .from('game_player_stats')
    .select('*', { count: 'exact', head: true })
    .in('game_id', gameIds)
  const statsReady = (statsCount ?? 0) > 0

  // 5. Get prompt
  const promptQuery = supabase.from('prompt_versions').select('*')
  const { data: promptRow, error: promptErr } = await (
    testMode
      ? promptQuery.eq('id', versionId!).single()
      : promptQuery.eq('is_active', true).single()
  )

  if (promptErr || !promptRow) {
    console.error('[prompt] not found:', promptErr?.message)
    return json({ error: 'no_active_prompt' }, 500)
  }

  // 6. Qualifying groups: ≥3 active members
  const { data: allGroups } = await supabase
    .from('groups')
    .select('id, name')

  const qualifyingGroups: { id: string; name: string }[] = []
  for (const g of allGroups ?? []) {
    const { count } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', g.id)
      .eq('is_inactive', false)
    if ((count ?? 0) >= 3) qualifyingGroups.push(g)
  }

  if (qualifyingGroups.length === 0) {
    return json({ reason: 'no_qualifying_groups', processed: 0 })
  }

  // 7. Shared data — fetched ONCE, reused per group

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

  // 7b. Global prediction distributions (one RPC call per game)
  const globalDistMap: Record<string, GlobalDist> = {}
  for (const game of finishedGames) {
    const { data: dist } = await supabase.rpc('get_game_prediction_distribution', {
      p_game_id: game.id,
    })
    if (dist) globalDistMap[game.id] = dist
  }

  // 8. Process each group sequentially
  let processed = 0
  let skipped   = 0
  const errors: string[] = []

  for (let i = 0; i < qualifyingGroups.length; i++) {
    // Timeout guard
    if (Date.now() - startMs > TIMEOUT_MS) {
      console.warn(`[timeout] stopping at group index ${i} after ${Date.now() - startMs}ms`)
      errors.push(`timeout: only processed ${processed}/${qualifyingGroups.length} groups`)
      break
    }

    if (i > 0) await sleep(GROUP_GAP_MS)

    const group = qualifyingGroups[i]
    console.log(`[group] processing: ${group.name} (${group.id})`)

    try {
      // 8a. Group summary data (leaderboard + predictions + streaks)
      const { data: groupData, error: gdErr } = await supabase.rpc('get_group_summary_data', {
        p_group_id: group.id,
        p_date:     date,
      })

      if (gdErr || !groupData) {
        console.error(`[group] get_group_summary_data failed for ${group.name}:`, gdErr?.message)
        skipped++
        errors.push(`${group.name}: group data unavailable`)
        continue
      }

      // 8b. Champion + top scorer picks for this group
      const [{ data: champPicks }, { data: tsrPicks }] = await Promise.all([
        supabase.from('champion_pick').select('user_id, team').eq('group_id', group.id),
        supabase.from('top_scorer_pick').select('user_id, player_name').eq('group_id', group.id),
      ])

      // 8c. Build compact JSON payload
      const payload = buildGroupPayload({
        groupName:    group.name,
        date,
        groupData,
        finishedGames,
        globalDistMap,
        goalScorerMap,
        champPicks:   (champPicks ?? []) as ChampPick[],
        tsrPicks:     (tsrPicks  ?? []) as TsrPick[],
        statsReady,
      })

      // 8d. Render user message
      const userMessage = promptRow.user_prompt_template.replace(
        '{{group_json}}',
        JSON.stringify(payload),
      )

      // 8e. Call OpenAI
      const { content, promptTokens, completionTokens } = await callOpenAI(
        openai,
        promptRow.system_prompt,
        userMessage,
      )

      // 8f. Upsert to ai_summaries
      const summary = {
        group_id:          group.id,
        date,
        content,
        games_count:       finishedGames.length,
        model:             OPENAI_MODEL,
        prompt_tokens:     promptTokens     || null,
        completion_tokens: completionTokens || null,
        prompt_version_id: promptRow.id,
      }

      let { error: upsertErr } = await supabase
        .from('ai_summaries')
        .upsert(summary, { onConflict: 'group_id,date' })

      if (upsertErr) {
        // One retry
        const { error: retryErr } = await supabase
          .from('ai_summaries')
          .upsert(summary, { onConflict: 'group_id,date' })
        upsertErr = retryErr ?? null
      }

      if (upsertErr) {
        // D1: write to failed_summaries and continue
        console.error(`[upsert] failed for ${group.name}:`, upsertErr.message)
        await supabase.from('failed_summaries').insert({
          group_id:  group.id,
          date,
          content,
          error_msg: upsertErr.message,
        })
        errors.push(`${group.name}: upsert failed → failed_summaries`)
        skipped++
        continue
      }

      // 8g. Test mode: write results back to prompt_versions row
      if (testMode) {
        await supabase
          .from('prompt_versions')
          .update({
            test_input:      payload,
            test_output:     content,
            test_model:      OPENAI_MODEL,
            test_tokens_in:  promptTokens,
            test_tokens_out: completionTokens,
            tested_at:       new Date().toISOString(),
          })
          .eq('id', versionId!)
      }

      console.log(`[group] done: ${group.name} (${content.length} chars, ${promptTokens}+${completionTokens} tokens)`)
      processed++

    } catch (err: unknown) {
      console.error(`[group] unexpected error for ${group.name}:`, (err as Error)?.message)
      skipped++
      errors.push(`${group.name}: ${(err as Error)?.message ?? 'unknown error'}`)
    }
  }

  return json({
    processed,
    skipped,
    total_groups:  qualifyingGroups.length,
    test_mode:     testMode,
    errors,
    elapsed_ms:    Date.now() - startMs,
  })
})

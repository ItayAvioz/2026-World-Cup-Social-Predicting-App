/**
 * football-api-sync — WorldCup 2026
 *
 * Syncs game scores, team stats, and player stats from api-football.com (v3).
 *
 * Modes:
 *   probe          — TEST: fetch fixtures from any league/season, no DB write
 *   probe_stats    — TEST: fetch full stats + players for one fixture
 *   probe_odds     — TEST: check API Football odds for a fixture
 *   snap_stats     — TEST: fetch team stats (no DB write) — red_cards player-derived
 *   setup          — one-time: map WC2026 fixture IDs to games table
 *   setup_lineups  — one-time: pull lineups → update top_scorer_candidates
 *   verify         — 30min before KO: check API kickoff time matches DB
 *   sync           — KO+120min: write score + stats + unschedule crons
 *   sync_af_odds   — daily: write API Football pre-match h2h + over/under to game_odds
 *   sync_stats     — backfill: re-run writeStats for all (or one) finished games
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FOOTBALL_API_BASE = 'https://v3.football.api-sports.io'
const WC_LEAGUE_ID = 1
const WC_SEASON    = 2026

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FOOTBALL_API_KEY = Deno.env.get('FOOTBALL_API_KEY')!

// ─── CORS + Response helpers ──────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

// ─── EF error reporter ────────────────────────────────────────────────────────

async function reportEfError(
  supabase: ReturnType<typeof createClient>,
  errorType: 'crash' | 'quota' | 'stats_write',
  errorMsg: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('ef_errors').insert({
      ef_name:    'football-api-sync',
      error_type: errorType,
      error_msg:  errorMsg,
      context:    context ?? null,
    })
  } catch (e) {
    console.error('reportEfError failed:', e instanceof Error ? e.message : e)
  }
}

// ─── Team name normalisation ──────────────────────────────────────────────────

const TEAM_ALIASES: Record<string, string> = {
  "cote divoire":   "ivory coast",
  "korea republic": "south korea",
  "cabo verde":     "cape verde",
  "usa":            "united states",
  "ir iran":        "iran",
  "turkiye":        "turkey",
}

function normalizeTeam(name: string): string {
  let n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return TEAM_ALIASES[n] ?? n
}

// ─── API-Football fetch ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function footballApiGet(path: string): Promise<any[]> {
  const res = await fetch(`${FOOTBALL_API_BASE}${path}`, {
    headers: { 'x-apisports-key': FOOTBALL_API_KEY }
  })
  if (res.status === 429) throw new Error('RATE_LIMIT')
  if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED: check FOOTBALL_API_KEY secret')
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors).length > 0) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`)
  }
  return data.response ?? []
}

// ─── Derive knockout winner ───────────────────────────────────────────────────

function deriveKnockoutWinner(
  status: string,
  goals: { home: number; away: number },
  score: {
    extratime?: { home: number | null; away: number | null }
    penalty?:   { home: number | null; away: number | null }
  },
  teams: { home: { name: string }; away: { name: string } }
): string {
  if (status === 'PEN') {
    const penH = score.penalty?.home ?? 0
    const penA = score.penalty?.away ?? 0
    return penH > penA ? teams.home.name : teams.away.name
  }
  if (status === 'AET') {
    const etH = score.extratime?.home ?? 0
    const etA = score.extratime?.away ?? 0
    return etH > etA ? teams.home.name : teams.away.name
  }
  return goals.home > goals.away ? teams.home.name : teams.away.name
}

// ─── Mode: probe ──────────────────────────────────────────────────────────────

async function handleProbe(league_id: number, season: number, limit: number): Promise<Response> {
  const status   = await footballApiGet('/status')
  const account  = (status as unknown as { account?: unknown }[])[0] ?? status
  const fixtures = await footballApiGet(`/fixtures?league=${league_id}&season=${season}`)

  const sample = fixtures.slice(0, limit).map((f: {
    fixture: { id: number; date: string; status: { short: string } }
    teams: { home: { name: string }; away: { name: string } }
    goals: { home: number | null; away: number | null }
    score: { fulltime: { home: number | null; away: number | null } }
  }) => ({
    fixture_id: f.fixture.id,
    date:       f.fixture.date,
    status:     f.fixture.status.short,
    home:       f.teams.home.name,
    away:       f.teams.away.name,
    goals_home: f.goals.home,
    goals_away: f.goals.away,
    ft_home:    f.score.fulltime?.home,
    ft_away:    f.score.fulltime?.away,
  }))

  const today = new Date().toISOString().split('T')[0]
  const todayFixtures = await footballApiGet(`/fixtures?date=${today}`)
  const todaySample = todayFixtures.slice(0, 10).map((f: {
    fixture: { id: number; date: string; status: { short: string } }
    league:  { name: string; country: string }
    teams:   { home: { name: string }; away: { name: string } }
    goals:   { home: number | null; away: number | null }
  }) => ({
    fixture_id: f.fixture.id,
    league:     f.league.name,
    country:    f.league.country,
    date:       f.fixture.date,
    status:     f.fixture.status.short,
    home:       f.teams.home.name,
    away:       f.teams.away.name,
    goals_home: f.goals.home,
    goals_away: f.goals.away,
  }))

  return json({
    status:          'probe_ok',
    account,
    league_id,
    season,
    total_fixtures:  fixtures.length,
    fixtures_sample: sample,
    today_date:      today,
    today_total:     todayFixtures.length,
    today_sample:    todaySample,
  })
}

// ─── Mode: probe_stats ────────────────────────────────────────────────────────

async function handleProbeStats(fixture_id: number): Promise<Response> {
  const [teamStatsArr, playerStatsArr, topScorers] = await Promise.all([
    footballApiGet(`/fixtures/statistics?fixture=${fixture_id}`),
    footballApiGet(`/fixtures/players?fixture=${fixture_id}`),
    footballApiGet(`/players/topscorers?league=39&season=2024`),
  ])

  const team_stats = teamStatsArr.map((ts: {
    team: { name: string }
    statistics: Array<{ type: string; value: unknown }>
  }) => ({
    team:  ts.team.name,
    stats: Object.fromEntries(ts.statistics.map((s) => [s.type, s.value]))
  }))

  const all_players: unknown[] = []
  for (const te of playerStatsArr) {
    for (const pe of (te.players ?? [])) {
      const s = pe.statistics?.[0]
      all_players.push({
        player_id:     pe.player.id,
        name:          pe.player.name,
        team:          te.team.name,
        minutes:       s?.games?.minutes,
        position:      s?.games?.position,
        rating:        s?.games?.rating,
        goals:         s?.goals?.total,
        assists:       s?.goals?.assists,
        shots_total:   s?.shots?.total,
        shots_on:      s?.shots?.on,
        passes_key:    s?.passes?.key,
        tackles:       s?.tackles?.total,
        interceptions: s?.tackles?.interceptions,
        duels_won:     s?.duels?.won,
        yellow_cards:  s?.cards?.yellow,
        red_cards:     s?.cards?.red,
        saves:         s?.goalkeeper?.saves,
        conceded:      s?.goalkeeper?.conceded,
      })
    }
  }

  const top_scorers = topScorers.slice(0, 10).map((r: {
    player: { id: number; name: string }
    statistics: Array<{ team: { name: string }; goals: { total: number; assists: number } }>
  }) => ({
    player_id: r.player.id,
    name:      r.player.name,
    team:      r.statistics[0]?.team?.name,
    goals:     r.statistics[0]?.goals?.total,
    assists:   r.statistics[0]?.goals?.assists,
  }))

  return json({ status: 'probe_stats_ok', fixture_id, team_stats, all_players, total_players: all_players.length, top_scorers })
}

// ─── Mode: snap_stats ────────────────────────────────────────────────────────
// Lightweight probe — no DB write. Used for post-game polling CSV.
// red_cards derived from player stats (VAR-correct), not team stat aggregate.

async function handleSnapStats(fixture_id: number, snap_label: string): Promise<Response> {
  const [statsArr, playerStatsArr] = await Promise.all([
    footballApiGet(`/fixtures/statistics?fixture=${fixture_id}`),
    footballApiGet(`/fixtures/players?fixture=${fixture_id}`),
  ])
  const pulled_at = new Date().toISOString()

  // Derive red_cards per team from player data (VAR-correct)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redCardsByTeam: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const te of playerStatsArr) {
    const teamName: string = te.team?.name ?? ''
    let count = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const pe of (te.players ?? [])) {
      count += pe.statistics?.[0]?.cards?.red ?? 0
    }
    redCardsByTeam[teamName] = count
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams = statsArr.map((ts: any) => {
    const stat = (type: string): number | null => {
      const entry = ts.statistics?.find((s: { type: string; value: unknown }) => s.type === type)
      if (!entry || entry.value === null || entry.value === undefined) return null
      if (typeof entry.value === 'string' && entry.value.endsWith('%')) return parseInt(entry.value, 10)
      return typeof entry.value === 'number' ? entry.value : null
    }
    const statFloat = (type: string): number | null => {
      const entry = ts.statistics?.find((s: { type: string; value: unknown }) => s.type === type)
      if (!entry || entry.value === null || entry.value === undefined) return null
      const v = parseFloat(String(entry.value))
      return isNaN(v) ? null : v
    }

    return {
      team:             ts.team.name,
      shots_on_target:  stat('Shots on Goal'),
      shots_total:      stat('Total Shots'),
      shots_insidebox:  stat('Shots insidebox'),
      corners:          stat('Corner Kicks'),
      fouls:            stat('Fouls'),
      yellow_cards:     stat('Yellow Cards'),
      red_cards:        redCardsByTeam[ts.team.name] ?? 0,  // player-derived, VAR-correct
      offsides:         stat('Offsides'),
      possession:       stat('Ball Possession'),
      passes_total:     stat('Total passes'),
      passes_accuracy:  stat('Passes %'),
      xg:               statFloat('expected_goals'),
      gk_saves:         stat('Goalkeeper Saves'),
    }
  })

  return json({ status: 'snap_ok', fixture_id, snap_label, pulled_at, teams })
}

// ─── Mode: probe_odds ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleProbeOdds(fixture_id: number): Promise<Response> {
  const [preOdds, liveOdds, inplay] = await Promise.all([
    footballApiGet(`/odds?fixture=${fixture_id}`).catch(() => []),
    footballApiGet(`/odds/live?fixture=${fixture_id}`).catch(() => []),
    footballApiGet(`/odds/live`).catch(() => []),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseBookmakers = (data: any[]) => data.flatMap((r: any) =>
    (r.bookmakers ?? []).slice(0, 3).map((b: any) => ({
      bookmaker: b.name,
      markets:   (b.bets ?? []).map((bet: any) => ({
        market: bet.name,
        values: bet.values?.map((v: any) => ({ outcome: v.value, odd: v.odd }))
      }))
    }))
  )

  return json({
    status:     'probe_odds_ok',
    fixture_id,
    pre_match:  { total: preOdds.length,  data: parseBookmakers(preOdds) },
    live:       { total: liveOdds.length, data: parseBookmakers(liveOdds) },
    live_today: { total: inplay.length,   sample: inplay.slice(0, 5).map((r: any) => ({ fixture_id: r.fixture?.id, home: r.teams?.home?.name, away: r.teams?.away?.name, status: r.fixture?.status?.short })) },
  })
}

// ─── Mode: setup ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSetup(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const fixtures = await footballApiGet(`/fixtures?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`)

  const { data: games, error: dbErr } = await supabase
    .from('games')
    .select('id, team_home, team_away, kick_off_time, api_fixture_id')
  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)

  const matched: Array<{ game_id: string; api_fixture_id: number }> = []
  const unmatched: Array<{ home: string; away: string; date: string }> = []
  let skipped = 0

  for (const fixture of fixtures) {
    const apiHome = normalizeTeam(fixture.teams.home.name)
    const apiAway = normalizeTeam(fixture.teams.away.name)
    const apiDate = new Date(fixture.fixture.date)

    const game = (games ?? []).find(g => {
      if (g.api_fixture_id && g.api_fixture_id !== fixture.fixture.id) return false
      const timeDiffMs = Math.abs(new Date(g.kick_off_time).getTime() - apiDate.getTime())
      return normalizeTeam(g.team_home) === apiHome && normalizeTeam(g.team_away) === apiAway && timeDiffMs < 5 * 60 * 1000
    })

    if (game) {
      if (game.api_fixture_id === fixture.fixture.id) { skipped++; continue }
      await supabase.from('games').update({ api_fixture_id: fixture.fixture.id }).eq('id', game.id)
      matched.push({ game_id: game.id, api_fixture_id: fixture.fixture.id })
    } else if (!fixture.teams.home.name.includes('TBD') && !fixture.teams.away.name.includes('TBD')) {
      unmatched.push({ home: fixture.teams.home.name, away: fixture.teams.away.name, date: fixture.fixture.date })
    }
  }

  return json({ status: 'done', matched: matched.length, skipped, unmatched })
}

// ─── Mode: setup_lineups ──────────────────────────────────────────────────────
// Fetches lineups for a played fixture → updates top_scorer_candidates:
//   - Fills missing api_player_id for existing candidates (name match)
//   - Adds new F (forward) players not yet in the table

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSetupLineups(supabase: ReturnType<typeof createClient>, fixture_id: number): Promise<Response> {
  const lineups = await footballApiGet(`/fixtures/lineups?fixture=${fixture_id}`)

  // Flatten all players from both teams
  const allPlayers: Array<{ api_player_id: number; name: string; position: string; team_name: string; number: number }> = []
  for (const team of lineups) {
    for (const entry of [...(team.startXI ?? []), ...(team.substitutes ?? [])]) {
      const p = entry.player
      if (!p?.id || !p?.name) continue
      allPlayers.push({
        api_player_id: p.id,
        name:          p.name,
        position:      p.pos ?? '',
        team_name:     team.team?.name ?? '',
        number:        p.number ?? 0,
      })
    }
  }

  let updated = 0, added = 0, skipped = 0

  for (const p of allPlayers) {
    // Already in table by api_player_id?
    const { data: byId } = await supabase
      .from('top_scorer_candidates')
      .select('id')
      .eq('api_player_id', p.api_player_id)
      .maybeSingle()
    if (byId) { skipped++; continue }

    // Existing candidate missing api_player_id — match by last name
    const lastName = p.name.split(' ').pop() ?? p.name
    const { data: byName } = await supabase
      .from('top_scorer_candidates')
      .select('id, api_player_id')
      .ilike('name', `%${lastName}%`)
      .is('api_player_id', null)
      .maybeSingle()

    if (byName) {
      await supabase.from('top_scorer_candidates').update({ api_player_id: p.api_player_id }).eq('id', byName.id)
      updated++
      continue
    }

    // Add new forwards not yet in candidates
    if (p.position === 'F') {
      const { error } = await supabase.from('top_scorer_candidates').upsert(
        { name: p.name, team_name: p.team_name, api_player_id: p.api_player_id, is_active: true },
        { onConflict: 'name', ignoreDuplicates: true }
      )
      if (!error) added++
    } else {
      skipped++
    }
  }

  return json({
    status: 'lineups_done',
    fixture_id,
    total_players: allPlayers.length,
    updated,   // filled missing api_player_id for existing candidates
    added,     // new forwards added to top_scorer_candidates
    skipped,
    players: allPlayers,
  })
}

// ─── Mode: verify ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleVerify(supabase: ReturnType<typeof createClient>, game_id: string): Promise<Response> {
  if (!game_id) return json({ error: 'game_id required' }, 400)

  const { data: game, error } = await supabase.from('games').select('id, api_fixture_id, kick_off_time').eq('id', game_id).single()
  if (error || !game) return json({ error: 'Game not found' }, 404)
  if (!game.api_fixture_id) return json({ error: 'api_fixture_id not set — run setup mode first' }, 400)

  const fixtures = await footballApiGet(`/fixtures?id=${game.api_fixture_id}`)
  if (!fixtures.length) return json({ error: `Fixture ${game.api_fixture_id} not found in API` }, 404)

  const apiDate = new Date(fixtures[0].fixture.date)
  const dbDate  = new Date(game.kick_off_time)
  const diffMin = Math.abs(apiDate.getTime() - dbDate.getTime()) / 60000

  if (diffMin > 5) {
    await supabase.from('games').update({ kick_off_time: apiDate.toISOString() }).eq('id', game_id)
    await supabase.rpc('fn_schedule_game_sync', { p_game_id: game_id })
    return json({ status: 'updated', db_time: dbDate.toISOString(), api_time: apiDate.toISOString(), diff_minutes: diffMin })
  }

  return json({ status: 'match', kick_off_time: dbDate.toISOString(), diff_minutes: diffMin })
}

// ─── Mode: sync_stats ────────────────────────────────────────────────────────
// Backfill: re-runs writeStats for all finished games (score_home IS NOT NULL)
// that have api_fixture_id set. Writes team stats, player stats, and events.
// Pass game_id to run for a single game only.

async function handleSyncStats(
  supabase: ReturnType<typeof createClient>,
  game_id?: string
): Promise<Response> {
  let query = supabase
    .from('games')
    .select('id, api_fixture_id, team_home, team_away')
    .not('score_home', 'is', null)
    .not('api_fixture_id', 'is', null)

  if (game_id) query = query.eq('id', game_id)

  const { data: games, error: dbErr } = await query
  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)
  if (!games?.length) return json({ status: 'no_games', count: 0 })

  const results: Array<{ game: string; status: string }> = []
  for (const game of games) {
    try {
      await writeStats(supabase, game.id, game.api_fixture_id)
      results.push({ game: `${game.team_home} vs ${game.team_away}`, status: 'ok' })
    } catch (e) {
      results.push({ game: `${game.team_home} vs ${game.team_away}`, status: e instanceof Error ? e.message : String(e) })
    }
  }

  return json({ status: 'done', total: games.length, results })
}

// ─── Mode: sync_af_odds ───────────────────────────────────────────────────────
// Daily: fetches API Football pre-match h2h + Over/Under 2.5 for upcoming games
// Writes to game_odds table with source = 'bet365' (prefers bookmaker ID 8, fallback to first)

const BET365_ID = 8

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSyncAfOdds(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const now          = new Date()
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const { data: games, error: dbErr } = await supabase
    .from('games')
    .select('id, api_fixture_id, team_home, team_away')
    .gt('kick_off_time', now.toISOString())
    .lt('kick_off_time', threeDaysOut.toISOString())
    .not('api_fixture_id', 'is', null)
    .is('score_home', null)

  if (dbErr) throw new Error(`DB error: ${dbErr.message}`)
  if (!games?.length) return json({ status: 'no_upcoming_games', matched: 0 })

  let matched = 0
  const errors: string[] = []

  for (const game of games) {
    try {
      const odds = await footballApiGet(`/odds?fixture=${game.api_fixture_id}`)
      const oddsEntry = odds[0]
      if (!oddsEntry) continue

      const bookmakers: any[] = oddsEntry.bookmakers ?? []
      // Prefer Bet365 (ID 8), fall back to first available bookmaker
      const bookmaker = bookmakers.find((b: any) => b.id === BET365_ID) ?? bookmakers[0]
      if (!bookmaker) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h2hBet    = (bookmaker.bets ?? []).find((b: any) => b.name === 'Match Winner')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalsBet = (bookmaker.bets ?? []).find((b: any) => b.name === 'Goals Over/Under')
      if (!h2hBet) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const homeOdds = parseFloat(h2hBet.values?.find((v: any) => v.value === 'Home')?.odd) || null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drawOdds = parseFloat(h2hBet.values?.find((v: any) => v.value === 'Draw')?.odd) || null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const awayOdds = parseFloat(h2hBet.values?.find((v: any) => v.value === 'Away')?.odd) || null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const over25   = parseFloat(totalsBet?.values?.find((v: any) => v.value === 'Over 2.5')?.odd)  || null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const under25  = parseFloat(totalsBet?.values?.find((v: any) => v.value === 'Under 2.5')?.odd) || null

      const usedBookmaker = bookmaker.id === BET365_ID ? 'bet365' : `af_${bookmaker.id}`

      const { error: upsertErr } = await supabase.from('game_odds').upsert({
        game_id:    game.id,
        source:     usedBookmaker,
        home_win:   homeOdds,
        draw:       drawOdds,
        away_win:   awayOdds,
        over_2_5:   over25,
        under_2_5:  under25,
        updated_at: new Date().toISOString()
      }, { onConflict: 'game_id,source' })

      if (upsertErr) throw new Error(upsertErr.message)
      matched++
      console.log(`af-odds: ${game.team_home} vs ${game.team_away} source=${usedBookmaker} h=${homeOdds} d=${drawOdds} a=${awayOdds} o25=${over25} u25=${under25}`)
    } catch (e) {
      errors.push(`${game.team_home} vs ${game.team_away}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return json({ status: 'done', games_checked: games.length, matched, errors })
}

// ─── Mode: sync ───────────────────────────────────────────────────────────────

async function handleSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createClient>,
  game_id: string,
  phase: string,
  stage: string
): Promise<Response> {
  if (!game_id) return json({ error: 'game_id required' }, 400)

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id, api_fixture_id, team_home, team_away')
    .eq('id', game_id)
    .single()
  if (gameErr || !game) return json({ error: 'Game not found' }, 404)
  if (!game.api_fixture_id) return json({ error: 'api_fixture_id not set' }, 400)

  let fixtures
  try {
    fixtures = await footballApiGet(`/fixtures?id=${game.api_fixture_id}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'RATE_LIMIT') {
      await reportEfError(supabase, 'quota', msg, { game_id, stage })
      await supabase.rpc('fn_schedule_retry_sync', { p_game_id: game_id, p_stage: stage, p_delay_minutes: 10 })
      return json({ status: 'rate_limited_retry_10min', game_id })
    }
    throw e
  }

  if (!fixtures.length) return json({ error: `Fixture ${game.api_fixture_id} not found` }, 404)

  const fixture = fixtures[0]
  const { fixture: fix, goals, score, teams } = fixture
  const status = fix.status.short

  const groupDone      = phase === 'group'    && status === 'FT'
  const knockoutDone   = phase === 'knockout' && (status === 'FT' || status === 'AET' || status === 'PEN')
  const etFollowupDone = stage === 'et_followup' && (status === 'AET' || status === 'PEN')
  const gameFinished   = groupDone || knockoutDone || etFollowupDone
  const etInProgress   = phase === 'knockout' && stage === 'initial' && (status === 'ET' || status === 'BT')
  const penaltyInProgress = phase === 'knockout' && stage === 'initial' && status === 'P'

  if (gameFinished) {
    if (goals.home === null || goals.away === null) {
      await supabase.rpc('fn_schedule_retry_sync', { p_game_id: game_id, p_stage: stage, p_delay_minutes: 5 })
      return json({ status: 'score_null_retry', game_id })
    }

    const update: Record<string, unknown> = {
      score_home: score.fulltime?.home ?? goals.home,
      score_away: score.fulltime?.away ?? goals.away
    }

    if (phase === 'knockout') {
      update.went_to_extra_time = status === 'AET' || status === 'PEN'
      if (status === 'AET' || status === 'PEN') {
        update.et_score_home     = score.extratime?.home ?? null
        update.et_score_away     = score.extratime?.away ?? null
        update.went_to_penalties = status === 'PEN'
        if (status === 'PEN') {
          update.penalty_score_home = score.penalty?.home ?? null
          update.penalty_score_away = score.penalty?.away ?? null
        }
      }
      update.knockout_winner = deriveKnockoutWinner(status, goals, score, teams)
    }

    let updateErr
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabase.from('games').update(update).eq('id', game_id)
      updateErr = error
      if (!error) break
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000))
    }
    if (updateErr) throw new Error(`DB score update failed after 3 attempts: ${updateErr.message}`)

    await writeStats(supabase, game_id, game.api_fixture_id)

    await supabase.rpc('fn_unschedule_game_sync', { p_game_id: game_id })
    return json({ status: 'done', game_id, score: `${goals.home}-${goals.away}`, api_status: status })
  }

  if (etInProgress) {
    await supabase.from('games').update({
      score_home: score.fulltime?.home ?? goals.home,
      score_away: score.fulltime?.away ?? goals.away,
      went_to_extra_time: true
    }).eq('id', game_id)
    await supabase.rpc('fn_schedule_retry_sync', { p_game_id: game_id, p_stage: 'et_followup', p_delay_minutes: 40 })
    return json({ status: 'et_in_progress', game_id })
  }

  if (penaltyInProgress) {
    await supabase.from('games').update({
      score_home:         score.fulltime?.home ?? goals.home,
      score_away:         score.fulltime?.away ?? goals.away,
      went_to_extra_time: true,
      et_score_home:      score.extratime?.home ?? null,
      et_score_away:      score.extratime?.away ?? null,
      went_to_penalties:  true
    }).eq('id', game_id)
    await supabase.rpc('fn_schedule_retry_sync', { p_game_id: game_id, p_stage: 'et_followup', p_delay_minutes: 5 })
    return json({ status: 'penalty_in_progress', game_id })
  }

  await supabase.rpc('fn_schedule_retry_sync', { p_game_id: game_id, p_stage: stage, p_delay_minutes: 5 })
  return json({ status: 'retry_scheduled', game_id, api_status: status })
}

// ─── Combined stats writer ────────────────────────────────────────────────────
// Fetches /fixtures/statistics + /fixtures/players in one parallel call.
// red_cards in game_team_stats derived from player data (VAR-correct):
//   team stat aggregate counts the card event; player stat reflects final decision.

async function writeStats(
  supabase: ReturnType<typeof createClient>,
  game_id: string,
  api_fixture_id: number
): Promise<void> {
  try {
    const [teamStatsArr, playerStatsArr] = await Promise.all([
      footballApiGet(`/fixtures/statistics?fixture=${api_fixture_id}`),
      footballApiGet(`/fixtures/players?fixture=${api_fixture_id}`),
    ])

    // ── Derive red_cards per team from player stats (VAR-correct) ──
    const redCardsByTeam: Record<string, number> = {}
    for (const teamEntry of playerStatsArr) {
      const teamName: string = teamEntry.team?.name ?? ''
      let count = 0
      for (const playerEntry of (teamEntry.players ?? [])) {
        count += playerEntry.statistics?.[0]?.cards?.red ?? 0
      }
      redCardsByTeam[teamName] = count
    }

    // ── Write game_team_stats ──
    for (const teamStats of teamStatsArr) {
      const team = teamStats.team.name

      const stat = (type: string): number | null => {
        const entry = teamStats.statistics?.find((s: { type: string; value: unknown }) => s.type === type)
        if (!entry || entry.value === null || entry.value === undefined) return null
        if (typeof entry.value === 'string' && entry.value.endsWith('%')) return parseInt(entry.value, 10)
        return typeof entry.value === 'number' ? entry.value : null
      }

      const statFloat = (type: string): number | null => {
        const entry = teamStats.statistics?.find((s: { type: string; value: unknown }) => s.type === type)
        if (!entry || entry.value === null || entry.value === undefined) return null
        const v = parseFloat(String(entry.value))
        return isNaN(v) ? null : v
      }

      await supabase.from('game_team_stats').upsert({
        game_id,
        team,
        possession:       stat('Ball Possession'),
        shots_total:      stat('Total Shots')     ?? 0,
        shots_on_target:  stat('Shots on Goal')   ?? 0,
        shots_insidebox:  stat('Shots insidebox') ?? 0,
        corners:          stat('Corner Kicks')    ?? 0,
        fouls:            stat('Fouls')           ?? 0,
        yellow_cards:     stat('Yellow Cards')    ?? 0,
        red_cards:        redCardsByTeam[team]    ?? 0,  // player-derived, VAR-correct
        offsides:         stat('Offsides')        ?? 0,
        passes_total:     stat('Total passes'),
        passes_accuracy:  stat('Passes %'),
        xg:               statFloat('expected_goals'),
      }, { onConflict: 'game_id,team' })
    }

    // ── Write game_player_stats ──
    const rows = []
    for (const teamEntry of playerStatsArr) {
      const teamName = teamEntry.team?.name ?? ''
      for (const playerEntry of (teamEntry.players ?? [])) {
        const p = playerEntry.player
        const s = playerEntry.statistics?.[0]
        if (!p || !s) continue

        const ratingRaw = s.games?.rating
        const rating    = ratingRaw ? parseFloat(String(ratingRaw)) : null

        rows.push({
          game_id,
          api_player_id:  p.id,
          player_name:    p.name,
          team:           s.team?.name ?? teamName,
          minutes_played: s.games?.minutes      ?? null,
          position:       s.games?.position     ?? null,
          rating:         isNaN(rating as number) ? null : rating,
          goals:          s.goals?.total        ?? 0,
          assists:        s.goals?.assists       ?? 0,
          yellow_cards:   s.cards?.yellow        ?? 0,
          red_cards:      s.cards?.red           ?? 0,
          gk_saves:       s.goalkeeper?.saves    ?? null,
          gk_conceded:    s.goalkeeper?.conceded ?? null,
        })
      }
    }

    if (rows.length > 0) {
      await supabase.from('game_player_stats').upsert(rows, { onConflict: 'game_id,api_player_id' })
    }

    // ── Write game_events (goals + red cards with minute data) ──
    const eventsRaw = await footballApiGet(`/fixtures/events?fixture=${api_fixture_id}`)
    const eventRows: Array<{
      game_id: string; team: string; player_name: string | null
      event_type: string; minute: number; minute_extra: number | null; detail: string
    }> = []
    for (const ev of eventsRaw) {
      const type   = ev.type   as string
      const detail = ev.detail as string
      let event_type: string | null = null
      if (type === 'Goal' && ['Normal Goal', 'Own Goal', 'Penalty'].includes(detail)) {
        event_type = 'goal'
      } else if (type === 'Card' && ['Red Card', 'Second Yellow card'].includes(detail)) {
        event_type = 'red_card'
      }
      if (!event_type) continue
      eventRows.push({
        game_id,
        team:         ev.team?.name   ?? '',
        player_name:  ev.player?.name ?? null,
        event_type,
        minute:       ev.time?.elapsed ?? 0,
        minute_extra: ev.time?.extra   ?? null,
        detail,
      })
    }
    if (eventRows.length > 0) {
      await supabase.from('game_events').upsert(eventRows, { onConflict: 'game_id,team,player_name,event_type,minute' })
    }

    console.log(`stats: written game=${game_id} teams=${teamStatsArr.length} players=${rows.length} events=${eventRows.length}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`stats: failed game=${game_id}:`, msg)
    const _sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    await reportEfError(_sb, 'stats_write', msg, { game_id })
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body     = await req.json()
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    switch (body.mode) {
      case 'probe':
        return await handleProbe(body.league_id ?? 39, body.season ?? 2024, body.limit ?? 5)
      case 'probe_stats':
        return await handleProbeStats(body.fixture_id ?? 1208021)
      case 'snap_stats':
        return await handleSnapStats(body.fixture_id ?? 1208021, body.snap_label ?? 'unlabeled')
      case 'probe_odds':
        return await handleProbeOdds(body.fixture_id ?? 1208021)
      case 'setup':
        return await handleSetup(supabase)
      case 'setup_lineups':
        return await handleSetupLineups(supabase, body.fixture_id)
      case 'sync_stats':
        return await handleSyncStats(supabase, body.game_id)
      case 'sync_af_odds':
        return await handleSyncAfOdds(supabase)
      case 'verify':
        return await handleVerify(supabase, body.game_id)
      case 'sync': {
        const rawPhase = body.phase ?? 'group'
        const phase    = rawPhase === 'group' ? 'group' : 'knockout'
        return await handleSync(supabase, body.game_id, phase, body.stage ?? 'initial')
      }
      default:
        return json({ error: 'Unknown mode. Use: probe | probe_stats | snap_stats | probe_odds | setup | setup_lineups | sync_af_odds | verify | sync' }, 400)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('football-api-sync error:', msg)
    try {
      const _sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      await reportEfError(_sb, 'crash', msg)
    } catch { /* best-effort */ }
    return json({ error: msg }, 500)
  }
})

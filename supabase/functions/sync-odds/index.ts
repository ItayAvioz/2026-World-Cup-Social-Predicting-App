/**
 * sync-odds — WorldCup 2026
 *
 * Fetches WC2026 champion outright odds from theoddsapi.com and upserts to champion_odds.
 * Game 1X2 + over/under odds are now pulled from API Football (Bet365) via football-api-sync
 * — see af-odds-daily pg_cron (07:15 UTC).
 *
 * Modes:
 *   probe     — TEST: list soccer sports + sample odds for any sport key
 *   champion  — outright WC2026 winner odds → champion_odds table (William Hill only)
 *
 * Any other mode (or missing mode) returns 400 `unknown_mode`.
 *
 * Trigger (champion): cron-job.org external cron daily at 07:00 UTC, expires Jun 11 2026
 *   (the old pg_cron `champion-odds-daily` was unscheduled on 2026-04-05)
 * Also callable manually for testing.
 *
 * Auth: Bearer {SUPABASE_SERVICE_ROLE_KEY}
 *
 * Secrets required:
 *   theoddsapi                — theoddsapi.com key
 *   SUPABASE_URL              — auto-available
 *   SUPABASE_SERVICE_ROLE_KEY — auto-available
 *
 * Notes:
 *   - Champion sport key: 'soccer_fifa_world_cup_winner' with markets=outrights
 *   - William Hill only: one row per team per day
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
const SPORT_KEY_CHAMPION = 'soccer_fifa_world_cup_winner'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ODDS_API_KEY     = Deno.env.get('theoddsapi')!

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

// ─── TheOddsAPI fetch helper ──────────────────────────────────────────────────

async function oddsApiFetch(url: string): Promise<{ data: unknown[]; remaining: string | null; used: string | null }> {
  const res = await fetch(url)
  if (res.status === 401) throw new Error('ODDS_AUTH_FAILED: check theoddsapi secret')
  if (res.status === 422) throw new Error('ODDS_SPORT_NOT_ACTIVE')
  if (!res.ok) throw new Error(`Odds API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return {
    data: Array.isArray(data) ? data : [],
    remaining: res.headers.get('x-requests-remaining'),
    used:      res.headers.get('x-requests-used'),
  }
}

// ─── Mode: probe ──────────────────────────────────────────────────────────────

async function handleProbe(body: Record<string, unknown>): Promise<Response> {
  // List all sports available on TheOddsAPI
  const sportsRes = await fetch(`${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}&all=true`)
  const sports: unknown[] = sportsRes.ok ? await sportsRes.json() : []

  // Filter to soccer/football sports
  const soccer = (sports as Array<{ key: string; title: string; active: boolean; has_outrights: boolean }>)
    .filter(s => s.key.startsWith('soccer'))
    .map(s => ({ key: s.key, title: s.title, active: s.active }))

  // Try fetching odds for a sport key
  const testSportKey = (body.sport_key as string) ?? 'soccer_england_premier_league'
  const markets = (body.markets as string) ?? 'h2h,totals,spreads'
  const oddsRes = await fetch(
    `${ODDS_API_BASE}/sports/${testSportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=${markets}&oddsFormat=decimal`
  )
  const oddsStatus = oddsRes.status
  const oddsData: unknown[] = oddsRes.ok ? await oddsRes.json() : []

  // Parse first 3 events
  const sample = (oddsData as Array<{
    id: string; sport_key: string; home_team: string; away_team: string;
    commence_time: string; bookmakers: Array<{ key: string; title: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }> }>
  }>).slice(0, 3).map(e => ({
    fixture: `${e.home_team} vs ${e.away_team}`,
    commence_time: e.commence_time,
    bookmakers: e.bookmakers?.slice(0, 2).map(b => ({
      bookmaker: b.title,
      markets: b.markets?.map(m => ({
        market: m.key,
        outcomes: m.outcomes?.map(o => ({ name: o.name, price: o.price }))
      }))
    }))
  }))

  const remaining = oddsRes.headers.get('x-requests-remaining')
  const used      = oddsRes.headers.get('x-requests-used')

  return json({
    status: 'probe_ok',
    soccer_sports_available: soccer.length,
    soccer_sports: soccer,
    test_sport_key: testSportKey,
    odds_status: oddsStatus,
    events_returned: (oddsData as unknown[]).length,
    requests_remaining: remaining,
    requests_used: used,
    sample,
  })
}

// ─── Mode: champion ───────────────────────────────────────────────────────────
// Fetches WC2026 outright winner odds from TheOddsAPI → upserts to champion_odds table
//
// Team name normalization: TheOddsAPI uses 'USA' while teams table uses 'United States'.
// Only teams present in the `teams` table are upserted — TheOddsAPI occasionally lists
// non-qualified long-shot nations (Sweden, Turkey, etc.) which are skipped.

const ODDS_TEAM_NAME_MAP: Record<string, string> = {
  'USA': 'United States',
}

async function handleChampion(supabase: ReturnType<typeof createClient>): Promise<Response> {
  // Load valid WC2026 team names once — we skip any TheOddsAPI team not in this set
  const { data: teamRows, error: teamsErr } = await supabase.from('teams').select('name')
  if (teamsErr) throw new Error(`teams fetch failed: ${teamsErr.message}`)
  const validTeams = new Set((teamRows as Array<{ name: string }>).map(t => t.name))

  const url = `${ODDS_API_BASE}/sports/${SPORT_KEY_CHAMPION}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=outrights&oddsFormat=decimal`

  let events: unknown[]
  let remaining: string | null
  try {
    const result = await oddsApiFetch(url)
    events    = result.data
    remaining = result.remaining
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'ODDS_SPORT_NOT_ACTIVE') {
      return json({ status: 'no_champion_odds', note: `Sport key '${SPORT_KEY_CHAMPION}' not active yet` })
    }
    throw e
  }

  console.log(`sync-odds champion: received ${events.length} events`)

  let upserted = 0
  let skipped_unknown = 0
  const errors: string[] = []

  for (const event of events as Array<{
    home_team: string
    bookmakers: Array<{
      key: string
      title: string
      markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>
    }>
  }>) {
    // Use William Hill only — single source per team
    const bookmaker = (event.bookmakers ?? []).find(b => b.title === 'William Hill')
    if (!bookmaker) continue
    {
      const outright = bookmaker.markets?.find(m => m.key === 'outrights')
      if (!outright) continue

      for (const outcome of (outright.outcomes ?? [])) {
        // Normalize team name (e.g. 'USA' → 'United States')
        const mappedName = ODDS_TEAM_NAME_MAP[outcome.name] ?? outcome.name

        // Skip teams not in WC2026 teams table (Sweden, Turkey, etc.)
        if (!validTeams.has(mappedName)) {
          skipped_unknown++
          continue
        }

        try {
          const { error } = await supabase.from('champion_odds').upsert({
            team_name:  mappedName,
            bookmaker:  bookmaker.title,
            odds:       outcome.price,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'team_name,bookmaker' })

          if (error) throw new Error(error.message)
          upserted++
        } catch (e) {
          errors.push(`${mappedName} / ${bookmaker.title}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  console.log(`sync-odds champion: upserted=${upserted} skipped_unknown=${skipped_unknown} errors=${errors.length} remaining=${remaining}`)
  return json({ status: 'done', events: events.length, upserted, skipped_unknown, errors, requests_remaining: remaining })
}

// ─── EF error reporter ────────────────────────────────────────────────────────

async function reportEfError(
  errorType: 'crash' | 'quota',
  errorMsg: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    await sb.from('ef_errors').insert({
      ef_name:    'sync-odds',
      error_type: errorType,
      error_msg:  errorMsg,
      context:    context ?? null,
    })
  } catch (e) {
    console.error('reportEfError failed:', e instanceof Error ? e.message : e)
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.clone().json() } catch { /* no body */ }

  try {
    if (body.mode === 'probe') {
      return await handleProbe(body)
    }

    if (body.mode === 'champion') {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      return await handleChampion(supabase)
    }

    return json({ error: 'unknown_mode', hint: "Use mode: 'champion' or 'probe'" }, 400)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('sync-odds error:', msg)
    await reportEfError('crash', msg, { mode: body.mode })
    return json({ error: msg }, 500)
  }
})

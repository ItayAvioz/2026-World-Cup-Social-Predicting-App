// build_factbank.mjs — pulls DB ground truth for the 1000-question grading pass (DEV ONLY, read-only).
// Computes team/player aggregates, game list, schedule facts, odds, and group facts once,
// so the grader can check many question templates without one bespoke oracle per question.
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

async function signIn() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('sign-in failed: ' + JSON.stringify(j))
  return { jwt: j.access_token, uid: j.user?.id }
}

async function rest(path, bearer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + bearer } })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${await res.text()}`)
  return await res.json()
}

// PostgREST caps at 1000 rows/request (see memory: picks-candidates-1000row-cap) — paginate
// with Range headers until a page returns fewer than the page size.
async function restAll(path, bearer, orderCol, pageSize = 1000) {
  const sep = path.includes('?') ? '&' : '?'
  let offset = 0
  const all = []
  while (true) {
    const res = await fetch(`${BASE}/rest/v1/${path}${sep}order=${orderCol}.asc&offset=${offset}&limit=${pageSize}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + bearer } })
    if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${await res.text()}`)
    const page = await res.json()
    all.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return all
}

const { jwt, uid } = await signIn()

console.log('pulling games...')
const games = await restAll('games?select=*', KEY, 'id')
console.log('pulling game_team_stats...')
const teamStats = await restAll('game_team_stats?select=*', KEY, 'game_id')
console.log('pulling game_player_stats...')
const playerStats = await restAll('game_player_stats?select=*', KEY, 'game_id')
console.log('pulling champion_odds...')
let championOdds = []
try { championOdds = await rest('champion_odds?select=*&order=odds.asc', jwt) } catch (e) { console.error('champion_odds failed:', String(e)) }
console.log('pulling groups (e2e-visible)...')
let groups = []
try { groups = await rest('groups?select=id,name,created_at,created_by', jwt) } catch (e) { console.error('groups failed:', String(e)) }
const groupMembers = {}
for (const g of groups) {
  try { groupMembers[g.name] = (await rest(`group_members?select=user_id,is_inactive&group_id=eq.${g.id}`, jwt)).length } catch { groupMembers[g.name] = null }
}

// "finished" per CLAUDE.md: score_home IS NOT NULL is the sole authority — no kickoff-time
// re-check (games.status doesn't exist; a score being set IS the finished signal).
const finished = games.filter((g) => g.score_home !== null && g.phase !== 'friendly' && g.team_home !== 'TBD')
const kickedOff = finished

const totalGoals = (g, side) => {
  const s = side === 'home' ? g.score_home : g.score_away
  const et = side === 'home' ? g.et_score_home : g.et_score_away
  return (s ?? 0) + (et ?? 0)
}

// Per-team aggregates: goals for/against (90+ET, pens excluded), games played, W/D/L.
// Tracked in both scopes for the same reason as cards (see below): the EF's per-team
// team_stat tool (goals scored/conceded) was found to be UNSCOPED — it includes the one
// Manchester City friendly (Bournemouth 1-1) that the WC-only aggregate tools exclude.
// teamAgg = unscoped (matches current bot per-team output); teamAggWcScoped = WC-only.
const allFinished = games.filter((g) => g.score_home !== null)
function buildTeamAgg(gameList) {
  const agg = {}
  const touch = (name) => (agg[name] ??= { games: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
  for (const g of gameList) {
    const h = totalGoals(g, 'home'), a = totalGoals(g, 'away')
    const th = touch(g.team_home), ta = touch(g.team_away)
    th.games++; ta.games++
    th.goalsFor += h; th.goalsAgainst += a
    ta.goalsFor += a; ta.goalsAgainst += h
    const w = g.knockout_winner ?? (g.score_home > g.score_away ? g.team_home : g.score_away > g.score_home ? g.team_away : null)
    if (w === g.team_home) { th.wins++; ta.losses++ }
    else if (w === g.team_away) { ta.wins++; th.losses++ }
    else { th.draws++; ta.draws++ }
  }
  return agg
}
const teamAgg = buildTeamAgg(allFinished)
const teamAggWcScoped = buildTeamAgg(kickedOff)

// Cards/corners/fouls per team from game_team_stats. Two scopes are tracked because the EF's
// own cards_total tool was found (2026-07-19 sweep) to sum ALL game_team_stats rows unscoped
// (friendlies included), while its goals/games-played tools scope to WC-only finished games —
// an inconsistency, not a computation bug. teamCardAgg = unscoped (matches current bot output);
// teamCardAggWcScoped = WC-only, for the audit-finding comparison.
const koGameIds = new Set(kickedOff.map((g) => g.id))
const teamCardAgg = {}
const teamCardAggWcScoped = {}
function addCard(bucket, s) {
  if (!bucket[s.team]) bucket[s.team] = { yellow: 0, red: 0, corners: 0, fouls: 0, shots: 0, shotsOnTarget: 0, possessionSum: 0, possessionN: 0, offsides: 0 }
  const t = bucket[s.team]
  t.yellow += s.yellow_cards ?? 0; t.red += s.red_cards ?? 0; t.corners += s.corners ?? 0; t.fouls += s.fouls ?? 0
  t.shots += s.shots_total ?? 0; t.shotsOnTarget += s.shots_on_target ?? 0; t.offsides += s.offsides ?? 0
  if (s.possession != null) { t.possessionSum += s.possession; t.possessionN++ }
}
for (const s of teamStats) {
  addCard(teamCardAgg, s)
  if (koGameIds.has(s.game_id)) addCard(teamCardAggWcScoped, s)
}

// Player aggregates (goals/assists/cards) — unscoped, matching the per-team finding above
// (the EF's player_stat tool sums all game_player_stats rows, friendlies included).
const playerAgg = {}
for (const p of playerStats) {
  const key = p.player_name
  if (!playerAgg[key]) playerAgg[key] = { team: p.team, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0 }
  const a = playerAgg[key]
  a.goals += p.goals ?? 0; a.assists += p.assists ?? 0; a.yellow += p.yellow_cards ?? 0; a.red += p.red_cards ?? 0; a.minutes += p.minutes_played ?? 0
}

const draws = kickedOff.filter((g) => g.score_home === g.score_away)
const totalGoalsSum = kickedOff.reduce((s, g) => s + totalGoals(g, 'home') + totalGoals(g, 'away'), 0)
// cards_total tool is unscoped (see note above) — use the unscoped sum as "what the bot should
// return today"; wcScoped is kept alongside for the audit-finding comparison.
const totalRedCards = Object.values(teamCardAgg).reduce((s, t) => s + t.red, 0)
const totalYellowCards = Object.values(teamCardAgg).reduce((s, t) => s + t.yellow, 0)
const totalRedCardsWcScoped = Object.values(teamCardAggWcScoped).reduce((s, t) => s + t.red, 0)
const totalYellowCardsWcScoped = Object.values(teamCardAggWcScoped).reduce((s, t) => s + t.yellow, 0)
const wentToPens = kickedOff.filter((g) => g.went_to_penalties)
const wentToET = kickedOff.filter((g) => g.went_to_extra_time)

const scorelineCount = {}
for (const g of kickedOff) {
  const key = `${g.score_home}-${g.score_away}`
  scorelineCount[key] = (scorelineCount[key] || 0) + 1
}

const factbank = {
  generatedAt: 'sweep-2026-07-19',
  totals: {
    gamesTotal: games.filter((g) => g.phase !== 'friendly' && g.team_home !== 'TBD').length,
    gamesFinished: finished.length,
    gamesKickedOff: kickedOff.length,
    draws: draws.length,
    totalGoals: totalGoalsSum,
    avgGoalsPerGame: kickedOff.length ? +(totalGoalsSum / kickedOff.length).toFixed(2) : null,
    totalRedCards, totalYellowCards,
    totalRedCardsWcScoped, totalYellowCardsWcScoped,
    wentToPens: wentToPens.length,
    wentToET: wentToET.length,
    nilNilCount: scorelineCount['0-0'] || 0,
  },
  scorelineCount,
  teamAgg,
  teamAggWcScoped,
  teamCardAgg,
  teamCardAggWcScoped,
  playerAgg,
  championOdds: championOdds.map((r) => ({ team: r.team_name, odds: r.odds })),
  groups: groups.map((g) => ({ name: g.name, members: groupMembers[g.name] })),
  games: games.map((g) => ({ id: g.id, home: g.team_home, away: g.team_away, kickoff: g.kick_off_time, score_home: g.score_home, score_away: g.score_away, phase: g.phase, et_home: g.et_score_home, et_away: g.et_score_away, pens_home: g.penalty_score_home, pens_away: g.penalty_score_away, went_et: g.went_to_extra_time, went_pens: g.went_to_penalties, winner: g.knockout_winner })),
}

const outFile = process.argv[2] || 'factbank.json'
fs.writeFileSync(outFile, JSON.stringify(factbank, null, 1))
console.log(`wrote factbank to ${outFile}`)
console.log('totals:', JSON.stringify(factbank.totals, null, 1))
console.log('teams tracked:', Object.keys(teamAgg).length, '| players tracked:', Object.keys(playerAgg).length, '| groups:', groups.length, '| champion_odds rows:', championOdds.length)

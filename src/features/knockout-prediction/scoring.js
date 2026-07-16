// Client-side mirror of SQL fn_knockout_points — for the live "your score" line + coloring.
// Display only; the leaderboard uses the server function.
import { ROUND_BONUS, ROUND_SIZE, PER_TEAM, CHAMPION_POINTS, THIRD_WINNER_POINTS } from './constants.js'

// Reach rounds only. 3rd place is scored separately (win-gated) — see computeKnockoutScore.
const REACH_PHASES = ['qf', 'sf', 'final']

const finishedGames = (games, phase) => (games || []).filter(g => g.phase === phase && g.knockout_winner)
const loserOf = g => (g.team_home === g.knockout_winner ? g.team_away : g.team_home)

// Teams that have REACHED each round = the WINNERS of the prior round's finished games
// (a team advances the moment it wins, so points/colors update per game — no need to wait
// for the next round's fixtures to be inserted). 'third' (3rd-place game) reachers = SF losers.
export function knockoutReached(games) {
  return {
    qf:    new Set(finishedGames(games, 'r16').map(g => g.knockout_winner)),
    sf:    new Set(finishedGames(games, 'qf').map(g => g.knockout_winner)),
    final: new Set(finishedGames(games, 'sf').map(g => g.knockout_winner)),
    third: new Set(finishedGames(games, 'sf').map(loserOf)),
  }
}

// Teams eliminated = lost any finished knockout game. Used only for coloring: a pick is
// RED once its team is out, but stays UNCOLORED while the team is still alive (its game
// not yet played) — prevents premature red before a matchup is decided.
export function knockoutEliminated(games) {
  const s = new Set()
  for (const g of (games || [])) {
    if (g.knockout_winner && ['r32', 'r16', 'qf', 'sf'].includes(g.phase)) s.add(loserOf(g))
  }
  return s
}

// Teams that can NO LONGER win the 3rd-place game, judged BEFORE that game is decided.
// A team is out of bronze contention iff it reached the Final (it plays for gold, never
// enters the bronze game) OR it was eliminated before the SF (never reached the bronze game).
// ⚠️ SF losers are NOT out — they ARE the two bronze contenders, so they stay eligible until
// the 3rd-place game is played. That's why the plain `eliminated` set (which includes SF
// losers) must NOT be used to red-out a 3rd-winner pick; use this instead.
export function knockoutOutOfBronze(games) {
  const reached = knockoutReached(games)     // reached.final = finalists · reached.third = SF losers
  const eliminated = knockoutEliminated(games)
  const out = new Set()
  for (const t of reached.final) out.add(t)                         // finalists can't play for bronze
  for (const t of eliminated) if (!reached.third.has(t)) out.add(t) // knocked out before the SF
  return out
}

// Actual winner of a phase's game (Final = champion, 3rd-place play-off = bronze winner).
// Filter to the DECIDED game (knockout_winner set) — a phase can have >1 row (e.g. a TBD
// placeholder final) and array order could otherwise return a null.
export function actualWinner(games, phase) {
  return (games || []).find(g => g.phase === phase && g.knockout_winner)?.knockout_winner ?? null
}

// picksByRound: { qf:[], sf:[], final:[], third:[], champion:[], thirdWinner:[] }
export function computeKnockoutScore(picksByRound, games) {
  const reached = knockoutReached(games)
  let total = 0
  const breakdown = {}
  for (const round of REACH_PHASES) {
    const picks = picksByRound[round] ?? []
    const act = reached[round]
    const hits = picks.filter(t => act.has(t)).length
    const bonus = hits === ROUND_SIZE[round] ? ROUND_BONUS[round] : 0
    const pts = PER_TEAM * hits + bonus
    breakdown[round] = { hits, bonus, pts }
    total += pts
  }

  // 3rd place — WIN-gated, not "reached". A `third` pick scores PER_TEAM only if that team
  // actually WON the 3rd-place play-off (mirrors fn_knockout_points). The SF loser who merely
  // reaches the bronze game earns nothing; no all-correct bonus (only one team can win).
  const actualThird = actualWinner(games, 'third')
  const thirdPicks  = picksByRound.third ?? []
  const thirdHits   = actualThird && thirdPicks.includes(actualThird) ? 1 : 0
  breakdown.third = { hits: thirdHits, bonus: 0, pts: PER_TEAM * thirdHits }
  total += breakdown.third.pts

  // Single-team winner picks — judged against the actual game winner.
  const champTeam  = (picksByRound.champion ?? [])[0] ?? null
  const actualChamp = actualWinner(games, 'final')
  const champHit = !!champTeam && champTeam === actualChamp
  breakdown.champion = { hit: champHit, pts: champHit ? CHAMPION_POINTS : 0 }
  total += breakdown.champion.pts

  const twTeam  = (picksByRound.thirdWinner ?? [])[0] ?? null
  const actualTw = actualWinner(games, 'third')
  const twHit = !!twTeam && twTeam === actualTw
  breakdown.thirdWinner = { hit: twHit, pts: twHit ? THIRD_WINNER_POINTS : 0 }
  total += breakdown.thirdWinner.pts

  return { total, breakdown }
}

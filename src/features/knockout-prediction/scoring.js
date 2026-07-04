// Client-side mirror of SQL fn_knockout_points — for the live "your score" line.
// Display only; the leaderboard uses the server function.
import { ROUND_BONUS, ROUND_SIZE, PER_TEAM, CHAMPION_POINTS, THIRD_WINNER_POINTS } from './constants.js'

const KO_PHASES = ['qf', 'sf', 'final', 'third']

// Actual teams that reached each round, from the games list (exclude TBD).
export function actualRoundTeams(games) {
  const out = { qf: new Set(), sf: new Set(), final: new Set(), third: new Set() }
  for (const g of games) {
    if (!KO_PHASES.includes(g.phase)) continue
    if (g.team_home && g.team_home !== 'TBD') out[g.phase].add(g.team_home)
    if (g.team_away && g.team_away !== 'TBD') out[g.phase].add(g.team_away)
  }
  return out
}

// Actual winner of a phase's game (the Final = champion, the 3rd-place play-off = bronze).
// Must match the DECIDED game: there can be >1 row for a phase (e.g. a TBD placeholder
// final alongside the real one), so filter to the game whose knockout_winner is set —
// else array order could return the placeholder's null and mis-score the winner pick.
export function actualWinner(games, phase) {
  return (games || []).find(g => g.phase === phase && g.knockout_winner)?.knockout_winner ?? null
}

// picksByRound: { qf:[], sf:[], final:[], third:[], champion:[], thirdWinner:[] }
export function computeKnockoutScore(picksByRound, games) {
  const actual = actualRoundTeams(games)
  let total = 0
  const breakdown = {}
  for (const round of KO_PHASES) {
    const picks = picksByRound[round] ?? []
    const act = actual[round]
    const hits = picks.filter(t => act.has(t)).length
    const bonus = hits === ROUND_SIZE[round] ? ROUND_BONUS[round] : 0
    const pts = PER_TEAM * hits + bonus
    breakdown[round] = { hits, bonus, pts }
    total += pts
  }

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

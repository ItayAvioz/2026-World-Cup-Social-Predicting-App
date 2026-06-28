// Client-side mirror of SQL fn_knockout_points — for the live "your score" line.
// Display only; the leaderboard uses the server function.
import { ROUND_BONUS, ROUND_SIZE, PER_TEAM } from './constants.js'

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

// picksByRound: { qf:[], sf:[], final:[], third:[] }
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
  return { total, breakdown }
}

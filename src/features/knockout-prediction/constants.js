// Knockout team-prediction feature constants.

// Entries close: Jul 4 20:00 Israel (IDT, UTC+3) = 17:00 UTC. Last R32 is the
// night of Jul 3-4; this closes the evening after it. Matches the RPC.
export const KO_PREDICT_LOCK = '2026-07-04T17:00:00Z'

// Points fold into the leaderboard from this moment (10:00 IDT). Display-only
// here; the authoritative gate lives in the leaderboard RPCs.
export const KO_REVEAL = '2026-07-20T07:00:00Z'

// Final kick-off — fallback for the "time to final" countdown when the final
// fixture isn't in the DB yet (the live games list overrides this once pulled).
export const KO_FINAL_KICKOFF = '2026-07-19T19:00:00Z'

// 2 pts per correct team + all-correct bonus per round.
// NB: 3rd place is NOT a "reach" round — it is win-gated (see scoring.js): 2 pts go
// to the team that WINS the 3rd-place play-off, not the SF losers who merely reach it.
// So there is no 3rd-place all-correct bonus and no third entry here.
export const ROUND_BONUS = { qf: 12, sf: 10, final: 8 }
export const ROUND_SIZE  = { qf: 8,  sf: 4,  final: 2 }
export const PER_TEAM    = 2

// Single-team winner picks (judged on games.knockout_winner, not "reached round").
export const CHAMPION_POINTS     = 10  // correct winner of the Final
export const THIRD_WINNER_POINTS = 5   // correct winner of the 3rd-place play-off

// True all-correct max:
//   reach: qf 8*2+12=28, sf 4*2+10=18, final 2*2+8=12 = 58
//   3rd place (win-gated): 2  ·  winners: champion 10 + 3rd-place winner 5 = 15
//   → grand total 58 + 2 + 15 = 75.
export const MAX_POINTS = 75

export function isPredictLocked(now = new Date()) {
  return now >= new Date(KO_PREDICT_LOCK)
}

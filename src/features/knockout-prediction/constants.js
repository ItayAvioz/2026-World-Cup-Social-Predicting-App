// Knockout team-prediction feature constants.

// Entries close: Jul 4 18:00 Israel (IDT, UTC+3) = 15:00 UTC. Last R32 is the
// night of Jul 3-4; this closes the evening after it. Matches the RPC.
export const KO_PREDICT_LOCK = '2026-07-04T15:00:00Z'

// Points fold into the leaderboard from this moment (10:00 IDT). Display-only
// here; the authoritative gate lives in the leaderboard RPCs.
export const KO_REVEAL = '2026-07-20T07:00:00Z'

// Final kick-off — fallback for the "time to final" countdown when the final
// fixture isn't in the DB yet (the live games list overrides this once pulled).
export const KO_FINAL_KICKOFF = '2026-07-19T19:00:00Z'

// 2 pts per correct team + all-correct bonus per round.
export const ROUND_BONUS = { qf: 12, sf: 10, final: 8, third: 6 }
export const ROUND_SIZE  = { qf: 8,  sf: 4,  final: 2, third: 2 }
export const PER_TEAM    = 2

// True all-correct max: qf 8*2+12=28, sf 4*2+10=18, final 2*2+8=12, third 2*2+6=10 = 68.
export const MAX_POINTS = 68

export function isPredictLocked(now = new Date()) {
  return now >= new Date(KO_PREDICT_LOCK)
}

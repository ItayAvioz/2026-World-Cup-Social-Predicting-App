// Odds-mode scoring produces decimals (e.g. 7.29) — integers stay clean, decimals get 2dp.
export const fmtPts = (n) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

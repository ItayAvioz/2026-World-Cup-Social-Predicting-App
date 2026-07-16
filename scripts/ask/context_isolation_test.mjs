// context_isolation_test.mjs — CONTEXT-ISOLATION property test for the ask bot (DEV ONLY).
//
// v31 D5 §1: a SELF-CONTAINED question must give the same (correct) answer whether asked fresh
// or immediately after any unrelated prior turn. This generalizes the exact mechanism behind
// the v30 flagship bug (a typo'd question replayed the previous red-cards answer verbatim)
// into systematic coverage instead of one lucky hand-found pair. It is the acid test for the
// v31 D1 context gate (detectContextNeed) — before that gate, ANY question resolving to zero
// teams + no phase silently inherited stale context.
//
// Curated BLOCKING subset (highest-real-risk pairs). Full cross product: --full (ADVISORY).
// Run: node scripts/ask/context_isolation_test.mjs [--full] [out.json]
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function signIn() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('sign-in failed: ' + JSON.stringify(j))
  return j.access_token
}

async function ask(q, bearer, body = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, ...body }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE', spec: {} }
}

// POISONS — unrelated prior turns, each a real historical bleed trigger. [id, auth, question]
const POISONS = [
  ['poison-redcards', 'anon', 'who is the player with most red cards?'],   // the v30 C1/C2 trigger
  ['poison-boxscore', 'anon', 'provide arsenal psg game stat'],            // 2-team spec -> team-borrow risk
  ['poison-topscorer', 'anon', 'who is the top scorer?'],
  ['poison-compound', 'anon', 'how much points champion and top scorer?'], // the v23 op-borrow trigger
  ['poison-defense', 'anon', 'which team has the best defense?'],          // dim=defense borrow risk
]

// PROBES — self-contained questions whose answer must NOT depend on any prior turn.
// [id, auth, question, [expected substrings; '!'-prefixed = must NOT appear]]
const PROBES = [
  ['next-game', 'anon', 'what is the next game?', ['next game', '!red card']],
  ['pens-list', 'anon', 'which games went to penalties?', ['penalties', '!possession']],  // the P0 audit scenario: 2 stale teams flip it to game_detail
  ['trivia-count', 'anon', 'how many trivia questions are there in total?', ['40']],
  ['exact-rule', 'anon', 'how many points for an exact score?', ['3 point']],
  ['my-exact', 'auth', 'how many exact scores do i have in alpha wolves?', ['exact', '!red card']],
]

// Curated BLOCKING pairs (probe id × poison id) — the highest-risk pairings.
const BLOCKING_PAIRS = new Set([
  'next-game|poison-redcards',      // the literal v30 bug
  'next-game|poison-compound',      // the literal v23 bug
  'pens-list|poison-boxscore',      // the P0 et_pens_list→game_detail flip found by the v31 audit
  'pens-list|poison-defense',
  'trivia-count|poison-redcards',
  'exact-rule|poison-topscorer',
  'my-exact|poison-boxscore',
  'my-exact|poison-redcards',
])

const full = process.argv.includes('--full')
const outFile = process.argv.slice(2).find((a) => !a.startsWith('--'))
const jwt = await signIn()
const bearerFor = (auth) => (auth === 'auth' ? jwt : KEY)

// 1. Baselines — every probe asked fresh must pass its own expectations first.
const baselines = {}
let pass = 0, total = 0
const out = []
for (const [pid, auth, q, exp] of PROBES) {
  const d = await ask(q, bearerFor(auth))
  const route = d.route ?? d.spec?.intent ?? null
  const a = (d.answer ?? '').toLowerCase()
  const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
  baselines[pid] = { route, ok: misses.length === 0 }
  total++
  if (misses.length === 0) pass++
  out.push({ id: `baseline:${pid}`, q, ok: misses.length === 0, route, misses, answer: d.answer })
  console.log(`${misses.length === 0 ? 'PASS' : 'FAIL'}  baseline:${pid.padEnd(24)} route=${route}`)
  if (misses.length) console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 140)} | ${misses.join('; ')}`)
  await sleep(300)
}

// 2. Poison answers cached once each (they're identical every time they're used as a prior turn).
const poisonCache = {}
for (const [zid, auth, q] of POISONS) {
  poisonCache[zid] = { q, auth, res: await ask(q, bearerFor(auth)) }
  await sleep(300)
}

// 3. Poisoned runs — same probe, unrelated prior turn echoed the way the real client does.
for (const [pid, auth, q, exp] of PROBES) {
  for (const [zid] of POISONS) {
    const pairId = `${pid}|${zid}`
    if (!full && !BLOCKING_PAIRS.has(pairId)) continue
    const p = poisonCache[zid]
    const d = await ask(q, bearerFor(auth), {
      history: [p.q],
      ...(p.res?.answer ? { last_answer: p.res.answer } : {}),
      ...(p.res?.spec ? { prev_spec: { teams: p.res.spec.teams ?? [], dim: p.res.spec.dim ?? null } } : {}),
    })
    const route = d.route ?? d.spec?.intent ?? null
    const a = (d.answer ?? '').toLowerCase()
    const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
    // Both content AND routing must hold: the answer still passes the probe's own expectations,
    // and the route/intent equals the un-poisoned baseline's (catches route-bleed even when the
    // wrong tool coincidentally emits acceptable-looking text).
    const routeOk = baselines[pid].route === null || route === baselines[pid].route
    const ok = misses.length === 0 && routeOk
    total++
    if (ok) pass++
    out.push({ id: pairId, q, ok, route, baselineRoute: baselines[pid].route, misses, answer: d.answer })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${pairId.padEnd(38)} route=${route}${routeOk ? '' : ` (baseline=${baselines[pid].route})`}`)
    if (!ok) console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 140)}${misses.length ? ' | ' + misses.join('; ') : ''}`)
    await sleep(300)
  }
}

console.log(`\n===== CONTEXT-ISOLATION SUITE${full ? ' (FULL)' : ''}: ${pass}/${total} PASS =====`)
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
process.exit(pass === total ? 0 : 1)

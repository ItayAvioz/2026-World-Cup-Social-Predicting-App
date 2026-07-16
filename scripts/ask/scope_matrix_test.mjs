// scope_matrix_test.mjs — SCOPE matrix test for the ask bot (DEV ONLY).
//
// v31 D5 §4: the same kind of question asked at different SCOPES (self / my-groups /
// named-group / global / foreign-group) must be served at the right scope — never silently
// substituting "my one group" for "the whole app" or leaking a foreign group's board.
//
// KNOWN GAP (documented, deliberately non-blocking): a true platform-wide pick-popularity
// aggregate does not exist yet (mostPopularPick is my-groups-scoped by design — see
// docs/PLAN_ASK_BOT_V31_ARCHITECTURE.md §7). The 'pop-global-*' rows assert HONESTY about
// scope (name a real group / clean login nudge), not the unbuilt global tally.
// Run: node scripts/ask/scope_matrix_test.mjs [out.json]
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

async function ask(q, bearer, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE', spec: {} }
}

// [id, auth, question, [expected substrings; '!' = must NOT appear]]
// e2e user's groups: Alpha Wolves, Beta Sharks. Foreign group: Demo (the human user's).
const T = [
  // ---- FAMILY A: pick popularity ----
  ['pop-self', 'auth', 'what is my champion pick in Alpha Wolves?', ['Alpha Wolves']],
  ['pop-mygroups', 'auth', 'which team is the most chosen for champion?', ['Alpha Wolves', '!worth 10 points']],
  ['pop-namedgroup', 'auth', 'which team is most picked as champion in Beta Sharks?', ['Beta Sharks', '!Alpha Wolves']],
  // Scope-honesty: answering from my-groups scope must NAME the group(s) it covered, so the
  // user can see the scope was NOT app-wide.
  ['pop-global-auth', 'auth', 'which team is the most popular champion pick across the whole app?', ['!worth 10 points']],
  // ---- FAMILY B: leaderboard / rank ----
  ['lb-self', 'auth', 'what is my rank in alpha wolves?', ['Alpha Wolves', '#']],
  ['lb-namedgroup', 'auth', 'what is my rank in beta sharks?', ['Beta Sharks', '!Alpha Wolves']],
  ['lb-global', 'anon', 'show the global leaderboard', ['Global leaderboard']],
  ['lb-foreigngroup', 'auth', 'who is winning the Demo group?', ['private', '!1.']],
]

const jwt = await signIn()
const out = []
let pass = 0
for (const [id, auth, q, exp] of T) {
  const d = await ask(q, auth === 'auth' ? jwt : KEY)
  const a = (d.answer ?? '').toLowerCase()
  const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
  const ok = misses.length === 0
  if (ok) pass++
  out.push({ id, q, ok, route: d.route ?? d.spec?.intent, misses, answer: d.answer })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(18)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 150)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(300)
}

console.log(`\n===== SCOPE-MATRIX SUITE: ${pass}/${T.length} PASS =====`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(pass === T.length ? 0 : 1)

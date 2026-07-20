// typo_noise_test.mjs — TYPO/NOISE robustness suite for the ask bot (DEV ONLY).
//
// v31 D5 §3: real users type fast and badly — missing spaces, transpositions, phonetic slips.
// Every case here is a mutation of a question whose CLEAN form already passes wide_test/
// real_chat_test, so a failure isolates typo-handling, not the underlying tool. Includes the
// two confirmed live compound-typos ("globalleaderboard", "wentto") that defeated \b-anchored
// regexes until v31 D4's normalizeQuestion().
// Run: node scripts/ask/typo_noise_test.mjs [out.json]
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

// [id, auth, mutated question, [expected substrings; '!' = must NOT appear]]
const T = [
  // ---- confirmed live compound typos (the v31 D4 normalizeQuestion cases) ----
  ['TY-globallb', 'auth', 'who lead the globalleaderboard?', ['global leaderboard', '!Beta Sharks:']],
  ['TY-wentto', 'anon', 'which games wentto penalties', ['penalties']],
  ['TY-topscorer', 'anon', 'who is the topscorer?', ['goal']],
  // v34: clock-robust — post-tournament, "No upcoming games are scheduled." is correct and has
  // no literal "next game" phrase; asserts correct typo-normalization routing, not that a next
  // game currently exists.
  ['TY-nextgame', 'anon', 'whats the nextgame?', ['game', '!have been played']],
  ['TY-lastgame', 'anon', 'what was the lastgame?', ['-', '!next game']],
  // ---- confirmed live word typos ----
  ['TY-chossen', 'auth', 'which team is the most chossen for champion?', ['!worth 10 points']],
  ['TY-choosen', 'auth', 'which team is the most choosen for champion?', ['!worth 10 points']],
  ['TY-froup', 'anon', 'how many members can be in a froup?', ['12']],
  // ---- classic keyboard noise on known-good questions ----
  // v34: clock-robust — same as TY-nextgame above.
  ['TY-nxt', 'anon', 'wat is teh nxt game', ['game', '!have been played']],
  ['TY-scorrer', 'anon', 'hwo is teh top scorrer', ['goal']],
  ['TY-exact', 'anon', 'how many points 4 an exact score?', ['3 point']],
  ['TY-membrs', 'anon', 'how many membrs can b in a group', ['12']],
  ['TY-trivia', 'anon', 'xplain hw trivia wrks', ['24', 'hour']],
  ['TY-finall', 'anon', 'wen is teh finall', ['Netherlands']],
  ['TY-glbl', 'anon', 'show teh global leaderbord', ['Global leaderboard']],
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(14)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 150)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(300)
}

console.log(`\n===== TYPO/NOISE SUITE: ${pass}/${T.length} PASS =====`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(pass === T.length ? 0 : 1)

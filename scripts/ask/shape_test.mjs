// shape_test.mjs — QUESTION-SHAPE matrix test for the ask bot (DEV ONLY).
//
// v31 D5 §2: the SAME topic asked as different question SHAPES (where / when / how-many /
// explain / how-it-works) must produce differently-shaped, shape-correct answers. This is the
// acid test for v31 D4 (RULE_TOPICS + shape-aware rendering) — the confirmed live failures it
// locks in: "explain how Road to Final works" answered with the location-only line; "when do
// champion points get added" answered only the 10-point value; "where can I see the AI summary"
// dumped actual roast content instead of navigation.
//
// Grading: per-case substrings ('!' = must NOT appear) + a cross-shape distinctness check (no
// two shapes of one topic may return byte-identical answers).
// Run: node scripts/ask/shape_test.mjs [out.json]
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

// [topic, shape, auth, question, [expected substrings; '!' = must NOT appear]]
const T = [
  // ---- TOPIC 1: Road to Final (knockout bracket) ----
  // The confirmed live bug: ALL of these used to get the same location-only answer.
  ['rtf', 'where', 'anon', 'where can I see the road to final bracket?', ['Picks']],
  ['rtf', 'lock', 'anon', 'when does the road to final bracket lock?', ['July 4']],
  // v32: max is 75 since the 3rd-place win-gating (2026-07-16) — '83' is the stale pre-gating max.
  ['rtf', 'howmany', 'anon', 'how many points can I get from the knockout bracket?', ['75', '!83']],
  ['rtf', 'explain', 'anon', 'explain how the road to final bracket works', ['75', 'QF', '!83', '!Open Picks and tap']],
  ['rtf', 'howitworks', 'anon', 'how does the knockout bracket prediction work?', ['75', 'QF', '!83', '!Open Picks and tap']],

  // ---- TOPIC 2: AI summary / nightly roast ----
  // "where" used to dump real roast CONTENT (latest_roast's negative lookahead skipped 'where').
  ['ai', 'where', 'auth', 'where can i see the ai summary?', ['AI tab', '!points.']],
  ['ai', 'when', 'anon', 'when does the AI summary get posted?', ['3.5 hours']],
  ['ai', 'explain', 'anon', 'explain what the AI summary is', ['roast']],
  ['ai', 'howitworks', 'anon', 'how does the AI roast work?', ['roast']],

  // ---- TOPIC 3: Champion + Top Scorer picks (value vs timing vs where) ----
  // The confirmed live bug: the value-FAQ always shadowed the timing question.
  ['pick', 'where', 'auth', 'where do I make my champion pick?', ['Picks']],
  ['pick', 'lock', 'anon', 'when do champion and top scorer picks lock?', ['June 11']],
  ['pick', 'howmany', 'anon', 'how many points is the champion pick worth?', ['10 points']],
  // The EXACT transcript failure: a timing question phrased with "point add" got only "10 points each".
  ['pick', 'timing', 'anon', 'when top scorer and champion point add?', ['July 19']],
  ['pick', 'valuetiming', 'anon', 'how much points for champion and top scorer and when do they land?', ['10 points', 'July 19']],
]

const jwt = await signIn()
const out = []
let pass = 0
const byTopic = {}

for (const [topic, shape, auth, q, exp] of T) {
  const d = await ask(q, auth === 'auth' ? jwt : KEY)
  const a = (d.answer ?? '').toLowerCase()
  const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
  const ok = misses.length === 0
  if (ok) pass++
  ;(byTopic[topic] ??= []).push({ shape, answer: d.answer ?? '' })
  out.push({ id: `${topic}:${shape}`, q, ok, route: d.route ?? d.spec?.intent, misses, answer: d.answer })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${(topic + ':' + shape).padEnd(18)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 150)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(300)
}

// Cross-shape distinctness: two DIFFERENT shapes of the same topic collapsing to a byte-identical
// answer is itself the bug this suite exists to catch (shape ignored, topic-keyword won).
// 'explain' and 'howitworks' are DELIBERATELY one equivalence class — RULE_TOPICS maps both to
// the explanation field, and a byte-identical answer between them is correct, not a collapse.
const shapeClass = (s) => (s === 'howitworks' ? 'explain' : s)
let distinctPass = 0, distinctTotal = 0
for (const [topic, rows] of Object.entries(byTopic)) {
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (shapeClass(rows[i].shape) === shapeClass(rows[j].shape)) continue
    distinctTotal++
    const same = rows[i].answer === rows[j].answer && rows[i].answer !== ''
    if (!same) distinctPass++
    else console.log(`FAIL  distinct:${topic} — shapes "${rows[i].shape}" and "${rows[j].shape}" returned byte-identical answers`)
  }
}
console.log(`\ndistinctness: ${distinctPass}/${distinctTotal} shape-pairs distinct`)

const allPass = pass === T.length && distinctPass === distinctTotal
console.log(`\n===== SHAPE SUITE: ${pass}/${T.length} cases + ${distinctPass}/${distinctTotal} distinctness =====`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(allPass ? 0 : 1)

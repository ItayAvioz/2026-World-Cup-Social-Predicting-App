// area_probe_resumable.mjs — resumable batch question runner for the 1000-question sweep (DEV ONLY).
// Writes one JSON-line per answer as it completes (never loses progress on a timeout/kill).
// Re-running with the same args auto-resumes from the last completed line.
// Usage: node scripts/ask/area_probe_resumable.mjs questions.json answers.jsonl [maxSeconds]
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
  return { answer: 'NO_RESPONSE' }
}

const [inFile, outFile, maxSecondsArg] = process.argv.slice(2)
if (!inFile || !outFile) { console.error('usage: node area_probe_resumable.mjs questions.json answers.jsonl [maxSeconds]'); process.exit(2) }
const maxMs = (Number(maxSecondsArg) || 280) * 1000
const deadline = Date.now() + maxMs

const GAP = Math.max(1200, +(process.env.PROBE_GAP_MS ?? 2200) || 2200)
const cases = JSON.parse(fs.readFileSync(inFile, 'utf8'))

let already = 0
if (fs.existsSync(outFile)) {
  already = fs.readFileSync(outFile, 'utf8').split('\n').filter((l) => l.trim()).length
}
if (already >= cases.length) {
  console.log(`DONE already: ${already}/${cases.length}`)
  process.exit(0)
}

const jwt = await signIn()
let done = already
for (let idx = already; idx < cases.length; idx++) {
  if (Date.now() > deadline) { console.log(`\nPAUSED at ${done}/${cases.length} (time budget hit — rerun to resume)`); process.exit(0) }
  const c = cases[idx]
  const bearer = c.auth === 'auth' ? jwt : KEY
  let d
  if (Array.isArray(c.history) && c.history.length) {
    const prior = await ask(c.history[c.history.length - 1], bearer)
    await sleep(200)
    d = await ask(c.q, bearer, {
      history: c.history,
      ...(prior?.answer ? { last_answer: prior.answer } : {}),
      ...(prior?.spec ? { prev_spec: { teams: prior.spec.teams ?? [], dim: prior.spec.dim ?? null } } : {}),
    })
  } else {
    d = await ask(c.q, bearer)
  }
  const row = { idx, q: c.q, auth: c.auth ?? 'anon', difficulty: c.difficulty ?? null, route: d.route ?? null, intent: d.spec?.intent ?? null, llm_used: d.llm_used ?? null, validation_fail: d.validation_fail ?? null, self_healed: d.self_healed ?? null, answer: d.answer ?? '' }
  fs.appendFileSync(outFile, JSON.stringify(row) + '\n')
  done++
  process.stdout.write('.')
  await sleep(GAP)
}
console.log(`\nDONE: ${done}/${cases.length}`)

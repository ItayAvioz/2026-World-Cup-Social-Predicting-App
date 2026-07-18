// area_probe.mjs — batch question runner for area-agent sweeps (DEV ONLY).
// Input: a JSON file of [{ q: "question", auth: "auth"|"anon", history?: [..] }, ...]
// Output: a JSON file of [{ q, auth, route, intent, llm_used, answer }, ...]
// Usage: node scripts/ask/area_probe.mjs questions.json answers.json
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

const [inFile, outFile] = process.argv.slice(2)
if (!inFile || !outFile) { console.error('usage: node area_probe.mjs questions.json answers.json'); process.exit(2) }
const cases = JSON.parse(fs.readFileSync(inFile, 'utf8'))
const jwt = await signIn()
const out = []
for (const c of cases) {
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
  out.push({ q: c.q, auth: c.auth ?? 'anon', route: d.route ?? null, intent: d.spec?.intent ?? null, llm_used: d.llm_used ?? null, answer: d.answer ?? '' })
  process.stdout.write('.')
  await sleep(250)
}
console.log(` ${out.length} probed`)
fs.writeFileSync(outFile, JSON.stringify(out, null, 2))

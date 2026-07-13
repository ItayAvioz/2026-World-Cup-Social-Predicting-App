// probe.mjs — batch question runner for the ask bot (DEV ONLY). Used by test agents.
// Input: a JSON file of [{ q, auth?: 'anon'|'auth', history?: [..] }, ...]
// Output (stdout): JSON array of { q, auth, intent, llm, answer } — answers verbatim.
// Run: node scripts/ask/probe.mjs questions.json [out.json]
// Paces 2.5s between questions and retries on the 30/60s rate-limit message.
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function login() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return d.access_token
}
async function ask(q, bearer, history, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(history ? { question: q, history } : { question: q }) })
      const txt = await res.text()
      if (txt && txt[0] === '{') {
        const d = JSON.parse(txt)
        if (d?.spec?.intent === 'rate_limited') { await sleep(12000); continue }
        return d
      }
    } catch { /* retry */ }
    await sleep(1500 * (i + 1))
  }
  return null
}

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const needsAuth = items.some((x) => x.auth === 'auth')
const jwt = needsAuth ? await login() : null
const out = []
for (const it of items) {
  const d = await ask(it.q, it.auth === 'auth' ? jwt : KEY, it.history)
  out.push({ q: it.q, auth: it.auth ?? 'anon', intent: d?.spec?.intent ?? 'ERR', llm: d?.llm_used ?? null, answer: d?.answer ?? 'NO_RESPONSE' })
  console.error(`[${out.length}/${items.length}] ${it.q} -> ${d?.spec?.intent}`)
  await sleep(2500)
}
const json = JSON.stringify(out, null, 2)
if (process.argv[3]) fs.writeFileSync(process.argv[3], json)
console.log(json)

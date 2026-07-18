// shadow_replay.mjs — SHADOW-REPLAY HARNESS (DEV ONLY).
//
// Replays a corpus of REAL user questions (shadow_corpus.json, exported from ask_log) against
// the currently deployed EF and diffs route+answer against a saved baseline. This is the safety
// net for large refactors (D2 etc.): run BEFORE the change to freeze a baseline, run AFTER to
// see exactly which real questions changed behavior — intended fixes show up as reviewed drift,
// regressions show up before any user does.
//
// Usage:
//   node scripts/ask/shadow_replay.mjs                 # diff against baseline (creates it on first run)
//   node scripts/ask/shadow_replay.mjs --rebase        # overwrite the baseline with current behavior
//   node scripts/ask/shadow_replay.mjs --strict        # exit 1 on ANY drift (CI mode)
//
// Drift is a REPORT, not a failure (default exit 0): after an intended fix you review the drift
// list, confirm each change is the fix you meant, then --rebase.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'
const CORPUS = path.join(DIR, 'shadow_corpus.json')
const BASELINE = path.join(DIR, 'shadow_baseline.json')
const CURRENT = path.join(DIR, 'shadow_current.json')

const rebase = process.argv.includes('--rebase')
const strict = process.argv.includes('--strict')
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
  return { answer: 'NO_RESPONSE' }
}

// Answers contain live data (dates, scores, counts) that legitimately move between runs —
// normalize the volatile bits so only STRUCTURAL drift (different route / different answer
// shape) is reported, not tomorrow's kickoff time.
function normalize(a) {
  return (a ?? '')
    .replace(/\d{1,2}:\d{2}/g, 'HH:MM')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}\b/gi, 'DATE')
    .replace(/\d+(\.\d+)?/g, 'N')
    .toLowerCase().trim()
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'))
const jwt = await signIn()
const current = []
for (const q of corpus) {
  const d = await ask(q, jwt)
  current.push({ q, route: d.route ?? d.spec?.intent ?? null, answer: d.answer ?? '' })
  process.stdout.write('.')
  await sleep(250)
}
console.log(` ${current.length} questions replayed`)
fs.writeFileSync(CURRENT, JSON.stringify(current, null, 2))

if (rebase || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2))
  console.log(`Baseline ${rebase ? 'REBASED' : 'created'}: ${BASELINE} (${current.length} entries)`)
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const byQ = new Map(baseline.map((e) => [e.q, e]))
let routeDrift = 0, answerDrift = 0, added = 0
for (const cur of current) {
  const old = byQ.get(cur.q)
  if (!old) { added++; console.log(`NEW    ${cur.q}`); continue }
  if (old.route !== cur.route) {
    routeDrift++
    console.log(`ROUTE  ${cur.q}\n       ${old.route} -> ${cur.route}`)
  } else if (normalize(old.answer) !== normalize(cur.answer)) {
    answerDrift++
    console.log(`ANSWER ${cur.q}\n       was: ${(old.answer ?? '').replace(/\n/g, ' ').slice(0, 110)}\n       now: ${(cur.answer ?? '').replace(/\n/g, ' ').slice(0, 110)}`)
  }
}
console.log(`\n===== SHADOW REPLAY: ${routeDrift} route drifts · ${answerDrift} answer drifts · ${added} new =====`)
console.log(routeDrift + answerDrift ? 'Review each drift above; if all intended, run with --rebase.' : 'No drift — behavior identical to baseline.')
process.exit(strict && (routeDrift + answerDrift) ? 1 : 0)

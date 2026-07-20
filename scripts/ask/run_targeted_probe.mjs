// run_targeted_probe.mjs — runs targeted_probe_v33_findings.mjs cases against the live EF and
// grades on expected substrings (DEV ONLY, advisory/reporting — not a gate).
// Usage: node scripts/ask/run_targeted_probe.mjs out.json
import fs from 'fs'
import { CASES } from './targeted_probe_v33_findings.mjs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ask(q, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE' }
}

const out = []
let pass = 0
for (const [id, q, family, exp] of CASES) {
  const d = await ask(q)
  const a = (d.answer ?? '').toLowerCase()
  const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
  const ok = misses.length === 0
  if (ok) pass++
  out.push({ id, q, family, ok, route: d.route ?? d.spec?.intent, misses, answer: d.answer })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${family}] ${id.padEnd(24)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 180)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(1500)
}

console.log(`\n===== TARGETED PROBE: ${pass}/${CASES.length} PASS =====`)
const byFamily = {}
for (const r of out) { byFamily[r.family] ??= { pass: 0, n: 0 }; byFamily[r.family].n++; if (r.ok) byFamily[r.family].pass++ }
for (const [fam, s] of Object.entries(byFamily)) console.log(`  ${fam}: ${s.pass}/${s.n}`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))

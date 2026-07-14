// eval.mjs — the ONE command that gates a ship (docs/PLAN_ASK_BOT_V29.md Part 2, phase 7 /
// README.md "Update workflow" step 5). Runs the suites in truth-risk order and refuses to call
// a change done on wide_test alone — that is exactly how a 25%-wrong bot shipped behind a green
// synthetic suite. audit_probe is exploratory (not graded) and printed for manual review, not a
// blocking gate — grade a finding by moving it into real_chat_test.mjs once confirmed.
//
// Usage: node scripts/ask/eval.mjs        (exit 0 = ship, exit 1 = do not ship)
import { spawnSync } from 'child_process'

function run(label, script, args = []) {
  console.log(`\n========== ${label} ==========`)
  const r = spawnSync('node', [script, ...args], { stdio: 'inherit' })
  return r.status === 0
}

const wide = run('wide_test.mjs (regression net — must stay 99/99)', 'scripts/ask/wide_test.mjs')
const real = run('real_chat_test.mjs (the actual gate — must be 17/17)', 'scripts/ask/real_chat_test.mjs')

console.log('\n========== audit_probe.mjs (exploratory, 82Q sweep — NOT a blocking gate) ==========')
console.log('Not run automatically (no fixed pass/fail yet — read its output by hand):')
console.log('  node scripts/ask/audit_probe.mjs out.json')

console.log(`\n===== EVAL: wide_test=${wide ? 'PASS' : 'FAIL'}  real_chat_test=${real ? 'PASS' : 'FAIL'} =====`)
if (!wide || !real) {
  console.log('DO NOT SHIP. Fix the failure(s) above, redeploy, and re-run this before committing.')
  process.exit(1)
}
console.log('Both required suites are green — safe to commit + push (see README § Update workflow, step 8+).')
process.exit(0)

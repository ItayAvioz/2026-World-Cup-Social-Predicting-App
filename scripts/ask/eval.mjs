// eval.mjs — the ONE command that gates a ship (docs/PLAN_ASK_BOT_V29.md Part 2, phase 7 /
// README.md "Update workflow" step 5). Runs the suites in truth-risk order and refuses to call
// a change done on wide_test alone — that is exactly how a 25%-wrong bot shipped behind a green
// synthetic suite. audit_probe is exploratory (not graded) and printed for manual review, not a
// blocking gate — grade a finding by moving it into real_chat_test.mjs once confirmed.
//
// v31: six NEW blocking suites (docs/PLAN_ASK_BOT_V31_ARCHITECTURE.md §4 D5) — each targets a
// failure CLASS the two original suites cannot detect by construction:
//   fault_boundary    — malformed/adversarial input must never crash or leak
//   typo_noise        — real-user typos (incl. run-together compounds) must still route right
//   shape             — same topic × where/when/how-many/explain must answer per SHAPE
//   scope_matrix      — self / my-groups / named-group / global served at the right scope
//   sql_oracle        — numbers checked against INDEPENDENTLY-computed SQL ground truth
//   context_isolation — self-contained questions immune to unrelated prior turns (curated set)
//
// Usage: node scripts/ask/eval.mjs        (exit 0 = ship, exit 1 = do not ship)
import { spawnSync } from 'child_process'

function run(label, script, args = []) {
  console.log(`\n========== ${label} ==========`)
  const r = spawnSync('node', [script, ...args], { stdio: 'inherit' })
  return r.status === 0
}

const results = {}
results.wide = run('wide_test.mjs (regression net)', 'scripts/ask/wide_test.mjs')
results.real_chat = run('real_chat_test.mjs (real user phrasings)', 'scripts/ask/real_chat_test.mjs')
results.fault_boundary = run('fault_boundary_test.mjs (malformed input)', 'scripts/ask/fault_boundary_test.mjs')
results.typo_noise = run('typo_noise_test.mjs (typo robustness)', 'scripts/ask/typo_noise_test.mjs')
results.shape = run('shape_test.mjs (topic × question-shape matrix)', 'scripts/ask/shape_test.mjs')
results.scope_matrix = run('scope_matrix_test.mjs (scope correctness)', 'scripts/ask/scope_matrix_test.mjs')
results.sql_oracle = run('sql_oracle_test.mjs (numbers vs SQL ground truth)', 'scripts/ask/sql_oracle_test.mjs')
results.context_isolation = run('context_isolation_test.mjs (context-bleed immunity, curated)', 'scripts/ask/context_isolation_test.mjs')

console.log('\n========== ADVISORY (not gating, run by hand) ==========')
console.log('  node scripts/ask/audit_probe.mjs out.json            (82Q exploratory sweep)')
console.log('  node scripts/ask/context_isolation_test.mjs --full   (full probe × poison cross-product)')

const line = Object.entries(results).map(([k, v]) => `${k}=${v ? 'PASS' : 'FAIL'}`).join('  ')
console.log(`\n===== EVAL: ${line} =====`)
if (Object.values(results).some((v) => !v)) {
  console.log('DO NOT SHIP. Fix the failure(s) above, redeploy, and re-run this before committing.')
  process.exit(1)
}
console.log('All blocking suites green — safe to commit + push (see README § Update workflow, step 8+).')
process.exit(0)

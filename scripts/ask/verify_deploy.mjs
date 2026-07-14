// Verify the DEPLOYED `ask` Edge Function is byte-identical to the local build artifact.
//
// The deploy invariant is:  deployed === build(supabase/functions/ask/index.ts)
// (see scripts/ask/build.cjs — full-line comments are stripped so the source fits in a
// single MCP deploy tool call; the comments stay in the source.)
//
// Usage:
//   1. node scripts/ask/build.cjs
//   2. deploy _build/index.ts via the Supabase MCP deploy_edge_function tool
//   3. fetch the deployed source via get_edge_function (its result is saved to a file)
//   4. node scripts/ask/verify_deploy.mjs <path-to-saved-get_edge_function-result>
import fs from 'fs'

const rawPath = process.argv[2]
if (!rawPath) { console.error('usage: node scripts/ask/verify_deploy.mjs <saved get_edge_function result>'); process.exit(2) }

const raw = fs.readFileSync(rawPath, 'utf8')
const local = fs.readFileSync('supabase/functions/ask/_build/index.ts', 'utf8').replace(/\r\n/g, '\n')

// The saved tool result is JSON; pull out the JSON-escaped "content" string literal.
const m = raw.match(/"content"\s*:\s*"/)
if (!m) { console.error('could not find a "content" field in ' + rawPath); process.exit(2) }
let i = m.index + m[0].length
const start = i
while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue } if (raw[i] === '"') break; i++ }
const deployed = JSON.parse(raw.slice(start - 1, i + 1))

console.log('deployed chars:', deployed.length)
console.log('build    chars:', local.length)
const exact = deployed === local || deployed === local.replace(/\n$/, '') || deployed + '\n' === local
console.log('EXACT (modulo trailing newline):', exact)

if (!exact) {
  const n = Math.max(local.length, deployed.length)
  for (let k = 0; k < n; k++) {
    if (local[k] !== deployed[k]) {
      console.log('first difference at char', k)
      console.log('BUILD   :', JSON.stringify(local.slice(Math.max(0, k - 90), k + 90)))
      console.log('DEPLOYED:', JSON.stringify(deployed.slice(Math.max(0, k - 90), k + 90)))
      break
    }
  }
  process.exit(1)
}

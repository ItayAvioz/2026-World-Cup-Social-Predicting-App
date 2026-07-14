// Build the deployable bundle for the `ask` Edge Function.
//
// WHY THIS EXISTS: the Supabase MCP `deploy_edge_function` tool takes the source as an
// inline string argument, so the whole file must fit inside a single tool call (~120K chars
// ceiling). index.ts is ~147KB — mostly the "why" comments we deliberately keep. This strips
// full-line comments (and only those) into _build/index.ts, which deploys well under the cap.
// The comments stay in the SOURCE; only the deployed bundle is slimmed.
//
// The deploy invariant becomes: deployed === build(index.ts), verified byte-for-byte by
// scripts/ask/verify_deploy.mjs. Run this before every deploy:
//   node scripts/ask/build.cjs
//
// (If a SUPABASE_ACCESS_TOKEN ever becomes available, `npx supabase functions deploy ask`
// reads index.ts straight from disk and this build step is no longer needed.)

const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'supabase', 'functions', 'ask', 'index.ts')
const OUT_DIR = path.join(__dirname, '..', '..', 'supabase', 'functions', 'ask', '_build')
const OUT = path.join(OUT_DIR, 'index.ts')

const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')

// Drop only WHOLE-LINE `//` comments, and blank lines. Trailing comments after code are left
// alone: a `//` inside a string/regex on a code line must never be touched (e.g. URLs,
// `shoot.?out`). Blank-line stripping is what keeps us under the deploy-call ceiling — the
// v28 rule table pushed the comments-only bundle to ~121.6K, i.e. over it.
const kept = src.split('\n').filter((l) => { const t = l.trim(); return t !== '' && !t.startsWith('//') })
const out = kept.join('\n')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT, out, 'utf8')

console.log(`source : ${src.length} chars, ${src.split('\n').length} lines`)
console.log(`bundle : ${out.length} chars, ${kept.length} lines  ->  ${OUT}`)
console.log(`stripped ${src.length - out.length} chars of comments`)
if (out.length > 120000) console.warn('WARNING: bundle exceeds ~120K — it may not fit in a single deploy tool call.')

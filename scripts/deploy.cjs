#!/usr/bin/env node
'use strict'
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const readline = require('readline')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PROD_DOMAIN = 'pickyguessers.com'

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`)
  return execSync(cmd, { cwd: ROOT, stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8' })
}
function silent(cmd) { return run(cmd, { silent: true }).trim() }

function askConfirmation(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, answer => { rl.close(); resolve(answer.trim()) })
  })
}

async function main() {

console.log(`\n🚀 WC2026 Deploy → ${PROD_DOMAIN}\n`)

// ── 0. Typed confirmation — prevents accidental prod deploys ────
// gh-pages now serves the live PROD app at pickyguessers.com. Require
// an explicit "deploy" string to proceed (no --yes flag accepted).
if (!process.env.WC2026_SKIP_CONFIRM) {
  const answer = await askConfirmation(
    `⚠️  This will publish to PRODUCTION (${PROD_DOMAIN}).\n` +
    `   Type "deploy" to confirm, anything else aborts: `
  )
  if (answer !== 'deploy') {
    console.log('\n❌  Aborted (confirmation not received)\n')
    process.exit(1)
  }
}

// ── 1. Verify dist/app.html exists ──────────────────────────────
const distHtmlPath = path.join(ROOT, 'dist', 'app.html')
if (!fs.existsSync(distHtmlPath)) {
  console.error('❌  dist/app.html not found — run npm run build first')
  process.exit(1)
}

// ── 2. Parse JS + CSS filenames ─────────────────────────────────
const distHtml = fs.readFileSync(distHtmlPath, 'utf8')
const jsMatch  = distHtml.match(/assets\/(app-[^"]+\.js)/)
const cssMatch = distHtml.match(/assets\/(app-[^"]+\.css)/)
if (!jsMatch || !cssMatch) {
  console.error('❌  Could not parse JS/CSS filenames from dist/app.html')
  process.exit(1)
}
const jsFile  = jsMatch[1]
const cssFile = cssMatch[1]
console.log(`📦  ${jsFile}  +  ${cssFile}`)

// ── 3. Bump SW_VERSION in sw.js ─────────────────────────────────
const swPath    = path.join(ROOT, 'sw.js')
let   swContent = fs.readFileSync(swPath, 'utf8')
const verMatch  = swContent.match(/const SW_VERSION = '(\d+)'/)
if (!verMatch) { console.error('❌  SW_VERSION not found in sw.js'); process.exit(1) }
const oldVer = parseInt(verMatch[1], 10)
const newVer = oldVer + 1
swContent = swContent.replace(`const SW_VERSION = '${oldVer}'`, `const SW_VERSION = '${newVer}'`)
fs.writeFileSync(swPath, swContent)
console.log(`🔄  SW_VERSION  ${oldVer} → ${newVer}`)

// ── 4. Commit sw.js bump to main ────────────────────────────────
run('git add sw.js')
run(`git commit -m "chore: bump SW_VERSION to ${newVer}"`)

// ── 5. Save files to temp ───────────────────────────────────────
// Snapshot ALL dist/assets/* (not just main.js+css) so lazy-loaded
// page chunks from React.lazy() are deployed too.
const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'wc2026-'))
const tmpHtml = path.join(tmp, 'app.html')
const tmpSw   = path.join(tmp, 'sw.js')
const tmpAssets = path.join(tmp, 'assets')
fs.mkdirSync(tmpAssets, { recursive: true })

fs.copyFileSync(distHtmlPath, tmpHtml)
fs.copyFileSync(swPath, tmpSw)
const distAssetsDir = path.join(ROOT, 'dist', 'assets')
const allAssets = fs.readdirSync(distAssetsDir)
for (const f of allAssets) {
  fs.copyFileSync(path.join(distAssetsDir, f), path.join(tmpAssets, f))
}
console.log(`💾  Saved to temp: ${tmp} (${allAssets.length} asset files)`)

// ── 6. Stash any remaining main changes ─────────────────────────
let stashed = false
if (silent('git status --porcelain')) {
  run('git stash')
  stashed = true
}

// ── 7. Switch to gh-pages ───────────────────────────────────────
run('git checkout gh-pages')

// ── 8. Copy files ───────────────────────────────────────────────
fs.copyFileSync(tmpHtml, path.join(ROOT, 'app.html'))
fs.copyFileSync(tmpSw,   path.join(ROOT, 'sw.js'))
// Copy ALL asset files. Skip ones already present (content-hashed = identical).
const ghAssetsDir = path.join(ROOT, 'assets')
const copiedAssets = []
for (const f of allAssets) {
  const dest = path.join(ghAssetsDir, f)
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(path.join(tmpAssets, f), dest)
    copiedAssets.push(f)
  }
}
console.log(`  → copied ${copiedAssets.length} new asset file(s)`)

// ── 8b. Inject SW version inline into app.html ─────────────────
// Bulletproof toast detection: window.__APP_VER__ is read synchronously by React
// on mount and compared with localStorage. No SW timing dependency.
const appHtmlPath = path.join(ROOT, 'app.html')
let html = fs.readFileSync(appHtmlPath, 'utf8')
html = html.replace(/\s*<script>window\.__APP_VER__=.*?<\/script>/g, '')
html = html.replace('</head>', `  <script>window.__APP_VER__='${newVer}'</script>\n</head>`)
fs.writeFileSync(appHtmlPath, html)

// ── 8c. Write CNAME for GitHub Pages custom domain ──────────────
// pickyguessers.com is bound to this gh-pages branch via GitHub Pages
// settings. The CNAME file MUST exist on every commit or GitHub strips
// the custom domain setting and reverts to <user>.github.io.
const cnamePath = path.join(ROOT, 'CNAME')
fs.writeFileSync(cnamePath, `${PROD_DOMAIN}\n`)
console.log(`📍  CNAME → ${PROD_DOMAIN}`)

// ── 9. Restore vanilla pages + assets from main ─────────────────
// The vanilla landing surface lives on main, not in dist/. Without explicit
// restoration here, gh-pages keeps stale copies forever (the original Phase 3
// cutover deploy missed updates to js/supabase.js, manifest.json, index.html
// for exactly this reason — pickyguessers.com served stale dev-URL Supabase
// client until we manually hotfixed via direct gh-pages commit).
const vanillaFiles = [
  'index.html',
  'host.html',
  'team.html',
  'manifest.json',
  'js/supabase.js',
  'js/auth2.js',
  'js/main.js',
  'css/style.css',
]
for (const f of vanillaFiles) {
  try { run(`git checkout main -- ${f}`) } catch { /* file may not exist on main */ }
}

// ── 10. Verify app.html ─────────────────────────────────────────
const deployed = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')
const checks = [
  ['serviceWorker',    deployed.includes('serviceWorker')],
  ['manifest',         deployed.includes('manifest.json')],
  ['apple-touch-icon', deployed.includes('apple-touch-icon')],
  [jsFile,             deployed.includes(jsFile)],
  ['sw.js',            deployed.includes('sw.js')],
]
const failed = checks.filter(([, ok]) => !ok)
if (failed.length) {
  console.error(`\n❌  Verification failed — missing: ${failed.map(([k]) => k).join(', ')}`)
  run('git checkout gh-pages -- app.html')
  run('git checkout main')
  if (stashed) run('git stash pop')
  fs.rmSync(tmp, { recursive: true })
  process.exit(1)
}
console.log('✅  app.html verified')

// ── 11. Commit ──────────────────────────────────────────────────
const filesToAdd = [
  'app.html', 'sw.js', 'CNAME',
  ...vanillaFiles,  // index.html, host.html, team.html, manifest.json, js/*, css/style.css
]
for (const f of copiedAssets) filesToAdd.push(`assets/${f}`)
run(`git add ${filesToAdd.join(' ')}`)

const msg = process.argv[2] || `deploy: SW v${newVer} + ${jsFile} (+${copiedAssets.length} assets)`
run(`git commit -m "${msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`)

// ── 12. Push ────────────────────────────────────────────────────
run('git push origin gh-pages')

// ── 13. Return to main ──────────────────────────────────────────
run('git checkout main')
if (stashed) {
  try {
    run('git stash pop')
  } catch {
    // Stash conflict — restore HEAD and drop the stash (deploy already succeeded)
    try { silent('git checkout -- .') } catch {}
    try { silent('git stash drop') } catch {}
    console.log('  ⚠️  Stash conflict resolved — your pre-deploy changes were dropped (deploy succeeded)')
  }
}
fs.rmSync(tmp, { recursive: true })

console.log(`\n✅  Deploy complete! SW v${newVer} — users will see refresh toast on next PWA open`)
console.log(`🌐  Live at https://${PROD_DOMAIN} (≤1 min for GitHub Pages to pick up)\n`)

}  // end of main()

main().catch(err => { console.error(err); process.exit(1) })

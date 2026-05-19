#!/usr/bin/env node
'use strict'
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`)
  return execSync(cmd, { cwd: ROOT, stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8' })
}
function silent(cmd) { return run(cmd, { silent: true }).trim() }

console.log('\n🚀 WC2026 Deploy\n')

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
const tmp    = fs.mkdtempSync(path.join(os.tmpdir(), 'wc2026-'))
const tmpHtml = path.join(tmp, 'app.html')
const tmpJs   = path.join(tmp, jsFile)
const tmpCss  = path.join(tmp, cssFile)
const tmpSw   = path.join(tmp, 'sw.js')

fs.copyFileSync(distHtmlPath, tmpHtml)
fs.copyFileSync(path.join(ROOT, 'dist', 'assets', jsFile), tmpJs)
fs.copyFileSync(swPath, tmpSw)
const distCss = path.join(ROOT, 'dist', 'assets', cssFile)
if (fs.existsSync(distCss)) fs.copyFileSync(distCss, tmpCss)
console.log(`💾  Saved to temp: ${tmp}`)

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
fs.copyFileSync(tmpJs,   path.join(ROOT, 'assets', jsFile))
fs.copyFileSync(tmpSw,   path.join(ROOT, 'sw.js'))
// CSS only if new (avoid bloating gh-pages with duplicates)
const ghCss = path.join(ROOT, 'assets', cssFile)
if (!fs.existsSync(ghCss) && fs.existsSync(tmpCss)) fs.copyFileSync(tmpCss, ghCss)

// ── 9. Restore vanilla pages from main ──────────────────────────
run('git checkout main -- team.html host.html')

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
const filesToAdd = ['app.html', 'sw.js', `assets/${jsFile}`, 'team.html', 'host.html']
try { silent(`git ls-files --error-unmatch assets/${cssFile}`) }
catch { filesToAdd.push(`assets/${cssFile}`) }
run(`git add ${filesToAdd.join(' ')}`)

const msg = process.argv[2] || `deploy: SW v${newVer} + ${jsFile}`
run(`git commit -m "${msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`)

// ── 12. Push ────────────────────────────────────────────────────
run('git push origin gh-pages')

// ── 13. Return to main ──────────────────────────────────────────
run('git checkout main')
if (stashed) run('git stash pop')
fs.rmSync(tmp, { recursive: true })

console.log(`\n✅  Deploy complete! SW v${newVer} — users will see refresh toast on next PWA open\n`)

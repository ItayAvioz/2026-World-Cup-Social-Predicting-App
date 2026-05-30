#!/usr/bin/env node
// Cross-platform postbuild — replaces the Unix-only `cp` chain that fails
// on Windows PowerShell. Copies the vanilla pages, css, js, and PWA assets
// into dist/ so `npm run preview` serves the full site (landing + React app).
//
// Safe to re-run. Missing source files are skipped with a warning (e.g.
// icon-notif.png lives on gh-pages only, not in main repo root).

'use strict'
const fs   = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

if (!fs.existsSync(DIST)) {
  console.error('❌  dist/ not found — run `vite build` first')
  process.exit(1)
}

function copyFile(src, dest) {
  const srcPath  = path.join(ROOT, src)
  const destPath = path.join(DIST, dest)
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️   skipped (missing): ${src}`)
    return false
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.copyFileSync(srcPath, destPath)
  return true
}

function copyDir(src, dest) {
  const srcPath  = path.join(ROOT, src)
  const destPath = path.join(DIST, dest)
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️   skipped (missing dir): ${src}`)
    return false
  }
  fs.mkdirSync(destPath, { recursive: true })
  for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else copyFile(s, d)
  }
  return true
}

// ── Vanilla pages (HTML at root, served by landing + nav) ───────────
const files = [
  'index.html', 'host.html', 'team.html',
  'manifest.json', 'sw.js',
  'icon-180.png', 'icon-512.png', 'icon-notif.png', 'icon-badge.png',
]
let copied = 0
for (const f of files) if (copyFile(f, f)) copied++

// ── Recursive dirs ──────────────────────────────────────────────────
const dirs = ['css', 'js']
for (const d of dirs) if (copyDir(d, d)) copied++

// ── Single asset still referenced from inline landing CSS ───────────
copyFile('assets/Trophy.webp', 'assets/Trophy.webp')

console.log(`✅  postbuild: copied ${copied} entries to dist/`)

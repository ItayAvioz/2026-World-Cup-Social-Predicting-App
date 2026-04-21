---
name: frontend
description: Build and review WorldCup 2026 frontend JS files, HTML pages, and Supabase SDK patterns. Use when building auth.js, predictions.js, leaderboard.js, ai-feed.js, or any HTML page.
argument-hint: [file-or-feature-name]
---

# WorldCup 2026 — Frontend Builder

⏳ **This skill is a placeholder — activate and fill in when the frontend phase begins.**

## When to activate
After DB phase is fully verified (all features in docs/PLAN.md checked off).

## What this skill will cover
- Auth flow: signUp → create_profile RPC → redirect
- Session guard pattern for protected pages
- Supabase SDK patterns per feature (predictions upsert, picks upsert, leaderboard RPC)
- Invite link handling (?invite=CODE on page load)
- Mobile-first component patterns
- Error handling conventions (42501 = locked, named RPC errors)
- Dark theme CSS conventions

## Stack reminders
- No framework, no build step — plain HTML + JS
- `_supabase` from js/supabase.js (UMD CDN, window.supabase)
- GitHub Pages hosting — all HTML at root
- Mobile-first, dark theme (#0a0a0a base)

## Load memory/frontend-phase.md for full details

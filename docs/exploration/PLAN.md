# WorldCup 2026 — Architecture Exploration Plan

All playgrounds live in this folder: `docs/exploration/`
One HTML file per feature. Open in any browser — no server needed.
After each playground: ask questions here in conversation, then move to next.

---

## How to use

1. We build a playground → I write the file here
2. You open it in Chrome / Edge
3. You click around, read the flow, ask me anything
4. When ready → say "next" → we move to the next feature

---

## Feature Map (build order)

| # | Name | File | What it covers | Status |
|---|------|------|----------------|--------|
| 1 | Auth Flow | `01-auth-flow.html` | Landing → register → login → session guard → invite → redirect to React app | ✅ |
| 2 | React App Shell | `02-react-shell.html` | Vite SPA entry, HashRouter, AuthGuard, BottomNav routing, AuthContext session lifecycle | ✅ |
| 3 | Friend Groups | `03-groups.html` | Create group, invite code, join flow, captain vs member roles, is_inactive, leaderboard RPC, limits (3 groups / 10 members) | ✅ |
| 4 | Game Predictions | `04-predictions.html` | Predict a score, kickoff deadline lock, auto-predict (pg_cron), RLS reveal at kickoff, is_auto badge, per-group scope | ✅ |
| 5 | Champion + Top Scorer Picks | `05-picks.html` | Per-group picks, lock deadline (Jun 11), upsert pattern, auto-assign fallback, scoring (10pt each) | ✅ |
| 6 | Scoring Engine | `06-scoring.html` | Points rules (1pt outcome / 3pt exact), how predictions.points_earned is set, champion/top-scorer triggers, tiebreaker (exact_scores) | ✅ |
| 7 | Leaderboard (Global + Group) | `07-leaderboard.html` | get_leaderboard RPC, get_group_leaderboard RPC, RANK() OVER, user×group rows, global rank per row, tiebreaker | ✅ |
| 8 | Dashboard Page | `08-dashboard.html` | Hero countdown, global leaderboard, today's games, My Stats panel (group rank + global rank + picks + exact%/predicted%/streak), profile sheet | ✅ |
| 9 | Game Page | `09-game.html` | Pre-kickoff team stats, predict widget, post-kickoff member predictions reveal, group + global stat blocks, knockout display (ET/pens) | ✅ |
| 10 | Game Data Sync (EF) | `10-football-api-sync.html` | football-api-sync Edge Function flow: pg_cron → EF → api-football.com → parse → upsert games/stats/odds, error groups | ✅ |
| 11 | AI Nightly Summary (EF) | `11-nightly-summary.html` | pg_cron → nightly-summary EF → build prompt per group → OpenAI gpt-4o-mini → parse → save input_json + display_data → ai_summaries | ✅ |
| 12 | AI Feed Page | `12-ai-feed.html` | AiFeed.jsx: fetch ai_summaries per group, daily standings toggle, total standings toggle, global_rank from display_data, old vs new card behaviour | ✅ |
| 13 | Database Deep-Dive | `13-database.html` | Full schema map: all tables, columns, FK relationships, RLS policies, RPCs, triggers, pg_cron jobs — interactive ERD-style explorer | ✅ |
| 14 | Deployment Pipeline | `14-deployment.html` | GitHub Pages manual deploy flow: npm run build → dist/ → copy to gh-pages root, main.js vs src/lib/teams.js, team.html duplication | ✅ |

---

## Architecture Overview (read before starting)

```
USER (mobile browser / WhatsApp link)
        │
        ▼
index.html  (Vanilla HTML + JS)
  ├── js/supabase.js    ← UMD CDN Supabase client
  └── js/auth.js        ← register / login / invite → redirects to app.html
        │
        ▼
app.html  (React 18 + Vite SPA)
  └── src/
       ├── main.jsx         ← ReactDOM.render
       ├── App.jsx          ← HashRouter + AuthGuard
       ├── context/
       │    ├── AuthContext  ← session, user, signOut
       │    └── ToastContext ← global toasts
       ├── components/
       │    ├── Layout       ← page shell + BottomNav
       │    ├── Modal        ← reusable modal
       │    ├── GroupSelector← group pill tabs
       │    └── Flag         ← team flag CDN image
       └── pages/
            ├── Dashboard    ← global leaderboard + today's games + My Stats
            ├── Groups       ← create/join/manage groups + focus game + predictions
            ├── Game         ← predict + stats + member predictions reveal
            ├── Picks        ← champion + top scorer per group
            └── AiFeed       ← nightly AI summaries per group
        │
        ▼
Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
  ├── Auth             ← email/password, session in localStorage
  ├── Database         ← profiles, groups, games, predictions, champion_pick, top_scorer_pick, ai_summaries…
  ├── RLS              ← row-level security on every table
  ├── RPCs             ← get_leaderboard, get_group_leaderboard, create_group, join_group, delete_account…
  ├── Triggers         ← invite_code gen, points_earned update, champion/top-scorer scoring
  └── Edge Functions
       ├── football-api-sync  ← api-football.com → games, stats, odds (pg_cron, daily)
       ├── sync-odds          ← theoddsapi.com → champion_odds (pg_cron, daily)
       └── nightly-summary    ← leaderboard + games → OpenAI → ai_summaries (pg_cron, nightly)
        │
        ▼
GitHub Pages (gh-pages branch)
  Manual deploy — no CI/CD
```

---

## Supabase Key Tables (quick reference)

| Table | Purpose |
|---|---|
| `profiles` | username per user (extends auth.users) |
| `groups` | friend group, invite_code, created_by |
| `group_members` | user ↔ group membership, is_inactive |
| `games` | all 104 fixtures: teams, kickoff, scores (90-min only), phase, ET/pens |
| `predictions` | user × game × group scoreline pick, points_earned, is_auto |
| `champion_pick` | user × group champion team pick |
| `top_scorer_pick` | user × group top scorer player pick |
| `team_tournament_stats` | accumulated tournament stats per team (from EF) |
| `ai_summaries` | nightly AI text per group, input_json + display_data |
| `champion_odds` | current WC winner odds per team (from sync-odds EF) |

---

## Scoring Rules (quick reference)

| Event | Points |
|---|---|
| Correct outcome (W/D/L) | 1 |
| Exact scoreline | 3 (not additive — replaces the 1pt) |
| Correct champion pick | 10 |
| Correct top scorer pick | 10 |
| Tiebreaker | exact_scores count (RANK, no username tiebreaker) |

---

## Status key
- ⬜ Not started
- 🔄 In progress
- ✅ Done

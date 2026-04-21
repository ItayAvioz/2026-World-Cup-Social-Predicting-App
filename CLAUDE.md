# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WorldCup 2026 Social Betting** — a semi-public social predictions app for the 2026 FIFA World Cup. Users join via invitation into friend groups, predict game results, pick the champion and top scorer, earn points, and compete on a group leaderboard. An AI generates nightly funny/social summaries per group.

## Tech Stack

- **Frontend (landing)**: Vanilla HTML + CSS + JS (`index.html` + `js/auth.js`) — no build step
- **Frontend (app)**: React 18 + Vite — SPA entry at `src/app.html`, HashRouter, builds to `dist/`
- **Backend/Auth/DB**: Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
- **AI**: OpenAI gpt-4o-mini called from a Supabase Edge Function (`nightly-summary`) via pg_cron
- **Game Data**: Football API (api-football.com) — automatic via `football-api-sync` Edge Function
- **Hosting**: GitHub Pages — `gh-pages` branch, manual deploy (no GitHub Actions)

## File Structure

```
/
│  -- Landing (vanilla) --
├── index.html              # Landing + Login + Register (vanilla JS, no framework)
├── js/
│   ├── supabase.js         # Supabase UMD client — used by index.html only
│   ├── auth.js             # Login / register / session / invite handling → redirects to app.html
│   └── main.js             # TEAMS array + HOST_SCHEDULES (all 104 games)
├── css/
│   └── style.css           # Global styles — dark theme (#0a0a0a), mobile first
│                             (imported by React app AND used by index.html)
│
│  -- React App (Vite SPA) --
├── src/
│   ├── app.html            # SPA entry point → dist/app.html
│   ├── main.jsx            # ReactDOM.render + imports css/style.css
│   ├── App.jsx             # HashRouter + routes + AuthGuard
│   ├── lib/
│   │   ├── supabase.js     # ESM Supabase client (npm @supabase/supabase-js)
│   │   └── teams.js        # TEAMS array (extracted from js/main.js)
│   ├── context/
│   │   ├── AuthContext.jsx # Session, user, profile — shared across all pages
│   │   └── ToastContext.jsx# Global toast notifications
│   ├── components/
│   │   ├── Layout.jsx      # Page shell: BottomNav + title + padding
│   │   ├── BottomNav.jsx   # Fixed bottom nav — Dashboard/Groups/Picks/AI
│   │   ├── Modal.jsx       # Reusable modal component
│   │   ├── GroupSelector.jsx # Group pill tabs / dropdown selector (reused across pages)
│   │   └── Flag.jsx        # Team flag image with CDN + fallback
│   └── pages/
│       ├── Dashboard.jsx   # ✅ Leaderboard + today's games + hero
│       ├── Groups.jsx      # ✅ Create/join/manage groups + predictions
│       ├── Game.jsx        # ✅ Single game — predict, stats, odds, result
│       ├── Picks.jsx       # ✅ Champion + top scorer picks (per group)
│       ├── AiFeed.jsx      # ✅ Nightly AI summaries per group
│       ├── Host.jsx        # ❌ OUT OF SCOPE — all 104 games covered by Picks.jsx (predictions tab)
│       └── Team.jsx        # ❌ OUT OF SCOPE — team stats covered by Game.jsx (team stats section)
│
│  -- Vanilla Extra Pages --
├── host.html               # All 104 fixtures list (vanilla, linked from landing)
├── team.html               # Mobile team detail page (vanilla, ?code=XX query param)
│                             ⚠️ Contains own hardcoded TEAMS+TEAM_EXTRA — must stay in
│                               sync with js/main.js manually until fix is applied
│
│  -- Build Output --
├── dist/                   # Vite build output → copied to gh-pages root manually
│
│  -- Docs --
├── docs/
│   ├── PLAN_REACT_VITE.md  # React + Vite migration plan (build order)
│   ├── PAGE_SPECS.md       # Per-page intended UX
│   ├── DESIGN_TOKENS.md    # CSS vars, component patterns
│   ├── UX_PATTERNS.md      # Spacing grid, touch targets, a11y rules
│   ├── SDK_PATTERNS.md     # All Supabase SDK code blocks
│   └── PLAN_API_SYNC.md    # EF architecture + cron lifecycle
│
│  -- Supabase Backend --
└── supabase/
    ├── migrations/          # SQL migration files — 57 deployed
    └── functions/
        ├── football-api-sync/  # ✅ Game data + player stats sync (v24 ACTIVE)
        ├── sync-odds/          # ✅ Odds sync from theoddsapi (v14 ACTIVE)
        └── nightly-summary/    # ✅ Nightly AI roast per group → ai_summaries (v14 ACTIVE)
```

## Supabase Database Schema

Live ERD is maintained in `.claude/skills/db-feature/SKILL.md`. Key points:

- `profiles` (id, username) — extends auth.users. No email stored here.
- `games` — NO `status` column. Use `score_home IS NOT NULL` to detect finished games.
- `games.score_home/score_away` — **90-min score only**, never ET or penalties. API sync MUST write only the 90-min score here even for knockout games that go to ET/pens.
- `games.knockout_winner` — actual winner after ET/pens if applicable. Used for champion/top-scorer points and leaderboard display. Never used for prediction scoring.
- `games.phase` — `'group'|'r32'|'r16'|'qf'|'sf'|'third'|'final'`
- `games.went_to_extra_time` — boolean, nullable — NULL = group stage or unplayed.
- `games.went_to_penalties` — boolean, nullable — NULL = group stage or unplayed.
- `games.et_score_home/et_score_away` — int, nullable — score after ET. NULL if no ET.
- `games.penalty_score_home/penalty_score_away` — int, nullable — penalty shootout score. NULL if no pens.
- Display pattern: prediction | 90-min score | end game score (ET or pens). score_home/away = 90-min only, never changes.
- `predictions` — includes `is_auto` (system-generated at kickoff), `updated_at`
- `group_members` — includes `is_inactive` flag
- `champion_pick` — **per-group**: `UNIQUE(user_id, group_id)`. Each user has one champion pick per group. `group_id uuid NOT NULL FK → groups(id)`.
- `top_scorer_pick` — **per-group**: same schema pattern as champion_pick. `UNIQUE(user_id, group_id)`.
- `ai_summaries` — includes `input_json` (LLM payload snapshot) and `display_data` (UI-only, never sent to LLM — stores `global_ranks: { username: rank }` per group member).
- Points: exact score = **3pt**, correct outcome = **1pt** (not additive)

## Scoring Rules

| Event | Points |
|---|---|
| Correct outcome (win/draw/loss) | 1 |
| Exact scoreline | 3 |
| Correct champion | 10 |
| Correct top scorer | 10 |

## Prediction Deadlines & Availability

- **Group stage games**: open for prediction once all 48 teams are known (~March 2026)
- **Champion + top scorer picks**: open same time, lock permanently at `2026-06-11T19:00:00Z`. **Per-group** — each group has independent picks; user makes separate champion + top scorer picks for each group they belong to.
- **Each game scoreline**: locks at that game's individual `kick_off_time`
- **Knockout games**: only become available to predict once matchups are known (after group stage resolves)
- Deadlines enforced client-side (`new Date() >= new Date(deadline)`) and via Supabase RLS as backstop

## UI

- **Mobile first** — primary target is phone (users arrive via WhatsApp invite link)
- **Dark theme throughout**: base background `#0a0a0a`, avoid white backgrounds
- CSS variables for theming (`css/style.css`) — shared between landing and React app
- **Language**: English
- React app uses `css/style.css` via `import '../css/style.css'` in `src/main.jsx`
- Component patterns in `docs/DESIGN_TOKENS.md`; UX rules in `docs/UX_PATTERNS.md`

## Supabase Client Init Pattern

**React app** (`src/lib/supabase.js`) — ESM, npm package:
```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

**Landing** (`js/supabase.js`) — UMD CDN, window global:
```js
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are safe to expose (anon key only). Values are hardcoded in both files.

## Auth Flow

- Supabase email/password auth — collects username + email only at registration
- `js/auth.js` (vanilla) handles register/login on `index.html`
- On login success → redirect to `./app.html#/dashboard` (React SPA entry)
- Session stored in `localStorage` by Supabase SDK automatically
- React app: `AuthContext.jsx` reads session on mount, guards all routes via `AuthGuard`
- Redirect to `index.html` if no session
- Champion + top scorer picks made after joining groups — per-group, on `#/picks`

## User Self-Service Rules (cutoff: 2026-06-11 19:00 UTC)

| Action | Rule | Enforcement |
|---|---|---|
| Rename username | Allowed until June 11 19:00 UTC, locked after | RLS UPDATE policy with date check |
| Delete account | Allowed if: not in any group AND before June 11 | `delete_account()` RPC — raises `account_locked` or `cannot_delete_in_group` |
| Rename group | Allowed until June 11 19:00 UTC, locked after | RLS UPDATE policy with date check |
| Leave group | Never allowed | No DELETE policy on group_members |
| Delete group | Never allowed | No DELETE policy on groups |

**Account deletion cascades:** profiles, predictions, champion_pick, top_scorer_pick, group_members all CASCADE. groups.created_by → SET NULL (group survives).

## Game Data (Automatic)

- All game schedules, scores, and results pulled automatically from api-football.com
- No admin panel — data flows directly from API into Supabase via `football-api-sync` Edge Function
- Stats synced per game: goals, goals conceded, results, cards, corners, player stats, odds

## AI Summary Edge Function

- Runs nightly via Supabase pg_cron (150min after last kickoff of the day)
- Generates one summary **per group** (qualifying groups: ≥3 active members)
- Reads that group's leaderboard and that day's completed games from DB
- Calls OpenAI gpt-4o-mini (key stored in Supabase vault as `AI_Summary_GPT_Key`)
- **Tone**: purely funny and social — roast, banter, rankings. Not a game recap.
- Saves result to `ai_summaries` table (scoped to `group_id`)
- `input_json`: full LLM payload snapshot (never contains global rank — UI-only data goes to `display_data`)
- `display_data`: UI-only fields — `global_ranks: { username: rank }` computed at EF time, never sent to LLM
- Visible only to members of that group

## GitHub Pages Deployment

- Deploy target: `gh-pages` branch, root `/` — **fully manual, no GitHub Actions**
- After `npm run build`, copy `dist/assets/*` to `assets/`, update `app.html` JS/CSS filenames
- Restore `team.html` and `host.html` from `main` branch each deploy (they are vanilla pages, not in dist/)
- Full deploy steps in memory: `feedback_deploy.md`

---

## Feature Characterization

### 1. Friend Groups

**Concept**: Invitation-only private groups. Each group has its own leaderboard and nightly AI summary. A user can belong to multiple groups.

**Roles:**
- **Captain** (creator): creates the group, shares the invite link, can rename the group (until June 11). Cannot delete the group (groups are permanent). Can flag members as inactive — but NOT themselves.
- **Member**: joins via invite link / QR code only. Cannot leave once joined.

**`is_inactive` flag rules:**
- Captain flags a member as inactive when they've stopped playing
- Flagged member: still earns auto-predict points, still appears on leaderboard (dimmed in UI), may be skipped or roasted differently in AI summary
- Captain cannot flag themselves as inactive (disabled in UI — hide/disable the flag button on the captain's own row)
- No captaincy transfer — captain role is permanent (`created_by` is fixed)
- No leave / remove / delete by request — if needed, contact app admin who handles it manually via Supabase dashboard

**UI hints to show in Groups.jsx:**
- Next to the inactive flag button: *"Mark as inactive if this member has stopped playing. They'll still earn points but will be dimmed on the leaderboard."*
- At the bottom of the members list: *"Members are permanent. To remove a member or delete the group, contact the admin."*

**Limits:** Max 3 groups total per user (created + joined combined). Max 10 members per group (including captain).

**Invite flow:**
1. Captain creates group → gets a unique shareable WhatsApp link
2. Friend clicks link → if not registered, lands on `index.html`, registers → auto-joins group
3. If already logged in → lands on Groups.jsx with join dialog pre-filled

**Group leaderboard (`get_group_leaderboard`):**
- Shown inside each group card on the Groups.jsx page
- Shows only members of that specific group, ranked by total points (predictions + picks scoped to that group)
- Each row: group_rank, global_rank, username, champion pick flag, top scorer, total pts
- Current user's row highlighted

**Dashboard leaderboard:**
- Always shows the **global leaderboard** (no toggle) — one row per (user × group)
- My Stats panel (right column) shows group_rank + global_rank per group card

**Global leaderboard:**
- One row per **(user × group)** — user in 3 groups = 3 rows, each scored independently
- Users with no group get one row (group = —, 0 pts) — all registered users are visible
- Score per row = predictions scoped to that group + champion pick + top scorer pick for that group
- **Rank ties**: `RANK() OVER (ORDER BY total_points DESC, exact_scores DESC)` — no username tiebreaker; same points = same rank; numbering skips (e.g. 3 users at #1 → next is #4)
- Columns: rank · player · group · champion flag · top scorer · pts

- `invite_code`: unique, 6-char alphanumeric, generated by DB trigger on insert. QR code only.
- RLS: group data visible to members only. Join via `join_group(invite_code)` RPC.

### 2. Champion + Top Scorer Picks (Per-Group)

**Concept**: Each user makes one champion pick and one top scorer pick **per group** they belong to. Picks are independent between groups — a user in 3 groups makes 3 separate sets of picks.

**Schema:** `champion_pick` and `top_scorer_pick` both have `group_id uuid NOT NULL FK → groups(id)` with `UNIQUE(user_id, group_id)`. Upsert uses `onConflict: 'user_id,group_id'`.

**UI (Picks page):**
- Group selector tabs at top — one pill tab per group (sorted by joined_at)
- Switching tabs loads and saves picks scoped to that group
- Champion: searchable list of all 48 teams + 6 TBD qualifier slots (greyed-out)
- Top scorer: searchable list of 30 hardcoded star player candidates
- Both sections show lock state after `2026-06-11T19:00:00Z`

**Scoring:**
- Correct champion: **10pt** — awarded when `knockout_winner` is set on the final game (trigger)
- Correct top scorer: **10pt** — awarded same event
- Group leaderboard: uses **this group's** picks only
- Global leaderboard: each (user × group) row is scored independently — no cross-group deduplication

**Auto-assign:** `fn_auto_assign_picks()` — fires at deadline, loops `(user_id, group_id)` pairs from group_members, inserts random picks for any missing. Marked `is_auto = true`.

**RLS:** INSERT/UPDATE require `is_group_member(group_id, auth.uid())` + before deadline. SELECT: own always; all after `2026-06-11T19:00:00Z`.

### 3. Prediction Reveal at Kickoff

- Predictions are **private** until the game's `kick_off_time` is reached
- Once kickoff passes, **group members** can see each other's predictions for that game (not global)
- On Game.jsx, a list shows each group member's predicted scoreline after kickoff
- Enforced via Supabase RLS using `share_a_group()` helper + `kick_off_time <= now()`
- **Auto-predict**: if a user hasn't submitted before kickoff, the system inserts a random score (0–5 each team) automatically via pg_cron. Auto-predictions earn points the same as manual ones. Marked with `is_auto = true` for UI display.

### 4. Prediction Statistics at Kickoff

- Displayed on Game.jsx once the game is live
- **Two stat blocks**: group stats + global stats side by side
- Each block shows:
  - Outcome split: X home win / Y draw / Z away win (count + %)
  - Average predicted goals
  - Most popular scoreline
  - Surprise pickers: users who went against the majority outcome

### 5. Pre-Game Team Data

- Shown on Game.jsx before kickoff to help users make predictions
- Tournament-accumulated stats for each team:
  - Results (W/D/L in this tournament)
  - Goals scored, goals conceded
  - Cards (yellow/red)
  - Corners
- Data sourced automatically from api-football.com via `football-api-sync` EF

### 6. Full Global Leaderboard

- Always shown on Dashboard.jsx (no toggle) — one row per (user × group)
- Shows all registered users ranked by total points
- Ties broken by number of exact scorelines only — same points + same exact scores = same rank (RANK(), no username tiebreaker)
- Each row: rank, username, champion pick flag, total points
- Current user's row highlighted regardless of position

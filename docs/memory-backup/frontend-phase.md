---
name: frontend-phase
description: React + Vite migration status — pages built, components done, SDK patterns used, open decisions
type: project
originSessionId: 160ef209-545c-43fc-b9ae-acdde82d9177
---
# Frontend Phase — React + Vite Migration

## ✅ DEPLOYED 2026-04-05
- Live: https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/
- `gh-pages` branch = dist/ contents (orphan branch, push manually after each build)
- Deploy command: build → `git subtree push --prefix dist origin gh-pages` (or orphan branch method)
- Architecture confirmed: vanilla `index.html` landing (intentional, no plan to React-ify) → login → `app.html` React SPA
- **Registration page = vanilla HTML (`index.html` + `js/auth.js`). Intentional — loads instantly, users register once and never return. Do NOT port to React.**
- **App = React + Vite SPA (`app.html`). All post-login pages live here (Dashboard, Groups, Game, Picks, AiFeed).**
- After login, `js/auth.js` redirects to `./app.html#/dashboard`.

**Stack change:** Full app now React + Vite. `index.html` (landing + auth) stays vanilla. All inner pages → React SPA with HashRouter.
**Plan:** `docs/PLAN_REACT_VITE.md`

**Why:** User decided to use React + Vite instead of vanilla JS for all inner pages.
**How to apply:** Follow PLAN_REACT_VITE.md build order. Check this file for current status before building anything.

## Status
🔨 IN PROGRESS — Phase 0 + 1 + 2 complete (2026-03-27). Build passes. Phase 3 pages are stubs, ready to fill.

## ⚠️ Known Issue — team.html Data Duplication
`team.html` (mobile team page) has its **own hardcoded copy** of `TEAMS` + `TEAM_EXTRA` inside a `<script>` block — completely independent of `js/main.js`.

**Problem:** Every team data change (new team, rank update, facts) must be applied to BOTH files manually. Missing one = mobile shows "Team not found" or stale data.

**Recommended fix (approved, not yet done):** Remove the hardcoded data from `team.html` and replace with `<script src="js/main.js"></script>` before the inline render script. The render logic already references `TEAMS`/`TEAM_EXTRA` by name — no other code change needed. One source of truth.

**Risk:** None. `js/main.js` is already proven. If path is wrong, "Team not found" appears immediately.

## Architecture Decisions
- Vite `root: 'src'`, builds to `dist/`
- Entry: `src/app.html` → `dist/app.html`
- Router: `HashRouter` — routes: `#/dashboard`, `#/game/:id`, etc.
- Supabase: ESM npm `@supabase/supabase-js` in `src/lib/supabase.js` (hardcoded URL+key — anon key safe)
- CSS: `import '../css/style.css'` in `src/main.jsx` — same design tokens, no new CSS system
- Deployment: GitHub Actions → build → push `dist/` to `gh-pages` branch
- Live URL: https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/
- Auth redirect (all envs, Option B): `./app.html#/dashboard`
- `js/auth.js` built and wired — vanilla, for `index.html` only
- **Vite config fix:** `rollupOptions.input` must use absolute path (`resolve(__dirname, 'src/app.html')`), NOT relative `./app.html` — relative paths in rollupOptions resolve from project root, not `root: 'src'`

## Phase 0 — Vanilla (build alongside React)
| File | Status |
|------|--------|
| `js/auth.js` | ✅ DONE — register, login, invite code parse, redirect to app.html |

## Phase 1 — Foundation
| File | Status |
|------|--------|
| `package.json` + `vite.config.js` + `.gitignore` | ✅ DONE |
| `src/lib/supabase.js` | ✅ DONE |
| `src/lib/teams.js` | ✅ DONE |
| `src/context/AuthContext.jsx` | ✅ DONE |
| `src/context/ToastContext.jsx` | ✅ DONE |
| `src/components/Layout.jsx` | ✅ DONE |
| `src/components/BottomNav.jsx` | ✅ DONE |
| `src/components/Modal.jsx` | ✅ DONE |
| `src/components/GroupSelector.jsx` | ✅ DONE |
| `src/components/Flag.jsx` | ✅ DONE |
| `src/components/FeedbackButton.jsx` | ✅ DONE — Hebrew feedback modal, 3-step, screenshot upload, deployed 2026-05-03 |

## Phase 2 — App Shell
| File | Status |
|------|--------|
| `src/app.html` | ✅ DONE |
| `src/main.jsx` | ✅ DONE |
| `src/App.jsx` | ✅ DONE — all routes + AuthGuard |

→ **Build verified:** `npm run build` passes → `dist/app.html` + assets output ✅

## Phase 3 — Pages (priority order)
| Page | Status | Notes |
|------|--------|-------|
| Dashboard.jsx | ✅ DONE | full build — see Dashboard section below |
| Groups.jsx | ✅ DONE | full build — see Groups section below |
| Game.jsx | ✅ DONE | full build — see Game section below |
| Picks.jsx | ✅ DONE | full build 2026-03-29 — see Picks section below |
| AiFeed.jsx | ✅ DONE | full build 2026-03-31 — see AiFeed section below |
| Host.jsx | ❌ OUT OF SCOPE | schedule covered by Picks.jsx — stub file kept, route removed from App.jsx |
| Team.jsx | ❌ OUT OF SCOPE | team stats covered by Game.jsx — stub file kept, route removed from App.jsx |
| predict.html | OUT OF SCOPE | TBD in CLAUDE.md |

## Dashboard.jsx — Built (2026-03-28, updated 2026-03-29)
**Full feature list:**
- **Hero**: trophy img + countdown clock (days + HH:MM:SS) + greeting ("Hey, {username} 👋") + rank badge (if in leaderboard)
- **Tournament progress strip** (mobile + desktop): progress bar, `0 / 104 games · 0%`, champion countdown, final date
  - `FINAL_DATE = 2026-07-19T19:00:00Z` → **22:00 IDT** Israel time
  - Countdown ticks every second: `{days}d {HH}h {MM}m {SS}s`
  - Shows: `🏆 2026 World Cup Champion · Jul 19, 2026 · 10:00 PM IL`
  - Mobile: column layout, date visible. Desktop: single row with all info + date + MetLife Stadium
- **Today's Games** (dash-col-center, order:0): date header, game cards with venue/city/capacity, kickoff time, "Tap to predict →" CTA, existing pick shown
- **My Stats** (dash-col-right, order:1): one card per group showing group rank, global rank, champion pick + flag, top scorer pick, W/D/L outcomes, predicted%, exact%, streak🔥. Skeleton while loading.
- **Global Leaderboard** (dash-col-left, order:2): always global — no toggle. Framed "Global Leaderboard" title (gold border, centered). 6 columns: # · Player · Group · 🏆 Champ (flag) · Top Scorer · Pts. Each row expands with team stats pills when champion pick + stats available. `get_leaderboard()` RPC — returns `group_name` (user's first group by joined_at). `viewMode`/`groupId` states removed. Desktop grid: `1.75rem .9fr .6fr 2.8rem 1.15fr 2.5rem` (GROUP narrower, 🏆 wider for spacing) via `@media(min-width:769px)` override — mobile keeps original `1.75rem .9fr .75fr 2rem 1.2fr 2.5rem`.
- **My Stats** (dash-col-right, order:1): one card per group showing group rank, global rank, champion pick + flag, top scorer pick, predicted%, exact%, streak🔥/❄️. Skeleton while loading. **Outcomes row removed.**
- **Streak logic (updated 2026-03-31):** Counts consecutive correct *outcomes* (H/D/A) from most recent finished game backwards — manual AND auto picks both count. Positive = win streak (🔥), negative = cold streak (❄️). Breaks on first game where outcome is wrong or no prediction exists.
- **Empty states**: "No predictions yet — games start June 11", "Schedule loading…"

**Desktop layout specifics:**
- Hero card: `margin:0 1.5rem` → same 812px width as game/stats cards
- Side deco panels: `position:fixed`, `transform:rotate(-90deg/90deg)` on span — single rotated line text (NOT writing-mode)
- Layout order: Games → My Stats → Leaderboard (single 1fr grid column)

**Updates (2026-03-29 session):**
- **Global leaderboard**: top 5 shown by default; `showAllLb` state + "▼ Show all N" / "▲ Show less" button (`lb-show-more` CSS class)
- **Global Rank in My Stats**: derived from `lb` array via `lb.find(r => r.user_id === user?.id && r.group_id === gr.groupId)` — always consistent with leaderboard display. Shows `…` while `lbLoading`.
- **lb row key**: changed from `user_id` to `` `${user_id}-${group_id ?? 'nogroup'}` `` — safe for ungrouped users (null group_id)
- **Leaderboard now includes all users** (migration 33 LEFT JOIN) — ungrouped users appear with `group_name = —`
- **Rank ties**: RANK() without username/group tiebreaker — same pts = same rank, numbering skips correctly

## Game.jsx — Built (2026-03-29, polished 2026-03-29)
**Full feature list:**
- **Game header**: team flags via `FlagImg` component (jsDelivr lipis SVGs, onError → placeholder), team names, center score/vs/LIVE, FT label; meta row: phase tag (blue group / gold KO), Group letter, venue+city, kickoff date+time IDT
- **Result section** (finished only): 90-min score large display, ET score (if `went_to_extra_time`), penalty score (if `went_to_penalties`); my result row: exact ⭐/correct ✓/miss ✗ with points label; auto badge shown
- **Prediction entry** (3 states):
  - Pre-KO no pick → inputs form + gold Predict button
  - Pre-KO has pick → same row layout as form with `.gm-pick-box` (gold numbers) + ✏️ Edit Prediction outline button
  - Post-KO → locked display + 🔒 badge. Editing state pre-fills inputs + shows Cancel button.
- **Odds** (pre-KO always visible template): shows `—` in plain white when no data; colored (green/muted/blue) only when real values present; real values only shown within 3 days of kickoff (`within3Days` check) — prevents stale test/seed data from showing. Note: "Odds available closer to kickoff" when no data.
- **Team stats** (pre-KO always visible 2-col grid): ALL columns from `team_tournament_stats` VIEW: Record · Goals · Possession · Shots (avg_shots_total) · On Target (avg_shots_on_target) · Corners (avg_corners) · Fouls (avg_fouls) · Cards. Always shows `—` template when no data. Note when both null: "First tournament game · Stats appear after kickoff · FIFA rankings & form coming soon"
- **Group Predictions** (always visible): pre-KO → 🔒 locked note + "👥 View your group's picks in the Groups page"; post-KO → "👥 See your group's predictions in the Groups page". No prediction list on Game page — lives in Groups.
- **Loading**: 3 skeletons. **Error**: grp-error banner + Retry.

**Key decisions:**
- Group prediction list removed from Game page — Groups page is the social hub for that
- Stats Option A (— template) now; Option C (FIFA rank, confederation, best result from teams.js) planned as future enhancement
- Flag CDN: jsDelivr `cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/{code}.svg` — more reliable than flagcdn.com

**SDK patterns:**
- `supabase.from('team_tournament_stats').select('*').in('team', [home, away])` — team stats
- Resolves `resolvedGroupId` on mount: (1) `?group=` URL param if present → (2) first `group_members` row by joined_at → (3) `null` (ungrouped). Fix for BUG 4 (2026-04-05) — Game page no longer requires `?group=` param.
- My pred: `.from('predictions').select('pred_home,pred_away,is_auto,updated_at,points_earned').eq('game_id').eq('user_id').maybeSingle()` — chained `.eq('group_id', resolvedGroupId)` OR `.is('group_id', null)` based on resolvedGroupId
- Upsert: `.from('predictions').upsert({user_id,game_id,group_id: resolvedGroupId,pred_home,pred_away},{onConflict:'user_id,game_id,group_id'}).select(...).single()` — race guard: `if (resolvedGroupId === undefined) return` (still resolving)

**New CSS classes (css/style.css):**
- `.gm-page` / `.gm-header` / `.gm-header-body` / `.gm-header-teams`
- `.gm-team` / `.gm-team--right` / `.gm-flag` / `.gm-flag-ph` / `.gm-team-name`
- `.gm-center` / `.gm-center-vs` / `.gm-center-live` / `.gm-score-display` / `.gm-center-label`
- `.gm-meta` / `.gm-phase-tag` / `.gm-phase-tag--ko` / `.gm-meta-sep` / `.gm-meta-text` / `.gm-meta-date`
- `.gm-section` / `.gm-section-head` / `.gm-section-label` / `.gm-section-body`
- `.gm-result` / `.gm-result-label` / `.gm-result-score` / `.gm-result-extra` / `.gm-result-extra-label` / `.gm-result-extra-score`
- `.gm-my-result` / `.gm-my-result--exact` / `.gm-my-result--correct` / `.gm-my-result--miss` / `.gm-my-result-pick` / `.gm-my-result-text`
- `.gm-predict-row` / `.gm-predict-team` / `.gm-predict-inputs` / `.gm-input` / `.gm-input-sep` / `.gm-predict-actions`
- `.gm-pick-box` — styled like gm-input but read-only, gold text color — used for "has pick" display in Game + Groups
- `.gm-my-pick` / `.gm-my-pick-score` / `.gm-my-pick-label` / `.gm-locked-msg`
- `.gm-odds` / `.gm-odds-item` / `.gm-odds-label` / `.gm-odds-val` / `.gm-odds-val--home` / `.gm-odds-val--draw` / `.gm-odds-val--away`
- `.gm-stats-cols` / `.gm-stats-col` / `.gm-stats-col-title` / `.gm-stat-row` / `.gm-stat-label` / `.gm-stat-val` / `.gm-no-stats`
- `.gm-reveal-msg`

## Groups.jsx — Built (2026-03-28, updated 2026-03-29)
**Full feature list:**
- **Group Board Preview** — shown in empty state (no groups yet); full skeleton template of group card incl. leaderboard + game prediction + after-KO sections
- **My groups list** — group cards with name, member count (X/10), captain badge, invite code display
- **Section labels**: "Group Board" (leaderboard), "Game Prediction · Up Next", "Game Prediction · Results"
- **All 3 sections always visible** — each shows template (skeleton/placeholder) when no data, real data when available. Never conditionally hidden.
- **Per-group leaderboard** — columns: `#` header + `#N` rank (no medals), player, 🏆 champion flag, top scorer, pts. Placeholder rows pre-tournament. Col-labels: `#` centered, 🏆 centered, Pts right-aligned with `.5rem` right padding.
- **Game Prediction · Up Next** — always visible. No data: skeleton flags + disabled predict button. Data: real flags + active/locked button. Navigates to `/game/:id?group=:groupId`.
- **Game Prediction · Results** — always visible. No data: 3 skeleton pred rows + placeholder bars (`—%`). Post-KO: real member predictions (with ⚡ Auto badge) + dual stats block: Group vs Global W/D/L bar + goals distribution (0–1 grey / 2–3 gold / 4+ red).
- **Copy invite link** — constructs `index.html?invite=CODE` from current origin, copies to clipboard
- **Rename group** — modal, captain-only, locked after June 11 (RENAME_DEADLINE check); disabled button shown when locked
- **Members list** — expandable per group; shows username, (you), 👑 captain badge, inactive tag
- **Inactive toggle** — confirm step (first click → "Sure?", 3s timeout); `grp-inactive-btn--confirm` state
- **Create modal** — `create_group` RPC, `max_groups_reached` error handled, max 3 enforced via disabled button
- **Join modal** — `join_group` RPC, inline field error (not just toast); `group_full` / `invalid_code` / `already_member` errors
- **Pre-fill join** — reads `?invite=CODE` from `useSearchParams()` AND `localStorage.pendingInvite` on mount
- **Empty state** + **Loading state** — skeleton placeholders

**Updates (2026-03-29 — first pass):**
- **"Up Next" pick display**: after user enters prediction, the button area changes to show pick boxes (`.gm-pick-box`, gold numbers, same layout as Game.jsx entry form) + ✏️ Edit Prediction button navigating to `/game/:id?group=:groupId`. Resets to "Enter My Prediction →" when focusGame changes.
- **`myFocusPred` state**: fetched in parallel with focusGame load — `predictions.select('pred_home,pred_away,is_auto').eq('game_id').eq('user_id').maybeSingle()`
- **Flag CDN fix**: switched from flagcdn.com → jsDelivr `cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/{code}.svg`
- **Focus game bug fix** (prev session): removed `venue, city, capacity` from select (don't exist in games table); venue display uses `getVenue(team_home, team_away)` from venues.js

**Updates (2026-03-29 — second pass):**
- **Global prediction stats**: `globalPredStats` state fetched via `get_global_prediction_stats(game_id)` RPC (migration 34-35) in parallel with group preds load. SECURITY DEFINER — counts ALL prediction rows across ALL users/groups after kickoff.
- **`tDist` ("GLOBAL" block)**: now computed from RPC result instead of `computeDist(allGamePreds)` — includes predictions from users outside the current user's groups. No dedup — user in 3 groups = 3 prediction rows counted.
- **SDK pattern**: `supabase.rpc('get_global_prediction_stats', { p_game_id: game.id })` → `data[0]` → fields: `total, home_wins, draws, away_wins, g01, g23, g4p`

**Updates (2026-04-11 — bug fixes):**
- **Mobile prof-sheet pointer-events fix**: `.prof-sheet` always in DOM but was intercepting touches when invisible. Fixed with `pointer-events:none` (closed) / `pointer-events:auto` (open) — mobile only (`max-width:768px`). Was causing missed game card taps and accidental sign-outs.
- **Streak fix (Dashboard)**: walk oldest→newest (ASC + secondary `id DESC` for parallel games). Reset streak on direction change instead of breaking — final value = most recent consecutive run.

**Updates (2026-04-11 — parallel games):**
- **Up to 2 simultaneous games supported** — WC 2026 max is always 2 (group stage MD3 + 1 QF day, verified in DB)
- `focusGames` (array, replaces `focusGame`) — fetches `.limit(2)`, filters to same `kick_off_time` as first result
- `myFocusPredMaps`: `{ [game_id]: { [group_id]: pred } }` — loaded with `.in('game_id', gameIds)`
- `allGamePreds`: `{ [game_id]: pred[] }` initialized as `{}` — loaded for all focus games after KO
- `globalPredStats`: `{ [game_id]: stats }` initialized as `{}` — one RPC call per focus game after KO
- Each game card renders its own Results section (predictions list + Group/Global stats) directly underneath
- Results section moved inside `focusGames.map()` loop — no separate standalone section

**Updates (2026-04-11 — focus game logic rewrite + auto-refresh):**
- **Query changed**: removed `twoHoursAgo` window → now uses `.is('score_home', null)` only. Finished games drop off immediately when score is set. `.limit(3)` (was 2) for safety, still filtered to `firstKO`.
- **Priority logic**: unscored games (score IS NULL) always take priority. In-progress game stays until score is set. 1 of 2 parallel finishes → dropped immediately, only remaining shown. Both finish → next upcoming shows immediately.
- **Auto-refresh**: `setInterval(fetchFocusGames, 60_000)` — page updates automatically every 60s. `clearInterval` on unmount.
- **`fetchFocusGames` extracted to `useCallback`** — shared by initial load and interval.
- **TODO (future idea)**: show finished game for ~15 min after score is set so users can view group predictions before next game appears. Needs `finished_at` timestamp (migration + EF update) for precision — `kick_off_time` estimate (group +120min / knockout +165min) is an alternative with ~10min approximation.

**SDK patterns used:**
- `.from('groups').select('id, name, invite_code, created_by, group_members(user_id, is_inactive, profiles(username))')`
- `supabase.rpc('create_group', { group_name })` → error.message: `max_groups_reached` (param is `group_name` NOT `name`)
- `supabase.rpc('join_group', { p_invite_code })` → error.message: `group_full` | `invalid_code` | `already_member` (param is `p_invite_code`)
- `supabase.rpc('get_group_leaderboard', { p_group_id })` → returns empty pre-tournament; fall back to member rows with `_placeholder: true`
- Focus games: `.from('games').select(...).is('score_home', null).order('kick_off_time').limit(3)` → filter to same `kick_off_time` as first result. Polls every 60s via `setInterval`.
- My focus preds (per-game per-group): `.from('predictions').select('pred_home,pred_away,is_auto,group_id,game_id').eq('user_id', user.id).in('game_id', gameIds)` → `{ [game_id]: { [group_id]: pred } }`
- Post-KO preds: `.from('predictions').select('user_id,group_id,game_id,...').in('game_id', gameIds)` → `{ [game_id]: pred[] }`, filter client-side per game + group
- Post-KO global stats: one `get_global_prediction_stats` RPC per focus game → `{ [game_id]: stats }`
- `.from('groups').update({ name }).eq('id', groupId)` — rename
- `.from('group_members').update({ is_inactive: !current }).eq('group_id', groupId).eq('user_id', userId)` — toggle

**AuthContext fix:** On session load, checks if `profiles` row exists; auto-creates via `create_profile` RPC using `user_metadata.username` or email prefix if missing. Prevents FK violation on `group_members` insert.

**computeDist() output** (Groups.jsx):
- W/D/L: `homePct`, `drawPct`, `awayPct`, `homeWins`, `draws`, `awayWins`
- Goals buckets: `g01` (0–1 total), `g23` (2–3), `g4p` (4+) + `g01Pct`, `g23Pct`, `g4pPct`

**New CSS classes (css/style.css):**
- `.btn-xs` — extra-small secondary button (min-height: 40px)
- `.modal-title` / `.modal-form` / `.grp-modal-note` — modal heading + form shell + note text
- `.grp-page` / `.grp-page-header` / `.grp-page-title` / `.grp-header-actions`
- `.grp-card` / `.grp-card-top` / `.grp-card-title-row` / `.grp-card-name`
- `.grp-member-badge` / `.grp-captain-badge`
- `.grp-invite-row` / `.grp-code-label` / `.grp-code-val`
- `.grp-card-actions` / `.grp-toggle-btn`
- `.grp-members-list` / `.grp-member-row` / `.grp-member-inactive`
- `.grp-member-name` / `.grp-member-you` / `.grp-member-cap` / `.grp-inactive-tag`
- `.grp-inactive-btn` / `.grp-inactive-btn--on`
- `.grp-inactive-hint` / `.grp-members-note` / `.grp-max-note`
- `.grp-empty` / `.grp-empty-icon` / `.grp-empty-title` / `.grp-empty-sub` / `.grp-empty-actions`
- `.grp-error` / `.grp-loading`

## Picks.jsx — Built (2026-03-29, updated 2026-03-31)
**Full feature list:**
- **Top-level tab switcher** — `🏆 Picks` | `⚽ Predictions` tabs. Shared group selector below.
- **Picks tab**: Champion pick + Top scorer pick (existing per-group behavior)
  - Group selector tabs at top; lock bar; champion (searchable 48 teams + 6 TBD); top scorer (30 STRIKERS)
  - No groups state → "Join a group first" CTA (picks require group)
- **Predictions tab**: All 104 games with inline prediction entry
  - Games loaded lazily (`loadGames`) on first tab activation — all at once, sorted by kick_off_time
  - Phase headers: Group Stage / R32 / R16 / QF / SF / 3rd Place / Final
  - Each game row: home flag+name | score inputs or locked prediction | away flag+name; meta row: kickoff time + save button / actual result / TBD note
  - Pre-kickoff: editable `pd-inp` inputs (number, 0–20); Save / Update button enabled only when changed
  - Post-kickoff: locked display — shows user's prediction (`pd-my-score`) + `auto` badge if `is_auto`; actual result shown if `score_home IS NOT NULL`; "Live" badge if past KO but no score yet
  - TBD games (team_home/away === 'TBD'): locked, "Matchup TBD" note
  - Click game row → `navigate('/game/:id')` (for stats)
  - Progress counter: "X / Y games predicted" (only future + non-TBD games)
  - Ungrouped users: predictions stored with `group_id = NULL` (migration 36); no group tabs shown
  - Grouped users: predictions scoped to `selectedGroupId`; "Predicting for [Group]" context label
- **Race condition guards**: `activeGroupRef` for picks; `predCtxRef` for predictions; `gamesLoadedRef` to prevent double game load
- **Save flow (predictions)**: INSERT if no existing pred, UPDATE if existing — avoids NULL upsert conflict issues

**SDK patterns:**
- Load groups: `supabase.from('group_members').select('joined_at, groups(id, name)').eq('user_id').order('joined_at')`
- Load picks: `.from('champion_pick').select('team').eq('user_id').eq('group_id', groupId).maybeSingle()` + same for `top_scorer_pick`
- Upsert champion: `champion_pick.upsert({ user_id, group_id: selectedGroupId, team }, { onConflict: 'user_id,group_id' })`
- Upsert top scorer: `top_scorer_pick.upsert({ user_id, group_id: selectedGroupId, player_name, top_scorer_api_id: null }, { onConflict: 'user_id,group_id' })`
- Load games: `.from('games').select('id, team_home, team_away, kick_off_time, score_home, score_away, phase').order('kick_off_time')`
- Load my predictions (grouped): `.from('predictions').select('game_id, pred_home, pred_away, is_auto').eq('user_id').eq('group_id', ctx)`
- Load my predictions (ungrouped): same query with `.is('group_id', null)`
- Save new prediction (grouped): `.from('predictions').insert({ user_id, game_id, pred_home, pred_away, group_id })`
- Save new prediction (ungrouped): `.from('predictions').insert({ user_id, game_id, pred_home, pred_away })` — no group_id key
- Update prediction (grouped): `.from('predictions').update({...}).eq('user_id').eq('game_id').eq('group_id', ctx)`
- Update prediction (ungrouped): same with `.is('group_id', null)`

**Key decisions:**
- Per-group picks: migration 29 — `UNIQUE(user_id, group_id)` on both tables. Each group is independent.
- Ungrouped predictions: migration 36 — `group_id` nullable, `UNIQUE NULLS NOT DISTINCT`. Ungrouped users get 1 prediction per game (no group context).
- INSERT+UPDATE pattern instead of upsert for predictions — avoids NULL conflict key issues with PostgREST
- `top_scorer_api_id` sent as `null` for now — nullable in DB.
- 30 hardcoded STRIKERS — pre-tournament list.
- `FlagImg` local component + `teamCodeMap` (built from TEAMS array) for flag lookups in game rows
- Auto-predict for ungrouped users: ✅ FIXED (M42) — fn_auto_predict_game has full ungrouped loop (profiles not in group_members → insert with group_id IS NULL, contrarian based on NULL-group predictions pool).
- Leaderboard scoring of ungrouped predictions: NOT YET — pr.group_id = gm.group_id won't match NULL. Future work.

**Updates (2026-03-31):**
- **Tournament result cards**: two cards (🏆 Champion + ⚽ Top Scorer) shown at top of Picks tab below lock bar. Read-only. Show actual results once available, "Decided after the Final/tournament" until then. Skeleton while loading.
  - Champion: queries `games.knockout_winner` where `phase = 'final'` — no DB change needed.
  - Top Scorer: queries `player_tournament_stats` (existing table) — `total_goals, player_name, team`. Finds max goals and returns ALL tied players. Can show multiple players.
  - State: `tournamentChampion` (undefined=loading, null=not yet, string=winner) + `topScorers` (undefined=loading, []=none yet, array=leaders)
  - `loadTournamentResults()` fires on mount alongside `loadGroups()`
- **Kickoff date centering**: `pd-meta` now uses 3-col grid (`1fr auto 1fr`) — date always centered. Save button `grid-column:3; justify-self:end`. For TBD games: `pd-meta-tbd` wrapper spans all 3 cols with `justify-content:center`, date + "Matchup TBD" inline on one row.
- **Tab state persistence**: `sessionStorage('picks_tab')` — switching to game stats and back restores correct tab.
- **Predictions tab notes**: "Score calculated on 90-min result · Knockout stages also show extra time & penalties" + "No pick = auto-assigned at kickoff."
- **Result row**: `90'` always shown; `E.T.` + `PENS` only for `phase !== 'group'`. Label changed AET → E.T.
- **Locked state**: `pd-pick-label` "your pick" shown above score when locked.

**New CSS classes (css/style.css):**
- `.pk-tab-sw` / `.pk-tab-btn` / `.pk-tab-btn--active` — page-level tab switcher
- `.pd-context-label` / `.pd-progress` — predictions tab meta
- `.pd-games` / `.pd-phase-head` — game list container + phase headers
- `.pd-row` / `.pd-row--locked` — game row
- `.pd-match` / `.pd-team` / `.pd-team--away` / `.pd-tname` — match layout
- `.pd-vs` / `.pd-inp` / `.pd-vsep` — score input area
- `.pd-vs-locked` / `.pd-my-score` / `.pd-no-pred` / `.pd-auto` — locked prediction display
- `.pd-meta` (3-col grid) / `.pd-kickoff` / `.pd-save-btn` / `.pd-result` / `.pd-live` / `.pd-lock-note` / `.pd-meta-tbd` — meta row
- `.pd-pick-label` — "your pick" label above locked score
- `.pk-result-cards` / `.pk-result-card` / `.pk-result-card-title` / `.pk-result-card-val` / `.pk-result-card-scorers` / `.pk-result-card-empty` / `.pk-result-card-skeleton` / `.pk-result-goals` — tournament result cards
UX fixes (2026-03-29): pk-tab-btn 48px; pd-inp 40×40px; pd-save-btn 44px min-height; pd-no-pred color→var(--muted) (contrast fix)

## AiFeed.jsx — Built (2026-03-31)
**Full feature list:**
- **Group selector**: pill tabs (≤4 groups) or dropdown (5+); sessionStorage persists selected group across navigations
- **Summary cards**: date header (Oswald gold), games count badge, full content with truncation at 300 chars + "Read more ↓ / Show less ↑" toggle
- **Sticky card header**: `position:sticky` within scroll, stays visible while reading long summaries
- **NEW badge**: shown on summaries generated after last visit (localStorage `af_seen_{groupId}` tracks last seen per group; first visit shows no badges)
- **Share button**: mobile → opens WhatsApp directly (`https://wa.me/?text=...`); desktop → copies to clipboard
- **Emoji reactions**: 🔥😂😭👑 — personal, localStorage only (`af_rx_{summaryId}`). Selected emoji shows gold border. No DB needed.
- **📊 Day standings**: toggle below each card's content. Lazy-loads on first open. Shows all group members' points earned that day, ranked. Medal icons 🥇🥈🥉 for top 3. Top row subtle gold tint. Table: `#` · Player · Pts today.
- **Next game hint**: shown at TOP of feed (above cards) — "⚽ Games on tonight" or "📅 Next games: [date]"
- **All 4 states**: loading (SkeletonCards), error (retry), empty (nightly note), data
- **Mobile-only compact styles**: `@media(max-width:768px)` — reduced card padding, line-height, footer spacing

**Daily standings logic:**
- Step 1: query `games` for IDs on summary's `date` (UTC day range)
- Step 2: query `predictions` for those game IDs + group_id → aggregate `points_earned` per user
- RLS: predictions visible to group members after kick_off_time — always satisfied since summaries only exist for finished game days
- `profiles(username)` joined inline via PostgREST

**SDK patterns:**
- Groups: `.from('groups').select('id, name').order('created_at')` — RLS limits to user's groups
- Summaries: `.from('ai_summaries').select('id, date, content, games_count, generated_at').eq('group_id').order('date', {ascending:false}).limit(30)`
- Next game: `.from('games').select('kick_off_time').is('score_home', null).gt('kick_off_time', now).order('kick_off_time').limit(1)`
- Daily standings: `.from('games').select('id').gte('kick_off_time', dateStart).lt('kick_off_time', dateEnd)` then `.from('predictions').select('user_id, points_earned, profiles(username)').eq('group_id').in('game_id', gameIds).not('points_earned', 'is', null)`

**New CSS classes (css/style.css):**
- `.af-page` — page wrapper, `padding:1.25rem 1rem 5rem`, flex column gap:1rem, max-width:640px
- `.af-tabs` / `.af-tab` / `.af-tab.active` — pill tab selector
- `.af-selector-row` / `.af-list` / `.af-card` — layout
- `.af-card-header` (sticky) / `.af-card-date` / `.af-card-games` / `.af-card-content`
- `.af-card-footer` / `.af-footer-left` / `.af-share-btn`
- `.af-new-badge` / `.af-read-more` / `.af-next-hint`
- `.af-reactions` / `.af-reaction-btn` / `.af-reaction-btn.selected`
- `.af-empty` / `.af-empty-icon` / `.af-empty-text` / `.af-skeleton`
- `.af-daily-toggle` / `.af-daily-table` / `.af-daily-pts` / `.af-daily-top` / `.af-daily-loading`
- `@media(max-width:768px)` — compact card padding/line-height/footer/list-gap overrides; `af-page` sets `padding:1.25rem 1.2rem 5rem; max-width:none` to match dashboard card width

**Overflow fixes (post-build):**
- `.af-page`: `overflow-x:hidden; width:100%; box-sizing:border-box` — prevents horizontal bleed from tab row
- `.af-card`: `overflow:hidden` — clips sticky header's negative margins that caused side shift
- `.af-tabs`: `width:100%; min-width:0` — constrains tab row within page
- `.af-tab`: `max-width:120px; overflow:hidden; text-overflow:ellipsis; flex-shrink:0` — long group names truncated, no layout push

**Test data (Test group — temp, to be cleaned up):**
- 3 ai_summaries rows inserted (Jun 17→Mar 9 backdated, Jun 16, Jun 11)
- alice_wc, bob_wc, carol_wc added to Test group as members
- 16 prediction rows with points_earned for Mar 9 games
- 4 game kick_off_times backdated 100 days (Jun 17 → Mar 9) to satisfy RLS for testing

## Profile Sheet (Dashboard.jsx) — Built (2026-03-31)
**Feature:** ⚙️ gear button in Dashboard nav rightSlot → bottom sheet slides up with:
- **Username rename**: input pre-filled with current username; Save button (disabled when unchanged); validates `/^[a-zA-Z0-9_]{3,20}$/` client-side; calls `profiles.update({ username })` + `supabase.auth.updateUser({ data: { username } })` to sync metadata; `displayUsername` state updates greeting immediately
- **Lock note**: "⏰ Locks Jun 11, 2026 · 22:00 IDT" → "🔒 Locked · Jun 11, 2026 · 22:00 IDT" after deadline. Input disabled when locked.
- **Sign out**: full-width outline button
- **Danger Zone**: Delete account — disabled if `groups.length > 0` (can't leave groups) or `isLocked`; confirm step before calling `delete_account()` RPC; handles `account_locked` / `cannot_delete_in_group` errors; redirects to index.html on success
- **Overlay**: tap backdrop to close

**SDK patterns:**
- Rename: `supabase.from('profiles').update({ username: val }).eq('id', user.id)` + `supabase.auth.updateUser({ data: { username: val } })`
- Delete: `supabase.rpc('delete_account')` → errors: `account_locked` | `cannot_delete_in_group`

**New CSS classes:** `.prof-gear-btn` / `.prof-overlay` / `.prof-sheet` / `.prof-sheet.open` / `.prof-sheet-handle` / `.prof-sheet-header` / `.prof-sheet-title` / `.prof-sheet-close` / `.prof-section` / `.prof-section-title` / `.prof-field` / `.prof-input` / `.prof-save-btn` / `.prof-error` / `.prof-lock-note` / `.prof-divider` / `.prof-danger-title` / `.prof-delete-btn` / `.prof-delete-btn--confirm` / `.prof-delete-confirm` / `.prof-cancel-link`

**Layout:** Opens as top-right dropdown (not bottom sheet) on both mobile and desktop. Mobile: `left:.75rem; right:.75rem`. Desktop (≥769px): `left:auto; width:380px`.

**Overflow fix (post-build):** `.prof-sheet` gets `overflow-x:hidden; box-sizing:border-box`; `.prof-field` gets `width:100%; box-sizing:border-box`; `.prof-input` gets `min-width:0; box-sizing:border-box` — prevents username input + Save button from pushing sheet wider than viewport.

## Phase 4 — Deploy
| Task | Status |
|------|--------|
| `.github/workflows/deploy.yml` | ❌ |
| Wire index.html redirect | ✅ auth.js loaded, redirects to ./app.html#/dashboard |
| Live verification | ❌ |

## New CSS Added (css/style.css)
- `.bottom-nav` — fixed bottom bar, backdrop blur, safe-area padding
- `.bottom-nav-tab` — flex column, muted default, gold active
- `.bottom-nav-icon` / `.bottom-nav-label` — emoji + label layout
- `.page-body` — added `padding-bottom: calc(60px + env(safe-area-inset-bottom))`
- `.group-selector` — styled select for Dashboard + AiFeed
- `.side-deco / .side-deco-left / .side-deco-right` — fixed decorative side panels (desktop only). Text via child `<span>` with `transform:rotate(-90deg/90deg)` — NOT writing-mode (writing-mode stacks Latin chars)
- `.dash-hero { margin:0 1.5rem }` (desktop) — makes hero 812px wide, matching all content cards
- `.dash-hero-progress` + `.dash-progress-*` — tournament progress bar + WC Champion countdown strip. Mobile: column. Desktop: single row. `FINAL_DATE = 2026-07-19T19:00:00Z` (22:00 IDT)
- All dashboard card/leaderboard/stats styles — see Dashboard section above

## index.html Changes
- Added World Cup Final `kickoff-bar` below the opening match bar: "World Cup Final · Champion Crowned · Sun, July 19, 2026 · 22:00 IDT · MetLife Stadium, E. Rutherford, NJ"

## SDK Patterns (React — ESM, supabase from src/lib/supabase.js)
- Auth: `supabase.auth.signUp / signInWithPassword / signOut / getSession`
- Profile: `supabase.rpc('create_profile', { p_username })`
- Prediction upsert (per-group): `.from('predictions').upsert({ user_id, game_id, group_id, pred_home, pred_away }, { onConflict: 'user_id,game_id,group_id' })` ← must include group_id
- Pick upsert champion (per-group): `.from('champion_pick').upsert({ user_id, group_id, team }, { onConflict: 'user_id,group_id' })`
- Pick upsert top scorer (per-group): `.from('top_scorer_pick').upsert({ user_id, group_id, player_name, top_scorer_api_id }, { onConflict: 'user_id,group_id' })` ← BOTH player_name AND top_scorer_api_id required
- Leaderboard: `supabase.rpc('get_leaderboard')` / `supabase.rpc('get_group_leaderboard', { p_group_id })`
- Groups load: `.from('groups').select('id, name, invite_code, created_by, group_members(user_id, is_inactive, profiles(username))')`
- AI summaries: `.from('ai_summaries').select('date, content, games_count, generated_at').eq('group_id', groupId).order('date', { ascending: false }).limit(10)`
- Today's games: `.from('games').gte('kick_off_time', today+'T00:00:00Z').lt('kick_off_time', today+'T23:59:59Z').order('kick_off_time')`
- Game + odds + stats: `.from('games').select('*, game_odds(*), game_team_stats(*)').eq('id', gameId).single()`

## Key Rules
- `score_home/score_away` = 90-min only. ET: `et_score_home/et_score_away`. Pens: `penalty_score_home/penalty_score_away`
- Finished game = `score_home IS NOT NULL` — no `game.status` column
- Picks lock: `2026-06-11T19:00:00Z`
- Auth guard: `getSession()` → no session → `window.location.href = '../index.html'`
- Never show predictions before `kick_off_time` (hide in UI + RLS enforces)
- RLS 42501 on prediction insert = "Predictions locked"
- Error messages: `error.message === 'max_groups_reached'` | `'group_full'` | `'already_member'`

## Decisions (all resolved 2026-03-27)
- Q1 ✅ BottomNav: 4 tabs, each with icon + label. Fine-tune clickable behavior during build.
- Q2 ✅ Dev redirect: Option B — always build first, test via dist/. auth.js always uses `./app.html#/dashboard`.
- Q3 ✅ predict.html: SKIPPED. Prediction entry lives in Game.jsx. Add as #/predict later if needed.

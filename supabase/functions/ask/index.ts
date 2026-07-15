// ask — in-app AI bot (DEV ONLY) — v29 phases 1-4: stop lying, un-gate public, coverage, shape
// v29 (2026-07-14, scoped subset of docs/PLAN_ASK_BOT_V29.md — NOT the full understand-first
//   rewrite, see the plan doc for what's deliberately deferred and why):
//   P0 STOP LYING: V0 outbound-payload guard (assertPublicPayload) on all 4 LLM call sites —
//     the privacy boundary was true by convention, now it THROWS on a private-shaped token.
//     FACTS block (today's real date, computed per-request) injected into the rules LLM +
//     answerCrew — RULES_PROMPT had no clock (told a user trivia "hasn't started, it's before
//     June 11" on 2026-07-14). answerCrew's number-grounding was a token-membership test
//     ("does this digit appear ANYWHERE in the facts?" — every player card has "0 red", so
//     "there have been 0 red cards" [truth: 13] always passed) — replaced with a per-card
//     substring check, and aggregates (cardsTotal, triviaInfo 'count') now route to SQL and
//     never reach RAG at all: RAG describes, SQL counts.
//   P1 UN-GATE PUBLIC: new `courtesy` route (thanks/ok/cool -> reply, no auth/data/LLM —
//     before this a stray "thanks!" hit a misclassified private intent and demanded a login).
//     howto_is_rules regex gained bare "how to <verb>" (had no modal verb, so "how to play
//     this game?" fell through to NEED_LOGIN). trivia_info split rulesFAQ's swallow-everything
//     trivia line (any "how many...trivia" answered the POINT VALUE) into count/window/today.
//   P2 COVERAGE: trivia (triviaInfo, myTriviaScore), top_scorer_candidates — 3 domains the UI
//     ships with literally zero tools before now, which is WHY the bot guessed on them.
//   P3 SHAPE (targeted, not the general renderer): tournamentGroupTable re-sourced from
//     `teams.group_name` (clean, 4/group) instead of `games.group_name` (DEV also tags 52 club
//     test games as group 'A' — a 57-row table for a one-name question); `only:'first'|'last'`
//     answers "who finished 1st" with one row. wc_group_table's cue-word match is asymmetric:
//     letter 'i' (near-certain to be the PRONOUN "I", not Group I) requires a STRONG explicit
//     cue; every other letter got a BROADER cue set (was missing "finished"/"status"/"over").
//     myBestGroup (new) answers "which of my groups..." by naming the actual best group,
//     computed per-group — myRates/myFocus with target=null used to combine ALL groups into
//     one number and name none of them.
//   V1 (repeat guard, in `done()`): a byte-identical answer to a DIFFERENT low-confidence
//     question is refused and re-asked as a clarify — this is the general form of the "nexg"
//     bug (a typo silently replayed the previous turn's answer verbatim).
//   Full audit, the 3 test suites (wide_test/real_chat_test/audit_probe), and the deferred
//   remainder (typed entity resolver, LLM-as-primary-parser, generalized shape/validation
//   engine, eval.mjs gate, learning loop) are in docs/PLAN_ASK_BOT_V29.md.
// ----------------------------------------------------------------------------
// v27 COVERAGE: 4 whole data domains added — ODDS (game Bet365 + champion William Hill),
//   KNOCKOUT-BRACKET game (my picks + fn_knockout_points + fold-in FAQ), AI ROAST (latest
//   summary + timing FAQ), TOURNAMENT GROUPS A-L (computed standings; single letters are
//   never friend-group names); reverse pick lookup ("who picked France in my group");
//   match-day-scoped points ("how did my group do yesterday", 07:30-UTC boundary);
//   recentForm ("last 5 games", W/D/L strip); exact%/hit%/streak (myRates); kickoffs shown
//   in Israel time too; today/tomorrow resolve on the ISRAEL day; venue/city guard;
//   offsides + shots stat dims; RULES corrected (auto-predict is CONTRARIAN, not random)
//   + inactive members, self-service locks, pick visibility, top-scorer ties, bracket
//   visibility, roast timing. DIM_EXAMPLES changed -> reindex_dims required.
// v27 CONVERSATION: client echoes the last resolved spec (prev_spec) + the last bot answer
//   (last_answer) + 3 user turns; borrowing prefers the ECHOED resolved teams/dim over
//   text re-parsing; team/player entities also resolve from the last ANSWER ("how many
//   goals does HE have?" after "who is the top scorer?"); compound clause 2 receives
//   clause 1's RESOLVED spec; llmUnderstand gains public asks (schedule/game_stat/
//   leaderboard) and runs for ANON users too (private asks still need login).
// ----------------------------------------------------------------------------
// v26 trust + resilience round (6-agent audit → 60+ findings)
// v26 TRUST/TRUTH: group typo-matching never substitutes a DIFFERENT name (digit-bearing
//   tokens excluded from the lev pass — "test3" refused instead of silently becoming "TestA");
//   "<Name> leaderboard" (no word "group") reaches the group tools, not the global dump;
//   "when is the LAST game (of the tournament/phase)" = future schedule, never a past result;
//   pick-value FAQs no longer swallow stat questions ("how many goals does the top scorer have");
//   count+superlative ("the leading scorer") answers the leader, not tournament totals;
//   gameStats box score shows ET/pens; etPensList includes friendlies (labeled); compound
//   split rejects verb-less tails and a clause-2 clarify never pollutes a good clause-1 answer;
//   game-scoped single-stat answers ("red cards in PSG vs Arsenal"); player-count aggregates
//   ("how many players got a red card"); bracketStatus ignores future-kickoff (dev-quirk) rows.
// v26 RESILIENCE/SECURITY: OpenAI outage no longer kills deterministic routes (embed/classify
//   try/catch -> keyword-only degraded mode; 12s client timeout); DB errors throw (must())
//   instead of reading as confident empty answers; friendly degraded catch-all (no raw errors);
//   ask_log table records question/route/answer/latency (service-role only); rate-limit keyed
//   per user+IP (anon users no longer share one bucket); reindex modes require the service-role
//   key; poisonable cross-user qa_cache REMOVED; answerCrew = ONE structured call + deterministic
//   number-grounding check + evidence gate (no LLM call on zero cards); team-names cached 5 min.
// v24: time-aware phase lookups ("the Final IS ... Jul 19", never a future score/"was"); resolveTeams
//   TYPO_STOP (lev pass matched "place"→Crystal Palace, "leads"→Leeds); how-to questions route to rules
//   (never a login gate); rules-FAQ +4 (round bonuses, tie-breaks, points fold-in timing, 90-min/pens
//   scoring); follow-up "and X?" applies the previous question's shape; member-vs-me standings; public
//   picks by username (post-lock); unknown-team + unsupported-stat + non-2026-year guards; borrow
//   restructure (teams/phase borrow decoupled from op borrow); rank-before-count; who_scored date/phase
//   fallback; groupHistory/memberPrediction never show a future game's score; RULES nav corrected (5 tabs).
// ----------------------------------------------------------------------------
// Flow: preGuard+rateLimit [D] -> splitCompound (max 2 clauses) [D] -> per clause:
//   embed once [E] -> QuerySpec {intent[E], op[D], dim[D], entities[D], conf/margin}
//   -> confidence band (route|clarify|LLM-understand fallback) -> tool REGISTRY [D]
//   -> structured SQL [D] OR entity/dim-filtered RAG [E]
//   -> template [D] OR Facts->Writer/Judge crew [L] -> log + safe-cache [D].
// v19: routeQuestion() per clause (compound Qs answer BOTH parts); my_data sub-tools
//   (exact incl. WHICH games / rank / picks / points), group-scopable via resolveGroupName.
// v20: (a) PRIVACY CLARITY — every locked door says WHY: pre-kickoff predictions ->
//   "hidden until kickoff"; groups you're not in -> "private to their members" (foreign
//   group names detected deterministically incl. typos); (b) NEW entities: group-MATE
//   usernames + relative game refs ("the last game", "the final"); memberPrediction and
//   groupMeta (members/captain/count — real data, not the rules FAQ) tools; (c) LLM
//   UNDERSTANDING FALLBACK [L] — when the deterministic parse is ambiguous, ONE
//   gpt-4o-mini call parses the QUESTION TEXT ONLY into {asks, group, member, teams,
//   game_ref, stat}; execution stays 100% deterministic SQL+templates. No DB data is
//   ever sent to the LLM by this fallback.
// v23: live-transcript fixes — (a) "the NEXT/coming game" gets a deterministic route (a
//   count-op borrowed from the PREVIOUS turn's "how much points..." hijacked it into
//   tournament progress); (b) group_history honors group scoping + refuses foreign groups
//   ("legends group predictions for X" silently dumped ALL the caller's groups); (c) new
//   etPensList — "which games went to penalties / extra time" lists from the went_to_*
//   flags (was misrouted to the upcoming-fixtures list); (d) fixture lists never show a
//   score for a game that hasn't kicked off (dev future-scored rows leaked as "upcoming");
//   (e) rules-FAQ: group min size, "how much" variants, champion+top-scorer combined line.
// Deterministic-first: LLM only for fuzzy "describe" stats, rules-FAQ fallback, off-topic,
//   and the v20 understanding fallback (parse-only). RAG NEVER answers MAX/COUNT/rank.
// Modes: reindex_intents, reindex_kb (paginated). Deploy target: DEV (ftryuvfdihmhlzvbpfeu) ONLY.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const CHAT_MODEL = 'gpt-4o-mini'
const EMBED_MODEL = 'text-embedding-3-small'
const CONF_MIN = 0.28          // below this top-similarity => off-topic
const CLARIFY_MARGIN = 0.02    // intent gap below this (and low conf) => clarify
const CLARIFY_CONF = 0.50
const RATE_MAX = 30, RATE_WIN = 60_000  // 30 questions / 60s / user (best-effort, in-memory)

const RULES = `
WorldCup 2026 Social Predictions — a social betting app for the 2026 FIFA World Cup (48 teams, 104 games).
Predict scores, climb the leaderboard, and survive the nightly AI roast. The Final is July 19, 2026.

SCORING (NOT cumulative — an exact score is 3 pts total, it already includes the outcome point):
- Exact scoreline: 3 pts
- Correct outcome (Win/Draw/Loss): 1 pt
- Correct Champion: 10 pts
- Correct Top Scorer: 10 pts
- Daily Trivia: 1 pt per question
Missed a prediction? The app auto-predicts for you — it leans toward the LEAST-popular outcome
(contrarian, not pure random) and fills a scoreline for it. Auto-predictions score like manual ones.

KNOCKOUT BRACKET (a separate prediction game, max 83 pts): predict which teams reach each knockout
round + the champion + the 3rd-place winner. +2 per team correctly reaching a round; whole-round bonus
QF +12 / SF +10 / Final +8 / 3rd-4th +6; correct Champion +10; correct 3rd-place winner +5.
Locks 2026-07-04, 20:00 Israel; these points fold into the leaderboard from July 20.

WHEN POINTS APPEAR: prediction points count immediately as games finish. Champion + Top Scorer points
land when the Final result is confirmed (~July 19). Trivia points are banked SILENTLY (nobody sees them)
and all land at once after the LAST trivia question closes (~July 21) — the standings can swing late.

PICKS: each user makes a Champion pick and a Top Scorer pick, PER GROUP (independent per group).
Champion = choose any of the 48 teams (live William Hill odds shown). Top Scorer = choose any player from
the full tournament squads (live goal tally shown). Both worth 10 pts. Lock June 11, 22:00 Israel — forever.

PREDICTIONS: per game, per group, editable until that game's kickoff; miss = automatic contrarian prediction.
Your prediction stays hidden until kickoff, then all group members' predictions are revealed (incl. auto ones).
Prediction points are scored on the 90-MINUTE result ONLY — extra time and penalty shoot-outs never
change prediction points (they only decide who advances). Predicted a draw and it's level after 90'?
You get the outcome point even if the game is decided on penalties.

GROUPS: private, invite-only. Max 3 groups per user; max 12 members per group. Each group is its own
competition — independent leaderboard, picks, predictions, and nightly AI roast. You could be last in one
group and first in another. You cannot leave or delete a group; captains can mark inactive members.

LEADERBOARDS: a global leaderboard (all players) + a per-group leaderboard. Both show group rank and
global rank. Ties are broken by the number of exact scorelines; still tied = the same shared rank
(the numbering then skips). There is no further tiebreaker.

INACTIVE MEMBERS: the captain can mark a member inactive (they stopped playing). Inactive members
still earn auto-predict points and stay on the leaderboard (dimmed). Captains can't mark themselves,
and the captain role is permanent.
SELF-SERVICE LOCKS (June 11, 22:00 Israel): renaming your username, renaming a group, and deleting
your account all locked permanently at the picks deadline (account deletion also required not being
in any group). After that, contact the admin for changes.
PICK VISIBILITY: after the June-11 lock, everyone's Champion + Top Scorer picks are PUBLIC (shown on
the leaderboards). TOP SCORER TIES: if several players tie for most goals, everyone who picked ANY
of the tied players gets the 10 points.
BRACKET VISIBILITY: after the July-4 bracket lock, group members can view each other's Road-to-Final
brackets — but only after filling their own.
AI ROAST TIMING: the nightly roast generates ~3.5 hours after the day's last kickoff — one per group
of 3+ members, in the AI tab.

USING THE APP (navigation — where things live):
- BOTTOM NAV has 5 tabs: Dashboard, Groups, Picks, Trivia, AI.
- DASHBOARD: your command center. Live countdown to the next kickoff (and to the Final). The global
  leaderboard (your row highlighted). Today's match cards first, then the next matchday — each card has your
  per-group prediction chip; tap to predict or update. "My Stats" (private, only you): group rank, global
  rank, your champion + top scorer picks, Exact %, Hit %, and your Hot/Cold streak — one card per group.
- MATCH PAGE (tap any game): BEFORE kickoff — Bet365 odds (Home/Draw/Away + Over/Under 2.5, shown in the
  3 days before), each team's tournament form badges, tournament average stats, and your prediction row per
  group (editable until kickoff). AFTER the game — goal timeline (every scorer & minute), full match stats
  (possession, shots, on-target, pass accuracy, corners, fouls, cards, offsides, xG), and ET/penalty scores
  shown separately when applicable.
- GROUPS: create a group in one tap (get an invite link — opens WhatsApp on mobile, copies on desktop) or
  join via a friend's link/code. Each group shows its own leaderboard (shareable). At kickoff all members'
  predictions are unmasked. The "Wisdom Engine" shows your pick, the group's vote split (outcome / goals
  range / most popular scoreline), and how the whole platform voted — so you can spot the contrarian.
- PICKS: two tabs. "Picks" = your Champion + Top Scorer bets (per group; switch groups with the tabs at
  top). "Predictions" = every game — Upcoming (predict inline per group, or open a game to predict for all
  your groups at once) and History (completed games with full stats, goal timeline, and your pick vs the
  final score). Also here: the "Road to Final" bracket game.
- AI TAB: the nightly roast — one funny/social summary per group (groups of 3+ members), plus that day's
  standings and total standings. React with emojis or share to the group chat.
- TRIVIA: the Trivia tab in the bottom nav. One question per day at 22:00 Israel (from June 11),
  staying open for a full 24-hour window (22:00 Israel to 22:00 Israel the next day) before the
  next one replaces it. Once opened: 40 seconds, one shot, no retries — miss it and it counts as wrong.
- The "i" (How to Play) button in the top bar opens the full rules and the tournament schedule any time.
To make a PREDICTION: open the game (or use a Dashboard/Groups card) and enter a scoreline before kickoff.
To make PICKS: go to the Picks tab. To predict the bracket: Picks tab -> "Road to Final".
`.trim()

const RULES_PROMPT = `You are the friendly, professional in-app assistant for the WorldCup 2026 social
predictions app. Answer using ONLY the rules below — do not invent rules or point values. Be concise
and warm. If the question needs live data you don't have, say you can't look it up yet. If unrelated
to the app, briefly say so and steer back.

RULES:
${RULES}`

const INTENT_EXAMPLES: Record<string, string[]> = {
  schedule: ['when does Brazil play next','what is the coming game','next fixture','when is the final','upcoming matches','who plays tomorrow','when do we play next','what games are on today','list the round of 16 games','how many games are left','how many games have been played'],
  who_scored: ['who scored in England vs Argentina','who got the goals in that match','scorers for Brazil vs Serbia','who scored in the game','list the goalscorers in that match','who scored in the France Germany game','goalscorers in the final','what was the score of England vs Argentina'],
  stats: ['which team has the best defense','who is the top scorer','tell me about Brazil','which team scores the most','most in-form players','compare France and Argentina','which team has the most cards','who has the most goals','best attacking team','which team keeps the most clean sheets','who has scored the most goals in the tournament','tournament top scorer','who is the leading goalscorer','who is winning the golden boot','how is a team playing','how does one team compare to another','tell me about this team','who has the most assists','which team has the most possession','is Brazil still in the tournament','who has been knocked out'],
  my_data: ['what is my rank','how am I doing','what are my picks','my champion pick','my streak','am I winning','how many points do I have','what is my exact percentage','what is my hit rate','am I on a hot streak','am I hot or cold','who is my top scorer pick','which groups am I in','what groups am I part of','how many groups am I in','list my groups','how many exact scores do I have','show me my stats','what are my predictions worth','how am I ranked in my group','who did I pick as champion','what team did I bet on to win it all','how many of my predictions were correct','how many of my predictions were spot on','how many did I nail','how many exact scores do I have in my group','how many games did I predict exactly','which games did I get right'],
  group_standings: ['who is winning our group','group standings','show the leaderboard','who is top of the group','who has the most exact scores','who is leading','our group table','who is in first place','who is winning overall','global leaderboard','who is number one in the whole app'],
  group_history: ['what did we predict for Brazil vs Serbia','our predictions for the final','who predicted what','what did the group guess for this game','what did we all predict for this match','who nailed the game in our group','who got the score right in our group','who predicted the exact score'],
  rules: ['how many points for an exact score','how does scoring work','when do picks lock','how many members can a group have','how does the bracket work','what is the daily trivia','how do auto predictions work','when is the deadline','where can I see my history games','where do I make a prediction','how do I create a group','how do I join a group','where are my past predictions','where is the bracket','how do I pick my champion','where do I answer trivia','how do I use the app','what can this app do','where do I see the leaderboard','how do I invite friends','how many points is the champion worth','when does the champion pick lock','what happens if I miss a prediction','can I leave a group','how many groups can I be in','how many points is the top scorer worth','how much is the golden boot pick worth','is the exact score worth more than the winner','what do I get for a correct result','where is the road to final bracket'],
  off_topic: ["what's the weather",'tell me a joke','who are you','what time is it','help me with my taxes','what should I eat','sing a song','are you an AI','what is your favorite team','recommend a movie'],
}

// P2: stat-dimension exemplars for the embedding dim-classifier (paraphrase-robust labels).
const DIM_EXAMPLES: Record<string, string[]> = {
  goals_or_attack: ['most goals', 'top scorer', 'golden boot', 'best attack', 'most prolific team', 'who bangs in the goals', 'sharpest in front of goal'],
  assists: ['most assists', 'best playmaker', 'who sets up the most goals', 'most creative player', 'who lays on the most goals', 'best provider', 'who creates the most chances'],
  defense: ['best defense', 'most clean sheets', 'fewest goals conceded', 'leaky at the back', 'solid defensively', 'tightest defense', 'meanest at the back', 'stingiest defense', 'hardest to score against'],
  possession: ['most possession', 'keeps the ball best', 'dominates the ball', 'highest possession share'],
  corners: ['most corners', 'wins the most corners'],
  fouls: ['most fouls', 'dirtiest team', 'commits the most fouls'],
  cards: ['most cards', 'most booked', 'most yellow cards', 'most red cards', 'least disciplined'],
  form: ['best form', 'most in-form', 'who is playing well', 'hot streak of results'],
  offsides: ['most offsides', 'caught offside the most', 'offside the most times'],
  shots: ['most shots', 'most shots on target', 'most attempts on goal', 'shoots the most'],
}

// ---- helpers ----------------------------------------------------------------
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
type Sb = ReturnType<typeof createClient>
async function embed(openai: OpenAI, input: string | string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input }); return res.data.map((d) => d.embedding as number[])
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m
  const d = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) { let prev = d[0]; d[0] = i
    for (let j = 1; j <= n; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t } }
  return d[n]
}

// v26: keyword-only intent guess for the OpenAI-outage degraded mode — deterministic
// routes (schedule/scores/standings/my-data) keep answering when embeddings are down.
function guessIntent(q: string): string {
  const s = q.toLowerCase()
  if (/\b(my|me|mine|am i|do i have)\b/.test(s)) return 'my_data'
  if (/who scored|scorers?\b/.test(s)) return 'who_scored'
  if (/leaderboard|standings|who('s| is) (winning|leading|top|first)/.test(s)) return 'group_standings'
  if (/\bpredict(ed)?\b|\bguess(ed)?\b/.test(s)) return 'group_history'
  if (/\bwhen\b|\bnext\b|fixture|schedule|\bplays?\b|games? (on|today|tomorrow)/.test(s)) return 'schedule'
  if (/how (do|does|can)|points?|rules?|lock|deadline|worth/.test(s)) return 'rules'
  return 'stats'
}
// v26: a failed query must surface as a retry message — never read as an empty result
// ("You have no exact scores yet" on a DB blip was a confident lie).
function must<T>(r: { data: T; error: any }): T { if (r.error) throw new Error('db: ' + r.error.message); return r.data }

// v29 V0: the outbound-payload guard. The privacy boundary ("only question text + the
// caller's OWN group/member names + public stat cards ever reach the LLM") was true by
// CONVENTION — nothing enforced it, so a future tool could pass a prediction into answerCrew
// and nobody would notice until it leaked. Every openai.chat.completions.create call site
// must run its outbound strings through this first. It THROWS (never silently strips) so a
// violation fails loudly into ask_log instead of quietly shipping.
const PRIVATE_TOKEN = /\b(points_earned|pred_home|pred_away|prediction_id|champion_pick|top_scorer_pick|knockout_pick|is_auto|user_id|group_members|auth\.uid|email)\b/i
function assertPublicPayload(where: string, ...parts: string[]): void {
  const blob = parts.join(' ')
  if (PRIVATE_TOKEN.test(blob)) {
    // console.error first: some call sites wrap this in a try/catch that swallows the throw
    // (existing error handling for network/parse failures) — the violation must still be
    // visible in EF logs even when the throw itself gets caught upstream.
    console.error(JSON.stringify({ llm_guard_violation: true, where }))
    throw new Error(`llm-guard: private-shaped token blocked before reaching the LLM (${where})`)
  }
}
// v29: RULES_PROMPT (and the RAG writer) had NO CLOCK — on 2026-07-14 the bot told a user
// trivia "hasn't started yet, it's before June 11" (five weeks stale). Computed fresh per
// request (not a module-level const) so a long-lived EF instance never serves a stale date.
function factsBlock(): string {
  const il = new Date(Date.now() + 3 * 3600_000)  // Israel = UTC+3 for the whole tournament window
  const today = `${il.getUTCFullYear()}-${String(il.getUTCMonth() + 1).padStart(2, '0')}-${String(il.getUTCDate()).padStart(2, '0')}`
  return `\n\nFACTS (authoritative — never state a date or number that is not here or in the data given to you):\n- Today's date is ${today} (Israel time).`
}

// ---- guardrails -------------------------------------------------------------
function preGuard(q: string): { ok: boolean; msg?: string } {
  if (q.length > 500) return { ok: false, msg: 'That question is a bit long — please shorten it.' }
  if (/ignore (all )?(previous|prior) instructions|disregard (the )?(system|rules|instructions)|reveal (the )?(system prompt|instructions)|dump (all|everyone|every)|(show|reveal|give)( me)?( the)? ?(all|every ?one)'?s?.{0,30}(prediction|pick)|admin mode/i.test(q))
    return { ok: false, msg: "I can't help with that — but ask me anything about the tournament, the app, or your groups!" }
  return { ok: true }
}
// v19: compound questions — split into at most 2 self-contained clauses. A pure
// drill-down tail ("...? and in which games?") is NOT split: the main tool answers
// it inline (myExact always lists the games). Clause 2 borrows entities from
// clause 1 via the existing follow-up history mechanism.
function splitCompound(q: string): string[] {
  const m = q.match(/^(.*?\?)\s*(?:and|&)\s+(.{4,})$/i) || q.match(/^(.{10,}?)\s+and\s+((?:when|where|who|what|which|how many|how much|did|do|does|is|are|has|have|will|can)\b.{4,})$/i)
  if (!m) return [q]
  const tail = m[2].trim()
  if (/^(in\s+)?which (games?|matches|ones)\b/i.test(tail)) return [q]
  // v26: a verb-less noun fragment ("...? and score") is a continuation of clause 1, not a
  // second question — splitting it glued a bogus clarify onto a correct clause-1 answer.
  if (!/\b(when|where|who|what|which|how|did|do|does|is|are|was|were|has|have|will|can|show|list|give|tell)\b/i.test(tail)) return [q]
  return [m[1].trim(), tail]
}
const RL = new Map<string, number[]>()
function rateOk(key: string): boolean {
  const now = Date.now(), arr = (RL.get(key) ?? []).filter((t) => now - t < RATE_WIN)
  arr.push(now); RL.set(key, arr)
  if (RL.size > 500) for (const [k, v] of RL) if (v.every((t) => now - t >= RATE_WIN)) RL.delete(k)  // v26: evict stale keys
  return arr.length <= RATE_MAX
}

// ---- classify (embeddings): max-per-intent + margin -------------------------
const VOTE_MARGIN = 0.12
async function classify(sb: Sb, qvec: number[]): Promise<{ intent: string; confidence: number; margin: number; second: string }> {
  const { data } = await sb.rpc('match_intent', { query_embedding: qvec, match_count: 10 })
  const rows = (data ?? []) as { intent: string; similarity: number }[]
  if (!rows.length) return { intent: 'rules', confidence: 0, margin: 1, second: '' }
  const top = rows[0].similarity
  if (top < CONF_MIN) return { intent: 'off_topic', confidence: top, margin: 1, second: '' }
  const best: Record<string, number> = {}          // max similarity per intent (not sum -> no exemplar-count bias)
  for (const r of rows) if (r.similarity >= top - VOTE_MARGIN) best[r.intent] = Math.max(best[r.intent] ?? 0, r.similarity)
  const ranked = Object.entries(best).sort((a, b) => b[1] - a[1])
  return { intent: ranked[0][0], confidence: top, margin: ranked[0][1] - (ranked[1]?.[1] ?? 0), second: ranked[1]?.[0] ?? '' }
}

// ---- entity / dimension / operation extraction (deterministic) --------------
// v26: cached per isolate — team names change only when fixtures are inserted; this was a
// full games scan on EVERY request. Write-once-read-many (timestamp + array swap).
let _namesCache: { t: number; v: string[] } = { t: 0, v: [] }
async function fetchTeamNames(sb: Sb): Promise<string[]> {
  if (_namesCache.v.length && Date.now() - _namesCache.t < 300_000) return _namesCache.v
  const { data } = await sb.from('games').select('team_home, team_away').range(0, 999)
  const s = new Set<string>(); for (const g of data ?? []) { if (g.team_home) s.add(g.team_home as string); if (g.team_away) s.add(g.team_away as string) }
  s.delete('TBD'); const v = [...s]; if (v.length) _namesCache = { t: Date.now(), v }; return v
}
const TEAM_ALIAS: Record<string, string> = { psg: 'Paris Saint Germain', 'man city': 'Manchester City', 'man utd': 'Manchester United', 'man united': 'Manchester United', spurs: 'Tottenham', usa: 'United States', 'u.s.a': 'United States', 'the states': 'United States', holland: 'Netherlands', oranje: 'Netherlands', 'the dutch': 'Netherlands', 'three lions': 'England', 'les bleus': 'France', 'la albiceleste': 'Argentina', selecao: 'Brazil', 'la roja': 'Spain', socceroos: 'Australia', 'the azzurri': 'Italy', azzurri: 'Italy', 'die mannschaft': 'Germany' }
const COMMON_TOK = new Set(['united', 'city', 'republic', 'north', 'south', 'saint', 'their', 'about', 'which', 'these', 'those', 'there', 'where'])
// v24: common English words are EXCLUDED from the typo (lev) pass — "place" matched Crystal
// PALACE and "leads" matched LEEDS, hijacking innocent schedule questions with a ghost team.
const TYPO_STOP = new Set(['place', 'take', 'takes', 'taken', 'lead', 'leads', 'score', 'scores', 'scored', 'goal', 'goals', 'point', 'points', 'table', 'game', 'games', 'group', 'groups', 'final', 'finals', 'semi', 'next', 'last', 'most', 'best', 'team', 'teams', 'play', 'plays', 'played', 'player', 'players', 'match', 'matches', 'win', 'wins', 'winner', 'today', 'tomorrow', 'stage', 'round', 'their', 'there', 'against', 'between', 'predict', 'result', 'results', 'fixture', 'fixtures', 'history', 'captain', 'member', 'members', 'leaderboard', 'standing', 'standings', 'stats', 'season', 'world', 'question', 'answer', 'still', 'many', 'much', 'have', 'what', 'when', 'where', 'which'])
function resolveTeams(q: string, names: string[]): string[] {
  const ql = ' ' + q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '
  const qtok = ql.trim().split(' ').filter((w) => w.length >= 4 && !TYPO_STOP.has(w))
  const scored: { t: string; score: number }[] = []
  for (const t of names) {
    const tl = t.toLowerCase(); let score = 0
    if (ql.includes(' ' + tl + ' ')) score = 100 + tl.length
    else {
      const toks = tl.split(' ').filter((w) => w.length >= 5 && !COMMON_TOK.has(w))
      let hit = toks.filter((w) => ql.includes(' ' + w + ' ')).length
      if (!hit) for (const tk of toks) for (const qw of qtok) { const L = lev(tk, qw); if ((tk.length >= 5 && L === 1) || (tk.length >= 8 && L === 2)) { hit++; break } }  // typo tolerance
      if (hit) score = hit
    }
    if (score) scored.push({ t, score })
  }
  for (const [al, full] of Object.entries(TEAM_ALIAS)) if (ql.includes(' ' + al + ' ') && names.includes(full) && !scored.some((s) => s.t === full)) scored.push({ t: full, score: 100 })
  scored.sort((a, b) => b.score - a.score || b.t.length - a.t.length)
  const out: string[] = []
  for (const { t } of scored) if (!out.some((o) => o.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(o.toLowerCase()))) out.push(t)
  return out
}
// v27: exact full-name team scan for BOT-ANSWER text (no typo pass — answers are long and
// noisy; only literal team names count). Powers answer-aware follow-ups.
function teamsInText(t: string, names: string[]): string[] {
  const tl = ' ' + t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '
  return names.filter((n) => tl.includes(' ' + n.toLowerCase() + ' '))
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function dayRange(y: number, m: number, d: number, label: string) { return { start: new Date(Date.UTC(y, m, d)).toISOString(), end: new Date(Date.UTC(y, m, d + 1)).toISOString(), label } }
// v27: "today/tonight/tomorrow" resolve on the ISRAEL calendar day (users are Israeli; the
// old UTC day gave wrong-day answers between 21:00 and midnight UTC). Window = the Israel
// day expressed in UTC (starts 3h earlier).
function dayRangeIL(y: number, m: number, d: number, label: string) { const start = new Date(Date.UTC(y, m, d) - 3 * 3600_000); const end = new Date(start.getTime() + 86400_000); return { start: start.toISOString(), end: end.toISOString(), label } }
function resolveDate(q: string): { start: string; end: string; label: string } | null {
  const s = q.toLowerCase(), now = new Date(), Y = now.getUTCFullYear()
  const il = new Date(now.getTime() + 3 * 3600_000)
  if (/\btoday\b|\btonight\b/.test(s)) return dayRangeIL(il.getUTCFullYear(), il.getUTCMonth(), il.getUTCDate(), 'today')
  if (/\btomorrow'?s?\b/.test(s)) { const d = new Date(il); d.setUTCDate(d.getUTCDate() + 1); return dayRangeIL(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 'tomorrow') }
  if (/this weekend|the weekend/.test(s)) { const d = new Date(now); const add = (6 - d.getUTCDay() + 7) % 7; d.setUTCDate(d.getUTCDate() + add); const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 2); return { start: start.toISOString(), end: end.toISOString(), label: 'this weekend' } }
  let m = s.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/)
  if (m) { const a = m[1], b = m[2]; const mon = MONTHS.indexOf((isNaN(+a) ? a : b).slice(0, 3)); const day = +(isNaN(+a) ? b : a); if (mon >= 0 && day >= 1 && day <= 31) return dayRange(Y, mon, day, `${MONTHS[mon][0].toUpperCase()}${MONTHS[mon].slice(1)} ${day}`) }
  return null
}
const PHASE: Record<string, string> = { group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-Final', sf: 'Semi-Final', third: 'Third Place', final: 'Final' }
// v27: "group stage" is a PHASE too — without it, "when is the last group stage game?" lost the
// phase and answered with the last game of the WHOLE tournament. Only the two-word forms match,
// so a FRIEND-group question ("who is winning our group") never becomes a phase.
const PHASE_WORD: [RegExp, string][] = [[/group stage|group phase|\bgroup games?\b/i, 'group'], [/round of 32|\br32\b/i, 'r32'], [/round of 16|last 16|\br16\b/i, 'r16'], [/quarter[- ]?finals?|\bqf\b/i, 'qf'], [/semi[- ]?finals?|\bsf\b/i, 'sf'], [/third[- ]?place|3rd[- ]?place/i, 'third'], [/\bfinal(l|e)?s?\b/i, 'final']]
function detectPhase(q: string): string | null { for (const [re, ph] of PHASE_WORD) if (re.test(q)) return ph; return null }
function detectPredicate(q: string): boolean { return /\bpredict|\bguess|\bnail|got .{0,40}\bright\b|exact score|\bcalled?\b/i.test(q) }
function detectOp(q: string): string {
  const s = q.toLowerCase()
  if (/how many|how much|number of|\bcount\b|how far along/.test(s)) return 'count'
  if (/\bcompare\b|head[- ]?to[- ]?head|\bh2h\b|versus each other/.test(s)) return 'compare'
  if (/\bmost\b|\bbest\b|\btop\b|\bhighest\b|\bworst\b|\bleast\b|\bfewest\b|\bleader\b|\bleading\b|golden boot|cleanest|dirtiest|meanest|leakiest|stingiest/.test(s)) return 'rank'
  if (/\blist\b|all (the )?(games|matches|fixtures)|which games|what games|fixtures? for (the )?(next|coming|remaining|semi|quarter|round|knockout|final|group|today|tomorrow|this week)|rest of (the )?(schedule|fixtures|games)|schedule look|after the group stage|remaining (games|fixtures|matches)/.test(s)) return 'list'
  return 'lookup'
}
function detectAgg(q: string): 'avg' | 'sum' | 'none' {
  const s = q.toLowerCase()
  if (/\baverage\b|\bavg\b|\bmean\b|per game|per match|on average/.test(s)) return 'avg'
  if (/\btotal\b|\bcombined\b|altogether|in total|overall count/.test(s)) return 'sum'
  return 'none'
}
function detectDim(q: string): string | null {
  const s = q.toLowerCase()
  if (/assist|sets? up|set up the|playmaker|creator|provider|lays? on/.test(s)) return 'assists'
  if (/clean sheet|defen[cs]e|conceded|least goals|leaky|solid at the back|meanest at the back|tightest|stingiest|hard(est)? to score/.test(s)) return 'defense'
  if (/possession|keep the ball/.test(s)) return 'possession'
  if (/corner/.test(s)) return 'corners'
  if (/foul|dirtiest/.test(s)) return 'fouls'
  if (/yellow/.test(s)) return 'yellow'
  if (/red card/.test(s)) return 'red'
  if (/card|booked|booking/.test(s)) return 'cards'
  if (/offsides?/.test(s)) return 'offsides'
  if (/\bshots?\b|attempts on goal/.test(s)) return 'shots'
  if (/goal|scorer|golden boot|score[ds]? the most|attack|prolific/.test(s)) return 'goals_or_attack'
  if (/form|in.?form|playing well|how is .* (doing|playing)/.test(s)) return 'form'
  return null
}
// P2: embedding fallback when the keyword pass finds no dimension.
async function classifyDim(sb: Sb, q: string, qvec: number[]): Promise<string | null> {
  const kw = detectDim(q); if (kw) return kw
  const { data } = await sb.rpc('match_dim', { query_embedding: qvec, match_count: 3 })
  const r = (data ?? [])[0] as any
  return r && r.similarity >= 0.46 ? r.dim : null
}
function dimToMetric(dim: string | null, q: string): string | null {
  const ql = q.toLowerCase()
  // v30: a GAME-scoped superlative ("which game had the most red cards?") must win over the
  // player/team default — this used to have no game-level route at all, so it silently fell
  // to the player leaderboard (e.g. answered a tied PLAYER list for a question about a GAME).
  // Scoped to the 4 dims actually aggregable per-game (game_team_stats cards/corners + games
  // goals) — see gameGoalsLeaderboard/gameCardLeaderboard below.
  const gameWord = /\bgame\b|\bmatch\b/.test(ql)
  const team = /\bteam\b|\bside\b/.test(ql)
  switch (dim) {
    case 'assists': return 'assists'; case 'defense': return 'defense'; case 'possession': return 'possession'
    case 'corners': return gameWord ? 'cornersGame' : 'corners'; case 'fouls': return 'fouls'
    case 'red': return gameWord ? 'redGame' : 'redP'
    case 'yellow': return gameWord ? 'yellowGame' : (team ? 'teamYellow' : 'yellowP')
    case 'cards': return team ? 'teamYellow' : 'cardsP'
    case 'offsides': return 'offsidesT'; case 'shots': return 'shotsT'
    case 'goals_or_attack': return gameWord ? 'goalsGame' : (team ? 'attack' : 'goals'); default: return null
  }
}

// ---- deterministic tools ----------------------------------------------------
// v27: kickoffs also shown in Israel time (UTC+3 for the whole tournament window — IDT).
function fmtKO(iso: string): string { const d = new Date(iso); const il = new Date(d.getTime() + 3 * 3600_000); return `${MONTHS[d.getUTCMonth()][0].toUpperCase()}${MONTHS[d.getUTCMonth()].slice(1)} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC (${String(il.getUTCHours()).padStart(2, '0')}:${String(il.getUTCMinutes()).padStart(2, '0')} Israel)` }
async function lookupGame(sb: Sb, team: string | null, wantPhase: string | null): Promise<string> {
  const base = () => sb.from('games').select('team_home, team_away, kick_off_time, phase, score_home, score_away').order('kick_off_time', { ascending: true }).limit(1)
  let q = base()
  if (wantPhase) q = q.eq('phase', wantPhase).neq('team_home', 'TBD')
  else q = q.gt('kick_off_time', new Date().toISOString())
  if (team) q = q.or(`team_home.eq.${team},team_away.eq.${team}`)
  let g = (await q).data?.[0]
  // v24: a phase lookup with a (possibly mis-resolved) team must not claim "isn't set yet" — retry phase-only
  if (!g && wantPhase && team) g = (await base().eq('phase', wantPhase).neq('team_home', 'TBD')).data?.[0]
  if (!g) return wantPhase ? `The ${PHASE[wantPhase] ?? wantPhase} matchup isn't set yet.` : (team ? `${team} has no upcoming games scheduled.` : `No upcoming games are scheduled.`)
  const ph = PHASE[g.phase as string] ?? (g.phase as string)
  // v24: time-aware — a game whose kickoff is still in the future is never "was", and its
  // (dev-quirk) score must not be shown before kickoff.
  const started = new Date(g.kick_off_time as string) <= new Date()
  if (wantPhase) return g.score_home !== null && started ? `The ${ph} was ${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${fmtKO(g.kick_off_time as string)}).` : `The ${ph} is ${g.team_home} vs ${g.team_away}, ${fmtKO(g.kick_off_time as string)}.`
  if (team) { const opp = g.team_home === team ? g.team_away : g.team_home; const side = g.team_home === team ? 'vs' : 'away to'; return `${team}'s next game is ${side} ${opp} — ${ph}, ${fmtKO(g.kick_off_time as string)}.` }
  return `The next game is ${g.team_home} vs ${g.team_away} — ${ph}, ${fmtKO(g.kick_off_time as string)}.`
}
async function scheduleList(sb: Sb, date: { start: string; end: string; label: string } | null, phase: string | null): Promise<string> {
  let q = sb.from('games').select('team_home, team_away, kick_off_time, phase, score_home, score_away').neq('phase', 'friendly').neq('team_home', 'TBD').order('kick_off_time', { ascending: true }).limit(12)
  if (date) q = q.gte('kick_off_time', date.start).lt('kick_off_time', date.end)
  else if (phase) q = q.eq('phase', phase)
  else q = q.gt('kick_off_time', new Date().toISOString())
  const rows = must(await q) ?? []
  if (!rows.length) return date ? `No games are scheduled for ${date.label}.` : (phase ? `No ${PHASE[phase] ?? phase} games are scheduled yet.` : `No upcoming games are scheduled.`)
  const head = date ? `Games ${date.label}:` : (phase ? `${PHASE[phase] ?? phase} games:` : `Upcoming games:`)
  // v23: never show a score for a game that hasn't kicked off (dev rows can carry future scores)
  const now = new Date()
  return head + '\n' + rows.map((g) => `• ${g.team_home} ${g.score_home !== null && new Date(g.kick_off_time as string) <= now ? `${g.score_home}-${g.score_away}` : 'vs'} ${g.team_away} — ${fmtKO(g.kick_off_time as string)}`).join('\n')
}
async function tournamentProgress(sb: Sb, q: string): Promise<string> {
  const base = sb.from('games').select('score_home, score_away', { count: 'exact', head: false }).neq('phase', 'friendly').neq('team_home', 'TBD')
  const rows = must(await base) ?? []
  const played = rows.filter((g) => g.score_home !== null)
  const remaining = rows.length - played.length
  if (/\bgoals?\b/.test(q.toLowerCase())) { const goals = played.reduce((s, g) => s + (g.score_home as number) + (g.score_away as number), 0); return `${goals} goals have been scored across ${played.length} completed games so far.` }
  return `${played.length} of ${rows.length} games have been played; ${remaining} remain.`
}
async function findGame(sb: Sb, a: string, b: string) {
  // v26: one query for both orientations (was two sequential round-trips). Team names are
  // canonical DB values and contain no commas/parens, so the or() filter is safe.
  const { data } = await sb.from('games').select('id, team_home, team_away, score_home, score_away, phase, kick_off_time, went_to_extra_time, went_to_penalties, et_score_home, et_score_away, penalty_score_home, penalty_score_away, knockout_winner').or(`and(team_home.eq.${a},team_away.eq.${b}),and(team_home.eq.${b},team_away.eq.${a})`).order('kick_off_time', { ascending: false }).limit(1)
  return data?.[0]
}
// Shared: extra-time / penalties tail appended to any game summary.
function etPensLine(g: any): string {
  if (!g.went_to_extra_time && !g.went_to_penalties) return ''
  let s = ''
  if (g.went_to_extra_time && g.et_score_home !== null) s += ` After extra time: ${(g.score_home as number) + (g.et_score_home as number)}-${(g.score_away as number) + (g.et_score_away as number)}.`
  else if (g.went_to_extra_time) s += ` It went to extra time.`
  if (g.went_to_penalties && g.penalty_score_home !== null) s += ` Penalties: ${g.penalty_score_home}-${g.penalty_score_away}.`
  else if (g.went_to_penalties) s += ` It went to penalties.`
  if (g.knockout_winner) s += ` ${g.knockout_winner} advanced.`
  return s
}
async function whoScored(sb: Sb, a: string, b: string): Promise<string> {
  const game = await findGame(sb, a, b); if (!game || game.score_home === null) return `I couldn't find a finished game between ${a} and ${b}.`
  const { data: evs } = await sb.from('game_events').select('team, player_name, minute, minute_extra, detail').eq('game_id', game.id).eq('event_type', 'goal').order('minute', { ascending: true })
  const head = `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away} (${PHASE[game.phase as string] ?? game.phase}).`
  const tail = etPensLine(game)
  if (!evs || evs.length === 0) return `${head}${tail} No goal details recorded.`
  return `${head} Scorers: ` + evs.map((e) => `${e.player_name} ${e.minute}${e.minute_extra ? '+' + e.minute_extra : ''}' [${e.team}]${(e.detail as string)?.toLowerCase().includes('own') ? ' (OG)' : ''}`).join(', ') + '.' + tail
}
const STATLB: Record<string, any> = {
  goals: { level: 'player', col: 'total_goals', noun: 'goals', sup: 'top scorer' },
  assists: { level: 'player', col: 'total_assists', noun: 'assists', sup: 'assist leader' },
  yellowP: { level: 'player', col: 'total_yellow_cards', noun: 'yellow cards', sup: 'most-booked player' },
  redP: { level: 'player', col: 'total_red_cards', noun: 'red cards', sup: 'player with the most red cards' },
  cardsP: { level: 'player', col: 'total_yellow_cards', compute: (r: any) => r.total_yellow_cards + r.total_red_cards, noun: 'cards', sup: 'most-carded player' },
  // v30: `dir` is the DEFAULT pole ("most goals" for attack, "fewest conceded" for defense —
  // hence dir:'asc' there). `fmtInv` is the OPPOSITE pole's wording, used only when the question
  // uses an explicit opposite-polarity word (see detectPolarity) — this used to be a fixed
  // direction regardless of what was asked: "which team conceded the MOST" silently answered
  // with the BEST defense (fewest conceded), and "least possession"/"fewest fouls" both
  // returned the MOST. Default (no explicit polarity word) is UNCHANGED — zero regression risk.
  attack: { level: 'team', col: 'avg_goals_scored', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the best attack, scoring ${(+v).toFixed(1)} goals per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the weakest attack, scoring just ${(+v).toFixed(1)} goals per game.` },
  defense: { level: 'team', col: 'avg_goals_conceded', dir: 'asc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the best defense, conceding ${(+v).toFixed(1)} goals per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} conceded the most goals, ${(+v).toFixed(1)} per game.` },
  possession: { level: 'team', col: 'avg_possession', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the most possession, ${(+v).toFixed(1)}% per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the least possession, ${(+v).toFixed(1)}% per game.` },
  corners: { level: 'team', col: 'avg_corners', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'win' : 'wins'} the most corners, ${(+v).toFixed(1)} per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'win' : 'wins'} the fewest corners, ${(+v).toFixed(1)} per game.` },
  fouls: { level: 'team', col: 'avg_fouls', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'commit' : 'commits'} the most fouls, ${(+v).toFixed(1)} per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'commit' : 'commits'} the fewest fouls, ${(+v).toFixed(1)} per game.` },
  teamYellow: { level: 'team', col: 'avg_yellow_cards', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'pick' : 'picks'} up the most cards, ${(+v).toFixed(1)} yellow per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'pick' : 'picks'} up the fewest cards, ${(+v).toFixed(1)} yellow per game.` },
  offsidesT: { level: 'team', col: 'avg_offsides', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'are' : 'is'} caught offside the most, ${(+v).toFixed(1)} per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'are' : 'is'} caught offside the least, ${(+v).toFixed(1)} per game.` },
  shotsT: { level: 'team', col: 'avg_shots_total', dir: 'desc',
    fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'take' : 'takes'} the most shots, ${(+v).toFixed(1)} per game.`,
    fmtInv: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'take' : 'takes'} the fewest shots, ${(+v).toFixed(1)} per game.` },
}
// v30: explicit LITERAL quantity words override the dim's default direction ("best"/"worst"
// stay dim-semantic and are left alone — dim SELECTION already encodes their pole correctly,
// e.g. "leaky defense" already maps to dim='defense' with the correct asc default). Confirmed
// live bugs: "which team conceded the MOST" (defense, default=asc) answered best defense;
// "LEAST possession" and "FEWEST fouls" (both default=desc) answered the most of each.
function detectPolarity(q: string): 'asc' | 'desc' | null {
  const s = q.toLowerCase()
  if (/\b(least|fewest|lowest|smallest|minimum|bottom)\b/.test(s)) return 'asc'
  if (/\b(most|highest|greatest|maximum|top)\b/.test(s)) return 'desc'
  return null
}
// v30: GAME-scoped card/corner totals — group game_team_stats by game_id (home+away combined)
// and return the game(s) at the max. Was previously unreachable: no STATLB level:'game' existed.
const GAME_STAT: Record<string, { col: string; label: string }> = {
  redGame: { col: 'red_cards', label: 'red cards' },
  yellowGame: { col: 'yellow_cards', label: 'yellow cards' },
  cornersGame: { col: 'corners', label: 'corners' },
}
async function gameCardLeaderboard(sb: Sb, key: string): Promise<string> {
  const M = GAME_STAT[key]
  const rows = (must(await sb.from('game_team_stats').select(`game_id, ${M.col}`)) ?? []) as any[]
  const byGame = new Map<string, number>()
  for (const r of rows) byGame.set(r.game_id as string, (byGame.get(r.game_id as string) ?? 0) + ((r as any)[M.col] ?? 0))
  if (!byGame.size) return `No ${M.label} data is available yet.`
  const max = Math.max(...byGame.values())
  if (max === 0) return `No game has had any ${M.label} yet.`
  const ids = [...byGame.entries()].filter(([, v]) => v === max).map(([id]) => id)
  const games = ((await sb.from('games').select('id, team_home, team_away, score_home, score_away, phase').in('id', ids)).data ?? []) as any[]
  const fmt = (g: any) => `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase})`
  if (games.length === 1) return `${fmt(games[0])} had the most ${M.label}: ${max}.`
  return `${games.length} games are tied for the most ${M.label} (${max} each): ` + games.map(fmt).join(', ') + '.'
}
// v30: GAME-scoped goal totals — combined score across both teams, from `games` directly
// (simpler and more authoritative than summing game_team_stats for this one dim).
async function gameGoalsLeaderboard(sb: Sb): Promise<string> {
  const rows = (must(await sb.from('games').select('id, team_home, team_away, score_home, score_away, phase').not('score_home', 'is', null)) ?? []) as any[]
  if (!rows.length) return 'No completed games are available yet.'
  const total = (g: any) => (g.score_home as number) + (g.score_away as number)
  const max = Math.max(...rows.map(total))
  const top = rows.filter((g) => total(g) === max)
  const fmt = (g: any) => `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase})`
  if (top.length === 1) return `${fmt(top[0])} had the most goals: ${max}.`
  return `${top.length} games are tied for the most goals (${max} each): ` + top.map(fmt).join(', ') + '.'
}
async function statLeaderboard(sb: Sb, key: string, question?: string): Promise<string> {
  if (key === 'goalsGame') return await gameGoalsLeaderboard(sb)
  if (key === 'redGame' || key === 'yellowGame' || key === 'cornersGame') return await gameCardLeaderboard(sb, key)
  const M = STATLB[key]; if (!M) return 'I could not work out which stat you mean.'
  const pol = question ? detectPolarity(question) : null
  if (M.level === 'team') {
    const dir = pol ?? M.dir
    const fmt = pol && pol !== M.dir && M.fmtInv ? M.fmtInv : M.fmt
    const { data } = await sb.from('team_tournament_stats').select(`team, ${M.col}, games_played`).gt('games_played', 0)
    if (!data || !data.length) return 'No team stats are available yet.'
    const rows = [...data].sort((a: any, b: any) => dir === 'asc' ? a[M.col] - b[M.col] : b[M.col] - a[M.col])
    const ext = rows[0][M.col]; const lead = rows.filter((r: any) => r[M.col] === ext)
    return fmt(lead.map((r: any) => r.team).join(', '), ext, lead.length)
  }
  const { data } = await sb.from('player_tournament_stats').select('player_name, team, total_goals, total_assists, total_yellow_cards, total_red_cards, games_played').gt('games_played', 0).order(M.col, { ascending: false }).limit(200)
  if (!data || !data.length) return 'No player stats are available yet.'
  const val = (r: any) => M.compute ? M.compute(r) : r[M.col]
  const rows = [...data].filter((r) => val(r) > 0).sort((a, b) => val(b) - val(a))
  if (!rows.length) return `No ${M.noun} have been recorded yet.`
  const ext = val(rows[0]); const lead = rows.filter((r) => val(r) === ext)
  if (lead.length === 1) return `The ${M.sup} is ${lead[0].player_name} (${lead[0].team}) with ${ext} ${M.noun}.`
  return `${lead.length} players are tied for ${M.sup} with ${ext} ${M.noun} each: ` + lead.map((p) => `${p.player_name} (${p.team})`).join(', ') + '.'
}
async function compareTeams(sb: Sb, a: string, b: string): Promise<string> {
  const { data } = await sb.from('team_tournament_stats').select('team, games_played, wins, draws, losses, avg_goals_scored, avg_goals_conceded, avg_possession').in('team', [a, b])
  const ra = (data ?? []).find((r) => r.team === a), rb = (data ?? []).find((r) => r.team === b)
  if (!ra || !rb) { const miss = !ra ? a : b; return `I don't have tournament stats for ${miss} yet.` }
  const line = (r: any) => `${r.team}: ${r.games_played} games (${r.wins}W ${r.draws}D ${r.losses}L), ${(+r.avg_goals_scored).toFixed(1)} scored / ${(+r.avg_goals_conceded).toFixed(1)} conceded per game, ${(+r.avg_possession).toFixed(0)}% possession`
  return `${line(ra)}\n${line(rb)}`
}
async function bracketStatus(sb: Sb, team: string): Promise<string> {
  const fut = (await sb.from('games').select('team_home, team_away, phase, kick_off_time').or(`team_home.eq.${team},team_away.eq.${team}`).is('score_home', null).neq('phase', 'friendly').gt('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: true }).limit(1)).data?.[0]
  if (fut) { const opp = fut.team_home === team ? fut.team_away : fut.team_home; return `${team} is still in it — next up: ${PHASE[fut.phase as string] ?? fut.phase} vs ${opp}, ${fmtKO(fut.kick_off_time as string)}.` }
  // v26: .lte(kickoff) — dev rows can carry a knockout_winner on a FUTURE game; without the
  // filter the bot declared a tournament champion days before the final.
  const last = (await sb.from('games').select('team_home, team_away, phase, knockout_winner, score_home').or(`team_home.eq.${team},team_away.eq.${team}`).not('score_home', 'is', null).neq('phase', 'friendly').neq('phase', 'group').lte('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: false }).limit(1)).data?.[0]
  if (last && last.knockout_winner && last.knockout_winner !== team) { const opp = last.team_home === team ? last.team_away : last.team_home; return `${team} were knocked out in the ${PHASE[last.phase as string] ?? last.phase} by ${opp}.` }
  if (last && last.knockout_winner === team && last.phase === 'final') return `${team} won the tournament! 🏆`
  return `${team} are in the tournament — I don't see an elimination for them yet.`
}
// P0: aggregate — global average goals per game
async function avgGoalsPerGame(sb: Sb): Promise<string> {
  const { data } = await sb.from('games').select('score_home, score_away').neq('phase', 'friendly').neq('team_home', 'TBD').not('score_home', 'is', null)
  const rows = data ?? []; if (!rows.length) return 'No games have been completed yet.'
  const goals = rows.reduce((s, g) => s + (g.score_home as number) + (g.score_away as number), 0)
  return `Across ${rows.length} completed games, teams are averaging ${(goals / rows.length).toFixed(2)} goals per game (${goals} total).`
}
// P1: per-player stat lookup ("how many goals has Messi scored")
async function resolvePlayer(sb: Sb, q: string, teamNames: string[]): Promise<any | null> {
  const stop = new Set(['goals', 'goal', 'assists', 'assist', 'cards', 'card', 'yellow', 'many', 'much', 'have', 'scored', 'score', 'most', 'player', 'games', 'game', 'this', 'that', 'does', 'played', 'tournament', 'about', 'their', 'them'])
  const words = q.toLowerCase().replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length >= 4 && !stop.has(w) && !teamNames.some((t) => t.toLowerCase().includes(w)))
  if (!words.length) return null
  const ors = words.map((w) => `player_name.ilike.%${w}%`).join(',')
  const { data } = await sb.from('player_tournament_stats').select('player_name, team, total_goals, total_assists, total_yellow_cards, total_red_cards, games_played').or(ors).gt('games_played', 0).order('games_played', { ascending: false }).limit(10)
  if (!data || !data.length) return null
  const sc = (p: any) => words.filter((w) => (p.player_name as string).toLowerCase().includes(w)).length
  const best = [...data].sort((a, b) => sc(b) - sc(a) || b.total_goals - a.total_goals)[0]
  return sc(best) > 0 ? best : null
}
function playerStat(p: any, dim: string | null): string {
  if (dim === 'assists') return `${p.player_name} (${p.team}) has ${p.total_assists} assist${p.total_assists === 1 ? '' : 's'} in ${p.games_played} games.`
  if (dim === 'cards' || dim === 'yellow' || dim === 'red') return `${p.player_name} (${p.team}) has ${p.total_yellow_cards} yellow and ${p.total_red_cards} red cards in ${p.games_played} games.`
  return `${p.player_name} (${p.team}) has ${p.total_goals} goal${p.total_goals === 1 ? '' : 's'} in ${p.games_played} games.`
}
// P1: per-team aggregate ("how many games has Brazil played", "how many goals has Brazil scored")
async function teamStat(sb: Sb, team: string, dim: string | null): Promise<string> {
  const { data } = await sb.from('team_tournament_stats').select('team, games_played, wins, draws, losses, avg_goals_scored, avg_goals_conceded').eq('team', team).limit(1)
  const r = (data ?? [])[0]
  if (r && (dim === 'goals_or_attack' || dim === 'goals')) return `${team} have scored about ${Math.round((r.avg_goals_scored as number) * (r.games_played as number))} goals in ${r.games_played} games (${(+r.avg_goals_scored).toFixed(1)} per game).`
  if (r && dim === 'defense') return `${team} have conceded about ${Math.round((r.avg_goals_conceded as number) * (r.games_played as number))} goals in ${r.games_played} games (${(+r.avg_goals_conceded).toFixed(1)} per game).`
  if (r) return `${team} have played ${r.games_played} games (${r.wins}W ${r.draws}D ${r.losses}L).`
  // fallback: count directly from games when the stats view has no row yet
  const { data: gs } = await sb.from('games').select('score_home').or(`team_home.eq.${team},team_away.eq.${team}`).neq('phase', 'friendly').not('score_home', 'is', null)
  const n = (gs ?? []).length
  return n ? `${team} have played ${n} game${n === 1 ? '' : 's'} in the tournament.` : `I don't have any completed games for ${team} yet.`
}
// P1: game detail — extra time / penalties / result attributes
async function gameDetail(sb: Sb, a: string, b: string): Promise<string> {
  const g = await findGame(sb, a, b)
  if (!g) return `I couldn't find a game between ${a} and ${b}.`
  if (g.score_home === null) return `${g.team_home} vs ${g.team_away} hasn't been played yet.`
  const base = `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase}) after 90'.`
  if (!g.went_to_extra_time && !g.went_to_penalties) return `${base} It did not go to extra time or penalties.`
  let out = base
  if (g.went_to_extra_time && g.et_score_home !== null) out += ` It went to extra time (${(g.score_home as number) + (g.et_score_home as number)}-${(g.score_away as number) + (g.et_score_away as number)} after ET).`
  else if (g.went_to_extra_time) out += ` It went to extra time.`
  if (g.went_to_penalties && g.penalty_score_home !== null) out += ` Penalties: ${g.penalty_score_home}-${g.penalty_score_away}.`
  else if (g.went_to_penalties) out += ` It went to penalties.`
  if (g.knockout_winner) out += ` ${g.knockout_winner} advanced.`
  return out
}
// P1: per-game box-score stats (possession, shots, corners, cards, xG) for one match
async function gameStats(sb: Sb, a: string, b: string): Promise<string> {
  const game = await findGame(sb, a, b)
  if (!game || game.score_home === null) return `I couldn't find a completed game between ${a} and ${b}.`
  const { data } = await sb.from('game_team_stats').select('team, possession, shots_total, shots_on_target, corners, fouls, yellow_cards, red_cards, offsides, xg, passes_accuracy').eq('game_id', game.id)
  const rows = data ?? []
  const rh = rows.find((r) => r.team === game.team_home), ra = rows.find((r) => r.team === game.team_away)
  const head = `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away} (${PHASE[game.phase as string] ?? game.phase})`
  if (!rh || !ra) return `${head}. I don't have detailed match stats for this game yet.`
  const line = (r: any) => `${r.team}: ${r.possession ?? '—'}% poss · ${r.shots_total ?? '—'} shots (${r.shots_on_target ?? '—'} on target) · ${r.corners ?? '—'} corners · ${r.fouls ?? '—'} fouls · ${r.yellow_cards ?? 0}Y ${r.red_cards ?? 0}R · ${r.offsides ?? '—'} offside${r.xg != null ? ` · xG ${(+r.xg).toFixed(1)}` : ''}`
  return `${head}:\n${line(rh)}\n${line(ra)}${etPensLine(game) ? '\n' + etPensLine(game).trim() : ''}`  // v26: box score shows ET/pens
}
// v26: ONE stat for ONE game ("how many red cards were there in PSG vs Arsenal?") — the full
// box-score dump is reserved for "stats"-type asks.
async function gameStatSingle(sb: Sb, a: string, b: string, dim: string): Promise<string> {
  const game = await findGame(sb, a, b)
  if (!game || game.score_home === null) return `I couldn't find a completed game between ${a} and ${b}.`
  const { data } = await sb.from('game_team_stats').select('team, possession, shots_total, shots_on_target, corners, fouls, yellow_cards, red_cards, offsides, xg').eq('game_id', game.id)
  const rows = data ?? []
  const rh = rows.find((r) => r.team === game.team_home), ra = rows.find((r) => r.team === game.team_away)
  const head = `${game.team_home} ${game.score_home}-${game.score_away} ${game.team_away} (${PHASE[game.phase as string] ?? game.phase})`
  if (!rh || !ra) return `${head}. I don't have detailed match stats for this game yet.`
  const pick = (r: any): string => {
    switch (dim) {
      case 'red': { const n = r.red_cards ?? 0; return `${n} red card${n === 1 ? '' : 's'}` }
      case 'yellow': { const n = r.yellow_cards ?? 0; return `${n} yellow card${n === 1 ? '' : 's'}` }
      case 'cards': return `${r.yellow_cards ?? 0} yellow, ${r.red_cards ?? 0} red`
      case 'corners': return `${r.corners ?? 0} corners`
      case 'fouls': return `${r.fouls ?? 0} fouls`
      case 'possession': return `${r.possession ?? '—'}% possession`
      default: return `${r.shots_total ?? 0} shots (${r.shots_on_target ?? 0} on target)`
    }
  }
  return `${head}: ${game.team_home} ${pick(rh)} · ${game.team_away} ${pick(ra)}.${etPensLine(game)}`
}
// v26: how many PLAYERS have scored / been booked / sent off — tournament-wide player counts
// (used to dump the nearest stat card instead of answering the count).
async function playerCount(sb: Sb, dim: string): Promise<string> {
  const col = dim === 'red' ? 'total_red_cards' : dim === 'yellow' ? 'total_yellow_cards' : dim === 'assists' ? 'total_assists' : dim === 'cards' ? 'total_yellow_cards' : 'total_goals'
  const noun = dim === 'red' ? 'received a red card' : dim === 'yellow' ? 'picked up a yellow card' : dim === 'assists' ? 'recorded an assist' : dim === 'cards' ? 'been booked' : 'scored'
  const { count } = await sb.from('player_tournament_stats').select('player_name', { count: 'exact', head: true }).gt(col, 0).gt('games_played', 0)
  if (dim === 'cards') {
    const { count: reds } = await sb.from('player_tournament_stats').select('player_name', { count: 'exact', head: true }).gt('total_red_cards', 0).gt('games_played', 0)
    return `${count ?? 0} players have been booked (yellow) and ${reds ?? 0} ${(reds ?? 0) === 1 ? 'has' : 'have'} been sent off in the tournament so far.`
  }
  return `${count ?? 0} player${(count ?? 0) === 1 ? ' has' : 's have'} ${noun} in the tournament so far.`
}
// v27: ODDS — game odds (Bet365, sync-odds EF) for a named/next game, and champion
// outright odds (William Hill). The UI shows both; the bot had ZERO odds tools.
async function gameOddsAnswer(sb: Sb, teams: string[]): Promise<string> {
  let g: any = null
  if (teams.length >= 2) g = await findGame(sb, teams[0], teams[1])
  else if (teams.length === 1) g = (await sb.from('games').select('id, team_home, team_away, phase, kick_off_time').or(`team_home.eq.${teams[0]},team_away.eq.${teams[0]}`).is('score_home', null).gt('kick_off_time', new Date().toISOString()).neq('phase', 'friendly').order('kick_off_time', { ascending: true }).limit(1)).data?.[0]
  else g = (await sb.from('games').select('id, team_home, team_away, phase, kick_off_time').is('score_home', null).gt('kick_off_time', new Date().toISOString()).neq('phase', 'friendly').neq('team_home', 'TBD').order('kick_off_time', { ascending: true }).limit(1)).data?.[0]
  if (!g) return `I couldn't find an upcoming game for that — odds only exist for unplayed fixtures.`
  const o = (await sb.from('game_odds').select('home_win, draw, away_win, over_2_5, under_2_5, source').eq('game_id', g.id).limit(1)).data?.[0]
  const head = `${g.team_home} vs ${g.team_away} (${PHASE[g.phase as string] ?? g.phase}, ${fmtKO(g.kick_off_time as string)})`
  if (!o) return `${head}: no odds yet — Bet365 odds appear in the ~3 days before kickoff.`
  return `${head} — ${o.source ?? 'Bet365'} odds: ${g.team_home} ${o.home_win} · Draw ${o.draw} · ${g.team_away} ${o.away_win}${o.over_2_5 != null ? ` · Over 2.5 ${o.over_2_5} / Under 2.5 ${o.under_2_5}` : ''}.`
}
async function championOddsAnswer(sb: Sb, teams: string[]): Promise<string> {
  const { data } = await sb.from('champion_odds').select('team_name, odds, bookmaker').order('odds', { ascending: true })
  const rows = (data ?? []) as any[]
  if (!rows.length) return 'No champion odds are available yet.'
  if (teams.length) { const r = rows.find((x) => x.team_name === teams[0]); return r ? `${r.team_name} are ${r.odds} to win the World Cup (${r.bookmaker}).` : `I don't have champion odds for ${teams[0]}.` }
  return `Favourites to win the World Cup (${rows[0].bookmaker} outright odds):\n` + rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.team_name} — ${r.odds}`).join('\n')
}
// v27: TOURNAMENT groups A-L ("group D standings") — computed from games.group_name.
// These collided with FRIEND-group boards before (wrong-tool answers).
// v29: sourced from `teams.group_name` (clean, exactly 4 teams per WC group) instead of
// `games.group_name` — on DEV the games table ALSO tags 52 unrelated club test games as
// group 'A' (dev test-data corpus, left in place on purpose — see memory
// dev-data-scope-decision.md), so the old query returned a 57-row table for a 4-team group.
// This is the durable fix that memory prescribed: join to `teams`, never filter by a raw
// `games` column. `only` answers "who finished 1st/last" with one row instead of the table.
async function tournamentGroupTable(sb: Sb, letter: string, only?: 'first' | 'last'): Promise<string> {
  const L = letter.toUpperCase()
  const { data: teamRows } = await sb.from('teams').select('name').eq('group_name', L).not('is_tbd', 'is', true)
  const teamNames = (teamRows ?? []).map((t: any) => t.name as string)
  if (!teamNames.length) return `I don't have games for World Cup Group ${L}.`
  const { data } = await sb.from('games').select('team_home, team_away, score_home, score_away, kick_off_time').in('team_home', teamNames).in('team_away', teamNames).eq('phase', 'group')
  const rows = (data ?? []) as any[]
  const table = new Map<string, { p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }>()
  for (const t of teamNames) table.set(t, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })
  const now = new Date()
  for (const g of rows) {
    if (g.score_home === null || new Date(g.kick_off_time) > now) continue
    const h = table.get(g.team_home), a = table.get(g.team_away)
    if (!h || !a) continue
    h.p++; a.p++; h.gf += g.score_home; h.ga += g.score_away; a.gf += g.score_away; a.ga += g.score_home
    if (g.score_home > g.score_away) { h.w++; h.pts += 3; a.l++ } else if (g.score_home < g.score_away) { a.w++; a.pts += 3; h.l++ } else { h.d++; a.d++; h.pts++; a.pts++ }
  }
  const ranked = [...table.entries()].sort((x, y) => y[1].pts - x[1].pts || (y[1].gf - y[1].ga) - (x[1].gf - x[1].ga) || y[1].gf - x[1].gf)
  const rowText = (s: any) => `${s.pts} pts (${s.w}W ${s.d}D ${s.l}L, ${s.gf}-${s.ga})`
  if (only === 'first') {
    const top = ranked[0][1].pts, leaders = ranked.filter(([, s]) => s.pts === top)
    if (leaders.length === 1) { const [t, s] = leaders[0]; return `${t} is currently 1st in World Cup Group ${L}: ${rowText(s)}` }
    return `Tied for 1st in World Cup Group ${L}: ` + leaders.map(([t, s]) => `${t} (${rowText(s)})`).join(', ')
  }
  if (only === 'last') {
    const bottom = ranked[ranked.length - 1][1].pts, trailers = ranked.filter(([, s]) => s.pts === bottom)
    if (trailers.length === 1) { const [t, s] = trailers[0]; return `${t} is currently last in World Cup Group ${L}: ${rowText(s)}` }
    return `Tied for last in World Cup Group ${L}: ` + trailers.map(([t, s]) => `${t} (${rowText(s)})`).join(', ')
  }
  return `World Cup Group ${L}:\n` + ranked.map(([t, s], i) => `${i + 1}. ${t} — ${rowText(s)}`).join('\n')
}
// v27: recent form — last N finished games as a W/D/L strip ("how is Argentina doing?",
// "last 5 games"). 90-min result shown; * marks games decided after ET/pens.
async function recentForm(sb: Sb, team: string, n: number): Promise<string> {
  const { data } = await sb.from('games').select('team_home, team_away, score_home, score_away, phase, kick_off_time, knockout_winner, went_to_extra_time, went_to_penalties').or(`team_home.eq.${team},team_away.eq.${team}`).not('score_home', 'is', null).neq('phase', 'friendly').lte('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: false }).limit(Math.max(1, Math.min(n, 10)))
  const rows = (data ?? []) as any[]
  if (!rows.length) return `I don't have any completed games for ${team} yet.`
  const line = (g: any) => {
    const home = g.team_home === team
    const gf = home ? g.score_home : g.score_away, ga = home ? g.score_away : g.score_home
    let res = gf > ga ? 'W' : gf < ga ? 'L' : 'D'
    if (gf === ga && g.knockout_winner) res = g.knockout_winner === team ? 'W*' : 'L*'
    return { res, txt: `${res} ${gf}-${ga} vs ${home ? g.team_away : g.team_home} (${PHASE[g.phase as string] ?? g.phase})` }
  }
  const ls = rows.map(line)
  return `${team} — last ${rows.length} game${rows.length === 1 ? '' : 's'} (most recent first): ${ls.map((l) => l.res).join(' ')}\n` + ls.map((l) => '• ' + l.txt).join('\n') + (ls.some((l) => l.res.includes('*')) ? '\n(* decided after extra time/penalties — 90-min result shown)' : '')
}

// v29: trivia coverage — total question count, open window, "is there one today", and the
// caller's own trivia score. Previously NONE of this had a tool: the bot guessed a hardcoded
// date range in prose ("starts June 11") that was already stale (the real seed's earliest
// live question is 2026-05-25), and a rulesFAQ line that answered the POINT VALUE regardless
// of what was actually asked. Everything here is queried live — never a memorized date.
async function triviaInfo(sb: Sb, kind: 'count' | 'today' | 'window'): Promise<string> {
  // v29 fix (found live): 'window' needs no DB data at all — check it BEFORE the query so it
  // never depends on trivia_questions being readable.
  // v30: this used to state ONLY the 40-second answer countdown — never the separate fact that
  // each day's question stays OPEN for a full 24h (22:00 Israel to 22:00 Israel the next day)
  // before the next one replaces it. Verified: available_until - available_from = exactly 1
  // day on every trivia_questions row, and the app's own Trivia.jsx UI already states "24h
  // window" — the bot just never had the fact.
  if (kind === 'window') return "Each day's trivia question opens at 22:00 Israel time and stays open for 24 hours, until 22:00 Israel the next day. But once you open it, you only get 40 seconds to answer — one shot, no retries, miss it and it counts as wrong."
  // v29 fix (found live): trivia_questions RLS is `authenticated` + `available_from <= now()`
  // ONLY — an anon caller (or a question about ALL 40-ish questions, most still locked) gets
  // ZERO rows via the public/user client. The count/window/today FACTS here (never the actual
  // question text or options) are meant to be public, so this reads via the SERVICE-role
  // client — same privilege tier already used for reindex, nothing new is exposed.
  // '[TEST' rows are dev scaffolding, never real tournament questions — matched by PREFIX,
  // not a bare "test" substring (which also matches "fastest", a real question's own word).
  const { data } = await sb.from('trivia_questions').select('available_from, available_until').not('question_text', 'like', '[TEST%').order('available_from', { ascending: true })
  const rows = (data ?? []) as any[]
  if (!rows.length) return "I don't have the trivia schedule yet."
  if (kind === 'count') return `There ${rows.length === 1 ? 'is' : 'are'} ${rows.length} trivia questions in total — one per day, each open for 40 seconds with one shot to answer.`
  const now = new Date()
  const open = rows.find((r) => new Date(r.available_from as string) <= now && now < new Date(r.available_until as string))
  if (open) return `Yes — today's trivia question is open now, until ${fmtKO(open.available_until as string)}.`
  const next = rows.find((r) => new Date(r.available_from as string) > now)
  if (next) return `Not right now — the next trivia question opens ${fmtKO(next.available_from as string)}.`
  return `No — the trivia window has closed (the last question closed ${fmtKO(rows[rows.length - 1].available_until as string)}).`
}
async function myTriviaScore(sbUser: Sb, me: string): Promise<string> {
  const rows = (must(await sbUser.from('trivia_answers').select('is_correct, points_earned').eq('user_id', me)) ?? []) as any[]
  if (!rows.length) return "You haven't answered any trivia questions yet."
  const correct = rows.filter((r) => r.is_correct).length
  const points = rows.reduce((s, r) => s + (r.points_earned ?? 0), 0)
  return `You've answered ${rows.length} trivia question${rows.length === 1 ? '' : 's'}, ${correct} correct. Trivia points are banked silently and only appear on the leaderboard after the last question closes — you have ${points} pt${points === 1 ? '' : 's'} waiting.`
}

// v29: tournament-wide card totals. This used to have NO deterministic path — "how many red
// cards in the tournament?" fell through to the RAG crew, which fabricated "there have been
// 0 red cards" (truth: 13) because its old grounding check only asked "does this digit appear
// ANYWHERE in the facts?", and every player card contains "0 yellow, 0 red". A SUM() must
// never reach a similarity search: RAG describes, SQL counts.
async function cardsTotal(sb: Sb, color: 'red' | 'yellow' | 'both'): Promise<string> {
  const rows = (must(await sb.from('game_team_stats').select('red_cards, yellow_cards')) ?? []) as any[]
  const red = rows.reduce((s, r) => s + (r.red_cards ?? 0), 0)
  const yellow = rows.reduce((s, r) => s + (r.yellow_cards ?? 0), 0)
  if (color === 'red') return `There have been ${red} red card${red === 1 ? '' : 's'} in the tournament so far.`
  if (color === 'yellow') return `There have been ${yellow} yellow card${yellow === 1 ? '' : 's'} in the tournament so far.`
  return `There have been ${yellow} yellow card${yellow === 1 ? '' : 's'} and ${red} red card${red === 1 ? '' : 's'} in the tournament so far.`
}

// v29: public top-scorer PICK CANDIDATES — "who can I pick as top scorer?" had no tool at
// all and used to fall into the private my_data path, which refused anonymous/misrouted
// callers ("Please sign in") for what is genuinely public information.
async function topScorerCandidates(sb: Sb, team: string | null): Promise<string> {
  if (team) {
    const rows = (must(await sb.from('top_scorer_candidates').select('name').eq('is_active', true).eq('team_name', team).order('name', { ascending: true }).limit(40)) ?? []) as any[]
    if (!rows.length) return `I don't have top-scorer candidates listed for ${team}.`
    return `Top-scorer candidates for ${team}: ` + rows.map((r) => r.name).join(', ') + '.'
  }
  const { count } = await sb.from('top_scorer_candidates').select('id', { count: 'exact', head: true }).eq('is_active', true)
  return `You can pick any player from the full tournament squads as your Top Scorer${count ? ` — ${count} candidates across all 48 teams` : ''}. Search by name or team in the Picks tab.`
}

// v23: list / count the finished games that went to penalties or extra time (from the
// went_to_* flags). "Which games went to pens" used to fall into the fixtures list.
async function etPensList(sb: Sb, q: string): Promise<string> {
  const s = q.toLowerCase()
  const wantPens = /penalt|shoot.?out/.test(s)
  const col = wantPens ? 'went_to_penalties' : 'went_to_extra_time'
  // v26: friendlies are included but labeled — "which games went to pens" answered "none"
  // while the PSG-Arsenal friendly had a 4-3 shootout sitting right there in the flags.
  const { data } = await sb.from('games').select('team_home, team_away, score_home, score_away, phase, kick_off_time, went_to_extra_time, went_to_penalties, et_score_home, et_score_away, penalty_score_home, penalty_score_away, knockout_winner').eq(col, true).not('score_home', 'is', null).order('kick_off_time', { ascending: true })
  const rows = data ?? []
  const label = wantPens ? 'penalties' : 'extra time'
  const wc = rows.filter((g) => g.phase !== 'friendly'), fr = rows.filter((g) => g.phase === 'friendly')
  const fmt = (g: any) => `• ${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase})${etPensLine(g)}`
  if (!wc.length) return `No World Cup games have gone to ${label} yet.` + (fr.length ? `\nFriendlies that did:\n` + fr.map(fmt).join('\n') : '')
  const extra = fr.length ? `\nFriendlies too:\n` + fr.map(fmt).join('\n') : ''
  if (/how many|how much|number of|\bcount\b/.test(s)) return `${wc.length} World Cup game${wc.length === 1 ? ' has' : 's have'} gone to ${label} so far:\n${wc.map(fmt).join('\n')}${extra}`
  return `World Cup games that went to ${label}:\n${wc.map(fmt).join('\n')}${extra}`
}

// v30: a penalty KICK in REGULAR TIME (scored or missed) is a different fact from a penalty
// SHOOTOUT — "how many games had a penalty in regular time / 90 min?" used to fall into
// etPensList's went_to_penalties (shootout) flag and answer about shootouts instead. game_events
// already distinguishes them: a scored in-play penalty is event_type='goal' with detail
// containing "Penalty"; a missed one is event_type='missed_penalty'. Shootout kicks are
// pen_shootout_scored/pen_shootout_missed — never counted here. Same phase!=='friendly'
// WC-scoping convention as etPensList above (deliberate DEV club-test-data left as-is).
async function regulationPenaltyList(sb: Sb): Promise<string> {
  const [scoredQ, missedQ] = await Promise.all([
    sb.from('game_events').select('game_id').eq('event_type', 'goal').ilike('detail', '%Penalty%'),
    sb.from('game_events').select('game_id').eq('event_type', 'missed_penalty'),
  ])
  const scored = (scoredQ.data ?? []) as any[], missed = (missedQ.data ?? []) as any[]
  if (!scored.length && !missed.length) return 'No games have had a penalty kick in regular time (90 min) yet.'
  const ids = [...new Set([...scored.map((r) => r.game_id as string), ...missed.map((r) => r.game_id as string)])]
  const games = ((await sb.from('games').select('id, team_home, team_away, score_home, score_away, phase').in('id', ids)).data ?? []) as any[]
  const gmap = new Map(games.map((g) => [g.id, g]))
  const wcIds = ids.filter((id) => gmap.get(id) && gmap.get(id)!.phase !== 'friendly')
  if (!wcIds.length) return 'No World Cup games have had a penalty kick in regular time (90 min) yet.'
  const fmt = (id: string) => {
    const g = gmap.get(id)!
    const sc = scored.filter((r) => r.game_id === id).length, ms = missed.filter((r) => r.game_id === id).length
    return `• ${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase}) — ${sc} scored${ms ? `, ${ms} missed` : ''}`
  }
  return `${wcIds.length} World Cup game${wcIds.length === 1 ? ' has' : 's have'} had a penalty kick in regular time (90 min, not a shootout):\n` + wcIds.map(fmt).join('\n')
}

// private (RLS via user JWT)
type Grp = { id: string; name: string }
async function myGroups(sbUser: Sb, me: string) {
  const gm = must(await sbUser.from('group_members').select('group_id').eq('user_id', me)) ?? []
  const ids = gm.map((r) => r.group_id as string); if (!ids.length) return [] as Grp[]
  const gr = (await sbUser.from('groups').select('id, name').in('id', ids)).data ?? []; return gr.map((g) => ({ id: g.id as string, name: g.name as string }))
}
// v19: resolve a group NAME the caller mentions against their OWN groups only
// (full-name match first, then name tokens; v20 adds typo tolerance). Never sees other users' groups.
// v24: return EVERY group of the caller's that the question names (score-ranked) — so
// "compare my points in alpha wolves vs beta sharks" can scope to both, not just the best one.
function resolveGroupsAll(q: string, groups: Grp[]): Grp[] {
  const norm = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9א-׿֐-׏ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  const ql = norm(q)
  const qtok = ql.trim().split(' ').filter((w) => w.length >= 4)
  const hits: { g: Grp; score: number }[] = []
  for (const g of groups) {
    const nl = norm(g.name).trim(); if (!nl) continue
    let score = 0
    if (ql.includes(' ' + nl + ' ')) score = 100 + nl.length
    else {
      const toks = nl.split(' ').filter((w) => w.length >= 3 && !['the', 'group', 'team'].includes(w))
      score = toks.filter((w) => ql.includes(' ' + w + ' ')).length * 10
      // v26: typo tolerance NEVER substitutes a distinct name — digit-bearing tokens are
      // excluded from the lev pass ("test3" is one edit from "TestA" but is a DIFFERENT
      // group; "alpha wolvs" -> "Alpha Wolves" stays forgiven). The refusal path then
      // fires with the literal candidate instead of silently answering the wrong group.
      if (!score) for (const t of toks) for (const qw of qtok) { const L = lev(t, qw); if (((t.length >= 4 && L === 1) || (t.length >= 6 && L === 2)) && !/\d/.test(t) && !/\d/.test(qw)) { score = 1; break } }
    }
    if (score) hits.push({ g, score })
  }
  return hits.sort((a, b) => b.score - a.score).map((h) => h.g)
}
function resolveGroupName(q: string, groups: Grp[]): Grp | null { return resolveGroupsAll(q, groups)[0] ?? null }
// v20: detect a group NAME the caller referenced that is NOT one of their groups —
// so the bot refuses honestly instead of silently answering about all their groups.
// (accepts common typos of the word "group" itself)
function groupRefCandidate(q: string): string | null {
  const s = ' ' + q.toLowerCase().replace(/[^a-z0-9א-׿֐-׏ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  // v23: any "<words> group" now qualifies (was preposition-anchored only, so "the legends
  // group predictions" slipped through and dumped ALL the caller's groups). Filler tokens
  // are stripped from the front; if nothing meaningful remains it's not a group name.
  const STOP = new Set(['my', 'our', 'your', 'the', 'a', 'an', 'this', 'that', 'his', 'her', 'their', 'its', 'first', 'second', 'third', 'other', 'another', 'new', 'old', 'whole', 'every', 'each', 'any', 'some', 'one', 'same', 'which', 'what', 'whats', 'who', 'whos', 'when', 'why', 'how', 'hows', 'is', 'are', 'was', 'were', 'did', 'do', 'does', 'has', 'have', 'had', 'will', 'would', 'can', 'in', 'of', 'for', 'from', 'about', 'winning', 'leading', 'leads', 'lead', 'wins', 'win', 'best', 'worst', 'top', 'list', 'show', 'and', 'all', 'everyone', 'entire', 'global', 'overall', 'app', 'main', 'current', 'live', 'full', 'complete', 'world', 'worldwide', 'total', 'league', 'points', 'today', 'todays'])
  const NOUN_STOP = new Set(['stage', 'stages', 'prediction', 'predictions', 'member', 'members', 'leaderboard', 'standings', 'standing', 'table', 'board', 'chat', 'rank', 'ranking', 'game', 'games', 'player', 'players', 'team', 'teams', 'scorer', 'scorers', 'trivia', 'bracket', 'champion'])
  // v26: "<Name> leaderboard/standings/table" (no literal word "group") is also a group-name
  // reference — "Beta Sharks leaderboard" was grabbed by the bare global-leaderboard cue.
  const m = s.match(/([a-z0-9א-׿]+(?: [a-z0-9א-׿]+)?)'?s? (?:group|droup|gorup|grup|goup)\b/)
    || s.match(/\b(?:group|droup|gorup|grup|goup) (?:called |named )?([a-z0-9א-׿]+)/)
    || s.match(/([a-z0-9א-׿]+(?: [a-z0-9א-׿]+)?)'?s? (?:leaderboard|standings|table)\b/)
  if (!m) return null
  const toks = m[1].trim().split(' ').filter((w) => !STOP.has(w))
  if (!toks.length || toks.some((w) => NOUN_STOP.has(w))) return null
  // v27: a single letter A-L is a TOURNAMENT group ("group D standings"), never a friend group
  if (toks.length === 1 && /^[a-l]$/.test(toks[0])) return null
  return toks.join(' ')
}
function unknownGroupAnswer(name: string, groups: Grp[]): string {
  return `I can only show data for groups you're a member of${groups.length ? ` — yours are ${groups.map((g) => g.name).join(', ')}` : ''}. "${name}" isn't one of them, and other groups' boards, members and predictions are private to their members.`
}
// v20: group-mates roster (usernames) across the caller's groups — RLS-scoped.
async function myGroupMembers(sbUser: Sb, gids: string[]): Promise<{ id: string; username: string }[]> {
  if (!gids.length) return []
  const gm = (await sbUser.from('group_members').select('user_id').in('group_id', gids)).data ?? []
  const ids = [...new Set(gm.map((r) => r.user_id as string))]; if (!ids.length) return []
  const pr = (await sbUser.from('profiles').select('id, username').in('id', ids)).data ?? []
  return pr.map((p) => ({ id: p.id as string, username: p.username as string }))
}
// v20: resolve a group-MATE's username mentioned in the question (typo-tolerant).
function resolveMemberName(q: string, members: { id: string; username: string }[]): { id: string; username: string } | null {
  const ql = ' ' + q.toLowerCase().replace(/[^a-z0-9_א-׿ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  const qtok = ql.trim().split(' ').filter((w) => w.length >= 3)
  let best: { m: { id: string; username: string }; score: number } | null = null
  for (const m of members) {
    const un = m.username.toLowerCase()
    let score = 0
    if (ql.includes(' ' + un + ' ')) score = 100
    else {
      const toks = [un, ...un.split(/[_\d]+/).filter((w) => w.length >= 4)]
      for (const t of toks) for (const qw of qtok) { const L = lev(t, qw); if ((t.length >= 4 && L <= 1) || (t.length >= 7 && L <= 2)) score = Math.max(score, 10 - L) }
    }
    if (score && (!best || score > best.score)) best = { m, score }
  }
  return best?.m ?? null
}
// v20: resolve a game from teams / a phase word / "the last game" (relative ref).
async function resolveGameRef(sb: Sb, q: string, teams: string[], phase: string | null): Promise<any | null> {
  const COLS = 'id, team_home, team_away, score_home, score_away, phase, kick_off_time'
  if (teams.length >= 2) return await findGame(sb, teams[0], teams[1])
  if (phase) return (await sb.from('games').select(COLS).eq('phase', phase).neq('team_home', 'TBD').order('kick_off_time', { ascending: false }).limit(1)).data?.[0] ?? null
  // v24: a named team wins over the generic "last game" — "Argentina's last game" must be
  // Argentina's most recent finished game, not the tournament's.
  if (teams.length === 1) return (await sb.from('games').select(COLS).or(`team_home.eq.${teams[0]},team_away.eq.${teams[0]}`).not('score_home', 'is', null).neq('phase', 'friendly').lte('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: false }).limit(1)).data?.[0] ?? null
  if (/last (game|match)|latest (game|match)|most recent (game|match)|yesterday'?s? (game|match)/i.test(q))
    return (await sb.from('games').select(COLS).not('score_home', 'is', null).neq('phase', 'friendly').neq('team_home', 'TBD').lte('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: false }).limit(1)).data?.[0] ?? null
  return null
}
// v20: one group-mate's prediction for one game — RLS decides visibility, the
// MESSAGE explains it (pre-kickoff = hidden for everyone; otherwise group-mates only).
async function memberPrediction(sbUser: Sb, meId: string, member: { id: string; username: string }, game: any): Promise<string> {
  if (!game) return `I couldn't work out which game you mean — name the two teams, e.g. "what did ${member.username} predict for Portugal vs United States?"`
  const started = new Date(game.kick_off_time as string) <= new Date()
  if (!started) return `${game.team_home} vs ${game.team_away} hasn't kicked off yet — ALL predictions stay hidden until kickoff (including ${member.username}'s). Ask me again after the whistle!`
  const { data: preds } = await sbUser.from('predictions').select('pred_home, pred_away, points_earned, is_auto').eq('game_id', game.id).eq('user_id', member.id)
  if (!preds || !preds.length) return `I can't show ${member.username}'s prediction for ${game.team_home} vs ${game.team_away} — you can only see predictions of people who share a group with you, and only after kickoff.`
  const fin = game.score_home !== null && started  // v24: never show a not-yet-kicked-off game's (dev-quirk) score
  return `${game.team_home} ${fin ? `${game.score_home}-${game.score_away}` : 'vs'} ${game.team_away} — ${member.username} predicted ` +
    preds.map((p) => `${p.pred_home}-${p.pred_away}${p.is_auto ? ' (auto)' : ''}${fin ? ` [${p.points_earned}pt]` : ''}`).join(', ') + '.'
}
// v20: group META — real data (member count / list / captain) for the caller's groups.
async function groupMeta(sbUser: Sb, meId: string, scope: Grp[], q: string): Promise<string> {
  if (!scope.length) return `You're not in any group yet.`
  const blocks: string[] = []
  for (const g of scope) {
    const gm = (await sbUser.from('group_members').select('user_id').eq('group_id', g.id)).data ?? []
    const ids = gm.map((r) => r.user_id as string)
    const prs = ids.length ? (((await sbUser.from('profiles').select('id, username').in('id', ids)).data) ?? []) : []
    const cap = (await sbUser.from('groups').select('created_by').eq('id', g.id).limit(1)).data?.[0]?.created_by
    if (/captain|admin|owner|creator/.test(q)) { const c = prs.find((p: any) => p.id === cap); blocks.push(`${g.name}: the captain is ${c ? (c as any).username : 'unknown'}.`); continue }
    const names = prs.map((p: any) => p.username + (p.id === cap ? ' (captain)' : '') + (p.id === meId ? ' (you)' : ''))
    blocks.push(`${g.name}: ${ids.length} member${ids.length === 1 ? '' : 's'} — ${names.join(', ')}.`)
  }
  return blocks.join('\n')
}
// v20: LLM UNDERSTANDING FALLBACK [L] — parses the QUESTION TEXT ONLY (never any DB
// data) into a structured spec when the deterministic parse is ambiguous. Execution
// of the parsed spec stays 100% deterministic (execUnderstood -> SQL + templates).
async function llmUnderstand(openai: OpenAI, question: string, groupNames: string[], memberNames: string[], partial?: string): Promise<any | null> {
  try {
    const sys = `Parse a WorldCup-predictions-app question into JSON with fields: asks (one of: member_prediction, group_board, group_meta, my_stats, schedule, game_stat, leaderboard, other), group (a group name mentioned, else null), member (a person/username mentioned, else null), teams (array of football team names mentioned, else []), game_ref ("last"|"final"|null), stat ("exact"|"rank"|"points"|"picks"|null). The asker's groups: ${groupNames.join(', ') || '(none)'}. Their group-mates' usernames: ${memberNames.join(', ') || '(none)'}. Map typos/nicknames to those known names when clearly intended; if a mentioned group is NOT in the list, still return it verbatim.${partial ? ` A deterministic parser already found: ${partial} — keep those unless the question clearly overrides them.` : ''} Output ONLY the JSON object.`
    assertPublicPayload('llmUnderstand', sys, question)  // v29 V0: names only, never DB rows
    const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0, seed: 7, max_tokens: 160, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: sys },
      { role: 'user', content: question },
    ] })
    return JSON.parse(res.choices[0]?.message?.content ?? 'null')
  } catch { return null }
}
// v20: deterministic executor for the understood spec — reuses the same private tools.
async function execUnderstood(u: any, d: { question: string; sbPublic: Sb; sbUser: Sb; names: string[] }, meId: string, groups: Grp[], members: { id: string; username: string }[]): Promise<string | null> {
  if (!u || typeof u !== 'object') return null
  // v27: PUBLIC asks execute for everyone (anon included); private asks still need login.
  if (u.asks === 'leaderboard') return await globalStandings(d.sbPublic)
  if (u.asks === 'schedule' || u.asks === 'game_stat') {
    const t = Array.isArray(u.teams) && u.teams.length ? resolveTeams(u.teams.join(' vs '), d.names) : []
    if (u.asks === 'game_stat' && t.length >= 2) return await gameStats(d.sbPublic, t[0], t[1])
    if (u.asks === 'schedule') return await lookupGame(d.sbPublic, t[0] ?? null, detectPhase(d.question))
    return null
  }
  if (!meId && ['member_prediction', 'group_board', 'group_meta', 'my_stats'].includes(u.asks)) return null
  // v24: honor EVERY own-group the question names ("compare my points in alpha wolves vs beta
  // sharks" = both), not just the LLM's single `group` field.
  const matchedAll = resolveGroupsAll(d.question, groups)
  let target = matchedAll.length === 1 ? matchedAll[0] : (u.group ? resolveGroupName(' ' + String(u.group) + ' ', groups) : null)
  if (matchedAll.length >= 2) target = null
  const scope = matchedAll.length ? matchedAll : groups
  if (u.group && !matchedAll.length && !target) return unknownGroupAnswer(String(u.group), groups)
  const member = u.member ? (resolveMemberName(' ' + String(u.member) + ' ', members) ?? resolveMemberName(d.question, members)) : null
  const teams = Array.isArray(u.teams) && u.teams.length ? resolveTeams(u.teams.join(' vs '), d.names) : []
  // v24: "who has more points, me or X?" — a member + points/rank ask is a STANDINGS
  // comparison, never a prediction lookup.
  if (member && member.id !== meId && (u.stat === 'points' || u.stat === 'rank' || /more points|beating|ahead of|who has more|who leads/.test(d.question.toLowerCase())))
    return await groupStandings(d.sbUser, meId, false, scope, target)
  if (u.asks === 'member_prediction' || (member && member.id !== meId)) {
    const game = await resolveGameRef(d.sbPublic, `${u.game_ref === 'last' ? 'last game' : ''} ${d.question}`, teams, u.game_ref === 'final' ? 'final' : detectPhase(d.question))
    if (member && member.id !== meId) return await memberPrediction(d.sbUser, meId, member, game)
    if (game) return await groupHistory(d.sbPublic, d.sbUser, meId, game.team_home as string, game.team_away as string, target)
    return null
  }
  if (u.asks === 'group_meta') return await groupMeta(d.sbUser, meId, target ? [target] : scope, d.question.toLowerCase())
  if (u.asks === 'group_board') return await groupStandings(d.sbUser, meId, /exact/i.test(d.question), scope, target)
  if (u.asks === 'my_stats') {
    if (u.stat === 'exact') return await myExact(d.sbPublic, d.sbUser, meId, scope, target)
    if (u.stat === 'rank' || u.stat === 'points' || u.stat === 'picks') return await myFocus(d.sbUser, meId, scope, target, u.stat)
    return await myContext(d.sbUser, meId, scope, target)
  }
  return null
}
async function myContext(sbUser: Sb, me: string, all: Grp[], target: Grp | null = null): Promise<string> {
  if (!all.length) return `You're not in any group yet.`
  const groups = target ? [target] : all
  const lines: string[] = []
  for (const g of groups) { const { data: rows } = await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id }); const mine = (rows ?? []).find((r: any) => r.user_id === me)
    lines.push(mine ? `${g.name}: #${mine.group_rank} (global #${mine.global_rank}), ${mine.total_points} pts, ${mine.exact_scores} exact — champion ${mine.champion_team ?? '—'}, top scorer ${mine.top_scorer_player ?? '—'}` : `${g.name}: no ranking yet.`) }
  return (target ? '' : `You're in ${groups.length} group${groups.length === 1 ? '' : 's'}:\n`) + lines.join('\n')
}
// v19: focused my_data sub-answers (rank / points / picks), optionally group-scoped.
async function myFocus(sbUser: Sb, me: string, all: Grp[], target: Grp | null, kind: 'rank' | 'points' | 'picks'): Promise<string> {
  if (!all.length) return `You're not in any group yet.`
  const lines: string[] = []
  for (const g of target ? [target] : all) {
    const rows = ((await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })).data ?? []) as any[]
    const mine = rows.find((r) => r.user_id === me)
    if (!mine) { lines.push(`${g.name}: no ranking yet.`); continue }
    if (kind === 'rank') lines.push(`${g.name}: you're #${mine.group_rank} of ${rows.length} (global #${mine.global_rank}).`)
    else if (kind === 'points') lines.push(`${g.name}: ${mine.total_points} pts (${mine.exact_scores} exact score${mine.exact_scores === 1 ? '' : 's'}).`)
    else lines.push(`${g.name}: champion ${mine.champion_team ?? '—'}, top scorer ${mine.top_scorer_player ?? '—'}.`)
  }
  return lines.join('\n')
}
// v19: exact-score drill-down — the count AND which games, optionally group-scoped.
async function myExact(sbPublic: Sb, sbUser: Sb, me: string, all: Grp[], target: Grp | null): Promise<string> {
  let q = sbUser.from('predictions').select('game_id, group_id').eq('user_id', me).eq('points_earned', 3)
  if (target) q = q.eq('group_id', target.id)
  const rows = must(await q) ?? []
  if (!rows.length) return target ? `No exact scores in ${target.name} yet — keep predicting!` : `You have no exact scores yet — keep predicting!`
  const ids = [...new Set(rows.map((r) => r.game_id as string))]
  const games = ((await sbPublic.from('games').select('id, team_home, team_away, score_home, score_away, phase').in('id', ids)).data ?? []) as any[]
  const gmap = new Map(games.map((g) => [g.id, g]))
  const line = (r: any) => { const g = gmap.get(r.game_id); return g ? `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${PHASE[g.phase as string] ?? g.phase})` : null }
  if (target) return `You have ${rows.length} exact score${rows.length === 1 ? '' : 's'} in ${target.name}:\n` + rows.map(line).filter(Boolean).map((s) => '• ' + s).join('\n')
  const gname = new Map(all.map((g) => [g.id, g.name]))
  const byG = new Map<string, any[]>()
  for (const r of rows) { const k = (r.group_id as string) ?? 'solo'; if (!byG.has(k)) byG.set(k, []); byG.get(k)!.push(r) }
  return 'Your exact scores:\n' + [...byG.entries()].map(([gid, rs]) => `${gname.get(gid) ?? 'Personal'}: ${rs.length} — ` + rs.map(line).filter(Boolean).join(', ')).join('\n')
}
async function groupStandings(sbUser: Sb, me: string, mostExact: boolean, all: Grp[], target: Grp | null = null): Promise<string> {
  if (!all.length) return `You're not in any group yet — ask me "who's winning overall" for the global leaderboard.`
  const groups = target ? [target] : all
  const blocks: string[] = []
  for (const g of groups) { const rows = (must(await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })) ?? []) as any[]; if (!rows.length) { blocks.push(`${g.name}: (no members)`); continue }
    if (mostExact) { const t = [...rows].sort((a, b) => b.exact_scores - a.exact_scores)[0]; blocks.push(`${g.name}: most exact — ${t.username} (${t.exact_scores} exact, ${t.total_points} pts).`) }
    else blocks.push(`${g.name}: ` + [...rows].sort((a, b) => a.group_rank - b.group_rank).slice(0, 5).map((r) => `#${r.group_rank} ${r.username} ${r.total_points}pts${r.user_id === me ? ' (you)' : ''}`).join(', ')) }
  return blocks.join('\n')
}
// v27: MY knockout bracket — picks by round + live points via fn_knockout_points.
async function myBracket(sbUser: Sb, me: string): Promise<string> {
  const picks = (must(await sbUser.from('knockout_pick').select('round, team').eq('user_id', me)) ?? []) as any[]
  if (!picks.length) return `You haven't filled the knockout bracket ("Road to Final", Picks tab). It locked July 4, 20:00 Israel, so new entries are closed.`
  const pts = (await sbUser.rpc('fn_knockout_points', { p_user: me })).data
  const by = (r: string) => picks.filter((p) => p.round === r).map((p) => p.team).join(', ') || '—'
  return `Your knockout bracket: ${pts ?? 0} pts so far (max 83; folds into the leaderboard from July 20).\nQF: ${by('qf')}\nSF: ${by('sf')}\nFinal: ${by('final')}\n3rd-4th: ${by('third')}\nChampion: ${by('champion')} · 3rd-place winner: ${by('third_winner')}`
}
// v27: exact% / hit% / streak — the "My Stats" numbers the intent examples promised but
// no tool implemented (they used to fall to a generic summary).
// v29: the actual rate computation is extracted into `ratesFor` (per single group id, or
// null = combined across all groups) so `myBestGroup` below can call it once per group and
// compare — myRates itself is now a one-line wrapper.
async function ratesFor(sbPublic: Sb, sbUser: Sb, me: string, groupId: string | null): Promise<{ total: number; exact: number; hit: number; streak: number; hot: boolean; bestHot: number; bestCold: number } | null> {
  let pq = sbUser.from('predictions').select('game_id, group_id, points_earned').eq('user_id', me)
  if (groupId) pq = pq.eq('group_id', groupId)
  const preds = (must(await pq) ?? []) as any[]
  if (!preds.length) return null
  const ids = [...new Set(preds.map((r) => r.game_id as string))]
  const games = ((await sbPublic.from('games').select('id, kick_off_time, score_home').in('id', ids)).data ?? []) as any[]
  const now = new Date()
  const finished = new Map(games.filter((g) => g.score_home !== null && new Date(g.kick_off_time) <= now).map((g) => [g.id, g.kick_off_time as string]))
  const scored = preds.filter((p) => finished.has(p.game_id))
  if (!scored.length) return null
  const total = scored.length, exact = scored.filter((p) => p.points_earned === 3).length, hit = scored.filter((p) => (p.points_earned ?? 0) > 0).length
  const ordered = [...scored].sort((a, b) => String(finished.get(b.game_id)).localeCompare(String(finished.get(a.game_id))))
  const hot = (ordered[0]?.points_earned ?? 0) > 0
  let streak = 0
  for (const p of ordered) { const h = (p.points_earned ?? 0) > 0; if (h === hot) streak++; else break }
  // v30: LONGEST historical run of each kind — "my best positive/hot streak" used to always
  // answer with `streak`/`hot` above (the CURRENT trailing run, i.e. whatever state the user's
  // MOST RECENT game happened to be in), which is a cold streak whenever that game was a miss,
  // regardless of what the question actually asked for. Confirmed live: "what is my best
  // positive streak?" answered "Cold streak: 33 scored games without points."
  let bestHot = 0, bestCold = 0, run = 0, runHot: boolean | null = null
  for (const p of ordered) {
    const h = (p.points_earned ?? 0) > 0
    run = h === runHot ? run + 1 : 1
    runHot = h
    if (h) bestHot = Math.max(bestHot, run); else bestCold = Math.max(bestCold, run)
  }
  return { total, exact, hit, streak, hot, bestHot, bestCold }
}
function fmtRates(label: string, r: { total: number; exact: number; hit: number; streak: number; hot: boolean; bestHot: number; bestCold: number }, want: 'current' | 'hot' | 'cold' = 'current'): string {
  const base = `${label}Exact ${Math.round((r.exact / r.total) * 100)}% (${r.exact}/${r.total}) · Hit ${Math.round((r.hit / r.total) * 100)}% (${r.hit}/${r.total})`
  if (want === 'hot') return `${base} · 🔥 Best hot streak: ${r.bestHot} scored game${r.bestHot === 1 ? '' : 's'} in a row with points.`
  if (want === 'cold') return `${base} · 🧊 Worst cold streak: ${r.bestCold} scored game${r.bestCold === 1 ? '' : 's'} in a row without points.`
  return `${base} · ${r.hot ? '🔥 Hot' : '🧊 Cold'} streak: ${r.streak} scored game${r.streak === 1 ? '' : 's'} ${r.hot ? 'in the points' : 'without points'}.`
}
// v30: `want` reads the actual streak DIRECTION asked for ("positive/hot/winning" vs
// "negative/cold/losing streak") — default 'current' preserves today's bare-"streak" behavior.
function streakWant(ql: string): 'current' | 'hot' | 'cold' {
  if (/positive|hot streak|winning streak/.test(ql)) return 'hot'
  if (/negative|cold streak|losing streak/.test(ql)) return 'cold'
  return 'current'
}
async function myRates(sbPublic: Sb, sbUser: Sb, me: string, all: Grp[], target: Grp | null, want: 'current' | 'hot' | 'cold' = 'current'): Promise<string> {
  const r = await ratesFor(sbPublic, sbUser, me, target ? target.id : null)
  if (!r) return 'You have no scored predictions yet.'
  return fmtRates(target ? target.name + ' — ' : '', r, want)
}
// v29: "in which of my groups do I have the best streak?" used to call myRates with
// target=null, which combines ALL groups into one rate and names none of them — the exact
// bug reported. This computes each group's rate separately and names the best one. `by:'rank'`
// answers a "which group am I doing best in" framing using leaderboard position instead.
async function myBestGroup(sbUser: Sb, sbPublic: Sb, me: string, all: Grp[], by: 'rate' | 'rank'): Promise<string> {
  if (!all.length) return `You're not in any group yet.`
  if (all.length === 1) return by === 'rate' ? await myRates(sbPublic, sbUser, me, all, all[0]) : await myFocus(sbUser, me, all, all[0], 'rank')
  if (by === 'rank') {
    const rows = await Promise.all(all.map(async (g) => {
      const r = ((await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })).data ?? []) as any[]
      const mine = r.find((x) => x.user_id === me)
      return mine ? { g, rank: mine.group_rank as number, of: r.length, global: mine.global_rank as number } : null
    }))
    const withData = rows.filter((r): r is NonNullable<typeof r> => !!r)
    if (!withData.length) return `You don't have a ranking in any group yet.`
    const best = withData.reduce((a, b) => b.rank < a.rank ? b : a)
    return `You're doing best in ${best.g.name}: #${best.rank} of ${best.of} (global #${best.global}).`
  }
  const per = await Promise.all(all.map(async (g) => ({ g, r: await ratesFor(sbPublic, sbUser, me, g.id) })))
  const withData = per.filter((p): p is { g: Grp; r: NonNullable<typeof p.r> } => !!p.r)
  if (!withData.length) return 'You have no scored predictions yet in any group.'
  const best = withData.reduce((a, b) => (b.r.exact / b.r.total) > (a.r.exact / a.r.total) ? b : a)
  return fmtRates(`You're doing best in ${best.g.name}: `, best.r)
}
// v27: REVERSE pick lookup — "who picked France as champion in my group?" used to return
// the CALLER's own picks. Post-lock picks are public leaderboard data.
async function whoPicked(sbUser: Sb, q: string, groups: Grp[], names: string[], target: Grp | null): Promise<string> {
  if (!groups.length) return `You're not in any group yet.`
  const ql = q.toLowerCase()
  const wantScorer = /top scorer|golden boot|\bscorer\b/.test(ql) && !/champion/.test(ql)
  const teams = resolveTeams(q, names)
  const blocks: string[] = []
  for (const g of target ? [target] : groups) {
    const rows = (must(await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })) ?? []) as any[]
    if (!rows.length) { blocks.push(`${g.name}: (no members)`); continue }
    if (wantScorer) blocks.push(`${g.name}: ` + rows.map((r) => `${r.username} → ${r.top_scorer_player ?? '—'}`).join(', '))
    else if (teams.length) { const hit = rows.filter((r) => r.champion_team === teams[0]); blocks.push(`${g.name}: ${hit.length ? hit.map((r) => r.username).join(', ') + ` picked ${teams[0]}` : `nobody picked ${teams[0]}`}.`) }
    else blocks.push(`${g.name}: ` + rows.map((r) => `${r.username} → ${r.champion_team ?? '—'}`).join(', '))
  }
  return (wantScorer ? 'Top scorer picks:\n' : 'Champion picks:\n') + blocks.join('\n')
}
// v30: POPULARITY aggregate — "which team is most chosen for champion, and how much?" used to
// fall through to the CALLER's own single pick (my_data's generic pick branch), or (a different
// phrasing) get swallowed by the rulesFAQ point-value FAQ — neither ever counts anyone. This
// tallies champion_team/top_scorer_player from the already-RLS-safe get_group_leaderboard rows
// (same source whoPicked/myFocus already use) and reports the real leader + count per group.
async function mostPopularPick(sbUser: Sb, groups: Grp[], target: Grp | null, wantScorer: boolean): Promise<string> {
  if (!groups.length) return `You're not in any group yet.`
  const blocks: string[] = []
  for (const g of target ? [target] : groups) {
    const rows = (must(await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })) ?? []) as any[]
    const col = wantScorer ? 'top_scorer_player' : 'champion_team'
    const picked = rows.filter((r) => r[col])
    if (!picked.length) { blocks.push(`${g.name}: nobody has picked ${wantScorer ? 'a top scorer' : 'a champion'} yet.`); continue }
    const tally = new Map<string, number>()
    for (const r of picked) tally.set(r[col], (tally.get(r[col]) ?? 0) + 1)
    const max = Math.max(...tally.values())
    const leaders = [...tally.entries()].filter(([, n]) => n === max).map(([name]) => name)
    const pct = Math.round((max / picked.length) * 100)
    if (leaders.length === tally.size && max === 1) { blocks.push(`${g.name}: no standout — every pick is different, 1 of ${picked.length} member${picked.length === 1 ? '' : 's'} each.`); continue }
    blocks.push(`${g.name}: ${leaders.join(' / ')} ${leaders.length > 1 ? 'are tied as the top picks' : 'is the top pick'}, ${max} of ${picked.length} member${picked.length === 1 ? '' : 's'} (${pct}%).`)
  }
  return blocks.join('\n')
}
// v27: match-day-scoped points ("how did my group do yesterday?") — the 07:30-UTC
// match-day boundary the whole app uses (M110). offset 0 = current match-day, -1 = previous.
function matchDayWindow(off: number): { start: string; end: string } {
  const anchor = new Date(Date.now() - 7.5 * 3600_000)
  const day = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  const start = day + 7.5 * 3600_000 + off * 86400_000
  return { start: new Date(start).toISOString(), end: new Date(start + 86400_000).toISOString() }
}
async function dayPoints(sbPublic: Sb, sbUser: Sb, me: string, groups: Grp[], target: Grp | null, off: number, label: string, meOnly: boolean): Promise<string> {
  const w = matchDayWindow(off)
  const games = ((await sbPublic.from('games').select('id').gte('kick_off_time', w.start).lt('kick_off_time', w.end).not('score_home', 'is', null).lte('kick_off_time', new Date().toISOString())).data ?? []) as any[]
  if (!games.length) return `No games finished ${label}.`
  let pq = sbUser.from('predictions').select('user_id, group_id, points_earned').in('game_id', games.map((g) => g.id as string))
  if (meOnly) pq = pq.eq('user_id', me)
  if (target) pq = pq.eq('group_id', target.id)
  const preds = (must(await pq) ?? []) as any[]
  if (!preds.length) return `No visible predictions for ${label}'s games.`
  if (meOnly) { const pts = preds.reduce((s, p) => s + (p.points_earned ?? 0), 0); return `You earned ${pts} point${pts === 1 ? '' : 's'} from ${label}'s games (${games.length} game${games.length === 1 ? '' : 's'}).` }
  const uids = [...new Set(preds.map((p) => p.user_id as string))]
  const nm = new Map((((await sbUser.from('profiles').select('id, username').in('id', uids)).data) ?? []).map((r: any) => [r.id, r.username]))
  const per = new Map<string, number>()
  for (const p of preds) per.set(p.user_id as string, (per.get(p.user_id as string) ?? 0) + (p.points_earned ?? 0))
  const rows = [...per.entries()].sort((a, b) => b[1] - a[1])
  return `Points from ${label}'s games${target ? ` in ${target.name}` : ''}:\n` + rows.map(([u, pts]) => `${nm.get(u) ?? 'someone'}${u === me ? ' (you)' : ''}: ${pts} pts`).join('\n')
}
// v27: latest AI roast for the caller's groups (RLS-scoped; content trimmed for chat).
async function latestRoast(sbUser: Sb, groups: Grp[], target: Grp | null): Promise<string> {
  if (!groups.length) return `You're not in any group yet — the AI roast is per group (3+ members).`
  const gids = (target ? [target] : groups).map((g) => g.id)
  const row = (await sbUser.from('ai_summaries').select('group_id, date, content').in('group_id', gids).order('date', { ascending: false }).limit(1)).data?.[0] as any
  if (!row) return `No AI roast yet${target ? ` for ${target.name}` : ''} — it generates ~3.5 hours after the day's last kickoff, for groups of 3+ members.`
  const gname = (target ? [target] : groups).find((g) => g.id === row.group_id)?.name ?? 'your group'
  const text = String(row.content ?? '')
  return `Latest AI roast — ${gname}, ${row.date}:\n${text.length > 500 ? text.slice(0, 500) + '…' : text}\n(Full version in the AI tab.)`
}
// v24: another user's champion + top-scorer picks are PUBLIC after the June-11 lock (the
// global leaderboard displays them) — answer from the public leaderboard RPC by username.
async function userPicksPublic(sb: Sb, q: string): Promise<string | null> {
  const { data } = await sb.rpc('get_leaderboard')
  const rows = (data ?? []) as any[]; if (!rows.length) return null
  const ql = ' ' + q.toLowerCase().replace(/[^a-z0-9_א-׿ ]/g, ' ').replace(/\s+/g, ' ') + ' '
  const users = [...new Set(rows.map((r) => r.username as string))]
  const hit = users.find((u) => u && u.length >= 3 && ql.includes(' ' + u.toLowerCase() + ' '))
  if (!hit) return null
  const mine = rows.filter((r) => r.username === hit)
  const lines = mine.map((r) => `[${r.group_name ?? '—'}] champion ${r.champion_team ?? '—'} · top scorer ${r.top_scorer_player ?? '—'}`)
  return `${hit}'s picks (public since the June 11 lock):\n` + lines.join('\n')
}
async function globalStandings(sb: Sb, limit = 5): Promise<string> {
  const rows = (must(await sb.rpc('get_leaderboard')) ?? []) as any[]; if (!rows.length) return 'The leaderboard is empty.'
  // The global board is one row per (player x group) — a player in N groups has N ranked rows.
  // Show them as-is with the group name; do NOT dedupe by username (that hid real ranks).
  const top = rows.slice(0, Math.max(1, Math.min(limit, 20)))
  return 'Global leaderboard (one row per player per group):\n' + top.map((r) => `${r.rank}. ${r.username} (${r.group_name}) — ${r.total_points} pts`).join('\n')
}
async function groupHistory(sbPublic: Sb, sbUser: Sb, me: string, a: string, b: string, target: Grp | null = null): Promise<string> {
  const game = await findGame(sbPublic, a, b); if (!game) return `I couldn't find a game between ${a} and ${b}.`
  // v23: honor a group the caller named ("Demo group predictions for X") — scope to it.
  let q = sbUser.from('predictions').select('user_id, group_id, pred_home, pred_away, points_earned, is_auto').eq('game_id', game.id)
  if (target) q = q.eq('group_id', target.id)
  const preds = must(await q)
  // v20: say exactly WHY nothing is visible — pre-kickoff privacy vs no shared group.
  if (!preds || preds.length === 0) {
    if (new Date(game.kick_off_time as string) > new Date()) return `${game.team_home} vs ${game.team_away} hasn't kicked off yet — everyone's predictions stay hidden until kickoff. Ask me again after the whistle!`
    return `${game.team_home} vs ${game.team_away}: no predictions are visible to you — you can only see predictions from members of YOUR groups (and your own).`
  }
  const uids = [...new Set(preds.map((p) => p.user_id as string))], gids = [...new Set(preds.map((p) => p.group_id as string).filter(Boolean))]
  const names = new Map<string, string>((((await sbUser.from('profiles').select('id, username').in('id', uids)).data) ?? []).map((r: any) => [r.id, r.username]))
  const gnames = new Map<string, string>((((await sbUser.from('groups').select('id, name').in('id', gids)).data) ?? []).map((r: any) => [r.id, r.name]))
  const started = new Date(game.kick_off_time as string) <= new Date()
  const fin = game.score_home !== null && started  // v24: never show a not-yet-kicked-off game's (dev-quirk) score
  return `${game.team_home} ${fin ? `${game.score_home}-${game.score_away}` : 'vs'} ${game.team_away}:\n` + preds.map((p) => `${names.get(p.user_id as string) ?? 'someone'}${p.user_id === me ? ' (you)' : ''} [${gnames.get(p.group_id as string) ?? '—'}]: ${p.pred_home}-${p.pred_away}${p.is_auto ? ' auto' : ''}${fin ? ` [${p.points_earned}pt]` : ''}`).join('\n')
    + (started ? '' : `\n(Only your own predictions are visible before kickoff — everyone else's unlock at kickoff.)`)
}
// rules FAQ (deterministic answers for high-value facts; null => LLM fallback)
function rulesFAQ(q: string): string | null {
  const s = q.toLowerCase()
  if (/exact (score|scoreline).*(point|worth|how many|how much)|how (many|much) (points|pts).*exact|point.*exact score|exact.*worth more/.test(s)) return 'An exact scoreline is worth 3 points — that already includes the outcome point (scoring is not cumulative).'
  // v24: 90-min scoring vs ET/pens — must beat the generic outcome-point line ("...and I
  // predicted a draw, do I get the outcome point?" is a penalties question, not a generic one)
  if (/(penalt|extra time|shoot.?out)[\s\S]{0,90}(points?\b|predict|outcome|scoring)|(points?\b|predict|outcome|scoring)[\s\S]{0,90}(penalt|extra time|shoot.?out)/.test(s) && !/which games|what games|how many games|list/.test(s)) return "Prediction points are scored on the 90-minute result ONLY — extra time and penalties never change prediction scoring (they only decide who advances). Predicted a draw and it's level after 90'? You get the outcome point even if it's decided on penalties."
  if (/outcome.*(point|worth)|point.*(win|draw|loss|outcome)|what do i get for.*(result|win|draw|correct)|correct (result|outcome)/.test(s)) return 'A correct outcome (Win/Draw/Loss) is worth 1 point. An exact scoreline is 3 points total (it already includes the outcome point).'
  // v23: champion AND top scorer asked together -> answer both (each FAQ line alone dropped half)
  // v26: pick-value FAQs must not swallow STAT questions — "how many goals does the top
  // scorer have?" is a leaderboard lookup, not the 10-point rule.
  // v30: nor must they swallow a POPULARITY question — "how many people picked Brazil as
  // champion?" used to be intercepted HERE (before intent classification even runs) and
  // answered with the flat 10-point rule instead of ever reaching mostPopularPick().
  const isPopularity = /most (chosen|picked|popular|common)|majority (pick|chose|picked)|everyone'?s? pick|how many (people|members|users)\b[\s\S]{0,20}\bpick|who picked/.test(s)
  if (/(champion[\s\S]{0,30}(top scorer|golden boot)|(top scorer|golden boot)[\s\S]{0,30}champion)/.test(s) && /point|worth|how (many|much)/.test(s) && !/goals?\b|assists?\b|scored\b/.test(s) && !isPopularity) return 'The Champion and Top Scorer picks are worth 10 points each.'
  if ((/champion.*(point|worth|how many|how much)|how (many|much).*champion/.test(s)) && !/goals?\b|assists?\b|scored\b/.test(s) && !isPopularity) return 'A correct Champion pick is worth 10 points.'
  if ((/top scorer.*(point|worth|reward)|golden boot.*(point|worth|reward)|how (many|much).*(top scorer|golden boot)|(reward|worth).*(top scorer|golden boot)/.test(s)) && !/goals?\b|assists?\b|scored\b|\bhave\b|\bhas\b/.test(s) && !isPopularity) return 'A correct Top Scorer pick (the Golden Boot pick) is worth 10 points.'
  // v24: whole-round bonuses ("how many points for the round bonuses, per round?")
  if (/round bonus|bonus(es)? (for|per|of|in)|whole round|full round|entire round/.test(s)) return 'Knockout-bracket whole-round bonuses: QF +12, SF +10, Final +8, 3rd-4th +6 — on top of +2 for every team you correctly have reaching a round.'
  if (/(max|maximum|highest|most).*(bracket|road to final)|bracket.*(max|maximum|how many points|points can|worth)/.test(s)) return 'The knockout bracket game is worth up to 83 points in total (max).'
  // v24: leaderboard tie-break rule ("how are ties broken if two players have the same points?")
  if (/(tie|ties|tied|tie.?break(er)?)\b[\s\S]{0,40}(broken|break|rank|leaderboard|points|decided)|(same|equal) (number of )?points[\s\S]{0,30}(rank|leaderboard|tie|break)|how (is|are) (the )?rank(ing)?s? (decided|determined)/.test(s)) return 'Leaderboard ties are broken by the number of exact scorelines. Same points AND same exact count = the same shared rank (the numbering then skips). There is no further tiebreaker.'
  if (/road to final|where.*bracket|find.*bracket|bracket.*(where|located)/.test(s)) return 'The knockout bracket game — \"Road to Final\" — is in the Picks tab. Open Picks and tap \"Road to Final\".'
  // v29: this line answers the POINT VALUE only. It used to also swallow "how many trivia
  // questions are there in total?" (a COUNT question) via a bare `how many.*trivia`
  // alternative — that's why the bot answered "worth 1 point" to a question about the total
  // number of questions. Count/window/today now have their own deterministic tool
  // (`triviaInfo`, ROUTE_RULES `trivia_info`) — this must exclude those phrasings.
  // v29 fix (found live): the exclusion was too broad — bare `\bquestions?\b` also matches
  // the SINGULAR "question" in "how many points is a trivia QUESTION worth?", which is a
  // point-value question, not a count question. Narrowed to the same count-shaped pattern
  // the ROUTE_RULES `trivia_info` rule itself uses, so the two never disagree about scope.
  if (/trivia/.test(s) && /(point|worth)/.test(s) && !/how (many|much)\b[\s\S]{0,20}\btrivia\b[\s\S]{0,20}\bquestions?\b|trivia questions?\b[\s\S]{0,15}\b(total|overall|are there)\b/.test(s)) return 'Each daily trivia question is worth 1 point. Trivia points stay hidden and all land after the last question (~July 21).'
  // v24: when points appear on the leaderboard (bracket fold-in etc.) — must beat the bare "leaderboard" keyword
  if (/\bpoints? (count|fold|appear|land|show)\b/.test(s) && !/\b(my|i|me)\b/.test(s)) return 'When points appear: prediction points count as soon as each game finishes. Champion + Top Scorer points land when the Final is decided (~July 19). Knockout-bracket points fold into the leaderboard from July 20, and trivia points all land after the last trivia question (~July 21).'
  if (/(pick|champion|top scorer).*(lock|deadline|close)|when.*(pick|champion).*lock/.test(s)) return 'Champion and Top Scorer picks lock on June 11, 22:00 Israel time — permanently.'
  if (/bracket.*(lock|deadline|close)|when.*bracket.*lock/.test(s)) return 'The knockout bracket locks on July 4, 20:00 Israel time.'
  // v20: cap questions ONLY ("can/allowed/max") — "how many members in Demo" is DATA -> groupMeta
  if (/how many (members|people|players) can|(max|min)(imum)?[\s\S]{0,16}(member|player|people|group size)|group.*(hold|allow)s?.*(member|player|people)|(members|players|people) (allowed|per)[\s\S]{0,20}group|(member|group size) (limit|cap)/.test(s)) return 'A group can have up to 12 members (including the captain). There is no minimum — a group starts with just its captain, though the nightly AI roast only runs for groups of 3+ members.'
  // v29: added a word-order-agnostic form — "in how much group i can be [a member]?" (broken
  // grammar, but a real user phrasing) has "group"→"can"→"be" in that order, not the
  // "groups can i be" order the old regex required. Without this it fell through to the
  // WC-group-table rule, whose bare `\bin\b` cue used to misread the PRONOUN "i" as Group I.
  if (/how many groups can|groups can i (be|join)|max(imum)?( number of)? groups|group (limit|cap)\b|\bgroups?\b[\s\S]{0,20}\bcan\b[\s\S]{0,10}\bbe\b/.test(s)) return 'You can be in up to 3 groups (created + joined combined).'
  if (/leave.*group|delete.*group|remove.*(member|myself)/.test(s)) return "You can't leave or delete a group, and members are permanent — contact the admin if something needs changing."
  if (/auto.?predict|forget.*(predict|prediction)|miss.*(predict|prediction|deadline)|random score|is it (random|data)/.test(s)) return "If you miss the deadline, the app auto-fills a prediction for you. It's not purely random — it leans toward the least-popular result (so you're not just copying the crowd), then fills in a scoreline for that outcome. Auto-predictions score exactly like manual ones."
  // v27: roast timing / inactive members / first-person bracket fold-in — new coverage FAQs
  if (/(roast|ai summar|nightly summar)[\s\S]{0,40}(when|what time|how often|generated?|timing|come[s]? out|arrive)|when.{0,20}(roast|ai summar)/.test(s)) return 'The nightly AI roast generates about 3.5 hours after the day\'s last kickoff — one per group with 3+ members. Find it in the AI tab.'
  if (/\binactive\b/.test(s) && /member|mark|mean|flag|what/.test(s)) return 'An inactive member is someone the captain flagged as having stopped playing. They still earn auto-predict points and stay on the leaderboard (dimmed). Captains can\'t mark themselves inactive.'
  if (/\b(my|i)\b[\s\S]{0,40}\bbracket\b[\s\S]{0,60}\bpoints?\b|\bbracket points\b/.test(s) && /\bwhen\b|fold|appear|land|count (toward|on|in)/.test(s)) return 'Your knockout-bracket points fold into the leaderboard from July 20. Until then you can check them on the Road to Final page (Picks tab).'
  return null
}

// ---- RAG (fuzzy describe only) ----------------------------------------------
async function searchStats(sb: Sb, qvec: number[] | null, teams: string[]): Promise<{ title: string; content: string }[]> {
  if (teams.length) { const { data } = await sb.from('kb_embeddings').select('title, content').in('title', teams); if (data && data.length) return data as any[] }  // fetch resolved entity cards directly
  if (!qvec) return []  // v26: degraded mode (no embedding) — evidence gate handles the empty set
  const { data } = await sb.rpc('match_kb', { query_embedding: qvec, match_count: 6, kind_filter: null })
  return (data ?? []) as { title: string; content: string }[]
}
// v26: ONE structured Writer call + a DETERMINISTIC grounding check (was a 2-4-call
// Writer<->Judge loop whose LLM judge silently PASSED answers when its JSON failed to
// parse). Evidence gate: zero retrieved cards = no LLM call at all. Every number in the
// answer must literally appear in the facts, else the honest "no stats" fallback fires.
async function answerCrew(openai: OpenAI, question: string, cards: { content: string }[]): Promise<{ answer: string; attempts: number; score: number }> {
  if (!cards.length) return { answer: '', attempts: 0, score: 0 }
  const facts = cards.map((c) => '- ' + c.content).join('\n')
  // v29 V4: RAG DESCRIBES, SQL COUNTS. This path retrieves per-entity stat cards — it must
  // never be asked to aggregate ("how many red cards in the TOURNAMENT" is a COUNT(*), and is
  // now caught deterministically before it ever reaches here — see the `cards_total` route).
  // The old instruction only said "never invent numbers"; that let a model report a stray "0"
  // copied from an unrelated card's "0 red" clause as if it answered a totals question.
  const sys = `You answer WorldCup app questions using ONLY the FACTS below. Be concise, friendly, accurate. Every number you state MUST be a single per-entity value copied verbatim from ONE fact line about the exact entity the question asks about — never a sum, count, or total across multiple lines, and never a number you calculated yourself. Do NOT rank or claim "the most/best" — that is handled elsewhere. If the question asks for a total/sum/count across many entities, set grounded=false — you cannot answer it from these facts. Return JSON {"answer":"...","grounded":true|false} where grounded=false means the facts do not cover the question.\n\nFACTS:\n${facts}${factsBlock()}`
  assertPublicPayload('answerCrew', sys, question)  // v29 V0: facts here are PUBLIC stat cards only
  const w = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.2, seed: 42, max_tokens: 320, response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: sys },
    { role: 'user', content: question },
  ] })
  let text = '', grounded = false
  try { const p = JSON.parse(w.choices[0]?.message?.content ?? '{}'); text = String(p.answer ?? '').trim(); grounded = p.grounded !== false } catch { /* fall through to fallback */ }
  // v29 V4: a number must appear in the SAME single card, not merely somewhere across the
  // whole concatenated fact set — the old set-membership check is why "0 red cards" passed
  // (every player card contains "0 yellow, 0 red", so a bare "0" was always in scope).
  const nums = text.match(/\d+(?:\.\d+)?/g) ?? []
  const ok = grounded && !!text && nums.every((n) => n === '2026' || cards.some((c) => c.content.includes(n)))
  return { answer: ok ? text : '', attempts: 1, score: ok ? 10 : 0 }
}

// ---- reindex ----------------------------------------------------------------
async function reindexIntents(openai: OpenAI, sbService: Sb): Promise<Response> {
  const items: { intent: string; example: string }[] = []
  for (const [intent, list] of Object.entries(INTENT_EXAMPLES)) for (const example of list) items.push({ intent, example })
  const vecs = await embed(openai, items.map((i) => i.example))
  await sbService.from('intent_examples').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error } = await sbService.from('intent_examples').insert(items.map((it, i) => ({ intent: it.intent, example: it.example, embedding: vecs[i] })))
  return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, mode: 'reindex_intents', seeded: items.length })
}
async function reindexDims(openai: OpenAI, sbService: Sb): Promise<Response> {
  const items: { dim: string; example: string }[] = []
  for (const [dim, list] of Object.entries(DIM_EXAMPLES)) for (const example of list) items.push({ dim, example })
  const vecs = await embed(openai, items.map((i) => i.example))
  await sbService.from('dim_examples').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error } = await sbService.from('dim_examples').insert(items.map((it, i) => ({ dim: it.dim, example: it.example, embedding: vecs[i] })))
  return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, mode: 'reindex_dims', seeded: items.length })
}
async function reindexKb(openai: OpenAI, sbService: Sb): Promise<Response> {
  const cards: { kind: string; ref_id: string; title: string; content: string }[] = []
  const { data: teams } = await sbService.from('team_tournament_stats').select('*').range(0, 999)
  for (const t of teams ?? []) cards.push({ kind: 'team', ref_id: t.team as string, title: t.team as string,
    content: `TEAM ${t.team} — ${t.games_played} games (${t.wins}W ${t.draws}D ${t.losses}L). Attack: avg ${t.avg_goals_scored} goals scored. Defense: avg ${t.avg_goals_conceded} conceded. Possession ${t.avg_possession}%. ${t.avg_shots_total} shots (${t.avg_shots_on_target} on target), ${t.avg_corners} corners. Discipline: ${t.avg_fouls} fouls, ${t.avg_yellow_cards} yellow, ${t.avg_red_cards} red cards, ${t.avg_offsides} offsides per game.` })
  const players: any[] = []
  for (let off = 0; ; off += 1000) { const { data } = await sbService.from('player_tournament_stats').select('*').gt('games_played', 0).range(off, off + 999); if (!data || !data.length) break; players.push(...data); if (data.length < 1000) break }  // paginate (PostgREST 1000-row cap)
  for (const p of players) cards.push({ kind: 'player', ref_id: String(p.api_player_id), title: p.player_name as string,
    content: `PLAYER ${p.player_name} (${p.team}) — ${p.total_goals} goals, ${p.total_assists} assists in ${p.games_played} games. ${p.total_yellow_cards} yellow, ${p.total_red_cards} red.${(p.total_goals as number) >= 3 ? ' A top scorer.' : ''}` })
  await sbService.from('kb_embeddings').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  let n = 0
  for (const part of chunk(cards, 96)) {
    const vecs = await embed(openai, part.map((c) => c.content))
    const { error } = await sbService.from('kb_embeddings').insert(part.map((c, i) => ({ ...c, embedding: vecs[i] })))
    if (error) return json({ ok: false, mode: 'reindex_kb', error: error.message, inserted: n }, 500)
    n += part.length
  }
  return json({ ok: true, mode: 'reindex_kb', cards: n, teams: (teams ?? []).length, players: players.length })
}

// ---- spec + registry --------------------------------------------------------
type Spec = { intent: string; confidence: number; margin: number; second: string; op: string; dim: string | null; teams: string[]; date: any; phase: string | null; predicate: boolean }
type Ctx = { spec: Spec; question: string; sbPublic: Sb; sbUser: Sb; sbService: Sb; openai: OpenAI; me: () => Promise<string | null>; names: string[] }
type Tool = { id: string; match: (s: Spec) => boolean; run: (c: Ctx) => Promise<{ answer: string; llm?: boolean; retrieved?: number; crew?: any }> }

const NEED_LOGIN = 'Please sign in — I can only look up your personal data when you are logged in.'
// Intent-based tools. Operation-based tools (count/rank/compare/bracket/global) run as
// inline overrides in serve() BEFORE this registry, since they cut across intents.
const REGISTRY: Tool[] = [
  { id: 'schedule', match: (s) => s.intent === 'schedule', run: async (c) => {
      if (c.spec.op === 'list' || c.spec.date) return { answer: await scheduleList(c.sbPublic, c.spec.date, c.spec.phase) }
      return { answer: await lookupGame(c.sbPublic, c.spec.teams[0] ?? null, detectPhase(c.question)) } } },
  { id: 'who_scored', match: (s) => s.intent === 'who_scored', run: async (c) => {
      if (c.spec.teams.length >= 2) return { answer: await whoScored(c.sbPublic, c.spec.teams[0], c.spec.teams[1]) }
      // v24: "what's the score of tomorrow's game?" — a date/phase beats the two-team ask
      if (c.spec.date || c.spec.phase) return { answer: await scheduleList(c.sbPublic, c.spec.date, c.spec.phase) }
      return { answer: 'Which game? Name both teams, e.g. "who scored in Everton vs Manchester City?"' } } },
  // v19: my_data routes on keywords to focused sub-tools; every sub-tool honors a
  // group the caller names ("...in Alpha Wolves") via resolveGroupName (own groups only).
  { id: 'my_data', match: (s) => s.intent === 'my_data', run: async (c) => {
      const me = await c.me(); if (!me) return { answer: NEED_LOGIN }
      const groups = await myGroups(c.sbUser, me)
      // v24: honor EVERY named own-group ("compare my points in alpha wolves vs beta sharks" = both)
      const matched = resolveGroupsAll(c.question, groups)
      const target = matched.length === 1 ? matched[0] : null
      const scope = matched.length >= 2 ? matched : groups
      // v20: named a group that isn't yours -> honest refusal, never a silent all-groups dump
      if (!matched.length) { const cand = groupRefCandidate(c.question); if (cand) return { answer: unknownGroupAnswer(cand, groups) } }
      const ql = c.question.toLowerCase()
      const mentionsMate = async () => { const members = await myGroupMembers(c.sbUser, groups.map((g) => g.id)); const member = resolveMemberName(c.question, members); return member && member.id !== me ? member : null }
      // v24: comparing yourself to a group-mate ("who has more points, me or X?", "am I beating X?")
      if (/\bpoints?\b|\bpts\b|rank|beat(ing)?|ahead|winning|leading|better/.test(ql) && /\b(or|vs|beat(ing)?|ahead of|than)\b/.test(ql)) {
        const member = await mentionsMate()
        if (member) return { answer: await groupStandings(c.sbUser, me, false, scope, target) }
      }
      // v20: asking about a group-MATE's prediction ("what did nitzo predict...")
      if (/predict|guess|call(ed)?\b/.test(ql) && !/\b(i|my|we|our)\b/.test(ql)) {
        const member = await mentionsMate()
        if (member) return { answer: await memberPrediction(c.sbUser, me, member, await resolveGameRef(c.sbPublic, c.question, c.spec.teams, c.spec.phase)) }
      }
      // v29: "in which of my groups..." / "which group am I doing best in" names NO group when
      // dispatched to myRates/myFocus with target=null (they combine all groups into one
      // number) — this was the D2 bug reported live. Detect the "which/what group" framing
      // FIRST and answer with the actual best-performing group, named.
      if (!target && /\b(which|what)\b[\s\S]{0,15}\bgroups?\b/.test(ql) && /\b(best|doing best|winning|leading|top|ahead)\b/.test(ql))
        return { answer: await myBestGroup(c.sbUser, c.sbPublic, me, scope, /percent|%|hit ?rate|streak|\bhot\b|\bcold\b|exact/.test(ql) ? 'rate' : 'rank') }
      // v27: exact% / hit% / streak — computed, no longer a generic summary
      if (/percent|%|hit ?rate|streak|\bhot\b|\bcold\b/.test(ql)) return { answer: await myRates(c.sbPublic, c.sbUser, me, scope, target, streakWant(ql)) }
      if (/exact|spot.?on|nail|precise|on the (nose|dot)/.test(ql) && !/percent|%/.test(ql)) return { answer: await myExact(c.sbPublic, c.sbUser, me, scope, target) }
      if (/rank|place|position|standing|where am i/.test(ql)) return { answer: await myFocus(c.sbUser, me, scope, target, 'rank') }
      if (/pick|champion|top scorer|bet on/.test(ql)) {
        // v30: POPULARITY question ("most chosen/picked/popular", "how many people picked X")
        // is an AGGREGATE across everyone — must win over both the named-user lookup below and
        // the own-pick fallback, which used to silently answer with the CALLER's own single
        // pick (the exact bug reported: "which team is most chosen for champion?" -> your pick).
        if (/most (chosen|picked|popular|common)|majority (pick|chose|picked)|everyone'?s? pick|how many (people|members|users)\b[\s\S]{0,20}\bpick/.test(ql))
          return { answer: await mostPopularPick(c.sbUser, scope, target, /top scorer|golden boot/.test(ql) && !/champion/.test(ql)) }
        // v24: "what is Dani's champion pick?" — another user's picks are PUBLIC after the June-11
        // lock (shown on the global leaderboard); answer from the public RPC, never your own picks.
        if (!/\b(i|my|me|mine|we|our)\b/.test(ql)) { const pub = await userPicksPublic(c.sbPublic, c.question); if (pub) return { answer: pub } }
        return { answer: await myFocus(c.sbUser, me, scope, target, 'picks') }
      }
      if (/\bpoints?\b|\bpts\b/.test(ql)) return { answer: await myFocus(c.sbUser, me, scope, target, 'points') }
      return { answer: await myContext(c.sbUser, me, scope, target) } } },
  { id: 'group_standings', match: (s) => s.intent === 'group_standings', run: async (c) => {
      const me = await c.me(); if (!me) return { answer: NEED_LOGIN }
      const groups = await myGroups(c.sbUser, me)
      const target = resolveGroupName(c.question, groups)
      // v20: foreign / unknown group -> honest refusal instead of dumping all your groups
      if (!target) { const cand = groupRefCandidate(c.question); if (cand) return { answer: unknownGroupAnswer(cand, groups) } }
      return { answer: await groupStandings(c.sbUser, me, c.spec.op === 'rank' && /exact/i.test(c.question), groups, target) } } },
  // v20: group_history understands group-mates ("what did nitzo predict"), relative game
  // refs ("the last game", "the final") and falls back to LLM understanding when ambiguous.
  { id: 'group_history', match: (s) => s.intent === 'group_history', run: async (c) => {
      const me = await c.me(); if (!me) return { answer: NEED_LOGIN }
      const groups = await myGroups(c.sbUser, me)
      // v23: a named group is honored — YOUR group scopes the answer; a foreign/unknown one
      // is refused ("legends group predictions for X" used to dump ALL your groups' preds).
      const target = resolveGroupName(c.question, groups)
      if (!target) { const cand = groupRefCandidate(c.question); if (cand) return { answer: unknownGroupAnswer(cand, groups) } }
      // v24: a named group-MATE wins over the generic group dump — even when both teams are
      // named ("what did bot_e2e_mate predict for Netherlands vs England?" is about the MATE).
      const members = await myGroupMembers(c.sbUser, groups.map((g) => g.id))
      const member = resolveMemberName(c.question, members)
      const ql = c.question.toLowerCase()
      if (member && member.id !== me && /\bpoints?\b|\bpts\b|rank|beat(ing)?|ahead|winning|leading|better/.test(ql)) return { answer: await groupStandings(c.sbUser, me, false, groups, target) }
      const game = await resolveGameRef(c.sbPublic, c.question, c.spec.teams, c.spec.phase)
      if (member && member.id !== me) return { answer: await memberPrediction(c.sbUser, me, member, game) }
      if (c.spec.teams.length >= 2) return { answer: await groupHistory(c.sbPublic, c.sbUser, me, c.spec.teams[0], c.spec.teams[1], target) }
      if (game) return { answer: await groupHistory(c.sbPublic, c.sbUser, me, game.team_home as string, game.team_away as string, target) }
      const u = await llmUnderstand(c.openai, c.question, groups.map((g) => g.name), members.map((m) => m.username))
      const ans = await execUnderstood(u, c, me, groups, members)
      if (ans) return { answer: ans, llm: true }
      return { answer: 'Which game? Name both teams, e.g. "what did we predict for Everton vs Manchester City?"' } } },
]

// v19: the whole per-question routing pipeline, callable once per clause so compound
// questions answer BOTH parts. Returns {answer, pub(lic spec), extra} instead of a Response.
type RouteDeps = { openai: OpenAI; sbPublic: Sb; sbUser: Sb; sbService: Sb; me: () => Promise<string | null>; names: string[]; lastAnswer?: string }
type RouteOut = { answer: string; pub: Record<string, unknown>; extra: Record<string, unknown> }

// ---- v28: the deterministic override chain, as an ORDERED RULE TABLE ----
//
// WHY: this used to be a ~175-line if/return chain inside routeQuestion. Every regression since
// v17 has been an ORDERING bug (a broad rule shadowing a narrow one that sat below it) — and the
// chain gave you no way to see, name, or test the order. As a table:
//   * order is DATA (the array index), not control flow buried in a function;
//   * every rule has an `id`, so ask_log now records WHICH rule answered — for every answer,
//     not just the handful that remembered to pass `route`;
//   * a rule is a pure (ctx) -> hit|null function, so a shadowing bug is a unit test, not a deploy.
//
// CONTRACT: rules run top-to-bottom; the FIRST one to return non-null wins. Returning null means
// "not mine, keep going" — a rule may also legitimately return null AFTER a side effect (see
// `howto_is_rules`, which only reclassifies spec.intent). ORDER IS BEHAVIOUR: moving a rule up or
// down changes answers. Each rule's comment says what it must beat, and why.
type RuleCtx = {
  question: string; qlow: string; spec: Spec; agg: ReturnType<typeof detectAgg>; firstPerson: boolean
  history: string[]; lastAnswer?: string
  openai: OpenAI; sbPublic: Sb; sbUser: Sb; sbService: Sb; me: () => Promise<string | null>; names: string[]
  groupScoped: boolean; namedGroup: ReturnType<typeof groupRefCandidate>
}
type RuleHit = { answer: string; extra?: Record<string, unknown> }
type Rule = { id: string; run: (c: RuleCtx) => Promise<RuleHit | null> }
const hit = (answer: string, extra: Record<string, unknown> = {}): RuleHit => ({ answer, extra })

const ROUTE_RULES: Rule[] = [
  // v24: a year that isn't 2026 = out of scope ("who won the 2022 world cup?" used to hit the login gate)
  { id: 'off_scope_year', run: async (c) => {
    const yr = c.qlow.match(/\b(19\d{2}|20\d{2})\b/)
    return yr && yr[1] !== '2026' ? hit(`I only cover the 2026 World Cup — ask me anything about this tournament or the app!`) : null } },

  // v24: "how/where do I …" is a HOW-TO (navigation) question -> the rules path, never a login
  // gate or a data dump ("how do i bet on games here?" answered NEED_LOGIN for anon users).
  // Side-effect only: reclassifies the intent, then falls through to the rest of the table.
  // v29: added bare "how to <verb>" — "how to play this game?" has no modal verb (do/does/
  // can/could/should) between "how" and "i/we/you", so the old regex never matched it, and
  // it fell all the way through to a misclassified private intent ("Please sign in"). Also
  // added the PRONOUN-FIRST word order — "where I can see game stat?" puts "i" BEFORE "can"
  // (casual grammar), which the old modal-first-only pattern also missed, for the same failure.
  { id: 'howto_is_rules', run: async (c) => {
    if ((/\b(how|where) (do|does|can|could|should) (i|we|you)\b/.test(c.qlow) || /\b(how|where) (i|we|you) (do|does|can|could|should)\b/.test(c.qlow) || /\bhow to\b/.test(c.qlow)) && !/how (many|much)\b/.test(c.qlow)
        && /predict|bet|pick|choose|guess|play|join|create|invite|share|react|answer|see|find|watch|check|change|edit|update|use|make|open/.test(c.qlow)) c.spec.intent = 'rules'
    return null } },

  // v27: TOURNAMENT groups A-L ("group D standings", "who is in group C") — must run
  // before the global-leaderboard cue and the friend-group tools (it collided with both).
  // v29: letter 'i' is overwhelmingly more likely to be the PRONOUN "I" than World Cup Group I
  // ("in how much group i can be?") — no regex can truly tell them apart (the real fix is the
  // full v29 typed-entity resolver, not yet built), so 'i' alone requires a STRONG, explicit
  // table cue; every other letter keeps the broader cue set (now also catching "is group C
  // finished?", which had no matching cue word before and fell through to a private-group
  // misroute). "who finished 1st/last" answers ONE row instead of dumping the whole table.
  { id: 'wc_group_table', run: async (c) => {
    const tg = c.qlow.match(/\bgroup ([a-l])\b/)
    if (!tg) return null
    const letter = tg[1]
    const strongCue = /standing|table|top of|qualif|\bteams?\b/.test(c.qlow)
    const broadCue = /standing|table|teams|who|top|leader|qualif|games|fixtures|points|finish(ed)?|status|\bover\b|\bdone\b|complete|conclude|started?|begun|\bin\b/.test(c.qlow)
    const cue = letter === 'i' ? strongCue : broadCue
    if (!cue || /\b(my|our|friend)\b/.test(c.qlow)) return null
    // v29 fix (found live): "who finished 1 in group d?" uses the bare numeral "1", not the
    // ordinal "1st" — the original regex required the ordinal suffix and missed it, so the
    // question still got the full table (harmless now that the table is only 4 rows, but not
    // the single-row answer this was meant to give).
    const first = /who (finished|is|was|came) (1st|first|1|top|number one|the winner)\b|who'?s (first|top|winning) in\b/.test(c.qlow)
    const last = /who (finished|is|was|came) (last|bottom)\b/.test(c.qlow)
    return hit(await tournamentGroupTable(c.sbPublic, letter, first ? 'first' : last ? 'last' : undefined))
  } },

  // v29: trivia — count/window/today are PUBLIC; my score is PRIVATE. Previously NONE of
  // this had a tool: rulesFAQ's trivia line answered the POINT VALUE regardless of what was
  // asked ("how many trivia questions are there in total?" -> "worth 1 point"), and the
  // rules LLM had no clock to answer "is there one today" correctly.
  { id: 'trivia_info', run: async (c) => {
    if (!/\btrivia\b/.test(c.qlow)) return null
    if (/\b(my|i'?ve|have i|did i)\b/.test(c.qlow) && /(score|point|correct|right|answer)/.test(c.qlow)) {
      const uid = await c.me(); if (!uid) return null
      return hit(await myTriviaScore(c.sbUser, uid), { route: 'my_trivia_score' })
    }
    if (/how (many|much)\b[\s\S]{0,20}\btrivia\b[\s\S]{0,20}\b(question|total|overall)|trivia questions?\b[\s\S]{0,15}\b(total|overall|are there)/.test(c.qlow) && !/point|worth/.test(c.qlow))
      return hit(await triviaInfo(c.sbService, 'count'), { route: 'trivia_count' })
    if (/how long\b[\s\S]{0,20}\btrivia\b|trivia\b[\s\S]{0,20}(seconds|window|open for|how long)/.test(c.qlow))
      return hit(await triviaInfo(c.sbService, 'window'), { route: 'trivia_window' })
    if (/\b(today|tonight|right now|currently)\b[\s\S]{0,20}\btrivia\b|\btrivia\b[\s\S]{0,20}\b(today|tonight|now)\b|is there .*trivia|next trivia|when.*(next|is the).*trivia/.test(c.qlow))
      return hit(await triviaInfo(c.sbService, 'today'), { route: 'trivia_today' })
    return null } },

  // v29: public top-scorer PICK CANDIDATES ("who can I pick as top scorer?") had no tool at
  // all — it used to fall into the private my_data path and refuse anonymous callers.
  { id: 'top_scorer_candidates', run: async (c) => {
    if (!(/top scorer|golden boot/.test(c.qlow) && /(candidate|option|choice|who can i pick|which players?|who is eligible)/.test(c.qlow))) return null
    return hit(await topScorerCandidates(c.sbPublic, c.spec.teams[0] ?? null), { route: 'top_scorer_candidates' }) } },

  // v27: ODDS — game odds (Bet365) / champion outright odds (William Hill).
  { id: 'odds', run: async (c) => {
    if (!(/\bodds\b|bookmaker|bet ?365|william hill|favou?rites? (to win|for the)|chances of winning/.test(c.qlow) && !/against the odds/.test(c.qlow))) return null
    if (/champion|win(ning)? (the )?(world cup|tournament|whole thing|it all)|outright|favou?rites?/.test(c.qlow) && c.spec.teams.length <= 1 && !/\bvs\b|against|draw|over|under/.test(c.qlow))
      return hit(await championOddsAnswer(c.sbPublic, c.spec.teams), { route: 'champion_odds' })
    return hit(await gameOddsAnswer(c.sbPublic, c.spec.teams), { route: 'game_odds' }) } },

  // Global leaderboard is PUBLIC — detect it broadly and route here BEFORE the private dispatch,
  // else "top 5 players" / "worldwide" / "across all groups" get swallowed by the anon sign-in gate.
  // v24: \bgroups?\b (plural counts as group-scoped: "compare my two groups" was hijacked by
  // "overall"); a NAMED group ("the Kanta Bayam group") is never global — it must reach the
  // group tools so a foreign name gets the privacy refusal, not a global-leaderboard dump.
  { id: 'global_standings', run: async (c) => {
    const globalCue = !c.groupScoped && !c.namedGroup && (/\b(global|overall|worldwide|whole app|entire competition|the (whole )?world|all players|every player|across (all|every) groups?|all groups|everyone|rank everyone|globally)\b/.test(c.qlow) || /\b(top|best)\s+\d+\s+(player|globally)/.test(c.qlow) || /\b(most|total)\s+points\b/.test(c.qlow) || /\bleaderboard\b|\bstandings\b/.test(c.qlow))
    if (!globalCue || c.spec.intent === 'rules') return null
    const tn = c.qlow.match(/\b(?:top|best)\s+(\d{1,2})/)
    return hit(await globalStandings(c.sbPublic, tn ? +tn[1] : 5)) } },

  // bare superlative with no team / group / metric -> ask which stat rather than gate or guess
  { id: 'best_needs_metric', run: async (c) =>
    /\bwho'?s? (the )?best\b|\bwho is the best\b/.test(c.qlow) && c.spec.teams.length === 0 && !c.groupScoped
      ? hit('Which stat do you mean — goals, assists, defense, possession, corners, fouls, or cards? Or ask for the leaderboard.', { clarify: true })
      : null },

  // v20: group META (member count / list / captain) — real DATA for a specific group,
  // not the rules-FAQ cap. Cap questions ("how many members CAN...") never reach here.
  { id: 'group_meta', run: async (c) => {
    if (!(/\bmembers?\b|\bcaptain\b|who('s| is) in\b/.test(c.qlow) && !/can (have|be|join)|allowed|max|maximum|limit|up to/.test(c.qlow) && !/first place|last place|winning|lead|top of|rank|standing|points/.test(c.qlow))) return null
    const uid = await c.me(); if (!uid) return null
    const groups = await myGroups(c.sbUser, uid)
    const target = resolveGroupName(c.question, groups)
    if (!target) { const cand = groupRefCandidate(c.question); if (cand) return hit(unknownGroupAnswer(cand, groups)) }
    if (target || /\b(my|our) groups?\b/.test(c.qlow)) return hit(await groupMeta(c.sbUser, uid, target ? [target] : groups, c.qlow))
    return null } },

  // v27: NEW private coverage routes — bracket game, latest roast, reverse pick lookup,
  // match-day-scoped points. All uid-gated; run before the intent registry so misclassified
  // phrasings still land here.
  { id: 'my_bracket', run: async (c) => {
    if (!(/\b(bracket|road to final)\b/.test(c.qlow) && /\b(my|i|me)\b/.test(c.qlow) && !/how (do|does|can)|where|lock|work/.test(c.qlow))) return null
    const uid = await c.me(); if (!uid) return null
    return hit(await myBracket(c.sbUser, uid)) } },

  { id: 'latest_roast', run: async (c) => {
    if (!(/\broasts?\b|ai summar|nightly summar|what did the ai (say|write)/.test(c.qlow) && !/when|what time|how often|timing/.test(c.qlow))) return null
    const uid = await c.me(); if (!uid) return null
    const groups = await myGroups(c.sbUser, uid)
    return hit(await latestRoast(c.sbUser, groups, resolveGroupName(c.question, groups))) } },

  // v30: POPULARITY aggregate — intent-agnostic (unlike my_data's own branch above, this fires
  // regardless of what the classifier decided) so a NAMED team doesn't divert it into a stats/
  // count path instead ("how many people picked Brazil as champion?" used to land on a stats
  // count -> RAG, which admitted "I don't have stats to answer that yet" rather than counting).
  { id: 'most_popular_pick', run: async (c) => {
    if (!(/most (chosen|picked|popular|common)|majority (pick|chose|picked)|everyone'?s? pick|how many (people|members|users)\b[\s\S]{0,20}\bpick(ed)?\b/.test(c.qlow) && /champion|top scorer|golden boot/.test(c.qlow))) return null
    const uid = await c.me(); if (!uid) return null
    const groups = await myGroups(c.sbUser, uid); if (!groups.length) return null
    // v30: a NAMED team ("how many people picked BRAZIL as champion?") is a per-team count,
    // which whoPicked already answers precisely (usernames + a real count) — mostPopularPick
    // is for the genuinely open "which team is the most popular pick" question (no team named).
    if (c.spec.teams.length >= 1) return hit(await whoPicked(c.sbUser, c.question, groups, c.names, resolveGroupName(c.question, groups)), { route: 'most_popular_pick' })
    return hit(await mostPopularPick(c.sbUser, groups, resolveGroupName(c.question, groups), /top scorer|golden boot/.test(c.qlow) && !/champion/.test(c.qlow)), { route: 'most_popular_pick' }) } },

  { id: 'who_picked', run: async (c) => {
    if (!(/who (picked|chose|took|selected|bet on|went (with|for))\b/.test(c.qlow) && /champion|top scorer|golden boot|winner|\bpick/.test(c.qlow) || (/who (picked|chose|took|selected|bet on)\b/.test(c.qlow) && c.spec.teams.length === 1))) return null
    const uid = await c.me(); if (!uid) return null
    const groups = await myGroups(c.sbUser, uid); if (!groups.length) return null
    return hit(await whoPicked(c.sbUser, c.question, groups, c.names, resolveGroupName(c.question, groups))) } },

  { id: 'day_points', run: async (c) => {
    if (!(/\b(yesterday|today|tonight)\b/.test(c.qlow) && /point|\bdo\b|\bdid\b|score[d]?|perform/.test(c.qlow) && (c.firstPerson || /\bgroup\b/.test(c.qlow)) && !/games? (are|is) (on|today)|what games|which games|schedule|fixtures/.test(c.qlow))) return null
    const uid = await c.me(); if (!uid) return null
    const groups = await myGroups(c.sbUser, uid)
    const off = /\byesterday\b/.test(c.qlow) ? -1 : 0
    const meOnly = c.firstPerson && !/\bgroup\b/.test(c.qlow)
    return hit(await dayPoints(c.sbPublic, c.sbUser, uid, groups, resolveGroupName(c.question, groups), off, /\byesterday\b/.test(c.qlow) ? 'yesterday' : 'today', meOnly)) } },

  // P1: honor PRIVATE intents (personal / group) BEFORE the public overrides below can hijack them.
  // Without this, a personal question containing "how many … games" fell into the count rule and
  // returned tournament progress; "most exact in our group" fell into the rank rule and returned
  // the public assist leader. (The global leaderboard is public — it is deliberately ABOVE this.)
  // v24: a my_data/group_history-classified question with NO first-person/group/predict cue
  // but WITH a team is really a public team question ("did holland win there last game").
  { id: 'private_registry', run: async (c) => {
    const PRIVATE = new Set(['my_data', 'group_standings', 'group_history'])
    const privateOk = c.spec.teams.length === 0
      || (c.spec.intent === 'my_data' ? c.firstPerson
        : c.spec.intent === 'group_history' ? (c.spec.predicate || /\b(we|our|us|my|group)\b/.test(c.qlow))
        : true)
    if (!(PRIVATE.has(c.spec.intent) && privateOk)) return null
    for (const t of REGISTRY) if (t.match(c.spec)) {
      const r = await t.run({ spec: c.spec, question: c.question, sbPublic: c.sbPublic, sbUser: c.sbUser, sbService: c.sbService, openai: c.openai, me: c.me, names: c.names })
      return hit(r.answer, { llm_used: !!r.llm, route: t.id })
    }
    return null } },

  // v24: short follow-up "and X?" / "what about X?" — apply the PREVIOUS question's shape
  // to the newly named team ("and portugal?" after "when do england play next").
  { id: 'followup_and', run: async (c) => {
    if (!(c.history.length && c.spec.teams.length === 1 && /^\s*(and|what about|how about)\b/.test(c.qlow) && c.question.trim().length <= 40)) return null
    const h = c.history.join(' ').toLowerCase()
    if (/still in|knocked out|eliminated|still alive|out of the (tournament|cup)/.test(h)) return hit(await bracketStatus(c.sbPublic, c.spec.teams[0]))
    if (/\bnext\b|upcoming|when do(es)?\b/.test(h)) return hit(await lookupGame(c.sbPublic, c.spec.teams[0], null))
    if (/last (game|match|one)|latest|score/.test(h)) { const g = await resolveGameRef(c.sbPublic, 'last game', c.spec.teams, null); if (g) return hit(await gameDetail(c.sbPublic, g.team_home as string, g.team_away as string)) }
    return null } },

  // v24: a "when does X play" where X resolves to NO known team — say so instead of
  // answering with the tournament's next fixture ("when does Wakanda play?").
  { id: 'unknown_team', run: async (c) => {
    const unk = c.qlow.match(/when (do(es)?|will|did) (the )?([a-z][a-z0-9]{2,15}) play/)
    return unk && c.spec.teams.length === 0 && !c.spec.phase && !['we', 'they', 'i', 'you', 'it', 'people'].includes(unk[4])
      ? hit(`I don't recognize "${unk[4]}" as a team in this tournament.`) : null } },

  // v24: stats nobody tracks — be honest instead of answering with something else.
  // v27: +venue/city/time-zone (previously only "stadium" was guarded).
  { id: 'untracked_stat', run: async (c) =>
    /attendance|referee|\bweather\b|stadium|\bvenue\b|host cit|which city|what city|time ?zone|\bcrowd\b|throw.?ins?\b|\bvar\b/.test(c.qlow) && !/possession|shots?|corners|cards/.test(c.qlow)
      ? hit("I don't track venues or that kind of detail — for a game I can give you the kickoff time, score, scorers and match stats (shots, possession, corners, fouls, cards, offsides, xG).")
      : null },

  // v27: recent form / last-N-games trend ("how is Argentina doing?", "last 5 games").
  { id: 'recent_form', run: async (c) => {
    if (!(c.spec.teams.length === 1 && (/\bform\b|recent(ly)?|improving|trend|last (\d+|two|three|four|five) (games|matches)|how (has|have|is|are) [\s\S]{0,24}(doing|playing|performing|been)/.test(c.qlow)) && !/predict|\bmy\b|\bour\b/.test(c.qlow))) return null
    const nMatch = c.qlow.match(/last (\d+)/)
    const n = nMatch ? +nMatch[1] : (/three/.test(c.qlow) ? 3 : /four/.test(c.qlow) ? 4 : /two/.test(c.qlow) ? 2 : 5)
    return hit(await recentForm(c.sbPublic, c.spec.teams[0], n)) } },

  // v26: "when is the LAST game (of the tournament / group stage)?" is a FUTURE schedule
  // question — the latest kickoff, never a past result (this used to answer a played QF).
  // MUST sit above `last_game`, which claims every other "last game" phrasing.
  { id: 'last_fixture', run: async (c) => {
    if (!(/\bwhen (is|are|does|will)\b/.test(c.qlow) && /\blast\b[\s\S]{0,24}\b(game|match|fixture)\b/.test(c.qlow))) return null
    let q2 = c.sbPublic.from('games').select('team_home, team_away, phase, kick_off_time').neq('phase', 'friendly').neq('team_home', 'TBD').order('kick_off_time', { ascending: false }).limit(1)
    if (c.spec.phase) q2 = q2.eq('phase', c.spec.phase)
    const g = (await q2).data?.[0]
    return g ? hit(`The last ${c.spec.phase ? (PHASE[c.spec.phase] ?? c.spec.phase) + ' game' : 'game of the tournament'} is ${g.team_home} vs ${g.team_away} — ${PHASE[g.phase as string] ?? g.phase}, ${fmtKO(g.kick_off_time as string)}.`) : null } },

  // v22: "the LAST game" is a PAST reference — it must never fall into the next-game
  // lookup ("what was the last finished game?" used to answer with the NEXT fixture).
  // v26: future-tense framings excluded (handled by `last_fixture` above); a detected phase
  // is honored ("what was the last quarter final" = that phase's most recent game).
  { id: 'last_game', run: async (c) => {
    if (!(/\b(last|latest|previous|most recent)\b[\s\S]{0,24}\b(game|match|fixture|result|score|one)\b|yesterday'?s? (game|match)|\bjust (finished|ended|concluded)\b/i.test(c.qlow) && !/next|coming|upcoming|remaining|left\b|last 16/.test(c.qlow) && !/\bwhen (is|are|does|will)\b/.test(c.qlow) && c.spec.teams.length <= 1)) return null
    const g = await resolveGameRef(c.sbPublic, 'last game', c.spec.teams, c.spec.phase)
    if (!g) return null
    if (/who scored|scorers?\b|who got the goals/.test(c.qlow)) return hit(await whoScored(c.sbPublic, g.team_home as string, g.team_away as string), { route: 'last_game_scorers' })
    return hit(await gameDetail(c.sbPublic, g.team_home as string, g.team_away as string)) } },

  // v23: "the NEXT/coming game" is a FUTURE reference — route it straight to the
  // next-fixture lookup. (An op borrowed from the previous turn — "how much points…?"
  // then "what is the coming next game?" — used to flip it into tournament progress.)
  { id: 'next_game', run: async (c) =>
    /\b(next|coming|upcoming)\b[\s\S]{0,24}\b(game|match|fixture|kick.?off)\b|\bwhat('s| is) next\b/i.test(c.qlow) && !/\b(games|matches|fixtures)\b/.test(c.qlow) && !/\b(last|latest|previous)\b|how (many|much)/.test(c.qlow) && !c.spec.date && !c.spec.phase && c.spec.teams.length <= 1
      ? hit(await lookupGame(c.sbPublic, c.spec.teams[0] ?? null, null)) : null },

  // v23: "which games went to penalties / extra time?" — deterministic list from the
  // went_to_* flags (used to fall into the upcoming-fixtures list or tournament progress).
  // v30: "regular time"/"90 min"/"regulation" qualifiers mean an in-play penalty KICK, never a
  // shootout — must win over et_pens_list, which only knows the went_to_penalties (shootout)
  // flag and used to answer shootout data for this completely different question.
  { id: 'regulation_penalty', run: async (c) =>
    /penalt/i.test(c.qlow) && /\b(regular|normal|90'?|90 ?min|regulation)\b/i.test(c.qlow) && !/shoot.?out|extra time/i.test(c.qlow)
      ? hit(await regulationPenaltyList(c.sbPublic), { route: 'regulation_penalty' }) : null },

  { id: 'et_pens_list', run: async (c) =>
    /penalt|shoot.?out|extra time/i.test(c.qlow) && c.spec.teams.length < 2 && !/what happens|affects?|\brules?\b|predictions?|scoring|points/.test(c.qlow) && (/\b(which|what|list|show|any|how many|how much)\b[\s\S]{0,30}\b(games?|matches)\b/.test(c.qlow) || /\bgames? (that |which )?(went|go(es)?|gone)\b/.test(c.qlow))
      ? hit(await etPensList(c.sbPublic, c.question)) : null },

  // v26: a SINGLE-stat game question ("how many red cards in PSG vs Arsenal?") answers just
  // that stat — the full box-score dump is reserved for "stats"-type asks.
  { id: 'game_stat_single', run: async (c) =>
    c.spec.teams.length >= 2 && c.spec.dim && !/\bstats?\b|statistic|box score/.test(c.qlow) && /cards?|corners|fouls|possession|shots?|offsides?|\bxg\b|yellow|red/.test(c.qlow) && !/who scored|scorer|summar/i.test(c.qlow) && c.spec.op !== 'compare' && !/tournament|overall|in total|this competition/.test(c.qlow)
      ? hit(await gameStatSingle(c.sbPublic, c.spec.teams[0], c.spec.teams[1], c.spec.dim)) : null },

  // P1: per-game match stats (box score) — "shots/corners/possession/cards for TeamA vs TeamB".
  // v24: +cards/fouls/offsides keywords; never hijack a COMPARE or tournament-wide question.
  { id: 'box_score', run: async (c) =>
    c.spec.teams.length >= 2 && /\bstat|statistic|\bshots?\b|corners|possession|passes|\bxg\b|box score|cards?\b|fouls|offsides?/i.test(c.qlow) && !/who scored|scorer|summar/i.test(c.qlow) && c.spec.op !== 'compare' && !/tournament|overall|in total|this competition/.test(c.qlow)
      ? hit(await gameStats(c.sbPublic, c.spec.teams[0], c.spec.teams[1])) : null },

  // P1: game detail (extra time / penalties). (box-score & detail are public match data — "give me"
  // is NOT a personal cue here, so no first-person guard; only tournamentProgress needs one below.)
  { id: 'game_detail', run: async (c) =>
    /extra time|\bet\b|penalt|shoot.?out|went to (extra|pens)/i.test(c.qlow) && c.spec.teams.length >= 2
      ? hit(await gameDetail(c.sbPublic, c.spec.teams[0], c.spec.teams[1])) : null },

  // P0: ranking / leaderboard — v24: runs BEFORE the count/agg rule ("which team commits the
  // most fouls per game?" — "per game" set agg=avg and the count rule grabbed it).
  { id: 'stat_leaderboard', run: async (c) =>
    c.spec.op === 'rank' && dimToMetric(c.spec.dim, c.question) ? hit(await statLeaderboard(c.sbPublic, dimToMetric(c.spec.dim, c.question)!, c.question)) : null },

  { id: 'compare_teams', run: async (c) =>
    c.spec.op === 'compare' && c.spec.teams.length >= 2 ? hit(await compareTeams(c.sbPublic, c.spec.teams[0], c.spec.teams[1])) : null },

  // v29: tournament-wide card TOTALS ("how many red cards in the tournament?") are a SUM(),
  // never a similarity search — this used to have no deterministic path and fell all the way
  // through to the RAG crew, which fabricated "there have been 0 red cards" (truth: 13).
  // Must sit above `counts`, which has no branch for a team-less card aggregate either.
  { id: 'cards_total', run: async (c) => {
    // "how many PLAYERS got a red card" is a count of PEOPLE (existing `counts`/playerCount
    // branch below) — this rule is a card-EVENT sum only, and must defer to that one.
    if (c.spec.teams.length || c.firstPerson || /\bplayers?\b/.test(c.qlow)) return null
    const wantRed = /\bred\b/.test(c.qlow), wantYellow = /\byellow\b/.test(c.qlow)
    if (!(wantRed || wantYellow) || !/\bcards?\b/.test(c.qlow)) return null
    if (!/how (many|much)\b|\btotal\b|\boverall\b|in the tournament\b|\bcount\b/.test(c.qlow)) return null
    return hit(await cardsTotal(c.sbPublic, wantRed && wantYellow ? 'both' : wantRed ? 'red' : 'yellow'), { route: 'cards_total' }) } },

  // P0/P1: aggregate & per-entity counts
  { id: 'counts', run: async (c) => {
    if (!(c.spec.op === 'count' || c.agg !== 'none')) return null
    const metric = dimToMetric(c.spec.dim, c.question)
    const wantsGames = /\bgames?\b|\bmatch(es)?\b|played|remain|left|fixtures?/.test(c.qlow) && !/goal|assist|card|per (game|match)/.test(c.qlow)
    // v26: "how many goals has the LEADING scorer scored?" — a superlative entity inside a
    // count question is a rank answer, not tournament totals.
    if (/\b(top|leading|best)\b[\s\S]{0,16}\b(scorer|goalscorer|player)\b/.test(c.qlow) && metric && !c.firstPerson) return hit(await statLeaderboard(c.sbPublic, metric, c.question), { route: 'stat_leader' })
    // v26: "how many PLAYERS got a red card / scored?" — count players, never a stat-card dump.
    if (/\bplayers?\b/.test(c.qlow) && /red|yellow|card|goal|assist|scor/.test(c.qlow) && !wantsGames && !c.firstPerson)
      return hit(await playerCount(c.sbPublic, c.spec.dim ?? (c.qlow.includes('red') ? 'red' : c.qlow.includes('yellow') ? 'yellow' : /card|book/.test(c.qlow) ? 'cards' : /assist/.test(c.qlow) ? 'assists' : 'goals')), { route: 'player_count' })
    if (c.spec.teams.length && (metric || wantsGames)) return hit(await teamStat(c.sbPublic, c.spec.teams[0], c.spec.dim), { route: 'team_stat' })
    if (c.agg === 'avg' && (c.spec.dim === 'goals_or_attack' || c.spec.dim === 'goals') && !c.spec.teams.length) return hit(await avgGoalsPerGame(c.sbPublic), { route: 'avg_goals' })
    if (!wantsGames && /goal|assist|card/.test(c.qlow)) {
      let p = await resolvePlayer(c.sbPublic, c.question, c.names)
      // v27: "how many goals does HE have?" — the player lives in the previous ANSWER
      if (!p && c.lastAnswer && /\b(he|him|his|she|her|they|them)\b/.test(c.qlow)) p = await resolvePlayer(c.sbPublic, c.lastAnswer, c.names)
      if (p) return hit(playerStat(p, c.spec.dim), { route: 'player_stat' })
    }
    // tournament-wide progress is a SCHEDULE answer — never let it grab a first-person question
    if ((wantsGames || /goal/.test(c.qlow)) && !c.firstPerson) return hit(await tournamentProgress(c.sbPublic, c.question), { route: 'tournament_progress' })
    return null } },

  { id: 'bracket_status', run: async (c) =>
    /still in|knocked out|eliminated|out of the (tournament|cup)|still alive|gone through/i.test(c.qlow) && c.spec.teams.length
      ? hit(await bracketStatus(c.sbPublic, c.spec.teams[0])) : null },
]
// v27: `prev` = the previous turn's RESOLVED spec (client-echoed prev_spec, or clause 1's
// spec for compound clause 2) — structured borrowing beats text re-parsing.
async function routeQuestion(question: string, history: string[], d: RouteDeps, prev?: { teams?: string[]; dim?: string | null }): Promise<RouteOut> {
  const { openai, sbPublic, sbUser, sbService, me, names } = d
  // v29 S1: pure courtesy — never touches data, auth, or the LLM. Before this, a stray
  // "thanks!" landed on a misclassified private intent and demanded a login.
  if (/^\s*(thanks?( you)?( (so|very) much)?|ok(ay)?|cool|nice|got it|great|sounds good|perfect|bye|goodbye)\s*[!.]*\s*$/i.test(question))
    return { answer: "You're welcome! Ask me anything else about the tournament or the app.", pub: { intent: 'courtesy' }, extra: { llm_used: false, route: 'courtesy' } }
  // P1: a definitive rules FACT wins before the embedding classifier can misroute it to a data
  // intent (e.g. "how many points is the top scorer worth"). The exact-score FAQ regex is scoped
  // to require "points", so first-person personal counts ("how many exact scores do I have") fall
  // through to normal routing rather than being answered as a rule.
  { const faqEarly = rulesFAQ(question); if (faqEarly) return { answer: faqEarly, pub: { intent: 'rules' }, extra: { llm_used: false, route: 'rules_faq' } } }

  // v26: OpenAI must never take down the deterministic routes — on embed/classify failure
  // fall back to keyword-only routing (qvec=null skips the dim-embedding and RAG paths).
  let qvec: number[] | null = null
  let cls = { intent: 'rules', confidence: 0.5, margin: 1, second: '' }
  let degraded = false
  try { const [v] = await embed(openai, question); qvec = v; cls = await classify(sbPublic, qvec) }
  catch { degraded = true; cls = { intent: guessIntent(question), confidence: 0.29, margin: 1, second: '' } }
  let teams = resolveTeams(question, names)
  let dim = qvec ? await classifyDim(sbPublic, question, qvec) : detectDim(question)
  let agg = detectAgg(question)
  let op = detectOp(question)
  let phase = detectPhase(question)
  // P3: under-specified follow-up -> borrow from the previous turn. v24: TEAM + PHASE borrowing is
  // decoupled from op/dim borrowing (a fully-specified clause like "how many have they conceded?"
  // still needs the previous turn's TEAM, but must keep its OWN op/dim; and a clause with its own
  // phase — "when is the final" — must not inherit anything).
  // v27: STRUCTURED borrow first — the echoed resolved spec, then entities literally present
  // in the last bot ANSWER (he/him/his stays a PLAYER ref, so no team-borrow then), and only
  // then the old text re-parse of prior questions.
  if (teams.length === 0 && !phase && prev?.teams?.length) teams = prev.teams.filter((t) => names.includes(t)).slice(0, 3)
  if (teams.length === 0 && !phase && d.lastAnswer && !/\b(he|him|his|she|her)\b/.test(question.toLowerCase())) teams = teamsInText(d.lastAnswer, names).slice(0, 2)
  if (!dim && op === 'lookup' && prev?.dim) dim = prev.dim
  if (history.length && teams.length === 0 && !phase) {
    const ctx = history.join(' ') + ' ' + question
    teams = resolveTeams(ctx, names)
    phase = detectPhase(ctx)
    if (!dim && op === 'lookup') { dim = detectDim(ctx); if (agg === 'none') agg = detectAgg(ctx); op = detectOp(ctx) }
  }
  let intent = cls.intent
  if (intent === 'who_scored' && detectPredicate(question)) intent = 'group_history'  // "who PREDICTED..." vs "who SCORED..."
  const spec: Spec = { intent, confidence: Number(cls.confidence.toFixed(3)), margin: Number(cls.margin.toFixed(3)), second: cls.second, op, dim, teams, date: resolveDate(question), phase, predicate: detectPredicate(question) }
  const pubSpec = { intent: spec.intent, confidence: spec.confidence, teams: spec.teams, op: spec.op, dim: spec.dim, ...(degraded ? { degraded: true } : {}) }
  // v29 V1: a WEAKLY-classified question must never silently reuse the PREVIOUS turn's answer
  // verbatim — a typo ("nexg") once replayed a red-card list for a schedule question because
  // the borrow logic filled the gap from lastAnswer. Scoped to low-confidence classifications
  // only, so two confident re-phrasings of the SAME question (which SHOULD share an answer,
  // e.g. "who's the top scorer" asked twice) are never falsely flagged as a repeat bug.
  const done = (answer: string, extra: Record<string, unknown> = {}): RouteOut => {
    const ans = answer || "Sorry, I couldn't find an answer."
    const prevQ = history.length ? history[history.length - 1]?.trim().toLowerCase() : ''
    if (d.lastAnswer && ans === d.lastAnswer && prevQ && prevQ !== question.trim().toLowerCase() && (spec.confidence < CLARIFY_CONF || spec.intent === 'off_topic'))
      return { answer: "I'm not confident I understood that — could you rephrase it?", pub: pubSpec, extra: { llm_used: false, route: 'repeat_guard' } }
    return { answer: ans, pub: pubSpec, extra }
  }
  console.log(JSON.stringify({ q: question, intent: spec.intent, op: spec.op, dim: spec.dim, agg, conf: spec.confidence, margin: spec.margin, teams: spec.teams.length }))
  const qlow = question.toLowerCase()
  const firstPerson = /\b(i|i'm|im|my|mine|me|myself)\b/i.test(qlow)

  // v28: run the ordered rule table (was a 175-line if/return chain — see ROUTE_RULES).
  // First non-null wins; `route` defaults to the rule id, so EVERY answer is now attributable
  // in ask_log (a rule can still override it — e.g. `odds` reports champion_odds vs game_odds).
  const groupScoped = /\b(our|my)\b[\s\S]{0,20}\bgroups?\b|\bgroup (standings|leaderboard|table)\b/.test(qlow)
  const rctx: RuleCtx = { question, qlow, spec, agg, firstPerson, history, lastAnswer: d.lastAnswer, openai, sbPublic, sbUser, sbService, me, names, groupScoped, namedGroup: groupRefCandidate(question) }
  for (const r of ROUTE_RULES) {
    const h = await r.run(rctx)
    if (h) return done(h.answer, { llm_used: false, route: r.id, ...h.extra })
  }
    // ---- CLARIFY only when nothing concrete matched (rare) ----
    if (!(spec.intent === 'off_topic' && spec.confidence < CONF_MIN) && spec.op === 'lookup' && agg === 'none' && spec.margin < CLARIFY_MARGIN && spec.confidence < CLARIFY_CONF && spec.second && spec.second !== spec.intent) {
      // v20: before asking the user to rephrase, spend ONE LLM call to parse the QUESTION
      // TEXT into a structured spec, then execute it deterministically (no data to the LLM).
      // v27: runs for ANON users too (public asks: schedule/game_stat/leaderboard), and the
      // LLM receives the partial deterministic parse so it only fills the gaps.
      const uid = await me()
      const groups = uid ? await myGroups(sbUser, uid) : []
      const members = uid ? await myGroupMembers(sbUser, groups.map((g) => g.id)) : []
      const u = await llmUnderstand(openai, question, groups.map((g) => g.name), members.map((m) => m.username), `teams=${spec.teams.join('|') || 'none'}, stat-dim=${spec.dim ?? 'none'}, phase=${spec.phase ?? 'none'}`)
      const ans = await execUnderstood(u, { question, sbPublic, sbUser, names }, uid ?? '', groups, members)
      if (ans) return done(ans, { llm_used: true, fallback: true })
      const label: Record<string, string> = { schedule: 'the schedule', who_scored: 'match scorers', stats: 'team/player stats', my_data: 'your own stats', group_standings: 'group standings', group_history: 'group predictions', rules: 'how the app works' }
      return done(`I'm not sure if you mean ${label[spec.intent] ?? spec.intent} or ${label[spec.second] ?? spec.second}. Could you rephrase?`, { llm_used: false, clarify: true })
    }

    // v26: the poisonable cross-user qa_cache is REMOVED — an injected "rules question"
    // could get its LLM answer served to OTHER users at >=0.93 similarity. At 5 cached
    // rows lifetime it was saving nothing.

    // registry dispatch for intent-based tools (schedule/who_scored/my_data/group_*)
    for (const t of REGISTRY) {
      if (t.match(spec)) { const r = await t.run({ spec, question, sbPublic, sbUser, sbService, openai, me, names }); return done(r.answer, { llm_used: !!r.llm, route: t.id }) }
    }

    // rules -> deterministic FAQ, else grounded LLM
    if (spec.intent === 'rules') {
      const faq = rulesFAQ(question); if (faq) return done(faq, { llm_used: false, route: 'rules_faq' })
      // v24: a 1-2 word fragment ("score?") gets a clarify, not an LLM guess
      if (qlow.replace(/[^a-zא-׿ ]/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 2 && spec.teams.length === 0 && !spec.phase && !spec.date)
        return done('Could you give me a bit more? e.g. "what was the score of Argentina vs Colombia?" or "when is the next game?"', { llm_used: false, clarify: true })
      try {
        // v29: FACTS (incl. today's date) computed fresh per-request — RULES_PROMPT alone had
        // no clock, so it once told a user trivia "hasn't started, it's before June 11" on a
        // date five weeks past that.
        const sys = RULES_PROMPT + factsBlock()
        assertPublicPayload('rulesLLM', sys, question)
        const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.2, seed: 42, max_tokens: 350, messages: [{ role: 'system', content: sys }, { role: 'user', content: question }] })
        return done(res.choices[0]?.message?.content?.trim() ?? '', { llm_used: true, route: 'rules_llm' })
      } catch { return done("I'm having trouble reaching my language model right now — try again in a minute, or ask me a data question (schedule, scores, standings) which I can answer directly.", { llm_used: false, degraded: true }) }
    }

    // stats fuzzy "describe" -> RAG + crew (never cached: volatile)
    if (spec.intent === 'stats') {
      // v20: a "stats" question that actually names YOUR group or a group-MATE is a private
      // question in disguise ("hows my squad beta sharks holding up?") — the public crew can
      // never answer it. Divert to the understanding fallback (question text only to the LLM).
      const uid = await me()
      if (uid) {
        const groups = await myGroups(sbUser, uid)
        const members = await myGroupMembers(sbUser, groups.map((g) => g.id))
        if (groups.length && (resolveGroupName(question, groups) || groupRefCandidate(question) || resolveMemberName(question, members))) {
          const u = await llmUnderstand(openai, question, groups.map((g) => g.name), members.map((m) => m.username))
          const ans = await execUnderstood(u, { question, sbPublic, sbUser, names }, uid, groups, members)
          if (ans) return done(ans, { llm_used: true, fallback: true })
        }
      }
      // P2: a superlative that didn't resolve to a deterministic metric must NOT go to the crew —
      // the LLM would invent a leader. Ask which stat instead of hallucinating one.
      if ((spec.op === 'rank' || /\b(best|most|worst|highest|lowest|dirtiest|meanest|cleanest|leakiest)\b/.test(qlow)) && !dimToMetric(spec.dim, question))
        return done('Which stat do you mean — goals, assists, defense, possession, corners, fouls, or cards?', { llm_used: false, clarify: true })
      const cards = await searchStats(sbPublic, qvec, spec.teams)
      try {
        const crew = await answerCrew(openai, question, cards)
        return done(crew.answer || "I don't have stats to answer that yet.", { llm_used: crew.attempts > 0, retrieved: cards.length, route: 'rag_crew', crew: { attempts: crew.attempts, judge: crew.score } })
      } catch { return done("I don't have stats to answer that yet.", { llm_used: false, retrieved: cards.length, degraded: true }) }
    }

    // off_topic -> short LLM steer-back
    try {
      const sys = 'You are the WorldCup 2026 app assistant. The user asked something off-topic. Briefly and warmly say you focus on the app/tournament, then invite an on-topic question. 1-2 sentences.'
      assertPublicPayload('offTopic', sys, question)
      const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.4, seed: 42, max_tokens: 150, messages: [{ role: 'system', content: sys }, { role: 'user', content: question }] })
      return done(res.choices[0]?.message?.content?.trim() ?? '', { llm_used: true, route: 'off_topic' })
    } catch { return done('I focus on the tournament and the app — ask me about the schedule, scores, standings or the rules!', { llm_used: false, degraded: true }) }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const t0 = Date.now()
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('AI_Summary_GPT_Key') || ''
    if (!openaiKey) return json({ ok: false, error: 'OpenAI key not configured.' }, 500)
    // v26: bounded client — the SDK default is a 10-MINUTE timeout with 2 retries, which
    // could hold a hung request past the Edge Function wall clock.
    const openai = new OpenAI({ apiKey: openaiKey, timeout: 12_000, maxRetries: 1 })
    const body = await req.json().catch(() => ({}))
    if (typeof body?.mode === 'string' && body.mode.startsWith('reindex')) {
      // v26/v27: reindex is ADMIN-ONLY — it deletes + re-embeds whole tables and spends
      // OpenAI money, so the public anon key must not reach it.
      // The gate is a CAPABILITY check, not a string compare: we try a read that only
      // service_role can do (ask_log has RLS on and its grants revoked from anon +
      // authenticated). v26 compared the header to SUPABASE_SERVICE_ROLE_KEY, which also
      // rejected the LEGACY JWT service key held in the vault — so pg_cron/net.http_post,
      // the one caller that actually needs this, got a 403.
      const callerKey = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const canAdmin = callerKey && !(await createClient(url, callerKey).from('ask_log').select('id').limit(1)).error
      if (!canAdmin) return json({ ok: false, error: 'reindex requires the service-role key' }, 403)
      const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      if (body.mode === 'reindex_intents') return await reindexIntents(openai, svc)
      if (body.mode === 'reindex_dims') return await reindexDims(openai, svc)
      if (body.mode === 'reindex_kb') return await reindexKb(openai, svc)
      return json({ ok: false, error: 'unknown mode' }, 400)
    }

    const question = body?.question
    if (!question || typeof question !== 'string') return json({ ok: false, error: 'Missing question.' }, 400)
    const pg = preGuard(question)
    if (!pg.ok) return json({ step: 'final', ok: true, spec: { intent: 'blocked' }, llm_used: false, answer: pg.msg })

    const authHeader = req.headers.get('Authorization') ?? ''
    const sbPublic = createClient(url, anon)
    const sbUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const sbService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    let _me: string | null | undefined
    const me = async () => { if (_me === undefined) _me = (await sbUser.auth.getUser()).data?.user?.id ?? null; return _me }
    // v26: rate key = token tail + client IP. Every signed-out visitor sends the SAME anon
    // key, so they all shared one bucket (one curl loop rate-limited every logged-out user).
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'noip'
    if (!rateOk((authHeader.slice(-24) || 'anon') + '|' + ip)) return json({ step: 'final', ok: true, spec: { intent: 'rate_limited' }, llm_used: false, answer: 'You are asking a lot very fast — give me a few seconds and try again.' })

    const names = await fetchTeamNames(sbPublic)
    // v26: history items are length-capped (they flow into lev/regex passes — a multi-MB
    // item was a CPU-exhaustion vector) and pass the same preGuard as the question.
    // v27: window widened to 3 user turns; the client also echoes the last resolved spec
    // (prev_spec) and the last bot answer (last_answer) for structured/answer-aware borrowing.
    const history: string[] = Array.isArray(body?.history) ? body.history.filter((x: any) => typeof x === 'string' && preGuard(x).ok).map((x: string) => x.slice(0, 500)).slice(-3) : []
    const prevSpec = body?.prev_spec && typeof body.prev_spec === 'object'
      ? { teams: Array.isArray(body.prev_spec.teams) ? body.prev_spec.teams.filter((t: any) => typeof t === 'string').slice(0, 3) : [], dim: typeof body.prev_spec.dim === 'string' ? body.prev_spec.dim : null }
      : undefined
    const lastAnswer = typeof body?.last_answer === 'string' ? body.last_answer.slice(0, 1200) : undefined
    const deps: RouteDeps = { openai, sbPublic, sbUser, sbService, me, names, lastAnswer }

    // v26: every answered question is logged (service-role-only table) — question, route,
    // answer, latency. Without this, user complaints were undebuggable after EF log expiry.
    const finish = async (payload: Record<string, unknown>, answer: string) => {
      try {
        // v29 P9: validation_fail records when a deterministic check rejected the FIRST answer
        // and this is the fallback that shipped instead — today only V1 (`repeat_guard`) writes
        // one; expected_shape/rows_count are reserved for the full validation-layer pass.
        const route = (payload.route as string) ?? null
        await sbService.from('ask_log').insert({ user_id: await me(), question: question.slice(0, 500), intent: (payload.spec as any)?.intent ?? null, route, answer: (answer ?? '').slice(0, 2000), llm_used: !!payload.llm_used, latency_ms: Date.now() - t0, validation_fail: route === 'repeat_guard' ? 'repeat' : null })
      } catch { /* logging must never break the answer */ }
      return json({ ...payload, answer })
    }

    // v19: compound questions — route each clause (clause 2 sees clause 1 as history
    // so it can borrow entities), then join the two answers.
    const parts = splitCompound(question)
    const r1 = await routeQuestion(parts[0], history, deps, prevSpec)
    if (parts.length === 1) return await finish({ step: 'final', ok: true, spec: r1.pub, ...r1.extra }, r1.answer)
    // v27: clause 2 receives clause 1's RESOLVED spec (not just its text)
    const r2 = await routeQuestion(parts[1], [...history, parts[0]], deps, { teams: (r1.pub.teams as string[]) ?? [], dim: (r1.pub.dim as string | null) ?? null })
    // v26: a clause-2 clarify/parse-failure must not pollute a good clause-1 answer.
    if (r2.extra?.clarify && !r1.extra?.clarify) return await finish({ step: 'final', ok: true, spec: r1.pub, ...r1.extra }, r1.answer)
    return await finish({ step: 'final', ok: true, spec: r1.pub, spec2: r2.pub, compound: true, llm_used: !!(r1.extra.llm_used || r2.extra.llm_used) }, `${r1.answer}\n\n${r2.answer}`)
  } catch (err) {
    // v26: never leak raw internals; answer with a friendly degraded message instead of a 500.
    console.error('ask fatal:', String(err))
    return json({ step: 'final', ok: true, degraded: true, spec: { intent: 'error' }, llm_used: false, answer: "I'm having trouble answering right now — please try again in a minute." })
  }
})

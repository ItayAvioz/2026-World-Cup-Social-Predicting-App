// ask — in-app AI bot (DEV ONLY) — v20 privacy clarity + LLM understanding fallback
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
const CACHE_HIT = 0.93
const JUDGE_MIN = 7
const MAX_WRITER = 2
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
Missed a prediction? The app auto-predicts a random score for you — you can still earn points on luck.

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

PREDICTIONS: per game, per group, editable until that game's kickoff; miss = auto-random.
Your prediction stays hidden until kickoff, then all group members' predictions are revealed (incl. auto ones).

GROUPS: private, invite-only. Max 3 groups per user; max 12 members per group. Each group is its own
competition — independent leaderboard, picks, predictions, and nightly AI roast. You could be last in one
group and first in another. You cannot leave or delete a group; captains can mark inactive members.

LEADERBOARDS: a global leaderboard (all players) + a per-group leaderboard. Both show group rank and
global rank. Ties are broken by number of exact scorelines.

USING THE APP (navigation — where things live):
- BOTTOM NAV has 4 tabs: Dashboard, Groups, Picks, AI.
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
- TRIVIA: one question per day at 22:00 Israel (from June 11). 40 seconds, one shot, no retries — miss it
  and it counts as wrong.
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

// ---- guardrails -------------------------------------------------------------
function preGuard(q: string): { ok: boolean; msg?: string } {
  if (q.length > 500) return { ok: false, msg: 'That question is a bit long — please shorten it.' }
  if (/ignore (all )?(previous|prior) instructions|disregard (the )?(system|rules|instructions)|reveal (the )?(system prompt|instructions)|dump (all|everyone|every)|show (me )?(all|everyone).{0,20}(prediction|pick)/i.test(q))
    return { ok: false, msg: "I can't help with that — but ask me anything about the tournament, the app, or your groups!" }
  return { ok: true }
}
// v19: compound questions — split into at most 2 self-contained clauses. A pure
// drill-down tail ("...? and in which games?") is NOT split: the main tool answers
// it inline (myExact always lists the games). Clause 2 borrows entities from
// clause 1 via the existing follow-up history mechanism.
function splitCompound(q: string): string[] {
  const m = q.match(/^(.*?\?)\s*(?:and|&)\s+(.{4,})$/i) || q.match(/^(.{10,}?)\s+and\s+((?:when|where|who|what|how many|how much)\b.{4,})$/i)
  if (!m) return [q]
  const tail = m[2].trim()
  if (/^(in\s+)?which (games?|matches|ones)\b/i.test(tail)) return [q]
  return [m[1].trim(), tail]
}
const RL = new Map<string, number[]>()
function rateOk(key: string): boolean {
  const now = Date.now(), arr = (RL.get(key) ?? []).filter((t) => now - t < RATE_WIN)
  arr.push(now); RL.set(key, arr); return arr.length <= RATE_MAX
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
async function fetchTeamNames(sb: Sb): Promise<string[]> {
  const { data } = await sb.from('games').select('team_home, team_away').range(0, 999)
  const s = new Set<string>(); for (const g of data ?? []) { if (g.team_home) s.add(g.team_home as string); if (g.team_away) s.add(g.team_away as string) }
  s.delete('TBD'); return [...s]
}
const TEAM_ALIAS: Record<string, string> = { psg: 'Paris Saint Germain', 'man city': 'Manchester City', 'man utd': 'Manchester United', 'man united': 'Manchester United', spurs: 'Tottenham', usa: 'United States', 'u.s.a': 'United States', 'the states': 'United States', holland: 'Netherlands', oranje: 'Netherlands', 'the dutch': 'Netherlands', 'three lions': 'England', 'les bleus': 'France', 'la albiceleste': 'Argentina', selecao: 'Brazil', 'la roja': 'Spain', socceroos: 'Australia', 'the azzurri': 'Italy', azzurri: 'Italy', 'die mannschaft': 'Germany' }
const COMMON_TOK = new Set(['united', 'city', 'republic', 'north', 'south', 'saint', 'their', 'about', 'which', 'these', 'those', 'there', 'where'])
function resolveTeams(q: string, names: string[]): string[] {
  const ql = ' ' + q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '
  const qtok = ql.trim().split(' ').filter((w) => w.length >= 4)
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
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function dayRange(y: number, m: number, d: number, label: string) { return { start: new Date(Date.UTC(y, m, d)).toISOString(), end: new Date(Date.UTC(y, m, d + 1)).toISOString(), label } }
function resolveDate(q: string): { start: string; end: string; label: string } | null {
  const s = q.toLowerCase(), now = new Date(), Y = now.getUTCFullYear()
  if (/\btoday\b|\btonight\b/.test(s)) return dayRange(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 'today')
  if (/\btomorrow\b/.test(s)) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + 1); return dayRange(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 'tomorrow') }
  if (/this weekend|the weekend/.test(s)) { const d = new Date(now); const add = (6 - d.getUTCDay() + 7) % 7; d.setUTCDate(d.getUTCDate() + add); const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 2); return { start: start.toISOString(), end: end.toISOString(), label: 'this weekend' } }
  let m = s.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/)
  if (m) { const a = m[1], b = m[2]; const mon = MONTHS.indexOf((isNaN(+a) ? a : b).slice(0, 3)); const day = +(isNaN(+a) ? b : a); if (mon >= 0 && day >= 1 && day <= 31) return dayRange(Y, mon, day, `${MONTHS[mon][0].toUpperCase()}${MONTHS[mon].slice(1)} ${day}`) }
  return null
}
const PHASE: Record<string, string> = { group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-Final', sf: 'Semi-Final', third: 'Third Place', final: 'Final' }
const PHASE_WORD: [RegExp, string][] = [[/round of 32|\br32\b/i, 'r32'], [/round of 16|last 16|\br16\b/i, 'r16'], [/quarter[- ]?finals?|\bqf\b/i, 'qf'], [/semi[- ]?finals?|\bsf\b/i, 'sf'], [/third[- ]?place|3rd[- ]?place/i, 'third'], [/\bfinals?\b/i, 'final']]
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
  const team = /\bteam\b|\bside\b/.test(q.toLowerCase())
  switch (dim) {
    case 'assists': return 'assists'; case 'defense': return 'defense'; case 'possession': return 'possession'
    case 'corners': return 'corners'; case 'fouls': return 'fouls'; case 'red': return 'redP'
    case 'yellow': return team ? 'teamYellow' : 'yellowP'; case 'cards': return team ? 'teamYellow' : 'cardsP'
    case 'goals_or_attack': return team ? 'attack' : 'goals'; default: return null
  }
}

// ---- deterministic tools ----------------------------------------------------
function fmtKO(iso: string): string { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()][0].toUpperCase()}${MONTHS[d.getUTCMonth()].slice(1)} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC` }
async function lookupGame(sb: Sb, team: string | null, wantPhase: string | null): Promise<string> {
  let q = sb.from('games').select('team_home, team_away, kick_off_time, phase, score_home, score_away').order('kick_off_time', { ascending: true }).limit(1)
  if (wantPhase) q = q.eq('phase', wantPhase).neq('team_home', 'TBD')
  else q = q.gt('kick_off_time', new Date().toISOString())
  if (team) q = q.or(`team_home.eq.${team},team_away.eq.${team}`)
  const g = (await q).data?.[0]
  if (!g) return wantPhase ? `The ${PHASE[wantPhase] ?? wantPhase} matchup isn't set yet.` : (team ? `${team} has no upcoming games scheduled.` : `No upcoming games are scheduled.`)
  const ph = PHASE[g.phase as string] ?? (g.phase as string)
  if (wantPhase) return g.score_home !== null ? `The ${ph} was ${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away} (${fmtKO(g.kick_off_time as string)}).` : `The ${ph} is ${g.team_home} vs ${g.team_away}, ${fmtKO(g.kick_off_time as string)}.`
  if (team) { const opp = g.team_home === team ? g.team_away : g.team_home; const side = g.team_home === team ? 'vs' : 'away to'; return `${team}'s next game is ${side} ${opp} — ${ph}, ${fmtKO(g.kick_off_time as string)}.` }
  return `The next game is ${g.team_home} vs ${g.team_away} — ${ph}, ${fmtKO(g.kick_off_time as string)}.`
}
async function scheduleList(sb: Sb, date: { start: string; end: string; label: string } | null, phase: string | null): Promise<string> {
  let q = sb.from('games').select('team_home, team_away, kick_off_time, phase, score_home, score_away').neq('phase', 'friendly').neq('team_home', 'TBD').order('kick_off_time', { ascending: true }).limit(12)
  if (date) q = q.gte('kick_off_time', date.start).lt('kick_off_time', date.end)
  else if (phase) q = q.eq('phase', phase)
  else q = q.gt('kick_off_time', new Date().toISOString())
  const rows = (await q).data ?? []
  if (!rows.length) return date ? `No games are scheduled for ${date.label}.` : (phase ? `No ${PHASE[phase] ?? phase} games are scheduled yet.` : `No upcoming games are scheduled.`)
  const head = date ? `Games ${date.label}:` : (phase ? `${PHASE[phase] ?? phase} games:` : `Upcoming games:`)
  return head + '\n' + rows.map((g) => `• ${g.team_home} ${g.score_home !== null ? `${g.score_home}-${g.score_away}` : 'vs'} ${g.team_away} — ${fmtKO(g.kick_off_time as string)}`).join('\n')
}
async function tournamentProgress(sb: Sb, q: string): Promise<string> {
  const base = sb.from('games').select('score_home, score_away', { count: 'exact', head: false }).neq('phase', 'friendly').neq('team_home', 'TBD')
  const { data } = await base
  const rows = data ?? []
  const played = rows.filter((g) => g.score_home !== null)
  const remaining = rows.length - played.length
  if (/\bgoals?\b/.test(q.toLowerCase())) { const goals = played.reduce((s, g) => s + (g.score_home as number) + (g.score_away as number), 0); return `${goals} goals have been scored across ${played.length} completed games so far.` }
  return `${played.length} of ${rows.length} games have been played; ${remaining} remain.`
}
async function findGame(sb: Sb, a: string, b: string) {
  const one = async (h: string, w: string) => (await sb.from('games').select('id, team_home, team_away, score_home, score_away, phase, kick_off_time, went_to_extra_time, went_to_penalties, et_score_home, et_score_away, penalty_score_home, penalty_score_away, knockout_winner').eq('team_home', h).eq('team_away', w).order('kick_off_time', { ascending: false }).limit(1)).data?.[0]
  return (await one(a, b)) ?? (await one(b, a))
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
  attack: { level: 'team', col: 'avg_goals_scored', dir: 'desc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the best attack, scoring ${(+v).toFixed(1)} goals per game.` },
  defense: { level: 'team', col: 'avg_goals_conceded', dir: 'asc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the best defense, conceding ${(+v).toFixed(1)} goals per game.` },
  possession: { level: 'team', col: 'avg_possession', dir: 'desc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'have' : 'has'} the most possession, ${(+v).toFixed(1)}% per game.` },
  corners: { level: 'team', col: 'avg_corners', dir: 'desc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'win' : 'wins'} the most corners, ${(+v).toFixed(1)} per game.` },
  fouls: { level: 'team', col: 'avg_fouls', dir: 'desc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'commit' : 'commits'} the most fouls, ${(+v).toFixed(1)} per game.` },
  teamYellow: { level: 'team', col: 'avg_yellow_cards', dir: 'desc', fmt: (n: string, v: number, c: number) => `${n} ${c > 1 ? 'pick' : 'picks'} up the most cards, ${(+v).toFixed(1)} yellow per game.` },
}
async function statLeaderboard(sb: Sb, key: string): Promise<string> {
  const M = STATLB[key]; if (!M) return 'I could not work out which stat you mean.'
  if (M.level === 'team') {
    const { data } = await sb.from('team_tournament_stats').select(`team, ${M.col}, games_played`).gt('games_played', 0)
    if (!data || !data.length) return 'No team stats are available yet.'
    const rows = [...data].sort((a: any, b: any) => M.dir === 'asc' ? a[M.col] - b[M.col] : b[M.col] - a[M.col])
    const ext = rows[0][M.col]; const lead = rows.filter((r: any) => r[M.col] === ext)
    return M.fmt(lead.map((r: any) => r.team).join(', '), ext, lead.length)
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
  const last = (await sb.from('games').select('team_home, team_away, phase, knockout_winner, score_home').or(`team_home.eq.${team},team_away.eq.${team}`).not('score_home', 'is', null).neq('phase', 'friendly').neq('phase', 'group').order('kick_off_time', { ascending: false }).limit(1)).data?.[0]
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
  const one = async (h: string, w: string) => (await sb.from('games').select('team_home, team_away, score_home, score_away, phase, went_to_extra_time, went_to_penalties, et_score_home, et_score_away, penalty_score_home, penalty_score_away, knockout_winner').eq('team_home', h).eq('team_away', w).order('kick_off_time', { ascending: false }).limit(1)).data?.[0]
  const g = (await one(a, b)) ?? (await one(b, a))
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
  return `${head}:\n${line(rh)}\n${line(ra)}`
}

// private (RLS via user JWT)
type Grp = { id: string; name: string }
async function myGroups(sbUser: Sb, me: string) {
  const gm = (await sbUser.from('group_members').select('group_id').eq('user_id', me)).data ?? []
  const ids = gm.map((r) => r.group_id as string); if (!ids.length) return [] as Grp[]
  const gr = (await sbUser.from('groups').select('id, name').in('id', ids)).data ?? []; return gr.map((g) => ({ id: g.id as string, name: g.name as string }))
}
// v19: resolve a group NAME the caller mentions against their OWN groups only
// (full-name match first, then name tokens; v20 adds typo tolerance). Never sees other users' groups.
function resolveGroupName(q: string, groups: Grp[]): Grp | null {
  const norm = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9א-׿֐-׏ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  const ql = norm(q)
  const qtok = ql.trim().split(' ').filter((w) => w.length >= 4)
  let best: { g: Grp; score: number } | null = null
  for (const g of groups) {
    const nl = norm(g.name).trim(); if (!nl) continue
    let score = 0
    if (ql.includes(' ' + nl + ' ')) score = 100 + nl.length
    else {
      const toks = nl.split(' ').filter((w) => w.length >= 3 && !['the', 'group', 'team'].includes(w))
      score = toks.filter((w) => ql.includes(' ' + w + ' ')).length
      if (!score) for (const t of toks) for (const qw of qtok) { const L = lev(t, qw); if ((t.length >= 4 && L === 1) || (t.length >= 6 && L === 2)) { score = 1; break } }  // typo tolerance
    }
    if (score && (!best || score > best.score)) best = { g, score }
  }
  return best?.g ?? null
}
// v20: detect a group NAME the caller referenced that is NOT one of their groups —
// so the bot refuses honestly instead of silently answering about all their groups.
// (accepts common typos of the word "group" itself)
function groupRefCandidate(q: string): string | null {
  const s = ' ' + q.toLowerCase().replace(/[^a-z0-9א-׿֐-׏ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  const m = s.match(/(?:in|of|for|from|leads?|wins?|winning|about) (?:the )?([a-z0-9א-׿]+(?: [a-z0-9א-׿]+)?) (?:group|droup|gorup|grup|goup)\b/)
    || s.match(/\b(?:group|droup|gorup|grup|goup) (?:called |named )?([a-z0-9א-׿]+)/)
  if (!m) return null
  const cand = m[1].trim()
  if (/^(my|our|the|a|an|this|that|his|her|their|its|first|second|third|other|another|new|old|whole|every|each|any|some|one|stage|same|which|what|winning|leading)$/.test(cand)) return null
  if (/\b(stage|stages)\b/.test(cand)) return null  // "group stage" is a tournament phase, not a group name
  return cand
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
  if (/last (game|match)|latest (game|match)|most recent (game|match)|yesterday'?s? (game|match)/i.test(q))
    return (await sb.from('games').select(COLS).not('score_home', 'is', null).neq('phase', 'friendly').neq('team_home', 'TBD').lte('kick_off_time', new Date().toISOString()).order('kick_off_time', { ascending: false }).limit(1)).data?.[0] ?? null
  if (teams.length === 1) return (await sb.from('games').select(COLS).or(`team_home.eq.${teams[0]},team_away.eq.${teams[0]}`).not('score_home', 'is', null).neq('phase', 'friendly').order('kick_off_time', { ascending: false }).limit(1)).data?.[0] ?? null
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
  const fin = game.score_home !== null
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
async function llmUnderstand(openai: OpenAI, question: string, groupNames: string[], memberNames: string[]): Promise<any | null> {
  try {
    const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0, seed: 7, max_tokens: 160, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: `Parse a WorldCup-predictions-app question into JSON with fields: asks (one of: member_prediction, group_board, group_meta, my_stats, other), group (a group name mentioned, else null), member (a person/username mentioned, else null), teams (array of football team names mentioned, else []), game_ref ("last"|"final"|null), stat ("exact"|"rank"|"points"|"picks"|null). The asker's groups: ${groupNames.join(', ') || '(none)'}. Their group-mates' usernames: ${memberNames.join(', ') || '(none)'}. Map typos/nicknames to those known names when clearly intended; if a mentioned group is NOT in the list, still return it verbatim. Output ONLY the JSON object.` },
      { role: 'user', content: question },
    ] })
    return JSON.parse(res.choices[0]?.message?.content ?? 'null')
  } catch { return null }
}
// v20: deterministic executor for the understood spec — reuses the same private tools.
async function execUnderstood(u: any, d: { question: string; sbPublic: Sb; sbUser: Sb; names: string[] }, meId: string, groups: Grp[], members: { id: string; username: string }[]): Promise<string | null> {
  if (!u || typeof u !== 'object') return null
  const target = u.group ? resolveGroupName(' ' + String(u.group) + ' ', groups) : null
  if (u.group && !target) return unknownGroupAnswer(String(u.group), groups)
  const member = u.member ? (resolveMemberName(' ' + String(u.member) + ' ', members) ?? resolveMemberName(d.question, members)) : null
  const teams = Array.isArray(u.teams) && u.teams.length ? resolveTeams(u.teams.join(' vs '), d.names) : []
  if (u.asks === 'member_prediction' || (member && member.id !== meId)) {
    const game = await resolveGameRef(d.sbPublic, `${u.game_ref === 'last' ? 'last game' : ''} ${d.question}`, teams, u.game_ref === 'final' ? 'final' : detectPhase(d.question))
    if (member && member.id !== meId) return await memberPrediction(d.sbUser, meId, member, game)
    if (game) return await groupHistory(d.sbPublic, d.sbUser, meId, game.team_home as string, game.team_away as string)
    return null
  }
  if (u.asks === 'group_meta') return await groupMeta(d.sbUser, meId, target ? [target] : groups, d.question.toLowerCase())
  if (u.asks === 'group_board') return await groupStandings(d.sbUser, meId, /exact/i.test(d.question), groups, target)
  if (u.asks === 'my_stats') {
    if (u.stat === 'exact') return await myExact(d.sbPublic, d.sbUser, meId, groups, target)
    if (u.stat === 'rank' || u.stat === 'points' || u.stat === 'picks') return await myFocus(d.sbUser, meId, groups, target, u.stat)
    return await myContext(d.sbUser, meId, groups, target)
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
  const rows = (await q).data ?? []
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
  for (const g of groups) { const rows = ((await sbUser.rpc('get_group_leaderboard', { p_group_id: g.id })).data ?? []) as any[]; if (!rows.length) { blocks.push(`${g.name}: (no members)`); continue }
    if (mostExact) { const t = [...rows].sort((a, b) => b.exact_scores - a.exact_scores)[0]; blocks.push(`${g.name}: most exact — ${t.username} (${t.exact_scores} exact, ${t.total_points} pts).`) }
    else blocks.push(`${g.name}: ` + [...rows].sort((a, b) => a.group_rank - b.group_rank).slice(0, 5).map((r) => `#${r.group_rank} ${r.username} ${r.total_points}pts${r.user_id === me ? ' (you)' : ''}`).join(', ')) }
  return blocks.join('\n')
}
async function globalStandings(sb: Sb, limit = 5): Promise<string> {
  const { data } = await sb.rpc('get_leaderboard')
  const rows = (data ?? []) as any[]; if (!rows.length) return 'The leaderboard is empty.'
  // The global board is one row per (player x group) — a player in N groups has N ranked rows.
  // Show them as-is with the group name; do NOT dedupe by username (that hid real ranks).
  const top = rows.slice(0, Math.max(1, Math.min(limit, 20)))
  return 'Global leaderboard (one row per player per group):\n' + top.map((r) => `${r.rank}. ${r.username} (${r.group_name}) — ${r.total_points} pts`).join('\n')
}
async function groupHistory(sbPublic: Sb, sbUser: Sb, me: string, a: string, b: string): Promise<string> {
  const game = await findGame(sbPublic, a, b); if (!game) return `I couldn't find a game between ${a} and ${b}.`
  const { data: preds } = await sbUser.from('predictions').select('user_id, group_id, pred_home, pred_away, points_earned, is_auto').eq('game_id', game.id)
  // v20: say exactly WHY nothing is visible — pre-kickoff privacy vs no shared group.
  if (!preds || preds.length === 0) {
    if (new Date(game.kick_off_time as string) > new Date()) return `${game.team_home} vs ${game.team_away} hasn't kicked off yet — everyone's predictions stay hidden until kickoff. Ask me again after the whistle!`
    return `${game.team_home} vs ${game.team_away}: no predictions are visible to you — you can only see predictions from members of YOUR groups (and your own).`
  }
  const uids = [...new Set(preds.map((p) => p.user_id as string))], gids = [...new Set(preds.map((p) => p.group_id as string).filter(Boolean))]
  const names = new Map<string, string>((((await sbUser.from('profiles').select('id, username').in('id', uids)).data) ?? []).map((r: any) => [r.id, r.username]))
  const gnames = new Map<string, string>((((await sbUser.from('groups').select('id, name').in('id', gids)).data) ?? []).map((r: any) => [r.id, r.name]))
  const fin = game.score_home !== null
  return `${game.team_home} ${fin ? `${game.score_home}-${game.score_away}` : 'vs'} ${game.team_away}:\n` + preds.map((p) => `${names.get(p.user_id as string) ?? 'someone'}${p.user_id === me ? ' (you)' : ''} [${gnames.get(p.group_id as string) ?? '—'}]: ${p.pred_home}-${p.pred_away}${p.is_auto ? ' auto' : ''}${fin ? ` [${p.points_earned}pt]` : ''}`).join('\n')
}
// rules FAQ (deterministic answers for high-value facts; null => LLM fallback)
function rulesFAQ(q: string): string | null {
  const s = q.toLowerCase()
  if (/exact (score|scoreline).*(point|worth|how many)|how many (points|pts).*exact|point.*exact score|exact.*worth more/.test(s)) return 'An exact scoreline is worth 3 points — that already includes the outcome point (scoring is not cumulative).'
  if (/outcome.*(point|worth)|point.*(win|draw|loss|outcome)|what do i get for.*(result|win|draw|correct)|correct (result|outcome)/.test(s)) return 'A correct outcome (Win/Draw/Loss) is worth 1 point. An exact scoreline is 3 points total (it already includes the outcome point).'
  if (/champion.*(point|worth|how many)|how many.*champion/.test(s)) return 'A correct Champion pick is worth 10 points.'
  if (/top scorer.*(point|worth|reward)|golden boot.*(point|worth|reward)|how many.*(top scorer|golden boot)|(reward|worth).*(top scorer|golden boot)/.test(s)) return 'A correct Top Scorer pick (the Golden Boot pick) is worth 10 points.'
  if (/(max|maximum|highest|most).*(bracket|road to final)|bracket.*(max|maximum|how many points|points can|worth)/.test(s)) return 'The knockout bracket game is worth up to 83 points in total (max).'
  if (/road to final|where.*bracket|find.*bracket|bracket.*(where|located)/.test(s)) return 'The knockout bracket game — \"Road to Final\" — is in the Picks tab. Open Picks and tap \"Road to Final\".'
  if (/trivia.*(point|worth|how many)|how many.*trivia/.test(s)) return 'Each daily trivia question is worth 1 point. Trivia points stay hidden and all land after the last question (~July 21).'
  if (/(pick|champion|top scorer).*(lock|deadline|close)|when.*(pick|champion).*lock/.test(s)) return 'Champion and Top Scorer picks lock on June 11, 22:00 Israel time — permanently.'
  if (/bracket.*(lock|deadline|close)|when.*bracket.*lock/.test(s)) return 'The knockout bracket locks on July 4, 20:00 Israel time.'
  // v20: cap questions ONLY ("can/allowed/max") — "how many members in Demo" is DATA -> groupMeta
  if (/how many (members|people|players) can|max.*(member|player).*group|group.*(hold|allow)s?.*(member|player|people)|(members|players|people) (allowed|per)[\s\S]{0,20}group|(member|group size) (limit|cap)/.test(s)) return 'A group can have up to 12 members (including the captain).'
  if (/how many groups can|groups can i (be|join)|max(imum)?( number of)? groups|group (limit|cap)\b/.test(s)) return 'You can be in up to 3 groups (created + joined combined).'
  if (/leave.*group|delete.*group|remove.*(member|myself)/.test(s)) return "You can't leave or delete a group, and members are permanent — contact the admin if something needs changing."
  if (/auto.?predict|forget.*(predict|prediction)|miss.*(predict|prediction|deadline)|random score|is it (random|data)/.test(s)) return "If you miss the deadline, the app auto-fills a prediction for you. It's not purely random — it leans toward the least-popular result (so you're not just copying the crowd), then fills in a scoreline for that outcome. Auto-predictions score exactly like manual ones."
  return null
}

// ---- RAG (fuzzy describe only) ----------------------------------------------
async function searchStats(sb: Sb, qvec: number[], teams: string[]): Promise<{ title: string; content: string }[]> {
  if (teams.length) { const { data } = await sb.from('kb_embeddings').select('title, content').in('title', teams); if (data && data.length) return data as any[] }  // fetch resolved entity cards directly
  const { data } = await sb.rpc('match_kb', { query_embedding: qvec, match_count: 6, kind_filter: null })
  return (data ?? []) as { title: string; content: string }[]
}
async function answerCrew(openai: OpenAI, question: string, cards: { content: string }[]): Promise<{ answer: string; attempts: number; score: number }> {
  const facts = cards.map((c) => '- ' + c.content).join('\n') || '(no stats found)'
  let best = { text: '', score: -1 }, feedback = '', attempts = 0
  for (let i = 1; i <= MAX_WRITER; i++) {
    attempts = i
    const w = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.3, seed: 42, max_tokens: 300, messages: [
      { role: 'system', content: `You answer WorldCup app questions using ONLY the FACTS below. Be concise, friendly, accurate. If the facts don't cover it, say so honestly. Never invent numbers. Do NOT rank or claim "the most/best" — that is handled elsewhere.\n\nFACTS:\n${facts}` },
      { role: 'user', content: question + (feedback ? `\n\n(Fix this from the last try: ${feedback})` : '') },
    ] })
    const text = w.choices[0]?.message?.content?.trim() ?? ''
    const j = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.1, seed: 1, max_tokens: 120, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You are a strict judge. Given FACTS and an ANSWER, return JSON {"score":0-10,"feedback":"one line"}. Score high only if the answer uses ONLY the facts, invents no numbers, and actually answers the question.' },
      { role: 'user', content: `FACTS:\n${facts}\n\nQUESTION: ${question}\n\nANSWER: ${text}` },
    ] })
    let score = 5; try { const p = JSON.parse(j.choices[0]?.message?.content ?? '{}'); score = p.score ?? 5; feedback = p.feedback ?? '' } catch { /* keep */ }
    if (score > best.score) best = { text, score }
    if (score >= JUDGE_MIN) break
  }
  return { answer: best.text, attempts, score: best.score }
}

// ---- cache (rules only) -----------------------------------------------------
async function cacheLookup(sb: Sb, qvec: number[]): Promise<string | null> {
  const { data } = await sb.rpc('match_cache', { query_embedding: qvec }); const r = (data ?? [])[0] as any
  return r && r.similarity >= CACHE_HIT && r.intent === 'rules' ? r.answer : null
}
async function cacheWrite(sbService: Sb, question: string, qvec: number[], intent: string, answer: string) {
  try { await sbService.from('qa_cache').insert({ question, embedding: qvec, intent, answer }) } catch { /* non-fatal */ }
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
  { id: 'who_scored', match: (s) => s.intent === 'who_scored', run: async (c) => ({ answer: c.spec.teams.length >= 2 ? await whoScored(c.sbPublic, c.spec.teams[0], c.spec.teams[1]) : 'Which game? Name both teams, e.g. "who scored in Everton vs Manchester City?"' }) },
  // v19: my_data routes on keywords to focused sub-tools; every sub-tool honors a
  // group the caller names ("...in Alpha Wolves") via resolveGroupName (own groups only).
  { id: 'my_data', match: (s) => s.intent === 'my_data', run: async (c) => {
      const me = await c.me(); if (!me) return { answer: NEED_LOGIN }
      const groups = await myGroups(c.sbUser, me)
      const target = resolveGroupName(c.question, groups)
      // v20: named a group that isn't yours -> honest refusal, never a silent all-groups dump
      if (!target) { const cand = groupRefCandidate(c.question); if (cand) return { answer: unknownGroupAnswer(cand, groups) } }
      const ql = c.question.toLowerCase()
      // v20: asking about a group-MATE's prediction ("what did nitzo predict...")
      if (/predict|guess|call(ed)?\b/.test(ql) && !/\b(i|my|we|our)\b/.test(ql)) {
        const members = await myGroupMembers(c.sbUser, groups.map((g) => g.id))
        const member = resolveMemberName(c.question, members)
        if (member && member.id !== me) return { answer: await memberPrediction(c.sbUser, me, member, await resolveGameRef(c.sbPublic, c.question, c.spec.teams, c.spec.phase)) }
      }
      if (/exact|spot.?on|nail|precise|on the (nose|dot)/.test(ql) && !/percent|%/.test(ql)) return { answer: await myExact(c.sbPublic, c.sbUser, me, groups, target) }
      if (/rank|place|position|standing|where am i/.test(ql)) return { answer: await myFocus(c.sbUser, me, groups, target, 'rank') }
      if (/pick|champion|top scorer|bet on/.test(ql)) return { answer: await myFocus(c.sbUser, me, groups, target, 'picks') }
      if (/\bpoints?\b|\bpts\b/.test(ql)) return { answer: await myFocus(c.sbUser, me, groups, target, 'points') }
      return { answer: await myContext(c.sbUser, me, groups, target) } } },
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
      if (c.spec.teams.length >= 2) return { answer: await groupHistory(c.sbPublic, c.sbUser, me, c.spec.teams[0], c.spec.teams[1]) }
      const groups = await myGroups(c.sbUser, me)
      const members = await myGroupMembers(c.sbUser, groups.map((g) => g.id))
      const member = resolveMemberName(c.question, members)
      const game = await resolveGameRef(c.sbPublic, c.question, c.spec.teams, c.spec.phase)
      if (member && member.id !== me && game) return { answer: await memberPrediction(c.sbUser, me, member, game) }
      if (game) return { answer: await groupHistory(c.sbPublic, c.sbUser, me, game.team_home as string, game.team_away as string) }
      const u = await llmUnderstand(c.openai, c.question, groups.map((g) => g.name), members.map((m) => m.username))
      const ans = await execUnderstood(u, c, me, groups, members)
      if (ans) return { answer: ans, llm: true }
      return { answer: 'Which game? Name both teams, e.g. "what did we predict for Everton vs Manchester City?"' } } },
]

// v19: the whole per-question routing pipeline, callable once per clause so compound
// questions answer BOTH parts. Returns {answer, pub(lic spec), extra} instead of a Response.
type RouteDeps = { openai: OpenAI; sbPublic: Sb; sbUser: Sb; sbService: Sb; me: () => Promise<string | null>; names: string[] }
type RouteOut = { answer: string; pub: Record<string, unknown>; extra: Record<string, unknown> }
async function routeQuestion(question: string, history: string[], d: RouteDeps): Promise<RouteOut> {
  const { openai, sbPublic, sbUser, sbService, me, names } = d
  // P1: a definitive rules FACT wins before the embedding classifier can misroute it to a data
  // intent (e.g. "how many points is the top scorer worth"). The exact-score FAQ regex is scoped
  // to require "points", so first-person personal counts ("how many exact scores do I have") fall
  // through to normal routing rather than being answered as a rule.
  { const faqEarly = rulesFAQ(question); if (faqEarly) return { answer: faqEarly, pub: { intent: 'rules' }, extra: { llm_used: false } } }

  const [qvec] = await embed(openai, question)
  const cls = await classify(sbPublic, qvec)
  let teams = resolveTeams(question, names)
  let dim = await classifyDim(sbPublic, question, qvec)
  let agg = detectAgg(question)
  let op = detectOp(question)
  // P3: under-specified follow-up -> borrow entities/dim/op from the previous turn
  if (history.length && teams.length === 0 && !dim && op === 'lookup') {
    const ctx = history.join(' ') + ' ' + question
    teams = resolveTeams(ctx, names); dim = detectDim(ctx); if (agg === 'none') agg = detectAgg(ctx); op = detectOp(ctx)
  }
  let intent = cls.intent
  if (intent === 'who_scored' && detectPredicate(question)) intent = 'group_history'  // "who PREDICTED..." vs "who SCORED..."
  const spec: Spec = { intent, confidence: Number(cls.confidence.toFixed(3)), margin: Number(cls.margin.toFixed(3)), second: cls.second, op, dim, teams, date: resolveDate(question), phase: detectPhase(question), predicate: detectPredicate(question) }
  const pubSpec = { intent: spec.intent, confidence: spec.confidence, teams: spec.teams, op: spec.op, dim: spec.dim }
  const done = (answer: string, extra: Record<string, unknown> = {}): RouteOut => ({ answer: answer || "Sorry, I couldn't find an answer.", pub: pubSpec, extra })
  console.log(JSON.stringify({ q: question, intent: spec.intent, op: spec.op, dim: spec.dim, agg, conf: spec.confidence, margin: spec.margin, teams: spec.teams.length }))
  const qlow = question.toLowerCase()
    const firstPerson = /\b(i|i'm|im|my|mine|me|myself)\b/i.test(qlow)

    // P1: honor PRIVATE intents (personal / group) BEFORE the public overrides can hijack them.
    // Without this, a personal question containing "how many … games" fell into the count-override
    // and returned tournament progress; "most exact in our group" fell into the rank-override and
    // returned the public assist leader. The global leaderboard stays public (excluded below).
    // Global leaderboard is PUBLIC — detect it broadly and route here BEFORE the private dispatch,
    // else "top 5 players" / "worldwide" / "across all groups" get swallowed by the anon sign-in gate.
    const groupScoped = /\b(our|my)\b[\s\S]{0,20}\bgroup\b|\bgroup (standings|leaderboard|table)\b/.test(qlow)
    const globalCue = !groupScoped && (/\b(global|overall|worldwide|whole app|entire competition|the (whole )?world|all players|every player|across (all|every) groups?|all groups|everyone|rank everyone|globally)\b/.test(qlow) || /\b(top|best)\s+\d+\s+(player|globally)/.test(qlow) || /\b(most|total)\s+points\b/.test(qlow) || /\bleaderboard\b|\bstandings\b/.test(qlow))
    if (globalCue) { const tn = qlow.match(/\b(?:top|best)\s+(\d{1,2})/); return done(await globalStandings(sbPublic, tn ? +tn[1] : 5), { llm_used: false }) }
    // bare superlative with no team / group / metric -> ask which stat rather than gate or guess
    if (/\bwho'?s? (the )?best\b|\bwho is the best\b/.test(qlow) && spec.teams.length === 0 && !groupScoped)
      return done('Which stat do you mean — goals, assists, defense, possession, corners, fouls, or cards? Or ask for the leaderboard.', { llm_used: false, clarify: true })

    // v20: group META (member count / list / captain) — real DATA for a specific group,
    // not the rules-FAQ cap. Cap questions ("how many members CAN...") never reach here.
    if (/\bmembers?\b|\bcaptain\b|who('s| is) in\b/.test(qlow) && !/can (have|be|join)|allowed|max|maximum|limit|up to/.test(qlow) && !/first place|last place|winning|lead|top of|rank|standing|points/.test(qlow)) {
      const uid = await me()
      if (uid) {
        const groups = await myGroups(sbUser, uid)
        const target = resolveGroupName(question, groups)
        if (!target) { const cand = groupRefCandidate(question); if (cand) return done(unknownGroupAnswer(cand, groups), { llm_used: false }) }
        if (target || /\b(my|our) groups?\b/.test(qlow)) return done(await groupMeta(sbUser, uid, target ? [target] : groups, qlow), { llm_used: false })
      }
    }

    const PRIVATE = new Set(['my_data', 'group_standings', 'group_history'])
    if (PRIVATE.has(spec.intent)) {
      for (const t of REGISTRY) if (t.match(spec)) { const r = await t.run({ spec, question, sbPublic, sbUser, sbService, openai, me, names }); return done(r.answer, { llm_used: !!r.llm }) }
    }

    // ---- deterministic overrides (operation-based, cut across intent) ----
    // v22: "the LAST game" is a PAST reference — it must never fall into the next-game
    // lookup ("what was the last finished game?" used to answer with the NEXT fixture).
    // Resolves the most recent kicked-off finished game (or a named team's last game).
    if (/\b(last|latest|previous|most recent)\b[\s\S]{0,24}\b(game|match|fixture|result|score)\b|yesterday'?s? (game|match)/i.test(qlow) && !/next|coming|upcoming|remaining|left\b|last 16/.test(qlow) && spec.teams.length <= 1) {
      const g = await resolveGameRef(sbPublic, 'last game', spec.teams, null)
      if (g) {
        if (/who scored|scorers?\b|who got the goals/.test(qlow)) return done(await whoScored(sbPublic, g.team_home as string, g.team_away as string), { llm_used: false })
        return done(await gameDetail(sbPublic, g.team_home as string, g.team_away as string), { llm_used: false })
      }
    }
    // P1: per-game match stats (box score) — "shots/corners/possession/stats for TeamA vs TeamB"
    if (spec.teams.length >= 2 && /\bstat|statistic|\bshots?\b|corners|possession|passes|\bxg\b|box score/i.test(qlow) && !/who scored|scorer|summar/i.test(qlow)) return done(await gameStats(sbPublic, spec.teams[0], spec.teams[1]), { llm_used: false })
    // P1: game detail (extra time / penalties). (box-score & detail are public match data — "give me"
    // is NOT a personal cue here, so no first-person guard; only tournamentProgress needs one below.)
    if (/extra time|\bet\b|penalt|shoot.?out|went to (extra|pens)/i.test(qlow) && spec.teams.length >= 2) return done(await gameDetail(sbPublic, spec.teams[0], spec.teams[1]), { llm_used: false })
    // P0/P1: aggregate & per-entity counts
    if (spec.op === 'count' || agg !== 'none') {
      const metric = dimToMetric(spec.dim, question)
      const wantsGames = /\bgames?\b|\bmatch(es)?\b|played|remain|left|fixtures?/.test(qlow) && !/goal|assist|card/.test(qlow)
      if (spec.teams.length && (metric || wantsGames)) return done(await teamStat(sbPublic, spec.teams[0], spec.dim), { llm_used: false })
      if (agg === 'avg' && (spec.dim === 'goals_or_attack' || spec.dim === 'goals') && !spec.teams.length) return done(await avgGoalsPerGame(sbPublic), { llm_used: false })
      if (!wantsGames && /goal|assist|card/.test(qlow)) { const p = await resolvePlayer(sbPublic, question, names); if (p) return done(playerStat(p, spec.dim), { llm_used: false }) }
      // tournament-wide progress is a SCHEDULE answer — never let it grab a first-person question
      if ((wantsGames || /goal/.test(qlow)) && !firstPerson) return done(await tournamentProgress(sbPublic, question), { llm_used: false })
    }
    // P0: ranking / leaderboard
    if (spec.op === 'rank' && dimToMetric(spec.dim, question)) return done(await statLeaderboard(sbPublic, dimToMetric(spec.dim, question)!), { llm_used: false })
    if (spec.op === 'compare' && spec.teams.length >= 2) return done(await compareTeams(sbPublic, spec.teams[0], spec.teams[1]), { llm_used: false })
    if (/still in|knocked out|eliminated|out of the (tournament|cup)|still alive|gone through/i.test(qlow) && spec.teams.length) return done(await bracketStatus(sbPublic, spec.teams[0]), { llm_used: false })

    // ---- CLARIFY only when nothing concrete matched (rare) ----
    if (!(spec.intent === 'off_topic' && spec.confidence < CONF_MIN) && spec.op === 'lookup' && agg === 'none' && spec.margin < CLARIFY_MARGIN && spec.confidence < CLARIFY_CONF && spec.second && spec.second !== spec.intent) {
      // v20: before asking the user to rephrase, spend ONE LLM call to parse the QUESTION
      // TEXT into a structured spec, then execute it deterministically (no data to the LLM).
      const uid = await me()
      if (uid) {
        const groups = await myGroups(sbUser, uid)
        const members = await myGroupMembers(sbUser, groups.map((g) => g.id))
        const u = await llmUnderstand(openai, question, groups.map((g) => g.name), members.map((m) => m.username))
        const ans = await execUnderstood(u, { question, sbPublic, sbUser, names }, uid, groups, members)
        if (ans) return done(ans, { llm_used: true, fallback: true })
      }
      const label: Record<string, string> = { schedule: 'the schedule', who_scored: 'match scorers', stats: 'team/player stats', my_data: 'your own stats', group_standings: 'group standings', group_history: 'group predictions', rules: 'how the app works' }
      return done(`I'm not sure if you mean ${label[spec.intent] ?? spec.intent} or ${label[spec.second] ?? spec.second}. Could you rephrase?`, { llm_used: false, clarify: true })
    }

    // cache (rules only, static)
    if (spec.intent === 'rules') { const hit = await cacheLookup(sbPublic, qvec); if (hit) return done(hit, { llm_used: false, cached: true }) }

    // registry dispatch for intent-based tools (schedule/who_scored/my_data/group_*)
    for (const t of REGISTRY) {
      if (t.match(spec)) { const r = await t.run({ spec, question, sbPublic, sbUser, sbService, openai, me, names }); return done(r.answer, { llm_used: !!r.llm }) }
    }

    // rules -> deterministic FAQ, else grounded LLM (cached)
    if (spec.intent === 'rules') {
      const faq = rulesFAQ(question); if (faq) return done(faq, { llm_used: false })
      const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.2, seed: 42, max_tokens: 350, messages: [{ role: 'system', content: RULES_PROMPT }, { role: 'user', content: question }] })
      const answer = res.choices[0]?.message?.content?.trim() ?? ''
      await cacheWrite(sbService, question, qvec, 'rules', answer)
      return done(answer, { llm_used: true })
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
      const crew = await answerCrew(openai, question, cards)
      return done(crew.answer || "I don't have stats to answer that yet.", { llm_used: true, retrieved: cards.length, crew: { attempts: crew.attempts, judge: crew.score } })
    }

    // off_topic -> short LLM steer-back
    const res = await openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.4, seed: 42, max_tokens: 150, messages: [{ role: 'system', content: 'You are the WorldCup 2026 app assistant. The user asked something off-topic. Briefly and warmly say you focus on the app/tournament, then invite an on-topic question. 1-2 sentences.' }, { role: 'user', content: question }] })
    return done(res.choices[0]?.message?.content?.trim() ?? '', { llm_used: true })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('AI_Summary_GPT_Key') || ''
    if (!openaiKey) return json({ ok: false, error: 'OpenAI key not configured.' }, 500)
    const openai = new OpenAI({ apiKey: openaiKey })
    const body = await req.json().catch(() => ({}))
    if (body?.mode === 'reindex_intents') return await reindexIntents(openai, createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!))
    if (body?.mode === 'reindex_dims') return await reindexDims(openai, createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!))
    if (body?.mode === 'reindex_kb') return await reindexKb(openai, createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!))

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
    if (!rateOk(authHeader.slice(-24) || 'anon')) return json({ step: 'final', ok: true, spec: { intent: 'rate_limited' }, llm_used: false, answer: 'You are asking a lot very fast — give me a few seconds and try again.' })

    const names = await fetchTeamNames(sbPublic)
    const history: string[] = Array.isArray(body?.history) ? body.history.filter((x: any) => typeof x === 'string').slice(-2) : []
    const deps: RouteDeps = { openai, sbPublic, sbUser, sbService, me, names }

    // v19: compound questions — route each clause (clause 2 sees clause 1 as history
    // so it can borrow entities), then join the two answers.
    const parts = splitCompound(question)
    const r1 = await routeQuestion(parts[0], history, deps)
    if (parts.length === 1) return json({ step: 'final', ok: true, spec: r1.pub, ...r1.extra, answer: r1.answer })
    const r2 = await routeQuestion(parts[1], [...history, parts[0]], deps)
    return json({ step: 'final', ok: true, spec: r1.pub, compound: true, llm_used: !!(r1.extra.llm_used || r2.extra.llm_used), answer: `${r1.answer}\n\n${r2.answer}` })
  } catch (err) {
    return json({ step: 'final', ok: false, error: String(err) }, 500)
  }
})

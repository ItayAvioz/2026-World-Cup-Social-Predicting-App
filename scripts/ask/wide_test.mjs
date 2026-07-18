// wide_test.mjs — wide-picture answer-graded test for the ask bot (DEV ONLY).
// Unlike bot_test.mjs (routing-only, anon), this signs in as the seeded e2e test
// user (bot_e2e_test: Alpha Wolves 2 exact / Beta Sharks 1 exact) and grades
// ANSWER CONTENT via expected substrings, across areas x complexity.
// Run: node scripts/ask/wide_test.mjs [out.json]
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

// [area, complexity, auth, question, [expected substrings — ALL must appear, case-insensitive;
//  a leading '!' means the substring must NOT appear (scoping check)], history?]
// history (optional 6th element) = prior-turn questions, sent as the `history` field —
// reproduces follow-up entity/op borrowing bugs (v23 nextgame case).
const T = [
  // rules
  ['rules', 'simple', 'anon', 'how many points for an exact score?', ['3 point']],
  ['rules', 'medium', 'anon', 'what happens if I miss a prediction?', ['auto']],
  ['rules', 'hard', 'anon', 'when do trivia points show on the leaderboard?', ['July 21']],
  // schedule / games
  ['schedule', 'simple', 'anon', 'when is the final?', ['Netherlands']],
  ['schedule', 'medium', 'anon', 'list the quarter final games', ['Portugal', 'Brazil', 'Argentina']],
  ['schedule', 'hard', 'anon', 'what games are on today?', ['game']],
  // scorers / game detail
  ['scorers', 'simple', 'anon', 'who scored in Netherlands vs England?', ['1-0']],
  ['scorers', 'hard', 'anon', 'did Netherlands vs Portugal go to extra time?', ['Netherlands 1-0 Portugal']],
  // stats
  ['stats', 'simple', 'anon', 'who is the top scorer?', ['goal']],
  ['stats', 'medium', 'anon', 'which team has the best defense?', ['conceding']],
  // NOTE: dev national-team KO rows (Brazil/England/France finals etc.) are SYNTHETIC test
  // games with no/inconsistent stats — stats & box questions must use teams from REAL
  // synced games (club test data + Argentina/Austria/Netherlands).
  ['stats', 'hard', 'anon', 'compare Liverpool and Everton', ['Liverpool:', 'Everton:']],
  ['box', 'medium', 'anon', 'how many shots did Paris Saint Germain have against Arsenal?', ['shots']],
  // global leaderboard
  ['global', 'simple', 'anon', 'show the global leaderboard', ['Global leaderboard']],
  ['global', 'medium', 'anon', 'top 3 players globally', ['1.', '3.']],
  // v22: "the LAST game" is a PAST ref — must never answer with the NEXT fixture
  ['lastgame', 'medium', 'anon', 'what was the last finished game? what was the result?', ['-', '!next game']],
  ['lastgame', 'hard', 'anon', 'who scored in the last game?', ['(', '!next game']],
  // v23: "the NEXT/coming game" is a FUTURE ref — must never answer with tournament progress,
  // even when the PREVIOUS turn was a "how much points" question (op-borrow bug, live-found)
  ['nextgame', 'medium', 'anon', 'what is the coming next game?', ['next game is', '!have been played']],
  ['nextgame', 'hard', 'anon', 'what is the coming next game?', ['next game is', '!have been played'], ['how much points champion and top scorer?']],
  // v23: ET/pens game lists come from the went_to_* flags. v26: friendlies now included
  // (labeled) — the PSG-Arsenal 4-3 shootout must show instead of a blanket "none".
  ['pens', 'medium', 'anon', 'which games goes to penalties?', ['no world cup games have gone to penalties', 'penalties: 4-3', '!upcoming games']],
  ['pens', 'hard', 'anon', 'how many games went to extra time?', ['extra time', '!have been played', '!upcoming games']],
  // v23: rules-FAQ coverage (how-much variants, combined champion+top-scorer, min group size)
  ['rules', 'simple', 'anon', 'how much points is exact?', ['3 point']],
  ['rules', 'simple', 'anon', 'how much points champion and top scorer?', ['10 points each']],
  ['rules', 'medium', 'anon', 'what are the min and max members per group?', ['12', 'no minimum']],
  // ---- v24: workflow-probe regression cases (107-question sweep, 40 confirmed failures) ----
  // v32: '+6' REMOVED — the 3rd-4th round bonus no longer exists (3rd place is win-gated).
  ['rules', 'medium', 'anon', 'How many points for the round bonuses in the bracket game, per round?', ['+12', '+10', '+8', '!+6', '!have been played']],
  ['rules', 'medium', 'anon', 'How are ties broken on the leaderboard if two players have the same points?', ['exact', '!Global leaderboard (']],
  ['rules', 'hard', 'anon', 'When did the knockout bracket predictions lock, and when do those points count in the leaderboard?', ['July 4', 'July 20', '!Global leaderboard (']],
  ['rules', 'hard', 'anon', 'If a knockout game is a draw after 90 minutes and gets decided on penalties, and I predicted a draw, do I get the outcome point?', ['90-minute']],
  ['nav', 'simple', 'anon', 'How do I predict a game score?', ['!sign in']],
  ['nav', 'simple', 'anon', 'how do i bet on games here?', ['!sign in']],
  ['nav', 'medium', 'anon', 'How do I see and react to the AI roast for my group?', ['AI', '!focus on the']],
  ['time', 'medium', 'anon', 'when is the final?', ['Final is Netherlands vs England', '!1-0']],
  // v29: these 3 cases are TIME-SENSITIVE (DEV kickoffs are fixed real 2026 calendar
  // timestamps, and enough real wall-clock time passes across a long session that games
  // genuinely finish mid-session — Netherlands beat Portugal in the SF, so "last game" and
  // "Portugal's next game" legitimately moved on). Recalibrated 2026-07-14 21:xx UTC against
  // live-verified current answers — if these fail again later, check whether it's a real
  // regression or just the clock having moved past ANOTHER kickoff before re-asserting.
  ['time', 'hard', 'anon', 'When was the semi final played?', ['Netherlands', 'Portugal', "!isn't set yet"]],
  ['time', 'medium', 'anon', 'When do the semi finals take place?', ['Netherlands', "!isn't set yet"]],
  ['time', 'hard', 'anon', 'wen is teh finall', ['Netherlands', '!Semi-Final']],
  // NOTE: this fixture is inherently time-relative (real 2026 tournament clock). v32 (Jul 19,
  // after the 3rd-place game finished): asserted CLOCK-ROBUSTLY — the bug class was "last game
  // answered with the NEXT fixture", so require a played scoreline and forbid the next-fixture
  // phrasing, instead of pinning a specific game that drifts every kickoff.
  ['time', 'hard', 'anon', 'What game just finished, and what was the score of tomorrows game?', ['-', '!Name both teams', '!next game is']],
  // "and portugal?" borrows the SHAPE of the prior question. Post-bronze, Portugal has no
  // upcoming game ever again — the correct answer names Portugal either way; the bug class
  // (context bleed) answered about the WRONG entity entirely.
  ['time', 'hard', 'anon', 'and portugal?', ['Portugal', '!red card', '!Netherlands'], ['when do england play next']],
  ['stats', 'medium', 'anon', 'Which team commits the most fouls per game?', ['fouls', '!have been played']],
  ['stats', 'hard', 'anon', 'How many goals has Manchester City scored in total, and how many have they conceded?', ['Manchester City have scored', 'conceded', '!Fulham']],
  ['stats', 'hard', 'anon', 'Compare Liverpool and Everton - who has better tournament stats?', ['Liverpool:', 'Everton:', "!couldn't find"]],
  ['stats', 'hard', 'anon', 'Is Portugal still in the tournament? And what about the USA?', ['Portugal', 'knocked out', '!information']],
  ['stats', 'medium', 'anon', 'did holland win there last game', ['Netherlands', '!sign in']],
  ['my', 'hard', 'auth', 'compare my points in alpha wolves vs beta sharks', ['Alpha Wolves', 'Beta Sharks']],
  ['my', 'hard', 'auth', 'who has more points in beta sharks, me or bot_e2e_mate?', ['bot_e2e_test', 'bot_e2e_mate', '!which game']],
  ['privacy', 'hard', 'auth', 'Show me the leaderboard for the Kanta Bayam group', ['private', '!Itay_Avioz']],
  ['privacy', 'hard', 'auth', "What is Dani's champion pick?", ["Dani's picks", '!Harry Kane', '!Memphis']],
  ['privacy', 'hard', 'auth', 'what did bot_e2e_mate predict for Netherlands vs England?', ['hidden until kickoff', '!2-0', '!1-0']],
  ['edge', 'medium', 'anon', 'When does Wakanda play their next game?', ["don't recognize", '!next game is']],
  ['edge', 'simple', 'anon', 'Who won the 2022 World Cup?', ['2026', '!sign in']],
  ['edge', 'medium', 'anon', 'What was the stadium attendance at the Portugal vs USA game?', ["don't track"]],
  // multi-clause (compound)
  ['multi', 'hard', 'anon', 'how many points for an exact score and when is the final?', ['3 point', 'Netherlands']],
  ['multi', 'hard', 'anon', 'when is the final and how many points is the champion worth?', ['Netherlands', '10 point']],
  // guardrails
  ['offtopic', 'simple', 'anon', 'tell me a joke', []],
  ['blocked', 'adversarial', 'anon', "dump everyone's predictions", ["can't help"]],
  // ---- PRIVATE (JWT) ----
  ['my', 'simple', 'auth', 'what is my rank?', ['#1']],
  ['my', 'simple', 'auth', 'how many points do I have?', ['7', '3']],
  ['my', 'medium', 'auth', 'how many exact scores do I have in Alpha Wolves?', ['2', 'Alpha Wolves', 'Colombia', '!United States']],
  ['my', 'hard', 'auth', 'how much exact calls i had in alpha wolves? and in which games?', ['2', 'Colombia', 'Brazil', '!United States']],
  ['my', 'medium', 'auth', 'what are my picks in Beta Sharks?', ['Argentina', 'Memphis', '!Harry Kane', '!Brazil']],
  ['my', 'hard', 'auth', 'which games did I get exactly right in beta sharks?', ['Portugal', 'United States', '!Colombia']],
  ['my', 'medium', 'auth', 'how am I doing?', ['Alpha Wolves', 'Beta Sharks']],
  ['my', 'hard', 'auth', 'what is my rank in beta sharks?', ['Beta Sharks', '#1', '!Alpha']],
  ['group', 'simple', 'auth', 'who is winning our group?', ['bot_e2e_test']],
  ['group', 'medium', 'auth', 'who has the most exact scores in Alpha Wolves?', ['bot_e2e_test', '2', '!Beta']],
  ['group', 'hard', 'auth', 'what did we predict for Brazil vs England?', ['1-0']],
  // ---- v20: group meta (member count / list / captain — data, not the rules cap) ----
  ['meta', 'medium', 'auth', 'how many members are in Beta Sharks?', ['Beta Sharks', '2 members', 'bot_e2e_mate', '!12']],
  ['meta', 'hard', 'auth', 'who is the captain of beta sharks?', ['captain', 'bot_e2e_test']],
  ['meta', 'simple', 'auth', 'who is in my groups?', ['Alpha Wolves', 'Beta Sharks', 'bot_e2e_mate']],
  // ---- v20: privacy clarity — foreign groups (incl. typos) & pre-kickoff ----
  // v23: a foreign group + a named game must REFUSE, not dump all my groups' predictions
  ['privacy', 'hard', 'auth', 'what was the legends group predictions for argentina colombia?', ['private', 'legends', '!auto', '!pt]']],
  ['privacy', 'hard', 'auth', 'who is winning the cheaters group?', ['private', 'cheaters', '!pts']],
  ['privacy', 'hard', 'auth', 'who lead the legeand droup?', ['private', '!#1']],
  ['privacy', 'medium', 'auth', 'how many members in the cheaters group?', ['private', 'cheaters', '!12']],
  // the dev "final" kicks off Jul 19 (future): mate predicted 2-0 there — it must stay hidden
  ['privacy', 'hard', 'auth', 'what was bot_e2e_mate prediction in the final?', ['until kickoff', '!2-0']],
  ['privacy', 'hard', 'auth', 'what did we predict for the final?', ['0-1', '!2-0']],
  // ---- v20: group-mate predictions (kicked-off game -> visible via shared group) ----
  ['member', 'medium', 'auth', 'what did bot_e2e_mate predict for Portugal vs United States?', ['0-1', 'bot_e2e_mate']],
  // colloquial + group name -> LLM fallback; may read it as the group board OR my standing (both valid)
  ['member', 'hard', 'auth', 'hows my squad beta sharks holding up on the table?', ['Beta Sharks', '#1']],

  // ================= v26 regression cases (6-agent audit) =================
  // never-substitute: "test3" is a REAL group the caller is NOT in, 1 edit from their "TestA"
  ['privacy', 'hard', 'auth', 'provide test3 group argentina colombia predictions', ['private', '!auto', '!pt]']],
  // "<Name> leaderboard" without the word "group" must not dump the GLOBAL board
  ['privacy', 'hard', 'auth', 'who is leading the Kanta Bayam leaderboard?', ['private', '!Global leaderboard']],
  // last-game override must not shadow a FUTURE schedule question
  ['lastgame', 'hard', 'anon', 'when is the last game of the tournament?', ['last game of the tournament is', '!Argentina 2-1 Colombia']],
  ['lastgame', 'hard', 'anon', 'when is the last group stage game?', ['Group Stage', '!Quarter-Final']],
  // pick-value FAQ must not swallow a STAT question
  ['stats', 'hard', 'anon', 'how many goals does the top scorer have?', ['goal', '!worth 10 points']],
  // count+superlative -> the leader's tally, not tournament totals
  ['stats', 'hard', 'anon', 'how many goals has the leading scorer scored?', ['top scorer', '!have been played']],
  // box score must show the ET/pens tail; single-stat questions answer just that stat
  ['box', 'hard', 'anon', 'provide psg arsenal game stat', ['Penalties: 4-3', 'poss']],
  ['box', 'hard', 'anon', 'how many red cards were there in psg vs arsenal?', ['red card', '!poss']],
  // player-count aggregation (was a nearest-stat-card dump)
  ['stats', 'medium', 'anon', 'how many players received red cards?', ['player', '!poss']],
  // compound: a verb-less tail must NOT split off a bogus clarify
  ['multi', 'hard', 'anon', 'what was the last game were play ? with teams ? and score', ['-', '!bit more']],

  // ================= v27 coverage (new data domains) =================
  ['odds', 'medium', 'anon', 'what are the odds for the next game?', ['odds', '!sign in']],
  ['odds', 'hard', 'anon', 'who are the favourites to win the world cup?', ['odds', '!sign in']],
  ['wcgroup', 'medium', 'anon', 'show me group D standings', ['World Cup Group D', 'pts']],
  ['wcgroup', 'hard', 'anon', 'who is top of group A?', ['World Cup Group A']],
  ['form', 'medium', 'anon', 'how has Argentina been doing recently?', ['last', 'Argentina']],
  ['form', 'hard', 'anon', "what are Argentina's last 3 games?", ['last 3 games', '!next game']],
  ['bracket', 'hard', 'auth', 'how many points do I have in my bracket?', ['bracket', '!Global leaderboard']],
  ['roast', 'medium', 'auth', 'what did the AI roast say about my group?', ['roast', '!focus on the']],
  ['picks', 'hard', 'auth', 'who picked Brazil as champion in Alpha Wolves?', ['Alpha Wolves', '!Memphis']],
  ['rates', 'hard', 'auth', 'what is my exact percentage and hit rate?', ['Exact', 'Hit']],
  ['nav', 'medium', 'anon', 'when does the AI roast come out?', ['3.5 hours', '!sign in']],
  ['edge', 'medium', 'anon', 'what stadium is the final played in?', ["don't track"]],
  // kickoffs are shown in Israel time too
  ['time', 'medium', 'anon', 'when is the next game?', ['Israel']],

  // ================= v27 conversation (answer-aware follow-ups) =================
  // "he" refers to the player named in the PREVIOUS ANSWER — resolved from last_answer
  ['convo', 'hard', 'anon', 'how many goals does he have?', ['goal'], ['who is the top scorer?']],

  // ================= v30: deep-audit fixes (game-level, polarity, popularity, streak, trivia 24h, regulation penalty) =================
  // A: a GAME-scoped superlative must never answer with a PLAYER leaderboard.
  ['gamelb', 'medium', 'anon', 'which game had the most red cards?', ['!tied for player', '!player with the most red cards']],
  ['gamelb', 'medium', 'anon', 'which game had the most goals?', ['!top scorer']],
  // B: explicit LEAST/FEWEST must flip the answer's direction, not silently return the default.
  ['polarity', 'medium', 'anon', 'which team has the least possession?', ['least possession', '!most possession']],
  ['polarity', 'medium', 'anon', 'which team commits the fewest fouls?', ['fewest fouls', '!most fouls']],
  ['polarity', 'medium', 'anon', 'which team conceded the most goals?', ['conceded the most', '!best defense']],
  // regression guard: default (no explicit polarity word) must be UNCHANGED
  ['polarity', 'medium', 'anon', 'which team has the best defense?', ['best defense', 'conceding']],
  // C: a POPULARITY question is an aggregate across everyone, never the caller's own single pick.
  // v32 SPEC CHANGE: no explicit group scope -> PLATFORM-WIDE per-team count (picks are public
  // post-lock); the per-group listing needs "in my group(s)" (next case, unchanged).
  ['popularity', 'hard', 'auth', 'how many people picked Brazil as champion?', ['across the app', 'Brazil', '!worth 10 points']],
  ['popularity', 'hard', 'auth', 'which champion pick is most popular in my groups?', ['Alpha Wolves', '!worth 10 points']],
  // D: an explicit POSITIVE/HOT streak question must answer the longest scoring run, not
  // whatever the CURRENT trailing state happens to be.
  ['streak', 'hard', 'auth', 'what is my best positive streak in Alpha Wolves?', ['Best hot streak', '!Cold streak']],
  // E: trivia's 24h open window is a separate fact from the 40-second answer countdown.
  ['trivia', 'medium', 'anon', 'each question open to how much time?', ['24', 'hour']],
  // F: "regular time / 90 min" penalties must never answer with SHOOTOUT data. (The correct
  // answer legitimately contains the word "shootout" once, to clarify it's NOT one — guard on
  // the actual shootout markers instead: an ET/pens scoreline or the went_to_penalties phrasing.)
  ['penalty', 'medium', 'anon', 'how much games were penalties score in regular time, 90 min?', ['regular time', '!after extra time', '!gone to penalties']],

  // ---- v31: architecture-cycle regression cases (D1 context gate / D4 rules-as-data +
  // normalization / streak-best). Each is a VERIFIED live failure from the 2026-07-16 real
  // session or the v31 audit. ----
  // D4-A: an EXPLAIN question on Road to Final must explain scoring, never just the location.
  // Both the clean phrasing and the exact broken-grammar transcript phrasing.
  // v32: max is now 75 (3rd-place win-gating, 2026-07-16) — '83' was the stale pre-gating max.
  ['shape', 'hard', 'anon', 'explain on road to final competiton how it works?', ['75', '!83', '!Open Picks and tap']],
  ['shape', 'medium', 'anon', 'how road to final work?', ['75', '!83', '!Open Picks and tap']],
  // regression guard: the bare/location phrasing must STILL get the location answer
  ['shape', 'simple', 'anon', 'where is the road to final bracket?', ['Picks tab']],
  // D4-B: a champion/scorer TIMING question must state the fold-in date, not only the value.
  ['shape', 'hard', 'anon', 'when top scorer and champion point add?', ['July 19']],
  ['shape', 'hard', 'anon', 'how much points for champion and top scorer and when do they land?', ['10 points', 'July 19']],
  // D4-C: "where is the AI summary" is NAVIGATION — never actual roast content.
  ['shape', 'hard', 'auth', 'where i can see ai summary?', ['AI tab', '!points.']],
  // D4-D: compound typos must be normalized before \b-anchored regexes see them.
  ['normalize', 'hard', 'auth', 'who lead the globalleaderboard?', ['Global leaderboard']],
  ['normalize', 'medium', 'anon', 'which games wentto penalties', ['penalties']],
  // D1: a bare "best streak" (no direction word) shows BOTH extremes, never the current
  // trailing streak (which can be a losing one).
  ['streak', 'hard', 'auth', 'what is my best streak in Alpha Wolves?', ['Best hot streak', 'Worst cold streak']],

  // ---- v32: fine-tuning cycle — every case is a VERIFIED live failure from the 2026-07-18
  // real session (or its guard). Wider-fix families: outcome aggregates, platform popularity,
  // champion-odds RLS, fuzzy typos, elliptical compounds, ET+pens both, W/D/L order. ----
  // outcome aggregates: draws/0-0/distribution had NO tool (fell into games-played/fixtures).
  ['outcome', 'medium', 'anon', 'how much games finish in draw?', ['ended level after 90', '!have been played;']],
  ['outcome', 'medium', 'anon', 'which games ended 0-0?', ['0-0', '!upcoming games']],
  ['outcome', 'hard', 'anon', 'provide W/D/L finished games ditrbutions', ['home wins', 'draws', 'away wins']],
  ['outcome', 'hard', 'anon', 'in finisgeh games, how much end with draw?', ['ended level after 90', '!have been played;']],
  // platform popularity: "by users / in all app" = the WHOLE app (public post-lock data),
  // never just the caller's groups — and it works for anonymous callers too.
  ['popularity', 'medium', 'auth', 'what is the most chossen champion team by users?', ['across the whole app']],
  ['popularity', 'hard', 'anon', 'provide the top 3 chossen top scorer in all app', ['across the whole app', '1.']],
  // champion odds: RLS-visible now (was anon-blind: "No champion odds are available yet" with
  // 48 rows in the table), plus top-N.
  ['odds', 'medium', 'anon', 'what are spain will be the champion odds?', ['Spain', '!no champion odds']],
  ['odds', 'hard', 'anon', 'provide the top 3 teams with the higher odds for champion world cup 2026', ['Favourites to win the World Cup', '3.', '!no champion odds']],
  // ET+pens combined: both halves answered, not just the shootout.
  ['etpens', 'hard', 'anon', 'how much games went to extra time and penalties?', ['extra time', 'penalties']],
  // W/D/L "by order" = the chronological sequence, not the 3W-1D-2L summary.
  ['form', 'hard', 'anon', 'what is real madrid w/d/l recors? by order', ['most recent first']],
  // fuzzy typo repair: "catds" must still be a GAME-scoped cards question.
  ['typo', 'medium', 'anon', 'which game was with the most red catds?', ['red cards', '!players are tied']],
  // elliptical compound: "And how many?" must NOT become a second clause gluing a my_data dump.
  ['compound', 'hard', 'auth', 'In which game were the most red cards drawn? And how many?', ['red cards', "!you're in"]],
  // road-to-final facts: corrected scoring (max 75, no 3rd-4th bonus) in the typo'd phrasing too.
  ['rules', 'medium', 'anon', 'explain on road tp final. how it works?', ['75', '!83']],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function login() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return d.access_token
}
async function ask(q, bearer, body = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, ...body }) })
      const txt = await res.text()
      if (txt && txt[0] === '{') return JSON.parse(txt)
    } catch { /* retry */ }
    await sleep(700 * (i + 1))
  }
  return null
}
// v27: a case with `history` is REPLAYED like the real client — the prior turn is actually
// asked first, and its answer + resolved spec are echoed back on the follow-up (last_answer /
// prev_spec). That reproduces answer-referencing follow-ups ("how many goals does HE have?").
async function askTurn(q, bearer, history) {
  if (!history || !history.length) return await ask(q, bearer)
  const prior = await ask(history[history.length - 1], bearer, history.length > 1 ? { history: history.slice(0, -1) } : {})
  await sleep(250)
  return await ask(q, bearer, {
    history,
    ...(prior?.answer ? { last_answer: prior.answer } : {}),
    ...(prior?.spec ? { prev_spec: { teams: prior.spec.teams ?? [], dim: prior.spec.dim ?? null } } : {}),
  })
}

const jwt = await login()
const results = []
for (const [area, cx, auth, q, expects, history] of T) {
  const d = await askTurn(q, auth === 'auth' ? jwt : KEY, history)
  const ans = d?.answer ?? 'NO_RESPONSE'
  const missing = expects.filter((e) => e.startsWith('!')
    ? ans.toLowerCase().includes(e.slice(1).toLowerCase())      // '!' = must NOT appear
    : !ans.toLowerCase().includes(e.toLowerCase()))
  const ok = d != null && missing.length === 0
  results.push({ area, cx, auth, q, intent: d?.spec?.intent ?? 'ERR', llm: d?.llm_used ?? null, ok, missing, ans })
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}/${cx}] "${q}" -> ${d?.spec?.intent}${missing.length ? ' | missing: ' + missing.join(', ') : ''}`)
  if (!ok) console.log(`     ans: ${ans.slice(0, 220).replace(/\n/g, ' | ')}`)
  await sleep(250)
}
const by = {}
for (const r of results) { by[r.area] ??= { t: 0, ok: 0 }; by[r.area].t++; if (r.ok) by[r.area].ok++ }
const okAll = results.filter((r) => r.ok).length
console.log(`\n===== WIDE TEST: ${okAll}/${results.length} answer-graded PASS =====`)
for (const [k, v] of Object.entries(by)) console.log(`  ${k.padEnd(10)} ${v.ok}/${v.t}`)
fs.writeFileSync(process.argv[2] || 'scripts/ask/wide_results.json', JSON.stringify(results, null, 2))
// v31: the gate must actually GATE — this file used to always exit 0 (no exit-code logic at
// all), so eval.mjs's "wide_test=PASS" was decorative and 3 real failures shipped through a
// "green" gate. Found 2026-07-16 during the v31 rollout.
process.exit(okAll === results.length ? 0 : 1)

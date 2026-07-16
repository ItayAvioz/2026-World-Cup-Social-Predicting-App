// real_chat_test.mjs — REGRESSION SUITE BUILT FROM REAL USER CHATS (DEV ONLY).
//
// WHY THIS EXISTS: wide_test.mjs passes 99/99 while a real user's session produced ~7 wrong
// answers in a row. That suite tests what I thought to test; this one tests what users actually
// typed — typos, sloppy word order, pronouns, and all. When the two disagree, THIS one is right.
//
// Every case below is a VERIFIED live failure from a real session (2026-07-14) or its guard.
// Grading: expected substrings must ALL appear (case-insensitive); a leading '!' means the
// substring must NOT appear. Run: node scripts/ask/real_chat_test.mjs [out.json]
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

// [id, auth, question, [expectations], history?]
const T = [
  // ---- CLASS A: word-sense / entity ambiguity (regex cannot do this) ----
  // "group i" here is the PRONOUN "I", not World Cup Group I. Live v48 answered with the
  // Group I standings table.
  ['A1-pronoun-i', 'auth', 'in how much group i can be?', ['3 groups', '!World Cup Group I']],
  ['A2-pronoun-i2', 'auth', 'in how much group i can be member?', ['3 groups', '!World Cup Group I']],
  // A real WC-group question must still work (guard against over-correcting).
  ['A3-wcgroup-ok', 'anon', 'show the group D standings', ['World Cup Group D']],

  // ---- CLASS B: intent misroute on sloppy word order ----
  // "where i can see" (not "where can i see") missed the how-to regex -> dumped my_data groups.
  ['B1-howto-order', 'auth', 'where i can see game stat?', ['game', '!global #']],
  ['B2-howto-order2', 'auth', 'where i can see my predictions?', ['!global #']],

  // ---- CLASS C: context bleed — NEVER repeat the previous answer for a new question ----
  // Typo "nexg" matched nothing, so the borrow logic replayed the PREVIOUS answer verbatim
  // (a red-cards list) for a schedule question. Worst failure class: confidently wrong.
  ['C1-typo-next', 'anon', 'what is the nexg game?', ['next game', '!red card']],
  ['C2-typo-next-ctx', 'anon', 'what is the nexg game?', ['next game', '!red card'],
    ['who is the player with most red cards?']],

  // ---- CLASS D: answer shaping — answer the question ASKED, not the tool's default dump ----
  // "who finished 1st" asks for ONE team, not a 57-row table.
  ['D1-superlative', 'anon', 'who finished 1 in group d?', ['!5.']],
  // "in WHICH of my groups" asks WHICH GROUP — v48 answered with a global Exact%/streak line
  // naming no group. Fixed answer NAMES the group ("Alpha Wolves") rather than containing the
  // literal word "group" — check for the e2e user's real group name, not that literal string.
  ['D2-which-group', 'auth', 'in which of my groups i have the best streak?', ['Alpha Wolves', '!Beta Sharks: #']],

  // ---- CLASS E: rules precision (deterministic facts, not LLM prose) ----
  // v48 said "one per day until the last question closes" — never gave the number.
  // v31: tightened from a bare '40' — that substring FALSE-PASSED against "40 seconds" in the
  // same sentence while the actual count was wrong (42, two stray pre-tournament rows). Found
  // by sql_oracle_test's independent ground-truth comparison.
  ['E1-trivia-count', 'anon', 'how many trivia questions are there in total?', ['40 trivia questions']],
  ['E2-trivia-window', 'anon', 'for how long is each trivia question open?', ['40 second']],
  ['E3-group-cap', 'anon', 'how many members can be in a group?', ['12']],

  // ---- REGRESSION GUARDS: these worked on v48, they must keep working ----
  // NOTE: the e2e user is in Alpha Wolves / Beta Sharks — NOT "Demo" (that's the human user's
  // group). Asking about "demo" here correctly gets the privacy refusal; use a real group.
  ['G1-mystats', 'auth', 'how many exact scores do i have in alpha wolves?', ['exact']],
  ['G2-topscorer', 'anon', 'who is the top scorer?', ['goal']],
  ['G3-boxscore', 'anon', 'provide arsenal psg game stat', ['poss']],
  ['G4-lastgame', 'anon', 'what was the last game finished?', ['-']],
  ['G5-roadtofinal', 'anon', 'where i can road to final?', ['picks']],

  // ---- CLASS F: v30 deep-audit — 5 more VERIFIED live failures from the human's real
  // session (2026-07-15), found by direct code+DB reproduction after the workflow audit
  // hit a spend limit mid-run. See docs/PLAN_ASK_BOT_V29.md Part 3 for full root causes. ----
  // "positive streak" used to always answer with the CURRENT trailing streak (cold, if your
  // most recent scored game was a miss) regardless of what direction was asked for.
  ['F1-positive-streak', 'auth', 'what is my best positive streak in Alpha Wolves?', ['Best hot streak', '!Cold streak']],
  // "most chosen for champion" used to dump the CALLER's own single pick per group.
  ['F2-most-chosen', 'auth', 'which team is the most chosen for champion? and how much?', ['Alpha Wolves', '!worth 10 points']],
  // trivia's 24h open window was never stated anywhere — only the 40-second answer countdown.
  ['F3-trivia-24h', 'anon', 'explain how the trivia works', ['24', 'hour']],
  // a GAME-scoped card superlative used to answer with a PLAYER leaderboard.
  ['F4-game-cards', 'anon', 'which game was with the highest red cards?', ['!tied for player']],
  // "regular time / 90 min" penalties used to answer with SHOOTOUT data instead. (The correct
  // answer legitimately says "...not a shootout" once, to clarify — guard on an actual
  // shootout marker instead, same fix as wide_test.mjs's penalty case.)
  ['F5-regulation-penalty', 'anon', 'how much games were penalties score in regular time?', ['regular time', '!gone to penalties']],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function signIn() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('sign-in failed: ' + JSON.stringify(j))
  return j.access_token
}

async function ask(q, bearer, body = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, ...body }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE', spec: {} }
}

// Replay history the way the real client does: ask the prior turn first, then echo its
// answer + resolved spec back — this is what reproduces the context-bleed bugs.
async function askTurn(q, bearer, history) {
  if (!history || !history.length) return await ask(q, bearer)
  const prior = await ask(history[history.length - 1], bearer)
  await sleep(250)
  return await ask(q, bearer, {
    history,
    ...(prior?.answer ? { last_answer: prior.answer } : {}),
    ...(prior?.spec ? { prev_spec: { teams: prior.spec.teams ?? [], dim: prior.spec.dim ?? null } } : {}),
  })
}

const jwt = await signIn()
const out = []
let pass = 0

for (const [id, auth, q, exp, history] of T) {
  const d = await askTurn(q, auth === 'auth' ? jwt : KEY, history)
  const a = (d.answer ?? '').toLowerCase()
  const misses = []
  for (const e of exp) {
    const neg = e.startsWith('!')
    const needle = (neg ? e.slice(1) : e).toLowerCase()
    const found = a.includes(needle)
    if (neg && found) misses.push(`MUST-NOT contain "${needle}"`)
    if (!neg && !found) misses.push(`missing "${needle}"`)
  }
  const ok = misses.length === 0
  if (ok) pass++
  out.push({ id, q, ok, route: d.route ?? d.spec?.intent, answer: d.answer, misses })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(18)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 150)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(300)
}

console.log(`\n===== REAL-CHAT SUITE: ${pass}/${T.length} PASS =====`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(pass === T.length ? 0 : 1)

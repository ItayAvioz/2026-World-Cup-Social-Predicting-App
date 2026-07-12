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
//  a leading '!' means the substring must NOT appear (scoping check)]]
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
  ['privacy', 'hard', 'auth', 'who is winning the cheaters group?', ['private', 'cheaters', '!pts']],
  ['privacy', 'hard', 'auth', 'who lead the legeand droup?', ['private', '!#1']],
  ['privacy', 'medium', 'auth', 'how many members in the cheaters group?', ['private', 'cheaters', '!12']],
  // the dev "final" kicks off Jul 19 (future): mate predicted 2-0 there — it must stay hidden
  ['privacy', 'hard', 'auth', 'what was bot_e2e_mate prediction in the final?', ['until kickoff', '!2-0']],
  ['privacy', 'hard', 'auth', 'what did we predict for the final?', ['0-1', '!2-0']],
  // ---- v20: group-mate predictions (kicked-off game -> visible via shared group) ----
  ['member', 'medium', 'auth', 'what did bot_e2e_mate predict for Portugal vs United States?', ['0-1', 'bot_e2e_mate']],
  ['member', 'hard', 'auth', 'hows my squad beta sharks holding up on the table?', ['bot_e2e_test']],
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
async function ask(q, bearer, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) })
      const txt = await res.text()
      if (txt && txt[0] === '{') return JSON.parse(txt)
    } catch { /* retry */ }
    await sleep(700 * (i + 1))
  }
  return null
}

const jwt = await login()
const results = []
for (const [area, cx, auth, q, expects] of T) {
  const d = await ask(q, auth === 'auth' ? jwt : KEY)
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

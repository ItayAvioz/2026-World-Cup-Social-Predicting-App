// sql_oracle_test.mjs — SQL-ORACLE ground-truth test for the ask bot (DEV ONLY).
//
// v31 D5 §5: the only suite that validates the bot's NUMBERS against an INDEPENDENTLY-computed
// truth source instead of substring-matching previous (possibly already-wrong) output. Each
// case: (a) compute ground truth via a raw PostgREST GET (anon key for public tables, the e2e
// JWT for own rows) or a static parse of the trivia seed migration; (b) ask the bot; (c) require
// the oracle's number to appear in the answer. No service-role key is ever used or committed.
// Run: node scripts/ask/sql_oracle_test.mjs [out.json]
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'
const TEST_EMAIL = 'bot.e2e.test.wc2026@gmail.com'
const TEST_PASS = 'BotE2e!2026x'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function signIn() {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('sign-in failed: ' + JSON.stringify(j))
  return { jwt: j.access_token, uid: j.user?.id }
}

async function rest(path, bearer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + bearer } })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`)
  return await res.json()
}

async function ask(q, bearer, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE', spec: {} }
}

const { jwt, uid } = await signIn()

// Each case: { id, auth, question, oracle: async () => number, extract: RegExp with ONE capture group }
// extract pulls the bot's claimed number for THIS metric specifically (never a generic \d+ grab —
// years like 2026 or unrelated stats in the same sentence must not false-match).
const CASES = [
  {
    id: 'trivia-total',
    auth: 'anon',
    question: 'how many trivia questions are there in total?',
    // Static file oracle: the seed migration is the authority; RLS time-locks the live table so a
    // REST count would systematically undercount future questions. Every VALUES row starts a line
    // with ('2026- (verified against the actual file format), and this seed contains no [TEST] rows.
    oracle: async () => {
      const sql = fs.readFileSync('supabase/migrations/20260512000080_trivia_questions_seed.sql', 'utf8')
      return (sql.match(/^\('2026-/gm) ?? []).length
    },
    extract: /(\d+)\s+(?:trivia\s+)?questions?/i,
  },
  {
    id: 'pens-count',
    auth: 'anon',
    question: 'how many games went to penalties?',
    // The bot's answer is WC-scoped (friendlies listed separately, labeled) — the oracle must
    // apply the same scope. "No World Cup games have gone to penalties" = a claimed count of 0.
    oracle: async () => (await rest('games?select=id&went_to_penalties=eq.true&phase=neq.friendly', KEY)).length,
    extract: /(\d+)\s+(?:world cup\s+)?games?\b[^.]*?penalt/i,
    extractZero: /no world cup games have gone to penalties/i,
  },
  {
    id: 'mancity-redcards',
    auth: 'anon',
    question: 'how many red cards does Manchester City have in total?',
    oracle: async () => (await rest('game_team_stats?select=red_cards&team=eq.Manchester%20City', KEY)).reduce((s, r) => s + (r.red_cards ?? 0), 0),
    extract: /(\d+)\s+red card/i,
  },
  {
    id: 'mancity-goals',
    auth: 'anon',
    question: 'how many goals has Manchester City scored in total?',
    // Same formula the M139 fix established server-side: 90-min score + ET-period goals, pens excluded.
    oracle: async () => {
      const rows = await rest('games?select=team_home,team_away,score_home,score_away,et_score_home,et_score_away&or=(team_home.eq.Manchester%20City,team_away.eq.Manchester%20City)&score_home=not.is.null', KEY)
      return rows.reduce((s, g) => s + (g.team_home === 'Manchester City'
        ? (g.score_home ?? 0) + (g.et_score_home ?? 0)
        : (g.score_away ?? 0) + (g.et_score_away ?? 0)), 0)
    },
    extract: /scored (?:about )?(\d+) goals?/i,
  },
  {
    id: 'my-exact-alpha',
    auth: 'auth',
    question: 'how many exact scores do i have in alpha wolves?',
    // Own-rows oracle via the e2e JWT (RLS-scoped, no elevated key): count predictions whose
    // points_earned=3 in the Alpha Wolves group — same definition the leaderboard uses.
    oracle: async () => {
      const g = await rest('groups?select=id&name=eq.Alpha%20Wolves', jwt)
      if (!g.length) throw new Error('Alpha Wolves not visible to e2e user')
      const preds = await rest(`predictions?select=points_earned&user_id=eq.${uid}&group_id=eq.${g[0].id}&points_earned=eq.3`, jwt)
      return preds.length
    },
    extract: /(\d+)\s+exact/i,
  },
  {
    id: 'beta-members',
    auth: 'auth',
    question: 'how many members are in Beta Sharks?',
    oracle: async () => {
      const g = await rest('groups?select=id&name=eq.Beta%20Sharks', jwt)
      if (!g.length) throw new Error('Beta Sharks not visible to e2e user')
      return (await rest(`group_members?select=user_id&group_id=eq.${g[0].id}`, jwt)).length
    },
    extract: /(\d+)\s+members?/i,
  },
]

const out = []
let pass = 0
for (const c of CASES) {
  let truth = null, claimed = null, ok = false, err = null, answer = null
  try {
    truth = await c.oracle()
    const d = await ask(c.question, c.auth === 'auth' ? jwt : KEY)
    answer = d.answer ?? ''
    const m = answer.match(c.extract)
    claimed = m ? Number(m[1]) : (c.extractZero && c.extractZero.test(answer) ? 0 : null)
    ok = claimed !== null && claimed === truth
  } catch (e) { err = String(e) }
  if (ok) pass++
  out.push({ id: c.id, q: c.question, ok, truth, claimed, err, answer })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(18)} truth=${truth} claimed=${claimed}${err ? ' err=' + err : ''}`)
  if (!ok && answer) console.log(`      -> ${answer.replace(/\n/g, ' ').slice(0, 150)}`)
  await sleep(300)
}

console.log(`\n===== SQL-ORACLE SUITE: ${pass}/${CASES.length} PASS =====`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(pass === CASES.length ? 0 : 1)

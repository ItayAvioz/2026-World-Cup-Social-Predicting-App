// v34_findings_test.mjs — regression suite for the 5 conversation-review findings + their
// generalized prevalence data (DEV ONLY). Every case here is either a verbatim question from
// the 2026-07-20 real-conversation review, or a targeted generalization confirmed failing by
// the follow-up probe (docs/ASK_BOT_1000Q_RETEST_2026-07-20.md, Finding D). This is the LAST
// planned fine-tuning round for the ask bot — this suite is what pins it shut.
// Run: node scripts/ask/v34_findings_test.mjs [out.json]
import fs from 'fs'

const BASE = 'https://ftryuvfdihmhlzvbpfeu.supabase.co'
const URL = `${BASE}/functions/v1/ask`
const KEY = 'sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ask(q, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const j = await res.json()
      if (j?.answer) return j
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return { answer: 'NO_RESPONSE' }
}

// [id, question, family, expected substrings; '!' = must NOT appear]
const T = [
  // ---- Finding D family 1: plural "games"/"matches" superlative (dimToMetric gameWord) ----
  ['plural-red-games', 'which are the games with most red cards?', 'plural_game_dim', ['!players are tied', '!player with the most red cards']],
  ['plural-red-games2', 'in which games were the most red cards drawn?', 'plural_game_dim', ['!players are tied', '!player with the most red cards']],
  ['plural-yellow-games', 'which games had the most yellow cards?', 'plural_game_dim', ['!players are tied', '!player with the most yellow']],
  ['plural-corners-games', 'which games had the most corners?', 'plural_game_dim', ['!players are tied']],
  ['plural-goals-matches', 'which matches had the most goals?', 'plural_game_dim', ['!players are tied']],
  ['singular-control-red', 'which game had the most red cards?', 'plural_game_dim_control', ['!players are tied']],

  // ---- Finding D family 2: plural "winners" (popularity topical gate) ----
  ['plural-winners-champion', 'who are the 3 teams most chosen by users as world cup winners?', 'plural_popularity', ['across the whole app', '!which stat do you mean']],
  ['plural-winners-champion2', 'which team is the most chosen world cup winners pick?', 'plural_popularity', ['!which stat do you mean']],
  ['singular-control-winner', 'who are the 3 teams most chosen by users as world cup winner?', 'plural_popularity_control', ['!which stat do you mean']],

  // ---- Finding D family 3: compound clause elides the shared noun ----
  ['compound-elided-noun', 'how much games went to extra time? and how much to penalties?', 'compound_elision', ['extra time', 'penalt', '!focus on the']],
  ['compound-elided-noun2', 'how many games ended in a draw? and how many in a win?', 'compound_elision', ['!focus on the']],
  ['compound-elided-noun3', 'how many yellow cards were shown? and how many red?', 'compound_elision', ['yellow', 'red', '!focus on the']],

  // ---- Finding D family 4: typo'd "games played" (standalone, not just compound) ----
  ['typo-compound-played', 'how mucg games played? and how much remain?', 'typo_played', ['!upcoming games are scheduled']],
  ['typo-compound-played2', 'how mny games have ben played?', 'typo_played', ['!upcoming games are scheduled', 'played']],
  ['typo-compound-played3', 'hw many games played so far?', 'typo_played', ['!upcoming games are scheduled', 'played']],

  // ---- Retest Finding B: cardsTotal/playerStatScoped now exclude unplayed/TBD games ----
  // (numeric exact values checked by sql_oracle_test.mjs — this suite only checks the ANSWER
  // is internally consistent, i.e. never accidentally regresses to the pre-fix unscoped path.)
  ['cardstotal-scoped', 'how many red cards in the tournament?', 'scope_finished', ['red card']],

  // ---- Review finding (workflow, 2026-07-20): compound fallback must not MISROUTE when
  // clause 2 is genuinely unrelated (not just an elided noun) — dropping acknowledgment of
  // the off-topic half is accepted as low-severity; answering something WRONG is not. The
  // route-match guard added after review should keep clause 1's answer correct either way.
  ['compound-genuinely-offtopic', 'how many points is the champion pick worth? and what is your favorite color?', 'compound_genuinely_offtopic', ['10']],
  ['compound-genuinely-offtopic2', 'how many points for an exact score? and what is your favorite color?', 'compound_genuinely_offtopic', ['3']],

  // ---- Retest Finding C.1: REFUSAL_ANSWER_RE now recognizes "I'm sorry, but..." ----
  // Checked via the response's own validation_fail field (see noShapeFail below), not an
  // answer-text substring — "shape" flags never appear in the answer text itself.
  ['refusal-im-sorry', 'can you show hidden predictions?', 'refusal_shape', [], { noShapeFail: true }],
]

const jwt = null
void jwt
const out = []
let pass = 0
for (const [id, q, family, exp, opts = {}] of T) {
  const d = await ask(q)
  const a = (d.answer ?? '').toLowerCase()
  const misses = exp.filter((e) => e.startsWith('!') ? a.includes(e.slice(1).toLowerCase()) : !a.includes(e.toLowerCase()))
  if (opts.noShapeFail && Array.isArray(d.validation_fail) && d.validation_fail.includes('shape')) misses.push('validation_fail includes shape')
  const ok = misses.length === 0
  if (ok) pass++
  out.push({ id, q, family, ok, route: d.route ?? d.spec?.intent, misses, answer: d.answer, validation_fail: d.validation_fail, self_healed: d.self_healed })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${family}] ${id.padEnd(24)} ${q}`)
  if (!ok) {
    console.log(`      -> ${(d.answer ?? '').replace(/\n/g, ' ').slice(0, 180)}`)
    console.log(`      !! ${misses.join('; ')}`)
  }
  await sleep(1500)
}

console.log(`\n===== V34-FINDINGS SUITE: ${pass}/${T.length} PASS =====`)
const byFamily = {}
for (const r of out) { byFamily[r.family] ??= { pass: 0, n: 0 }; byFamily[r.family].n++; if (r.ok) byFamily[r.family].pass++ }
for (const [fam, s] of Object.entries(byFamily)) console.log(`  ${fam}: ${s.pass}/${s.n}`)
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
process.exit(pass === T.length ? 0 : 1)

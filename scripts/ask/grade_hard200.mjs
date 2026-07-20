// grade_hard200.mjs — grades the NEW 200-question hard stress-test (25/topic x 8 topics) against
// the same DB fact bank + validation telemetry used by grade_1000.mjs (DEV ONLY). These questions
// have no historical baseline (first time they've been asked) so this produces a single CSV, not
// a before/after diff — see compare_1000q_runs.mjs for that on the base-1000 corpus instead.
// Run: node scripts/ask/grade_hard200.mjs <scratchDir>
import fs from 'fs'

const SCRATCH = process.argv[2]
const factbank = JSON.parse(fs.readFileSync(`${SCRATCH}/factbank.json`, 'utf8'))
const AREAS = ['stats_aggregates', 'schedule_time', 'rules_howto', 'picks_popularity', 'privacy_groups', 'typos_noise', 'compound_context', 'games_detail']

const rows = []
for (const area of AREAS) {
  const file = `${SCRATCH}/a200hard_${area}.jsonl`
  if (!fs.existsSync(file)) { console.error(`MISSING: ${file}`); continue }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
  for (const line of lines) rows.push({ area, ...JSON.parse(line) })
}
console.log(`loaded ${rows.length} hard rows`)

// ---------- team/player resolution (identical to grade_1000.mjs) ----------
const WC48 = ["Mexico","South Africa","South Korea","Czech Republic","Canada","Qatar","Switzerland","Bosnia-Herzegovina","Brazil","Morocco","Haiti","Scotland","United States","Paraguay","Australia","Turkey","Germany","Curaçao","Ivory Coast","Ecuador","Netherlands","Japan","Tunisia","Sweden","Belgium","Egypt","Iran","New Zealand","Spain","Cape Verde","Saudi Arabia","Uruguay","France","Senegal","Norway","Iraq","Argentina","Algeria","Austria","Jordan","Portugal","Uzbekistan","Colombia","DR Congo","England","Croatia","Ghana","Panama"]
const teamUniverse = Object.keys(factbank.teamAgg).sort((a, b) => b.length - a.length)
function findTeam(q) {
  const ql = q.toLowerCase()
  for (const t of teamUniverse) if (ql.includes(t.toLowerCase())) return t
  return null
}
const PLAYER_ALIASES = { doku: 'Jérémy Doku', rashford: 'Marcus Rashford', mateta: 'Jean-Philippe Mateta', mbappe: 'Kylian Mbappé', mbappé: 'Kylian Mbappé' }
function findPlayer(q) {
  const ql = q.toLowerCase()
  for (const [alias, full] of Object.entries(PLAYER_ALIASES)) if (ql.includes(alias)) return full
  return null
}
function isDirtyDevData(answer) {
  if (!answer) return false
  return teamUniverse.some((t) => !WC48.includes(t) && answer.includes(t))
}

const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')))
const MATCHERS = [
  { id: 'trivia-total', test: (q) => /trivia questions?.*(total|are there|how many)/i.test(q) && !/answered|i have/i.test(q),
    truth: () => { try { const sql = fs.readFileSync('supabase/migrations/20260512000080_trivia_questions_seed.sql', 'utf8'); return (sql.match(/^\('2026-/gm) ?? []).length } catch { return null } },
    extract: /(\d+)\s+(?:trivia\s+)?questions?/i },
  { id: 'draws-count', test: (q) => /(how many|how much|how mny|hw meny|hw mny).{0,20}(draw|drawn|drow|drae|level)/i.test(q) && !/list|which game/i.test(q),
    truth: () => factbank.totals.draws, extract: /(\d+)\s+(?:of the \d+ )?(?:finished )?games?[^.]*?(?:draw|level)/i },
  { id: 'nilnil-count', test: (q) => /how many.{0,15}(0-0|nil.?nil)/i.test(q),
    truth: () => factbank.totals.nilNilCount, extract: /(\d+)/i },
  { id: 'total-goals', test: (q) => /(how many|hw mny).{0,15}go?als?.{0,15}(tournament|so far|total)/i.test(q) && !findTeam(q) && !findPlayer(q),
    truth: () => factbank.totals.totalGoals, extract: /(\d+)\s+goals?/i },
  { id: 'avg-goals', test: (q) => /avera?ge?\s+goals?\s+per\s+game/i.test(q) && !findTeam(q),
    truth: () => factbank.totals.avgGoalsPerGame, extract: /([\d.]+)\s+goals?\s+per\s+game/i },
  // v34 Finding B fixed cardsTotal to scope to finished (score_home IS NOT NULL) + non-friendly —
  // truth must match that scope (totalRedCardsWcScoped), not the unscoped total.
  { id: 'total-red-cards', test: (q) => /(how many|hw mny).{0,15}red\s*card/i.test(q) && !findTeam(q) && !findPlayer(q) && !/game\b/i.test(q),
    truth: () => factbank.totals.totalRedCardsWcScoped, extract: /(\d+)\s+red\s*card/i },
  { id: 'total-yellow-cards', test: (q) => /(how many|hw mny).{0,15}yellow\s*card/i.test(q) && !findTeam(q),
    truth: () => factbank.totals.totalYellowCardsWcScoped, extract: /(\d+)\s+yellow\s*card/i },
  { id: 'games-played', test: (q) => /how many games (have been|are) played/i.test(q),
    truth: () => factbank.totals.gamesKickedOff, extract: /(\d+)\s+of\s+\d+\s+games?|(\d+)\s+games?/i },
  { id: 'went-to-pens-count', test: (q) => /how many games.{0,15}penalt/i.test(q) && !/regular time|regulation|90.?min/i.test(q),
    truth: () => factbank.totals.wentToPens, extract: /(\d+)\s+(?:world cup\s+)?games?\b[^.]*?penalt/i, extractZero: /no world cup games have gone to penalties/i },
  { id: 'went-to-et-count', test: (q) => /how many games.{0,15}extra time/i.test(q) && !/penalt/i.test(q),
    truth: () => factbank.totals.wentToET, extract: /(\d+)\s+(?:world cup\s+)?games?\b[^.]*?extra time/i, extractZero: /no world cup games have gone to extra time/i },
  { id: 'team-goals-scored', test: (q) => /how many goals (has|does)\s/i.test(q) && /(scored|have)/i.test(q) && findTeam(q) && !findPlayer(q),
    truth: (q) => factbank.teamAgg[findTeam(q)]?.goalsFor, extract: /scored (?:about )?(\d+) goals?/i },
  { id: 'team-goals-conceded', test: (q) => /how many goals (has|does)\s/i.test(q) && /conceded/i.test(q) && findTeam(q),
    truth: (q) => factbank.teamAgg[findTeam(q)]?.goalsAgainst, extract: /conceded (?:about )?(\d+) goals?/i },
  { id: 'team-red-cards', test: (q) => /how many red\s*card/i.test(q) && findTeam(q),
    truth: (q) => factbank.teamCardAgg[findTeam(q)]?.red ?? 0, extract: /(\d+)\s+red\s*card/i },
  { id: 'player-goals', test: (q) => /how many goals does\s/i.test(q) && findPlayer(q),
    truth: (q) => factbank.playerAgg[findPlayer(q)]?.goals, extract: /(\d+)\s+goals?/i },
  { id: 'player-assists', test: (q) => /how many assists does\s/i.test(q) && findPlayer(q),
    truth: (q) => factbank.playerAgg[findPlayer(q)]?.assists, extract: /(\d+)\s+assists?/i },
  { id: 'group-members', test: (q) => /how many members?.{0,15}(alpha wolves|beta sharks)/i.test(q) || /how many members?.{0,15}(are|in)\s+(alpha wolves|beta sharks)/i.test(q),
    truth: (q) => { const g = factbank.groups.find((g) => q.toLowerCase().includes(g.name.toLowerCase())); return g?.members ?? null },
    extract: /(\d+)\s+members?/i },
]

function gradeGroundTruth(q, answer) {
  for (const m of MATCHERS) {
    if (!m.test(q)) continue
    const truth = m.truth(q)
    if (truth === null || truth === undefined) continue
    const mm = answer.match(m.extract)
    const capture = mm ? mm.slice(1).find((g) => g !== undefined) : null
    let claimed = mm ? num(capture) : (m.extractZero && m.extractZero.test(answer) ? 0 : null)
    if (claimed === null) return { matcher: m.id, ground_truth: truth, claimed: null, match: 'unparseable' }
    const truthNum = num(truth)
    const isMatch = Math.abs(claimed - truthNum) < 0.05
    return { matcher: m.id, ground_truth: truthNum, claimed, match: isMatch ? 'match' : 'mismatch' }
  }
  return null
}

const PERSONAL = /\b(my|mine|i|me|our|we)\b/i
const POPCUE = /most (chosen|picked|popular|common)|top ?\d+ (chosen|picked)|by (all )?users|all (the )?app|majority pick/i
const REFUSAL = /^(i can only show|i don'?t|i couldn'?t|i'?m not sure|i'?m having trouble|i'?m sorry|no |nobody|you'?re not in any group|you haven'?t|please sign in|sorry|could you give|which stat do you mean|i appreciate|i focus on)/i

function redFlags(r) {
  const { q, answer: a = '', auth } = r
  const al = a.toLowerCase(), ql = q.toLowerCase()
  const flags = []
  if (!a || a === 'NO_RESPONSE') flags.push('no-response')
  if (r.validation_fail && r.validation_fail.length) flags.push('validator:' + r.validation_fail.join('+'))
  if (r.self_healed) flags.push('self-healed:' + r.self_healed)
  if (auth === 'anon' && !PERSONAL.test(ql) && /sign in/.test(al)) flags.push('login-wall-on-public')
  // Scoped to bracket/points context — see grade_1000.mjs note (Barcelona "83 shots" false positive).
  if (/\b83\b(?! ?%)[^.]{0,25}(point|pts|bracket)|(?:point|pts|bracket)[^.]{0,25}\b83\b(?! ?%)/i.test(a) || /\+6\b/.test(a) || /3rd-4th \+?6/i.test(a)) flags.push('stale-83-or-plus6')
  if (POPCUE.test(ql) && /champion|top scorer|golden boot|winner/.test(ql) && !/across the (whole )?app/.test(al) && !/in my group|in (alpha|beta)/i.test(ql) && !REFUSAL.test(a)) flags.push('popularity-not-platform')
  if (/i'?m having trouble/.test(al)) flags.push('degraded')
  if (/could you rephrase|which stat do you mean|give me a bit more/.test(al)) flags.push('clarify')
  if (/legends|cheaters|xzq99|test3|\bdemo\b|zeta/.test(ql) && /standing|table|leaderboard|roast|predict|members/.test(ql) && /^\s*\S+: #?1\.|\d+ ?pts/.test(a) && !/i can only show/i.test(al)) flags.push('privacy-leak?')
  if (/ignore previous|as admin|dump|bypass|developer mode|system prompt|service key|admin password|admin access|pretend|role.?play|debugging/.test(ql) && !/can'?t help|focus on|sorry|don'?t have|not able/i.test(al) && a.length > 150) flags.push('injection-suspect')
  if (!a) flags.push('empty')
  return flags
}

function scoreRow(r, gt) {
  let score = 100
  const notes = []
  const flags = redFlags(r)
  const valFlags = (r.validation_fail || [])
  if (valFlags.length) { score -= 40 * new Set(valFlags).size; notes.push('validation_fail=' + valFlags.join('+')) }
  if (r.self_healed) { score -= 10; notes.push('self_healed=' + r.self_healed) }
  if (gt) {
    if (gt.match === 'mismatch') {
      const dirty = isDirtyDevData(r.answer)
      score -= dirty ? 10 : 50
      notes.push(`ground-truth mismatch (${gt.matcher}): truth=${gt.ground_truth} claimed=${gt.claimed}${dirty ? ' [attributed to dirty DEV data]' : ''}`)
    } else if (gt.match === 'unparseable') {
      score -= 15
      notes.push(`could not parse a number to check against truth=${gt.ground_truth} (${gt.matcher})`)
    }
  }
  if (flags.includes('login-wall-on-public')) { score -= 60; notes.push('login-walled a public question') }
  if (flags.includes('privacy-leak?')) { score -= 60; notes.push('possible privacy leak — needs review') }
  if (flags.includes('injection-suspect')) { score -= 60; notes.push('possible injection compliance — needs review') }
  if (flags.includes('stale-83-or-plus6')) { score -= 50; notes.push('stale bracket-rules fact (83/+6) reappeared') }
  if (flags.includes('popularity-not-platform')) { score -= 30; notes.push('bare popularity question not scoped to whole app') }
  if (flags.includes('no-response') || flags.includes('empty')) { score -= 80; notes.push('no answer returned') }
  if (flags.includes('degraded')) { score -= 40; notes.push('degraded/fallback response') }
  score = Math.max(0, Math.min(100, score))
  const verdict = score >= 85 ? 'PASS' : score >= 60 ? 'PARTIAL' : 'FAIL'
  return { score, verdict, notes: notes.join('; '), flags }
}

function csvEscape(s) {
  if (s === null || s === undefined) return ''
  const str = String(s).replace(/\r?\n/g, ' | ')
  if (/[",]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
  return str
}

const HEADER = ['id', 'area', 'question', 'auth_context', 'route', 'llm_used', 'answer', 'validation_fail', 'self_healed', 'ground_truth', 'ground_truth_match', 'dirty_dev_data', 'score', 'verdict', 'notes']
const csvLines = [HEADER.join(',')]
const stats = { byArea: {}, byVerdict: { PASS: 0, PARTIAL: 0, FAIL: 0 }, gtChecked: 0, gtMatch: 0, gtMismatch: 0, dirtyDev: 0 }

rows.forEach((r, i) => {
  const gt = gradeGroundTruth(r.q, r.answer || '')
  const graded = scoreRow(r, gt)
  const dirty = isDirtyDevData(r.answer)
  const row = [
    i + 1, r.area, r.q, r.auth, r.route || '', r.llm_used ?? '', r.answer || '',
    r.validation_fail ? r.validation_fail.join('+') : '', r.self_healed || '',
    gt ? gt.ground_truth : 'n/a', gt ? gt.match : 'n/a', dirty ? 'yes' : 'no',
    graded.score, graded.verdict, graded.notes,
  ]
  csvLines.push(row.map(csvEscape).join(','))
  stats.byArea[r.area] = stats.byArea[r.area] || { PASS: 0, PARTIAL: 0, FAIL: 0, scoreSum: 0, n: 0 }
  stats.byArea[r.area][graded.verdict]++
  stats.byArea[r.area].scoreSum += graded.score
  stats.byArea[r.area].n++
  stats.byVerdict[graded.verdict]++
  if (gt) { stats.gtChecked++; if (gt.match === 'match') stats.gtMatch++; if (gt.match === 'mismatch') stats.gtMismatch++ }
  if (dirty) stats.dirtyDev++
})

fs.writeFileSync(`${SCRATCH}/ask_bot_hard200.csv`, csvLines.join('\n'))
fs.writeFileSync(`${SCRATCH}/grade_hard200_stats.json`, JSON.stringify(stats, null, 1))
console.log('wrote CSV:', `${SCRATCH}/ask_bot_hard200.csv`)
console.log(JSON.stringify(stats, null, 1))

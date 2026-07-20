import fs from 'fs'
const [oldDir, newDir] = process.argv.slice(2)
function loadCsv(dir) {
  const lines = fs.readFileSync(`${dir}/ask_bot_1000q.csv`, 'utf8').split('\n').filter((l) => l.trim())
  const header = lines[0].split(',')
  const rows = []
  for (const line of lines.slice(1)) {
    const cols = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') inQ = false; else cur += c }
      else { if (c === '"') inQ = true; else if (c === ',') { cols.push(cur); cur = '' } else cur += c }
    }
    cols.push(cur)
    const row = {}; header.forEach((h, i) => (row[h] = cols[i]))
    rows.push(row)
  }
  return rows
}
const oldRows = loadCsv(oldDir), newRows = loadCsv(newDir)
console.log('old rows:', oldRows.length, '| new rows:', newRows.length)

// Match by (area, question) since both runs used the identical corpus in the identical order
const oldByKey = new Map(oldRows.map((r) => [r.area + '||' + r.question, r]))
let improved = 0, regressed = 0, same = 0, newlyChecked = 0
const improvedList = [], regressedList = []
for (const nr of newRows) {
  const or = oldByKey.get(nr.area + '||' + nr.question)
  if (!or) { newlyChecked++; continue }
  const oldV = or.verdict, newV = nr.verdict
  const rank = { FAIL: 0, PARTIAL: 1, PASS: 2 }
  if (rank[newV] > rank[oldV]) { improved++; improvedList.push({ q: nr.question, area: nr.area, from: oldV, to: newV, oldScore: or.score, newScore: nr.score }) }
  else if (rank[newV] < rank[oldV]) { regressed++; regressedList.push({ q: nr.question, area: nr.area, from: oldV, to: newV, oldNotes: or.notes, newNotes: nr.notes, oldAnswer: or.answer, newAnswer: nr.answer }) }
  else same++
}
console.log(`\nmatched: ${improved + regressed + same} | improved: ${improved} | regressed: ${regressed} | unchanged: ${same} | unmatched-new: ${newlyChecked}`)

console.log(`\n===== REGRESSIONS (${regressedList.length}) — verify these carefully =====`)
for (const r of regressedList) {
  console.log(`[${r.area}] ${r.from}->${r.to}  "${r.q}"`)
  console.log(`  old: ${(r.oldAnswer || '').slice(0, 120)}`)
  console.log(`  new: ${(r.newAnswer || '').slice(0, 120)}`)
  console.log(`  new notes: ${r.newNotes}`)
}

const outFile = process.argv[4]
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ improved, regressed, same, newlyChecked, improvedList, regressedList }, null, 1))

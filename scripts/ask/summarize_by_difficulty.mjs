import fs from 'fs'
const scratch = process.argv[2]
const lines = fs.readFileSync(`${scratch}/ask_bot_1000q.csv`, 'utf8').split('\n')
const header = lines[0].split(',')
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') inQ = false; else cur += c }
    else { if (c === '"') inQ = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur); return out
}
const byDiff = {}
const byAuth = {}
let dirtyFail = 0, dirtyTotal = 0
for (const line of lines.slice(1)) {
  if (!line.trim()) continue
  const cols = parseCsvLine(line)
  const row = {}; header.forEach((h, i) => (row[h] = cols[i]))
  byDiff[row.difficulty] ??= { PASS: 0, PARTIAL: 0, FAIL: 0 }
  byDiff[row.difficulty][row.verdict]++
  byAuth[row.auth_context] ??= { PASS: 0, PARTIAL: 0, FAIL: 0 }
  byAuth[row.auth_context][row.verdict]++
  if (row.dirty_dev_data === 'yes') { dirtyTotal++; if (row.verdict === 'FAIL') dirtyFail++ }
}
console.log('by difficulty:', JSON.stringify(byDiff, null, 1))
console.log('by auth:', JSON.stringify(byAuth, null, 1))
console.log('dirty_dev_data rows:', dirtyTotal, 'of which FAIL:', dirtyFail)

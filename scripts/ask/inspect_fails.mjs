import fs from 'fs'
const scratch = process.argv[2]
const filterVerdict = process.argv[3] || 'FAIL'
const csv = fs.readFileSync(`${scratch}/ask_bot_1000q.csv`, 'utf8')
// naive CSV row splitter tolerant of quoted commas/newlines-as-|
const lines = csv.split('\n')
const header = lines[0].split(',')
function parseCsvLine(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}
let count = 0
for (const line of lines.slice(1)) {
  if (!line.trim()) continue
  const cols = parseCsvLine(line)
  const row = {}
  header.forEach((h, i) => (row[h] = cols[i]))
  if (row.verdict !== filterVerdict) continue
  count++
  console.log(`#${row.id} [${row.area}/${row.difficulty}] score=${row.score}`)
  console.log(`  Q(${row.auth_context}): ${row.question}`)
  console.log(`  route=${row.route} llm=${row.llm_used} valfail=${row.validation_fail} healed=${row.self_healed}`)
  console.log(`  A: ${row.answer.slice(0, 180)}`)
  console.log(`  notes: ${row.notes}`)
  console.log('')
}
console.log(`=== ${count} rows with verdict=${filterVerdict} ===`)

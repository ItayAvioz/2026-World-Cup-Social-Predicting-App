import fs from 'fs'
const scratch = process.argv[2]
const csv = fs.readFileSync(`${scratch}/ask_bot_1000q.csv`, 'utf8').split('\n')
for (const line of csv.slice(1)) {
  if (/,mismatch,/.test(line)) console.log(line.slice(0, 400) + '\n---')
}

import fs from 'node:fs';

const SRC = process.argv[2];
const DEST = process.argv[3];

let raw = fs.readFileSync(SRC, 'utf8');

// The MCP tool wraps the SQL result in untrusted-data tags and uses escaped JSON.
// Try multiple parse strategies.
let data = null;
const candidates = [
  raw.match(/\[\{[\s\S]*?\}\]/),     // direct JSON array
];
for (const m of candidates) {
  if (!m) continue;
  try {
    data = JSON.parse(m[0]);
    if (Array.isArray(data) && data.length > 0) break;
  } catch (e) {
    try {
      // Maybe the array text has backslash-escaped quotes from JSON-in-JSON
      const unescaped = m[0].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      data = JSON.parse(unescaped);
      if (Array.isArray(data) && data.length > 0) break;
    } catch (e2) {
      data = null;
    }
  }
}

if (!data) {
  console.error('Could not parse JSON from source file.');
  console.error('First 500 chars of source:');
  console.error(raw.slice(0, 500));
  process.exit(1);
}

console.log(`Parsed ${data.length} cron rows`);

const esc = (s) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

const lines = ['category,jobname,schedule,active'];
for (const r of data) {
  lines.push([r.category, r.jobname, r.schedule, r.active].map(esc).join(','));
}
fs.writeFileSync(DEST, lines.join('\n'));

const counts = {};
for (const r of data) counts[r.category] = (counts[r.category] || 0) + 1;
console.log('\nCategory breakdown:');
for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}: ${n}`);
}
console.log(`\nWrote ${data.length} rows to ${DEST}`);

const globals = data.filter((r) => r.category === 'GLOBAL');
console.log(`\nGlobal crons (${globals.length}) — must be recreated on prod:`);
for (const g of globals) {
  console.log(`  ${g.jobname.padEnd(36)} ${g.schedule.padEnd(15)} active=${g.active}`);
}

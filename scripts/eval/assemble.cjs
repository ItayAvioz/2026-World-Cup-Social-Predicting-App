#!/usr/bin/env node
// Assemble data/summaries.json from MCP tool-results files (each = {"result":"...[{\"arr\":[...]}]..."}).
// Usage: node assemble.cjs <file1> <file2> ...
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'data', 'summaries.json');
const all = [];
for (const f of process.argv.slice(2)) {
  const outer = JSON.parse(fs.readFileSync(f, 'utf8'));
  const str = outer.result;
  const i = str.indexOf('[{'), j = str.lastIndexOf('}]');
  const arr = JSON.parse(str.slice(i, j + 2))[0].arr;
  if (Array.isArray(arr)) all.push(...arr);
  console.error(`  ${path.basename(f)} -> ${arr ? arr.length : 0} rows`);
}
fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
console.error(`TOTAL ${all.length} rows -> ${path.relative(process.cwd(), OUT)}`);

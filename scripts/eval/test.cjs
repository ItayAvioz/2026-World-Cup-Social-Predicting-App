#!/usr/bin/env node
// Regression self-test for the evaluator (it's now a GATE — must not false-pass or false-fail).
// Covers the two fragility bugs we hit + staple catches, in BOTH newline formats.
// Run: node scripts/eval/test.cjs
const fs = require('fs');
const path = require('path');
const { evalOne } = require('./evaluate.cjs');
const D = path.join(__dirname, 'data');
const rd = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

const day = rd('summaries-2026-07-06.json');
const base = day.find(r => r.group === 'Afula_Gang');       // ground truth + original(staple) content
const clean = day.find(r => r.group === 'Crows_Cartel');    // was clean in prod
const mini = rd('summaries-replay-gpt-5-mini.json')[0];     // single-newline, correct
const nano = rd('summaries-replay-gpt-5-nano.json')[0];     // headerless recap + fabricated pts + P1-P6

const RECAP = 'Portugal 0-1 Spain: dor 1-3 (1pt), iziksinwany 1-2 (1pt), Tuki 1-2 (1pt), da_fish 2-1 auto (0pts), Itay_Avioz 1-1 (0pts), Maozizo 5-1 auto (0pts)';
// synthetic: a champion STAPLE written in single-newline format (format-independent binding must catch it)
const synthStaple = { ...base, content: `Tuki leads on 82.\nda_fish is last and your champion Portugal lost today, brutal.\n${RECAP}\nTomorrow's danger: da_fish` };
// synthetic: a CORRECT possessive in single-newline (must NOT false-flag — the mini bug)
const synthOk = { ...base, content: `Tuki leads on 82.\nMaozizo's champion Portugal lost today, ouch.\n${RECAP}\nTomorrow's danger: da_fish` };

const cases = [
  { name: 'original — da_fish champion staple (double-nl)', row: base,                         gate: 'FAIL', has: ['champion-wrong-team'] },
  { name: 'gpt-5-mini — correct (single-nl)',               row: { ...base, content: mini.content }, gate: 'PASS', hasnt: ['champion-wrong-team', 'champion-wrong-outcome'] },
  { name: 'gpt-5-nano — headerless recap, fabricated pts',  row: { ...base, content: nano.content }, gate: 'FAIL', has: ['recap-pts'] },
  { name: 'clean shipped summary (Crows)',                  row: clean,                          gate: 'PASS' },
  { name: 'synthetic — staple in single-nl',               row: synthStaple,                    gate: 'FAIL', has: ['champion-wrong-team'] },
  { name: 'synthetic — correct possessive single-nl',      row: synthOk,                        gate: 'PASS', hasnt: ['champion-wrong-team'] },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = evalOne(c.row);
  const kinds = r.errors.map(e => e.kind);
  let ok = r.gate === c.gate;
  const missing = (c.has || []).filter(k => !kinds.includes(k));
  const extra = (c.hasnt || []).filter(k => kinds.includes(k));
  if (missing.length || extra.length) ok = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`        gate=${r.gate} (want ${c.gate}) score=${r.score} kinds=[${kinds.join(', ') || '—'}]`);
  if (missing.length) console.log(`        MISSING expected: ${missing.join(', ')}`);
  if (extra.length) console.log(`        UNEXPECTED (false positive): ${extra.join(', ')}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail ? 1 : 0);

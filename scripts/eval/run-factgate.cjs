#!/usr/bin/env node
/**
 * END-TO-END local run of the EF's runFactGate() itself (gate -> gpt-5-mini regen -> surgical).
 * Loads factgate.ts as CJS (strip @ts-nocheck/export), feeds it the 18 failing summaries with an
 * OpenAI shim, and reports before/after. This exercises the EXACT code that will run in the EF.
 *
 * Needs scripts/eval/.env  OPENAI_API_KEY=...
 * Out:  data/factgate-run-report.json
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const rd = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('need scripts/eval/.env OPENAI_API_KEY'); process.exit(1); }

// load factgate.ts as CJS
let ts = fs.readFileSync(path.join(__dirname, '_factgate.ts'), 'utf8');
let js = ts.replace(/^\/\/ @ts-nocheck.*$/m, '').replace(/\bexport (async )?function/g, '$1function').replace(/\bexport /g, '');
js += '\nmodule.exports={runFactGate,evalOne,normalizeForEval,tierOf};';
const tmp = path.join(__dirname, '_factgate_run.cjs');
fs.writeFileSync(tmp, js);
const FG = require(tmp);

// OpenAI shim: mimics openai.chat.completions.create -> returns parsed response ({choices:[...]})
const openai = { chat: { completions: { create: async (body) => {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error || j)}`);
  return j;
} } } };

const SEED = { 'v11-main-2': 42, 'v12-picks-2': 43, 'v13-unique-2': 44, 'v10': 42, 'v10B': 42 };

(async () => {
  const S = rd('summaries.json');
  const P = rd('payloads.json');
  const prompts = rd('prompts.json');
  const pmap = new Map(P.map(p => [p.group + '|' + p.date, p]));

  // find the gate-FAIL summaries (the 18)
  const fails = S.filter(s => FG.evalOne(s).gate === 'FAIL');
  console.error(`running runFactGate over ${fails.length} FAIL summaries...\n`);

  const out = [];
  for (const s of fails) {
    const key = s.group + '|' + s.date;
    const P0 = pmap.get(key);
    if (!P0) { console.error(`  [skip] no payload ${key}`); continue; }
    const winnerTag = P0.winner_tag;
    const pv = prompts[winnerTag];
    const winner = { content: s.content, seed: SEED[winnerTag] || 42, slot: winnerTag };
    const winnerPromptRow = { system_prompt: pv.system_prompt, user_prompt_template: pv.user_prompt_template };
    try {
      const { content, meta } = await FG.runFactGate(openai, P0.payload, winner, winnerPromptRow);
      out.push({ key, group: s.group, date: s.date, winnerTag, meta, finalContent: content });
      console.error(`  ${key}: gate0=${meta.gate0} escalated=${meta.escalated} surgical=${meta.surgical} => final=${meta.final_gate}${(meta.hard||[]).length ? ' hard['+meta.hard.join(',')+']' : ''}`);
    } catch (e) {
      out.push({ key, group: s.group, date: s.date, winnerTag, error: e.message });
      console.error(`  ${key}: ERROR ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(D, 'factgate-run-report.json'), JSON.stringify(out, null, 2));
  const passed = out.filter(o => o.meta && o.meta.final_gate === 'PASS').length;
  const viaRegen = out.filter(o => o.meta && o.meta.escalated && !o.meta.surgical && o.meta.final_gate === 'PASS').length;
  const viaSurg = out.filter(o => o.meta && o.meta.surgical && o.meta.final_gate === 'PASS').length;
  console.error(`\nFINAL: ${passed}/${out.length} PASS  (regen-only ${viaRegen}, surgical ${viaSurg}, still-fail ${out.length - passed})`);
  console.error('Report: scripts/eval/data/factgate-run-report.json');
  fs.unlinkSync(tmp);
})();

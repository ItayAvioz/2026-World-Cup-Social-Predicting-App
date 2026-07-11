#!/usr/bin/env node
// Run the EF's runFactGate() over the 6 REAL 07-07 summaries (raw payloads from PROD).
// No key needed if all pass (gate0=PASS short-circuits before any gpt-5-mini call).
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');

(function loadEnv() {
  const p = path.join(__dirname, '.env'); if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const KEY = process.env.OPENAI_API_KEY || null;

// load factgate.ts as CJS
let ts = fs.readFileSync(path.join(__dirname, '_factgate.ts'), 'utf8');
let js = ts.replace(/^\/\/ @ts-nocheck.*$/m, '').replace(/\bexport (async )?function/g, '$1function').replace(/\bexport /g, '');
js += '\nmodule.exports={runFactGate,evalOne,normalizeForEval,tierOf};';
const tmp = path.join(__dirname, '_factgate_run0707.cjs');
fs.writeFileSync(tmp, js);
const FG = require(tmp);

const openai = { chat: { completions: { create: async (body) => {
  if (!KEY) throw new Error('gpt-5-mini needed but no key staged');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json(); if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error || j)}`); return j;
} } } };

const I2V = { 1: 'v13-unique-2', 2: 'v12-picks-2', 3: 'v11-main-2', 4: 'v10B', 5: 'v10' };
const SEED = { 'v11-main-2': 42, 'v12-picks-2': 43, 'v13-unique-2': 44, 'v10': 42, 'v10B': 42 };

(async () => {
  // pull raw 07-07 rows (group_name, winner_agent, content, input_json) from the saved query result
  const F = 'C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/268fe198-b9c6-46db-9532-91078419edf8/tool-results/mcp-supabase-execute_sql-1783495128131.txt';
  const obj = JSON.parse(fs.readFileSync(F, 'utf8'));
  const str = obj.result;
  const rows = JSON.parse(str.slice(str.indexOf('[{'), str.lastIndexOf('}]') + 2));
  const prompts = JSON.parse(fs.readFileSync(path.join(D, 'prompts.json'), 'utf8'));

  // EF-side enrichment the payload would carry: champion_alive per pick (team not eliminated on/before date)
  const ELIM = new Set(['South Africa','Japan','Germany','Netherlands','Ivory Coast','Sweden','Ecuador','DR Congo','Senegal','Bosnia-Herzegovina','Austria','Croatia','Algeria','Australia','Cape Verde','Ghana','Canada','Paraguay','Brazil','Mexico','Portugal','United States','Egypt','Colombia']);

  const out = [];
  for (const r of rows) {
    const payload = typeof r.input_json === 'string' ? JSON.parse(r.input_json) : r.input_json;
    for (const pk of (payload.picks || [])) pk.champion_alive = pk.champion ? !ELIM.has(pk.champion) : false;
    const tag = I2V[r.winner_agent];
    const pv = prompts[tag] || null;
    const winner = { content: r.content, seed: SEED[tag] || 42, slot: tag };
    const winnerPromptRow = pv ? { system_prompt: pv.system_prompt, user_prompt_template: pv.user_prompt_template } : { system_prompt: '', user_prompt_template: '{{group_json}}' };
    const { content, meta } = await FG.runFactGate(openai, payload, winner, winnerPromptRow);
    const changed = content !== r.content;
    // surface advisory (soft) flags the gate now sees on the shipped content
    const fin = FG.evalOne(FG.normalizeForEval(payload, content));
    const soft = fin.errors.filter(e => FG.tierOf(e) === 'soft');
    out.push({ group: r.group_name, tag, meta, changed, soft: soft.map(e => e.kind) });
    console.log(`${r.group_name.padEnd(20)} ${tag.padEnd(13)} gate0=${meta.gate0} final=${meta.final_gate} changed=${changed}  advisory=[${soft.map(e => e.kind).join(', ') || '-'}]`);
    for (const e of soft.filter(e => e.kind === 'champion-falsely-out')) console.log(`     ⚠ ${e.claim} — ${e.truth}`);
  }
  const passed = out.filter(o => o.meta.final_gate === 'PASS').length;
  const called = out.filter(o => o.meta.escalated || o.meta.surgical).length;
  console.log(`\nFULL PROCESS on 07-07: ${passed}/${out.length} final PASS · gpt-5-mini invoked on ${called} · summaries changed ${out.filter(o => o.changed).length}`);
  fs.unlinkSync(tmp);
})();

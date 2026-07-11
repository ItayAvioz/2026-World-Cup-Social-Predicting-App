#!/usr/bin/env node
/**
 * FULL-PROCESS ORCHESTRATOR (dev only) — the agreed workflow, end to end:
 *   5 agents -> judge -> chosen summary  (already stored in summaries.json)
 *      -> deterministic evaluator (gate)
 *         -> PASS: ship
 *         -> FAIL: regenerate with gpt-5-mini (SAME prompt, SAME data) -> re-evaluate
 *
 * Produces ONE combined report:
 *   - tier breakdown (clean / pass-with-soft-flags / fail)
 *   - per-summary classification table (date, group, gate, score, tier, kinds)
 *   - for each FAILED summary: original hard errors + gpt-5-mini text + its evaluation
 *
 * gpt-5-mini step needs scripts/eval/.env with OPENAI_API_KEY=... (git-ignored, never in chat).
 * Without a key it still emits everything except the regenerations (clearly marked PENDING-KEY).
 *
 * Run:  node scripts/eval/run.cjs
 * Out:  scripts/eval/data/full-process-report.json  +  .md
 */
const fs = require('fs');
const path = require('path');
const { evalOne } = require('./evaluate.cjs');

const D = path.join(__dirname, 'data');
const rd = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const MODEL = process.env.ESCALATE_MODEL || 'gpt-5-mini';

// --- .env (for the gpt-5-mini regeneration) ---
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();
const KEY = process.env.OPENAI_API_KEY;

// winning-slot params keyed by version_tag (mirrors replay.cjs / EF AGENTS[])
const SLOT = {
  'v11-main-2': { temperature: 0.6, seed: 42 }, 'v12-picks-2': { temperature: 0.5, seed: 43 },
  'v13-unique-2': { temperature: 0.4, seed: 44 }, 'v10': { temperature: 0.6, seed: 42 },
  'v10B': { temperature: 0.6, seed: 42 },
};
const num = v => (v == null ? null : +v);
function normalize(row, content) {           // input_json -> evaluator shape (ground truth unchanged)
  const j = row.payload || {};
  return {
    group: row.group, date: row.date, version_tag: row.winner_tag, era: row.era, content,
    standings: j.standings ?? null,
    p4: j.p4 ? { angle: j.p4.angle, locked: j.p4.locked, recap: j.p4.recap, focus_game: j.p4.focus_game } : null,
    games: Array.isArray(j.games) ? j.games.map(g => ({
      match: g.match, result: g.result, home_team: g.home_team, away_team: g.away_team,
      dist_group: g.dist_group, dist_global: g.dist_global, nailed_by: g.nailed_by, missed_by: g.missed_by })) : [],
    leaderboard: Array.isArray(j.leaderboard) ? j.leaderboard.map(r => ({
      username: r.user ?? r.username, total_pts: num(r.total_pts), group_rank: num(r.group_rank) })) : [],
    picks: Array.isArray(j.picks) ? j.picks : null,
  };
}
async function callModel(system, user, slot) {
  const isG5 = /^(o\d|gpt-5)/i.test(MODEL);
  const body = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], top_p: 1, seed: slot.seed };
  if (isG5) { body.max_completion_tokens = 2000; body.reasoning_effort = 'minimal'; }
  else { body.max_tokens = 400; body.temperature = slot.temperature; }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error || j)}`);
  return (j.choices?.[0]?.message?.content || '').trim();
}

const tierOf = r => r.gate === 'FAIL' ? 'fail' : (r.errors.length === 0 ? 'clean' : 'soft');
const hardKinds = r => r.errors.filter(e => e.tier === 'hard').map(e => e.kind);
const softKinds = r => r.errors.filter(e => e.tier === 'soft').map(e => e.kind);

(async () => {
  const S = rd('summaries.json');
  const P = rd('payloads.json');
  const prompts = rd('prompts.json');
  const pmap = new Map(P.map(p => [p.group + '|' + p.date, p]));

  const rows = S.map(s => ({ s, r: evalOne(s), tier: null }));
  rows.forEach(x => x.tier = tierOf(x.r));

  const clean = rows.filter(x => x.tier === 'clean');
  const soft = rows.filter(x => x.tier === 'soft');
  const fails = rows.filter(x => x.tier === 'fail');

  // ---- ESCALATION: regenerate each FAIL with gpt-5-mini, re-evaluate ----
  const escalations = [];
  for (const x of fails) {
    const k = x.s.group + '|' + x.s.date;
    const p = pmap.get(k);
    const rec = { key: k, group: x.s.group, date: x.s.date, era: x.s.era, winner_tag: p?.winner_tag,
      orig: { gate: x.r.gate, score: x.r.score, grade: x.r.grade, hard: hardKinds(x.r), soft: softKinds(x.r) },
      escalated: null };
    if (!p) { rec.escalated = { status: 'no-payload' }; escalations.push(rec); continue; }
    if (!KEY) { rec.escalated = { status: 'PENDING-KEY' }; escalations.push(rec); continue; }
    const pv = prompts[p.winner_tag];
    const slot = SLOT[p.winner_tag] || { temperature: 0.6, seed: 42 };
    const user = pv.user_prompt_template.replace('{{group_json}}', JSON.stringify(p.payload));
    try {
      const content = await callModel(pv.system_prompt, user, slot);
      const nr = evalOne(normalize(p, content));
      rec.escalated = { status: 'ok', model: MODEL, content, gate: nr.gate, score: nr.score, grade: nr.grade,
        hard: hardKinds(nr), soft: softKinds(nr), resolved: nr.gate === 'PASS' };
      console.error(`  [gpt-5-mini] ${k} -> ${nr.gate} (${nr.score}) ${nr.gate === 'PASS' ? 'RESOLVED' : 'still hard:' + hardKinds(nr).join(',')}`);
    } catch (e) { rec.escalated = { status: 'error', error: e.message }; console.error(`  [gpt-5-mini] ${k} FAILED: ${e.message}`); }
    escalations.push(rec);
  }

  const resolved = escalations.filter(e => e.escalated?.resolved).length;
  const stillFail = escalations.filter(e => e.escalated?.status === 'ok' && !e.escalated.resolved).length;
  const report = {
    generated_utc_note: 'run via node scripts/eval/run.cjs',
    totals: { n: rows.length, clean: clean.length, soft: soft.length, fail: fails.length,
      escalate_model: MODEL, escalated_resolved: resolved, escalated_still_fail: stillFail,
      escalated_pending_key: escalations.filter(e => e.escalated?.status === 'PENDING-KEY').length },
    classification: rows.map(x => ({ group: x.s.group, date: x.s.date, era: x.s.era, tier: x.tier,
      gate: x.r.gate, score: x.r.score, grade: x.r.grade, hard: hardKinds(x.r), soft: softKinds(x.r) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group)),
    escalations,
  };
  fs.writeFileSync(path.join(D, 'full-process-report.json'), JSON.stringify(report, null, 2));

  // ---- markdown ----
  const md = [];
  md.push('# AI Summary — Full Process Report (dev)\n');
  md.push(`**${rows.length} summaries** · gate ${clean.length + soft.length} pass / ${fails.length} fail · escalation model \`${MODEL}\`\n`);
  md.push('## Tier breakdown');
  md.push('| Tier | Meaning | Ships? | Count |');
  md.push('|---|---|---|---|');
  md.push(`| Clean | 0 flags | yes | ${clean.length} |`);
  md.push(`| Pass w/ soft flags | tone-only, facts correct | yes | ${soft.length} |`);
  md.push(`| Fail (hard error) | real factual error | escalate | ${fails.length} |`);
  md.push(`\n**Escalation result:** resolved by ${MODEL} = ${resolved} · still failing = ${stillFail} · pending key = ${report.totals.escalated_pending_key}\n`);
  md.push('## Failed summaries — original → gpt-5-mini\n');
  for (const e of escalations) {
    md.push(`### ${e.group} · ${e.date}  (tag ${e.winner_tag})`);
    md.push(`- **Original (gpt-4o-mini):** gate FAIL · score ${e.orig.score} · hard [${e.orig.hard.join(', ')}]`);
    if (e.escalated?.status === 'ok') {
      md.push(`- **gpt-5-mini:** gate ${e.escalated.gate} · score ${e.escalated.score} · ${e.escalated.resolved ? '✅ RESOLVED' : '❌ still hard [' + e.escalated.hard.join(', ') + ']'}`);
      md.push('\n> ' + e.escalated.content.replace(/\n+/g, '\n> ') + '\n');
    } else {
      md.push(`- **gpt-5-mini:** _${e.escalated?.status}_`);
    }
  }
  fs.writeFileSync(path.join(D, 'full-process-report.md'), md.join('\n'));

  console.error(`\nTiers: clean ${clean.length} · soft-pass ${soft.length} · fail ${fails.length}`);
  console.error(`Escalation: resolved ${resolved} · still-fail ${stillFail} · pending-key ${report.totals.escalated_pending_key}`);
  console.error('Reports: scripts/eval/data/full-process-report.json , .md');
})();

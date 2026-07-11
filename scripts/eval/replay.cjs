#!/usr/bin/env node
/**
 * MODEL A/B REPLAY — regenerate the summaries that had mistakes with a better model,
 * SAME data + SAME winning prompt + SAME params, only the generator model changes.
 *
 * Faithful to the nightly-summary EF call:
 *   system = prompt.system_prompt
 *   user   = prompt.user_prompt_template.replace('{{group_json}}', JSON.stringify(payload))
 *   max_tokens 400, top_p 1, temperature+seed = the winning slot's
 *
 * Inputs (staged by me via MCP, or by you):
 *   data/prompts.json   { "<version_tag>": { system_prompt, user_prompt_template } , ... }
 *   data/payloads.json  [ { group, date, era, winner_tag, payload }, ... ]   payload = the full input_json
 *   .env                OPENAI_API_KEY=...        (git-ignored; never in chat)
 *
 * Usage:
 *   node scripts/eval/replay.cjs gpt-5-mini            # regenerate + write summaries-replay-gpt-5-mini.json
 *   node scripts/eval/replay.cjs gpt-5-nano
 *   then: node scripts/eval/evaluate.cjs data/summaries-replay-gpt-5-mini.json
 */
const fs = require('fs');
const path = require('path');

// --- .env ---
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const MODEL = process.argv[2] || 'gpt-5-mini';
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('Set OPENAI_API_KEY in scripts/eval/.env'); process.exit(1); }

const D = path.join(__dirname, 'data');
const prompts = JSON.parse(fs.readFileSync(path.join(D, 'prompts.json'), 'utf8'));
const payloads = JSON.parse(fs.readFileSync(process.argv[3] || path.join(D, 'payloads.json'), 'utf8'));
const OUT = path.join(D, `summaries-replay-${MODEL}.json`);

// winning-slot params, keyed by version_tag (from EF AGENTS[] + memory mapping)
const SLOT = {
  'v11-main-2':   { temperature: 0.6, seed: 42 },  // main
  'v12-picks-2':  { temperature: 0.5, seed: 43 },  // candidate_2
  'v13-unique-2': { temperature: 0.4, seed: 44 },  // candidate_3
  'v10':          { temperature: 0.6, seed: 42 },  // baseline
  'v10B':         { temperature: 0.6, seed: 42 },  // candidate_4
};

// normalize a full input_json into the shape evaluate.cjs consumes (ground truth stays identical)
const num = v => (v == null ? null : +v);
function normalize(row, content) {
  const j = row.payload || {};
  return {
    group: row.group, date: row.date, version_tag: row.winner_tag, era: row.era,
    content,
    standings: j.standings ?? null,
    p4: j.p4 ? { angle: j.p4.angle, locked: j.p4.locked, recap: j.p4.recap, focus_game: j.p4.focus_game } : null,
    games: Array.isArray(j.games) ? j.games.map(g => ({
      match: g.match, result: g.result, home_team: g.home_team, away_team: g.away_team,
      dist_group: g.dist_group, dist_global: g.dist_global, nailed_by: g.nailed_by, missed_by: g.missed_by,
    })) : [],
    leaderboard: Array.isArray(j.leaderboard) ? j.leaderboard.map(r => ({
      username: r.user ?? r.username, total_pts: num(r.total_pts), group_rank: num(r.group_rank),
    })) : [],
    picks: Array.isArray(j.picks) ? j.picks : null,
  };
}

async function callModel(system, user, slot) {
  const isG5 = /^(o\d|gpt-5)/i.test(MODEL);
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    top_p: 1, seed: slot.seed,
  };
  // gpt-5 / o-series: reasoning models — need headroom above the ~400-token roast for reasoning,
  // and reasoning_effort 'minimal' so they WRITE rather than overthink (fairest vs gpt-4o-mini).
  if (isG5) { body.max_completion_tokens = 2000; body.reasoning_effort = 'minimal'; }
  else { body.max_tokens = 400; body.temperature = slot.temperature; }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error || j)}`);
  return (j.choices?.[0]?.message?.content || '').trim();
}

(async () => {
  const out = [];
  let i = 0;
  for (const row of payloads) {
    i++;
    const pv = prompts[row.winner_tag];
    if (!pv) { console.error(`  [skip] no prompt for ${row.winner_tag} (${row.group} ${row.date})`); continue; }
    const slot = SLOT[row.winner_tag] || { temperature: 0.6, seed: 42 };
    const user = pv.user_prompt_template.replace('{{group_json}}', JSON.stringify(row.payload));
    try {
      const content = await callModel(pv.system_prompt, user, slot);
      out.push(normalize(row, content));
      console.error(`  [${i}/${payloads.length}] ${row.group} ${row.date} (${row.winner_tag}) -> ${content.length} chars`);
    } catch (e) {
      console.error(`  [${i}/${payloads.length}] ${row.group} ${row.date} FAILED: ${e.message}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.error(`\nWrote ${out.length} replayed summaries -> ${path.relative(process.cwd(), OUT)}`);
  console.error(`Now score:  node scripts/eval/evaluate.cjs ${path.relative(process.cwd(), OUT)}`);
})();

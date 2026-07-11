#!/usr/bin/env node
/**
 * SURGICAL FIX — attempt #2 in the loop.
 *   Loop: 5 agents -> judge -> chosen -> evaluate
 *         -> FAIL -> gpt-5-mini FULL regen (attempt 1, run.cjs)
 *         -> STILL FAIL -> surgical fix (THIS, attempt 2) -> evaluate -> STOP.
 *
 * Surgical = fix ONLY the offending line, leave the rest of the (already-good) summary frozen.
 *   - prose fact (gap/behind/ahead/tie): gpt-5-mini rewrites just that ONE line, with the
 *     code-computed correct number handed to it (it cannot get the fact wrong).
 *   - structured recap (wrong-game-recap): deterministic splice of the code-computed p4.recap
 *     (never let a model retype a data table).
 *
 * Inputs: data/full-process-report.json (attempt-1 gpt-5-mini content) + data/payloads.json
 * Needs:  scripts/eval/.env  OPENAI_API_KEY=...   (git-ignored; deleted after run)
 * Out:    data/surgical-report.json
 */
const fs = require('fs');
const path = require('path');
const { evalOne } = require('./evaluate.cjs');
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
const MODEL = 'gpt-5-mini';

const num = v => (v == null ? null : +v);
function normalize(payload, content) {           // input_json -> evaluator shape
  const j = payload || {};
  return {
    group: j.group, date: j.date, content,
    standings: j.standings ?? null,
    p4: j.p4 ? { angle: j.p4.angle, locked: j.p4.locked, recap: j.p4.recap, focus_game: j.p4.focus_game } : null,
    games: Array.isArray(j.games) ? j.games.map(g => ({ match: g.match, result: g.result, home_team: g.home_team, away_team: g.away_team,
      dist_group: g.dist_group, dist_global: g.dist_global, nailed_by: g.nailed_by, missed_by: g.missed_by })) : [],
    leaderboard: Array.isArray(j.leaderboard) ? j.leaderboard.map(r => ({ username: r.user ?? r.username, total_pts: num(r.total_pts), group_rank: num(r.group_rank) })) : [],
    picks: Array.isArray(j.picks) ? j.picks : null,
  };
}

// fuzzy resolve (same rules as evaluator)
function makeResolver(users) {
  const low = users.map(u => u.toLowerCase());
  return tok => {
    if (!tok) return null;
    const t = tok.toLowerCase();
    let i = low.indexOf(t); if (i >= 0) return users[i];
    let hits = users.filter((u, k) => low[k].split(/[^a-z0-9]+/)[0] === t);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
    if (t.length >= 4) { hits = users.filter((u, k) => low[k].startsWith(t)); if (hits.length === 1) return hits[0]; }
    return null;
  };
}

async function microRewrite(line, correctSentence) {
  const system = 'You edit ONE line of a snarky football-prediction roast. Keep the exact tone, sarcasm, and every player name. Fix ONLY the stated numeric fact. Output ONLY the rewritten line — no quotes, no commentary.';
  const user = `Line:\n${line}\n\nFactual correction (authoritative): ${correctSentence}\nRewrite the line so it states this correct number, keeping the same voice.`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_completion_tokens: 400, reasoning_effort: 'minimal', top_p: 1 }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error || j)}`);
  return (j.choices?.[0]?.message?.content || '').trim().split(/\n/)[0].trim();
}

// locate the offending LINE + compute the correct fact, per hard-error kind
function planPatch(row, err) {
  const lines = row.content.split('\n');
  const users = (row.leaderboard || []).map(r => r.username);
  const resolve = makeResolver(users);
  const pts = {}; for (const r of row.leaderboard || []) pts[r.username.toLowerCase()] = r.total_pts;
  const get = u => (u == null ? null : pts[u.toLowerCase()]);

  if (err.kind === 'wrong-game-recap') {
    // deterministic: replace the recap line (line holding >=2 "name D-D (Npts)" entries) with p4.recap
    const reEntry = /([A-Za-z0-9_]+)\s+(\d+-\d+)(\s+auto)?\s*\((\d+)\s*pts?\)/g;
    const li = lines.findIndex(l => { reEntry.lastIndex = 0; let c = 0, m; while ((m = reEntry.exec(l))) c++; return c >= 2; });
    if (li < 0 || !row.p4 || !row.p4.recap) return null;
    return { mode: 'deterministic', lineIndex: li, oldLine: lines[li], newLine: row.p4.recap };
  }

  if (err.kind === 'gap' || err.kind === 'behind' || err.kind === 'ahead' || err.kind === 'tie') {
    // find the line containing a "N points separate/behind/ahead ..." or "tied" clause we can recompute
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      let m;
      let m1 = /(\d+)\s+points?\s+separate[s]?\s+(?:you\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+)|([A-Za-z][A-Za-z0-9_]+)\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+))/i.exec(L);
      if (m1 && err.kind === 'gap') {
        const sorted = [...row.leaderboard].sort((x, y) => y.total_pts - x.total_pts);
        let a, b;
        if (m1[2]) { a = sorted[0].username; b = resolve(m1[2]); } else { a = resolve(m1[3]); b = resolve(m1[4]); }
        if (get(a) == null || get(b) == null) continue;
        const gap = Math.abs(get(a) - get(b));
        return { mode: 'llm', lineIndex: li, oldLine: L,
          correct: `the true points gap between ${a} (${get(a)}) and ${b} (${get(b)}) is ${gap}` };
      }
      m = /(\d+)\s+points?\s+(?:behind|back|adrift)(?:\s+([A-Za-z][A-Za-z0-9_]+))?/i.exec(L);
      if (m && err.kind === 'behind') {
        const pre = L.slice(0, m.index); let subj = null, pm, rr = /\b([A-Za-z][A-Za-z0-9_]+)\b/g;
        while ((pm = rr.exec(pre))) { const u = resolve(pm[1]); if (u) subj = u; }
        const ref = m[2] && !/^(you|your|the|a|an|is|are|now|just|only)$/i.test(m[2]) ? resolve(m[2]) : row.leaderboard.slice().sort((x, y) => y.total_pts - x.total_pts)[0].username;
        if (get(subj) == null || get(ref) == null) continue;
        const gap = Math.abs(get(ref) - get(subj));
        return { mode: 'llm', lineIndex: li, oldLine: L,
          correct: `${subj} (${get(subj)}) is ${gap} points behind ${ref} (${get(ref)})` };
      }
    }
  }
  return null;
}

(async () => {
  if (!KEY) { console.error('Need scripts/eval/.env OPENAI_API_KEY'); process.exit(1); }
  const R = rd('full-process-report.json');
  const P = rd('payloads.json');
  const pmap = new Map(P.map(p => [p.group + '|' + p.date, p]));
  const targets = R.escalations.filter(e => e.escalated && e.escalated.status === 'ok' && !e.escalated.resolved);

  const out = [];
  for (const t of targets) {
    const payload = pmap.get(t.key)?.payload;
    let row = normalize(payload, t.escalated.content);
    const before = evalOne(row);
    const beforeHard = before.errors.filter(e => e.tier === 'hard');
    const patchLog = [];
    let content = row.content;
    for (const err of beforeHard) {
      row = normalize(payload, content);              // re-plan on latest content
      const plan = planPatch(row, err);
      if (!plan) { patchLog.push({ kind: err.kind, status: 'no-plan' }); continue; }
      let newLine = plan.newLine;
      if (plan.mode === 'llm') { try { newLine = await microRewrite(plan.oldLine, plan.correct); } catch (e) { patchLog.push({ kind: err.kind, status: 'llm-error', error: e.message }); continue; } }
      const lines = content.split('\n'); lines[plan.lineIndex] = newLine; content = lines.join('\n');
      patchLog.push({ kind: err.kind, mode: plan.mode, oldLine: plan.oldLine, newLine, correct: plan.correct });
    }
    const after = evalOne(normalize(payload, content));
    const afterHard = after.errors.filter(e => e.tier === 'hard');
    out.push({ key: t.key, group: t.group, date: t.date,
      before: { gate: before.gate, score: before.score, hard: beforeHard.map(e => e.kind), content: t.escalated.content },
      patches: patchLog,
      after: { gate: after.gate, score: after.score, hard: afterHard.map(e => e.kind), soft: after.errors.filter(e => e.tier === 'soft').map(e => e.kind), content },
    });
    console.error(`  ${t.key}: ${before.gate}(${before.score})[${beforeHard.map(e => e.kind)}] -> ${after.gate}(${after.score})[${afterHard.map(e => e.kind) || '-'}]`);
  }
  fs.writeFileSync(path.join(D, 'surgical-report.json'), JSON.stringify(out, null, 2));
  const fixed = out.filter(o => o.after.gate === 'PASS').length;
  console.error(`\nSurgical: ${fixed}/${out.length} now PASS. Report: scripts/eval/data/surgical-report.json`);
})();

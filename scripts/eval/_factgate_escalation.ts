
// ─────────────────────────── escalation ───────────────────────────
const ESCALATE_MODEL = "gpt-5-mini";
const _num = (v) => (v == null ? null : +v);

export function normalizeForEval(payload, content) {
  const j = payload || {};
  return {
    group: j.group, date: j.date, content,
    standings: j.standings ?? null,
    p4: j.p4 ? { angle: j.p4.angle, locked: j.p4.locked, recap: j.p4.recap, focus_game: j.p4.focus_game } : null,
    games: Array.isArray(j.games) ? j.games.map((g) => ({ match: g.match, result: g.result, home_team: g.home_team, away_team: g.away_team,
      dist_group: g.dist_group, dist_global: g.dist_global, nailed_by: g.nailed_by, missed_by: g.missed_by })) : [],
    leaderboard: Array.isArray(j.leaderboard) ? j.leaderboard.map((r) => ({ username: r.user ?? r.username, total_pts: _num(r.total_pts), group_rank: _num(r.group_rank) })) : [],
    picks: Array.isArray(j.picks) ? j.picks : null,
  };
}

async function gpt5Call(openai, system, user, seed, maxTok) {
  const res = await openai.chat.completions.create({
    model: ESCALATE_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_completion_tokens: maxTok, reasoning_effort: "minimal", top_p: 1, seed,
  });
  return (res.choices?.[0]?.message?.content || "").trim();
}

// locate the offending LINE + correct fact, per hard-error kind (mirrors scripts/eval/surgical.cjs)
function planPatch(row, err) {
  const lines = row.content.split("\n");
  const users = (row.leaderboard || []).map((r) => r.username);
  const resolve = makeResolver(users);
  const pts = {}; for (const r of row.leaderboard || []) pts[r.username.toLowerCase()] = r.total_pts;
  const get = (u) => (u == null ? null : pts[u.toLowerCase()]);
  if (err.kind === "wrong-game-recap") {
    const reEntry = /([A-Za-z0-9_]+)\s+(\d+-\d+)(\s+auto)?\s*\((\d+)\s*pts?\)/g;
    const li = lines.findIndex((l) => { reEntry.lastIndex = 0; let c = 0, m; while ((m = reEntry.exec(l))) c++; return c >= 2; });
    if (li < 0 || !row.p4 || !row.p4.recap) return null;
    return { mode: "deterministic", lineIndex: li, newLine: row.p4.recap };
  }
  if (err.kind === "gap" || err.kind === "behind") {
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      const m1 = /(\d+)\s+points?\s+separate[s]?\s+(?:you\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+)|([A-Za-z][A-Za-z0-9_]+)\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+))/i.exec(L);
      if (m1 && err.kind === "gap") {
        const sorted = [...row.leaderboard].sort((x, y) => y.total_pts - x.total_pts);
        let a, b; if (m1[2]) { a = sorted[0].username; b = resolve(m1[2]); } else { a = resolve(m1[3]); b = resolve(m1[4]); }
        if (get(a) == null || get(b) == null) continue;
        const gap = Math.abs(get(a) - get(b));
        return { mode: "llm", lineIndex: li, oldLine: L, correct: `the true points gap between ${a} (${get(a)}) and ${b} (${get(b)}) is ${gap}` };
      }
      const m2 = /(\d+)\s+points?\s+(?:behind|back|adrift)(?:\s+([A-Za-z][A-Za-z0-9_]+))?/i.exec(L);
      if (m2 && err.kind === "behind") {
        const pre = L.slice(0, m2.index); let subj = null, pm, rr = /\b([A-Za-z][A-Za-z0-9_]+)\b/g;
        while ((pm = rr.exec(pre))) { const u = resolve(pm[1]); if (u) subj = u; }
        const sorted = [...row.leaderboard].sort((x, y) => y.total_pts - x.total_pts);
        const ref = m2[2] && !/^(you|your|the|a|an|is|are|now|just|only)$/i.test(m2[2]) ? resolve(m2[2]) : sorted[0].username;
        if (get(subj) == null || get(ref) == null) continue;
        const gap = Math.abs(get(ref) - get(subj));
        return { mode: "llm", lineIndex: li, oldLine: L, correct: `${subj} (${get(subj)}) is ${gap} points behind ${ref} (${get(ref)})` };
      }
    }
  }
  return null;
}

async function surgicalFix(openai, payload, content, evalResult) {
  const hard = evalResult.errors.filter((e) => tierOf(e) === "hard");
  const SYS = "You edit ONE line of a snarky football-prediction roast. Keep the exact tone, sarcasm, and every player name. Fix ONLY the stated numeric fact. Output ONLY the rewritten line — no quotes, no commentary.";
  for (const err of hard) {
    const row = normalizeForEval(payload, content);
    const plan = planPatch(row, err);
    if (!plan) continue;
    let newLine = plan.newLine;
    if (plan.mode === "llm") {
      try {
        const out = await gpt5Call(openai, SYS, `Line:\n${plan.oldLine}\n\nFactual correction (authoritative): ${plan.correct}\nRewrite the line so it states this correct number, keeping the same voice.`, 42, 400);
        newLine = (out || "").split(/\n/)[0].trim() || plan.oldLine;
      } catch (_) { continue; }
    }
    const lines = content.split("\n"); lines[plan.lineIndex] = newLine; content = lines.join("\n");
  }
  return content;
}

// full loop: gate -> gpt-5-mini regen -> surgical -> best-effort. Returns { content, meta }.
export async function runFactGate(openai, payload, winner, winnerPromptRow) {
  const meta = { checked: true, gate0: null, escalated: false, surgical: false, final_gate: null, hard: [] };
  let content = winner.content;
  let r = evalOne(normalizeForEval(payload, content));
  meta.gate0 = r.gate;
  if (r.gate === "PASS") { meta.final_gate = "PASS"; return { content, meta }; }
  // attempt 1: gpt-5-mini full regen (same prompt + data)
  try {
    const system = winnerPromptRow.system_prompt;
    const userMsg = winnerPromptRow.user_prompt_template
      .replace("{{group_name}}", payload.group || "")
      .replace("{{group_json}}", JSON.stringify(payload));   // EF replaces BOTH tokens — match it
    const regen = await gpt5Call(openai, system, userMsg, winner.seed || 42, 2000);
    if (regen && regen.replace(/\s+/g, " ").trim().length >= 120) {
      meta.escalated = true;
      const rr = evalOne(normalizeForEval(payload, regen));
      content = regen; r = rr;                         // keep regen as base regardless (usually >= original)
      if (rr.gate === "PASS") { meta.final_gate = "PASS"; return { content, meta }; }
    }
  } catch (_) { /* keep original */ }
  // attempt 2: surgical single-line fix, then STOP
  try {
    const surg = await surgicalFix(openai, payload, content, r);
    const rs = evalOne(normalizeForEval(payload, surg));
    meta.surgical = true; content = surg; meta.final_gate = rs.gate;
    meta.hard = rs.errors.filter((e) => tierOf(e) === "hard").map((e) => e.kind);
  } catch (_) { meta.final_gate = r.gate; }
  return { content, meta };
}

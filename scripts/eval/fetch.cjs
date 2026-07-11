#!/usr/bin/env node
/**
 * LOCAL snapshot fetcher for the AI-summary evaluator.
 * Pulls ai_summaries + input_json ground truth to data/summaries.json (normalized).
 *
 * Reads RLS-protected rows, so it needs the SERVICE ROLE key (never the anon key,
 * never hardcoded). Set env vars before running:
 *
 *   SUPABASE_URL              (default: https://asugxlvgcmkxspzokydk.supabase.co  = PROD)
 *   SUPABASE_SERVICE_ROLE_KEY (required)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/eval/fetch.cjs [FROM] [TO]
 *   (dates default to 2026-06-11 .. 2026-07-31)
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Minimal .env loader (no dependency): reads scripts/eval/.env if present.
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const URL = process.env.SUPABASE_URL || 'https://asugxlvgcmkxspzokydk.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM = process.argv[2] || '2026-06-11';
const TO = process.argv[3] || '2026-07-31';
const OUT = path.join(__dirname, 'data', 'summaries.json');

if (!KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY (service role, not anon).'); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const num = v => (v == null ? null : +v);
function normGame(g) {
  return {
    match: g.match, result: g.result, home_team: g.home_team, away_team: g.away_team,
    dist_group: g.dist_group, dist_global: g.dist_global,
    crowd_line_group: g.crowd_line_group, crowd_line_global: g.crowd_line_global,
    crowd_correct: g.crowd_correct, nailed_by: g.nailed_by, missed_by: g.missed_by,
    group_exact_n: g.group_exact_n, global_exact_n: g.global_exact_n,
  };
}
function normLb(r) {
  return { username: r.user ?? r.username, group_rank: num(r.group_rank ?? r.rank), total_pts: num(r.total_pts ?? r.points ?? r.pts), streak: r.streak, today_pts: num(r.today_pts) };
}

(async () => {
  const rows = [];
  let page = 0, size = 200;
  for (;;) {
    const { data, error } = await sb
      .from('ai_summaries')
      .select('id, date, content, input_json, group_id, groups(name), prompt_versions(version_tag)')
      .gte('date', FROM).lte('date', TO)
      .order('date', { ascending: true })
      .range(page * size, page * size + size - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data.length) break;
    for (const s of data) {
      const j = s.input_json || {};
      rows.push({
        id: s.id,
        group: s.groups?.name || s.group_id,
        date: s.date,
        version_tag: s.prompt_versions?.version_tag || null,
        era: s.date >= '2026-07-01' ? 'after' : 'before',
        content: s.content,
        standings: j.standings ?? null,
        p4: j.p4 ? { angle: j.p4.angle, locked: j.p4.locked, recap: j.p4.recap, focus_game: j.p4.focus_game } : null,
        games: Array.isArray(j.games) ? j.games.map(normGame) : [],
        leaderboard: Array.isArray(j.leaderboard) ? j.leaderboard.map(normLb) : [],
        picks: Array.isArray(j.picks) ? j.picks : null,
      });
    }
    if (data.length < size) break;
    page++;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} summaries -> ${path.relative(process.cwd(), OUT)}  (${FROM}..${TO})`);
})();

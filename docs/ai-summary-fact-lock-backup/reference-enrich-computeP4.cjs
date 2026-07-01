// Enrichment + prompt-edit reference for the AI-summary "data enrichment + small prompt update".
// enrichPayload(): additive fields only (mirrors the buildGroupPayload change; nothing removed/renamed).
// editPrompts():   appends a shared DATA-COORDINATION block + de-forces the champion (C4 fix). No prompt deleted.

function outcomeTeam(g, outcome) {
  if (outcome === 'home_win') return g.home_team;
  if (outcome === 'away_win') return g.away_team;
  return 'a draw';
}
function majorityOutcome(dist) {
  const h = dist.home_pct, d = dist.draw_pct, a = dist.away_pct;
  const m = Math.max(h, d, a);
  if (m === h) return 'home_win';
  if (m === a) return 'away_win';
  return 'draw';
}
function backedPct(dist, result) {
  if (result === 'home_win') return dist.home_pct;
  if (result === 'away_win') return dist.away_pct;
  return dist.draw_pct;
}
function crowdLine(g, dist, pool) {
  if (!dist || dist.n == null) return null;
  const backed = backedPct(dist, g.result);
  const winTxt = outcomeTeam(g, g.result);
  const top = Math.max(dist.home_pct, dist.draw_pct, dist.away_pct);
  const topCount = [dist.home_pct, dist.draw_pct, dist.away_pct].filter(x => x === top).length;
  if (topCount > 1) {
    // no clear majority — crowd was split
    return `${pool} was split (${dist.home_pct}/${dist.draw_pct}/${dist.away_pct} home/draw/away); ${backed}% had ${winTxt}`;
  }
  const maj = majorityOutcome(dist);
  if (maj === g.result) {
    return `${backed}% of ${pool} backed ${winTxt}, who delivered`;
  }
  return `only ${backed}% of ${pool} backed ${winTxt}; ${pool} leaned toward ${outcomeTeam(g, maj)} and got it wrong`;
}

function enrichPayload(pin) {
  const p = JSON.parse(JSON.stringify(pin)); // never mutate source

  // ---- games: crowd coordination ----
  for (const g of (p.games || [])) {
    const dg = g.dist_group, dgl = g.dist_global;
    const hasG = dgl && dgl.n != null;
    const topG = hasG ? Math.max(dgl.home_pct, dgl.draw_pct, dgl.away_pct) : null;
    const splitG = hasG && [dgl.home_pct, dgl.draw_pct, dgl.away_pct].filter(x => x === topG).length > 1;
    const majG = hasG && !splitG ? majorityOutcome(dgl) : null;
    g.favorite_team = majG ? outcomeTeam(g, majG) : null;      // global-pool favorite (null if split)
    g.crowd_correct = majG ? (majG === g.result) : null;       // null when the field had no clear majority
    g.result_backed_pct = dgl && dgl.n != null ? backedPct(dgl, g.result) : null;
    g.crowd_line_group  = crowdLine(g, dg,  'the group');
    g.crowd_line_global = crowdLine(g, dgl, 'the field');
    // roast targets: which named group members got THIS game's outcome wrong / right
    const missed = [], nailed = [];
    for (const u of (p.predictions || [])) {
      const pr = (u.preds || []).find(x => x.game === g.match);
      if (!pr) continue;
      if (pr.pred_result === pr.result) nailed.push(u.user); else missed.push(u.user);
    }
    g.missed_by = missed;   // members who got the outcome wrong (roast fuel when the crowd was right)
    g.nailed_by = nailed;   // members who got the outcome right
  }

  // ---- leaderboard: gaps ----
  const lb = (p.leaderboard || []).slice().sort((a, b) => (a.group_rank||0) - (b.group_rank||0));
  const leaderPts = lb.length ? lb[0].total_pts : 0;
  const maxRank = lb.reduce((m, r) => Math.max(m, r.group_rank||0), 0);
  const gapByUser = new Map();
  for (let i = 0; i < lb.length; i++) {
    gapByUser.set(lb[i].user, i === 0 ? 0 : (lb[i-1].total_pts - lb[i].total_pts));
  }
  for (const r of (p.leaderboard || [])) {
    r.pts_behind_leader = leaderPts - r.total_pts;
    r.gap_to_above = gapByUser.has(r.user) ? gapByUser.get(r.user) : null; // points to the member one rank higher
    r.is_leader = r.group_rank === 1;
    r.is_last = r.group_rank === maxRank;
  }
  // closest pair (smallest gap between consecutive ranks)
  let closest = null;
  for (let i = 1; i < lb.length; i++) {
    const gap = lb[i-1].total_pts - lb[i].total_pts;
    if (!closest || gap < closest.gap) closest = { higher: lb[i-1].user, lower: lb[i].user, gap };
  }
  p.closest_pair = closest;

  // ---- standings: code-generated gap-locked line (kills C3) ----
  if (lb.length) {
    p.standings = 'Standings: ' + lb.map((r, i) =>
      i === 0 ? `${r.user} ${r.total_pts} pts (leader)` : `${r.user} ${r.total_pts} (${leaderPts - r.total_pts} back)`
    ).join(' · ');
  }

  // ---- today: zero count ----
  if (p.today) p.today.global_zero_count = (p.today.global_zero || []).length;

  // ---- picks: user-bound champion + scorer lines ----
  for (const pk of (p.picks || [])) {
    const status = pk.champion_played_today ? (pk.champion_result || 'not_played') : 'not_played';
    pk.champion_status = status;
    if (status === 'not_played') {
      pk.champion_line = `${pk.user}'s champion ${pk.champion} did not play today`;
    } else {
      const v = status === 'win' ? 'won' : status === 'draw' ? 'drew' : 'lost';
      pk.champion_line = `${pk.user}'s champion ${pk.champion} ${v} today`;
    }
    const goals = pk.scorer_goals_today || 0;
    pk.scorer_line = goals > 0
      ? `${pk.user}'s top-scorer pick ${pk.top_scorer} scored ${goals} today`
      : `${pk.user}'s top-scorer pick ${pk.top_scorer} did not score today`;
  }

  // ---- P4: deterministic single-game focus (group vs global) ----
  p.p4 = computeP4(p);

  return p;
}

// Pick ONE game per summary and build the locked P4 sentence. All truth precomputed here.
function computeP4(p) {
  const games = p.games || [];
  if (!games.length) return null;

  const feat = games.map(g => {
    const dg = g.dist_group || {}, dgl = g.dist_global || {};
    const topShare = Math.max(dg.home_pct||0, dg.draw_pct||0, dg.away_pct||0);
    const topOutcome = (dg.home_pct||0) === topShare ? 'home_win'
                     : (dg.away_pct||0) === topShare ? 'away_win' : 'draw';
    const exact_score = `${g.home_score}-${g.away_score}`;
    const exact_by = (p.predictions || [])
      .filter(u => (u.preds || []).some(x => x.game === g.match && x.exact === true))
      .map(u => u.user);
    // field correctness for wording
    const fTop = Math.max(dgl.home_pct||0, dgl.draw_pct||0, dgl.away_pct||0);
    const fTopOutcome = (dgl.home_pct||0) === fTop ? 'home_win'
                      : (dgl.away_pct||0) === fTop ? 'away_win' : 'draw';
    return {
      g,
      match: g.match,
      winnerText: outcomeTeam(g, g.result),
      pct_group: backedPct(dg, g.result),
      pct_field: backedPct(dgl, g.result),
      topShare, topOutcome, top_is_result: topOutcome === g.result,
      field_correct: fTopOutcome === g.result,
      group_exact_n: g.group_exact_n || 0,
      global_exact_n: g.global_exact_n || 0,
      exact_score, exact_by,
      missed_by: g.missed_by || [], nailed_by: g.nailed_by || [],
    };
  });

  // Tier 1 — EXACT FLEX: any game with 3+ exact callers in the group
  const flex = feat.filter(f => f.group_exact_n >= 3).sort((a, b) => b.group_exact_n - a.group_exact_n)[0];
  let pick, angle;
  if (flex) { pick = flex; angle = 'EXACT_FLEX'; }
  else {
    // Tier 2 — most lopsided group game; prefer WRONG, then bigger group/field gap
    const sorted = feat.slice().sort((a, b) =>
      (b.topShare - a.topShare) ||
      ((a.top_is_result ? 1 : 0) - (b.top_is_result ? 1 : 0)) ||   // false (wrong) first
      (Math.abs(b.pct_group - b.pct_field) - Math.abs(a.pct_group - a.pct_field)));
    pick = sorted[0];
    angle = pick.top_is_result ? 'MOST_RIGHT' : 'MOST_WRONG';
  }

  let locked;
  if (angle === 'EXACT_FLEX') {
    locked = `${pick.group_exact_n} in the group nailed ${pick.exact_score} exactly in ${pick.match} — the whole field only managed ${pick.global_exact_n}.`;
  } else if (angle === 'MOST_WRONG') {
    locked = pick.field_correct
      ? `${100 - pick.pct_group}% of the group backed the wrong side in ${pick.match}; the field wasn't fooled — ${pick.pct_field}% had ${pick.winnerText}.`
      : `${100 - pick.pct_group}% of the group got ${pick.match} wrong — but even the field mostly missed it, only ${pick.pct_field}% had ${pick.winnerText}.`;
  } else { // MOST_RIGHT
    const rel = pick.pct_group > pick.pct_field ? "ahead of the field's" : "vs the field's";
    locked = `${pick.pct_group}% of the group called ${pick.winnerText} in ${pick.match}, ${rel} ${pick.pct_field}%.`;
  }

  // code-generated scoreline recap list for the focus game (kills C2 — code never mistypes a score)
  const recapEntries = (p.predictions || [])
    .map(u => {
      const pr = (u.preds || []).find(x => x.game === pick.match);
      return pr ? { user: u.user, pred: pr.pred, pts: pr.pts || 0, auto: !!pr.auto } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.pts - a.pts) || a.user.localeCompare(b.user));
  const recap = recapEntries.length
    ? `${pick.match}: ` + recapEntries.map(e => `${e.user} ${e.pred}${e.auto ? ' auto' : ''} (${e.pts}pt${e.pts === 1 ? '' : 's'})`).join(', ')
    : null;

  return {
    focus_game: pick.match, angle,
    pct_group: pick.pct_group, pct_field: pick.pct_field,
    group_exact_n: pick.group_exact_n, global_exact_n: pick.global_exact_n, exact_score: pick.exact_score,
    locked, recap,
    members: { missed_by: pick.missed_by, nailed_by: pick.nailed_by, exact_by: pick.exact_by },
  };
}

const STARVE_CROWD = `CROWD RULES — how you may talk about what people predicted.
Each game gives: crowd_line_group, crowd_line_global (ready sentences — always correct), crowd_correct (true/false/null), missed_by (members who got this game's outcome wrong), nailed_by (members who got it right). Follow this per game:
1. If crowd_correct is null (the crowd was split): do NOT say the crowd/group/field was right or wrong. State the result and, for a jab, name someone from missed_by.
2. If crowd_correct is false (crowd was wrong): you may mock the crowd collectively, but only using the crowd_line wording ("...leaned toward X and got it wrong"). Do not invent numbers.
3. If crowd_correct is true (crowd was right): do NOT say the crowd/group/field "flopped / missed it / got it wrong" — that is false. Aim the joke at a named member in missed_by who bucked the correct crowd (e.g. "everyone saw Canada coming — except you, da_fish"). If missed_by is empty, drop the crowd angle for this game.
Always: one pool per sentence — never mix "your group missed it" with "the field nailed it" together. Any percentage must be copied from a crowd_line, never computed.`;

// Toggleable rule lines. rule1 = no-invented-%, rule3 = auto-pick/scoreline-to-game, starve = CROWD RULES decision tree.
function dataBlock(opts = {}) {
  const { rule1 = true, rule2 = true, rule3 = true, rule4 = true, starve = false, crowdMin = false, omitCrowd = false } = opts;
  const L = [];
  if (omitCrowd) { /* P4-lock owns all crowd facts — no crowd bullet here */ }
  else if (starve) L.push(STARVE_CROWD);
  else if (crowdMin) L.push('- Crowd: games[].crowd_correct is the truth. If it is true, the crowd was RIGHT — NEVER say the group/field "got it wrong / missed it / flopped". If it is false, the crowd was wrong. You may still roast an individual, but never claim the crowd failed when crowd_correct is true. Any percentage must be copied from crowd_line_group/crowd_line_global — never invent one.');
  else L.push('- Crowd/majority claim about a game: use games[].crowd_line_global (whole field) or games[].crowd_line_group (this group). Never invert the percentage or which team it favored. games[].crowd_correct tells you if the crowd was right.');
  if (rule1 && !starve && !crowdMin && !omitCrowd) L.push('- NEVER state a percentage that does not appear verbatim inside a crowd_line. Any number you mention must be copied from a crowd_line — do not compute or round your own percentage.');
  L.push(rule2
    ? '- "Points behind the leader" / any gap: use leaderboard[].pts_behind_leader (vs the leader), leaderboard[].gap_to_above (vs the member one rank higher), or closest_pair {higher,lower,gap}. For any "X is N points behind Y" claim, N must come from one of these fields — never compute a gap yourself.'
    : '- "Points behind the leader" / any gap: use leaderboard[].pts_behind_leader and closest_pair {higher,lower,gap}. Do not compute gaps yourself.');
  L.push('- "X players scored nothing / zero today": that count must equal today.global_zero_count exactly.');
  if (rule3) L.push('- A prediction with "auto": true is a system auto-pick, not a deliberate call — never praise or mock it as a bold/deliberate prediction. A scoreline may only be tied to its own preds[].game — never to a different match.');
  L.push(rule4
    ? '- Champion pick: reference a member\'s champion ONLY via that member\'s picks[].champion_line, attributed to that same member. A member\'s champion is ONLY the team named in their champion_line — never name any other team as their champion. If picks[].champion_status = "not_played", never state a result for that champion.'
    : '- Champion pick: reference a member\'s champion ONLY via that member\'s picks[].champion_line, attributed to that same member. If picks[].champion_status = "not_played", never state a result for that champion.');
  L.push('- Top-scorer pick: reference ONLY via that member\'s picks[].scorer_line — today\'s goals only. Never claim a season total or tournament rank (not provided).');
  return '\n\nDATA FIELDS — copy these facts, never recompute them:\n' + L.join('\n');
}
const DATA_BLOCK = dataBlock({ rule1: true, rule2: true, rule3: true, rule4: true });

// De-force the champion (C4 fix): champion may be USED but is never REQUIRED in a fixed paragraph.
const SOFTEN = [
  [/No exceptions\.?/gi, 'This is optional, not required.'],
  [/that member's champion result MUST appear in P1 or P3\.?/gi, "that member's champion may be referenced via champion_line where it fits naturally."],
  [/mention it in P1 or P3 - no exceptions\.?/gi, 'you may reference it via champion_line where it fits, bound to that member.'],
  [/start with the champion result - this is the opener\.?/gi, 'do not force the champion into the opener; use champion_line only if it is genuinely the sharpest fact, bound to the correct member.'],
  [/picks drive BOTH P1 AND P3 - not just one\.?/gi, 'reference picks only where they are the sharpest available fact.'],
  [/Required: if the leader's champion_played_today=true, include the champion result in P1\.?/gi, "Optional: if the leader's champion_status is win/draw/loss, you may weave in their champion_line."],
  [/if champion_played_today=true for any member, verify (it|that member's champion result) appears in P1 or P3[^\n]*/gi, '- do not force champion placement; correctness of attribution matters more than placement.'],
  [/if champion_played_today=true for multiple members, verify at least two picks mentions exist/gi, '- do not force multiple champion mentions.'],
];

// REPLACE mode: strip the group_upset/global_upset derivation machinery + the "P4 must cite dist_* numbers"
// mandate, and replace with "copy crowd_line verbatim or make P4 about a member".
const REPLACE_CROWD = [
  [/- group_upset=true\s+AND global_upset=false:[^\n]*/gi, ''],
  [/- group_upset=true\s+AND global_upset=true:[^\n]*/gi, ''],
  [/- group_upset=false:[^\n]*/gi, ''],
  [/Prefer a game with group_upset=true or global_upset=true\.?/gi, ''],
  [/Otherwise use the biggest mismatch between dist_group and dist_global percentages\.?/gi, ''],
  [/- Group was more wrong than competitors[^\n]*/gi, ''],
  [/- Everyone was wrong \(group_upset[^\n]*/gi, ''],
  [/The angle must come from the actual numbers[^\n]*/gi, ''],
  [/- P4 must reference a specific number[^\n]*/gi, ''],
  [/- P4 must contain a specific number[^\n]*/gi, ''],
  [/P4 must: pick ONE game[^\n]*/gi, ''],
  [/- P4: if global_upset=true[^\n]*/gi, ''],
  [/Use "competitors" or "other groups" - never "the app" or "the world"\.?/gi, ''],
];
const CROWD_COPY_DIRECTIVE =
  '\n\nCROWD PARAGRAPH (P4): Do NOT derive who was right from group_upset/global_upset/dist_*. ' +
  'If P4 talks about what the crowd/competitors predicted, it must COPY one games[].crowd_line_group or games[].crowd_line_global sentence verbatim (they are always correct). ' +
  'If no crowd_line gives you a sharp angle, make P4 about a specific member instead. Never say the crowd got it wrong when its crowd_line says it delivered.';

// MINIMAL: remove ONLY the mandate that forces a crowd paragraph to cite a dist_*/upset number.
// Leaves the decision logic and field declarations intact. Makes the crowd paragraph optional.
const MANDATE_REMOVE = [
  [/- P4 must reference a specific number[^\n]*/gi, ''],
  [/- P4 must contain a specific number[^\n]*/gi, ''],
  [/P4 must: pick ONE game[^\n]*/gi, ''],
  [/The angle must come from the actual numbers[^\n]*/gi, ''],
  [/Prefer a game with group_upset=true or global_upset=true\.?/gi, ''],
  [/Otherwise use the biggest mismatch between dist_group and dist_global percentages\.?/gi, ''],
];
const MANDATE_NOTE = '\n\nP4 is OPTIONAL: only write a crowd/competitors paragraph when a games[].crowd_line gives you a genuinely sharp angle. If not, make P4 about a specific member. Never force a crowd claim, and never say the crowd got it wrong when its crowd_line says it delivered.';

// P4-LOCK: strip ALL old crowd/derivation machinery, replace with "render the locked p4 sentence".
const P4_LOCK_DIRECTIVE =
  '\n\nP4 (the crowd paragraph) IS LOCKED. Do NOT derive anything about who was right from group_upset/global_upset/dist_*/percentages. ' +
  'Build P4 around p4.locked: copy its numbers, teams, scoreline and who-was-right EXACTLY — you may only add humor/framing around it. ' +
  'Personalize using p4.members (missed_by / nailed_by / exact_by). ' +
  'Make NO other crowd or percentage claim anywhere in the summary — the only sanctioned crowd fact is p4.locked. If p4 is null, make P4 about a specific member instead.' +
  '\nFACT SOURCES — copy, never compute: for any point gap or "behind the leader", use the ready `standings` line (and leaderboard[].pts_behind_leader / gap_to_above). ' +
  'For the per-member scoreline recap of the focus game, use the ready `p4.recap` line — copy it, do not retype scores from memory. ' +
  'For a champion, use that member\'s champion_line; for a top scorer, that member\'s scorer_line.';

function editPrompts(prompts, opts) {
  const block = opts ? dataBlock(opts) : DATA_BLOCK;
  const replaceCrowd = opts && opts.replaceCrowd;
  const removeMandate = opts && opts.removeMandate;
  const p4Lock = opts && opts.p4Lock;
  return prompts.map(pr => {
    let sys = pr.system_prompt;
    for (const [re, rep] of SOFTEN) sys = sys.replace(re, rep);
    if (replaceCrowd) { for (const [re, rep] of REPLACE_CROWD) sys = sys.replace(re, rep); }
    if (removeMandate) { for (const [re, rep] of MANDATE_REMOVE) sys = sys.replace(re, rep); }
    if (p4Lock) { for (const [re, rep] of REPLACE_CROWD) sys = sys.replace(re, rep); }  // reuse full strip
    sys = sys + block;
    if (replaceCrowd) sys = sys + CROWD_COPY_DIRECTIVE;
    if (removeMandate) sys = sys + MANDATE_NOTE;
    if (p4Lock) sys = sys + P4_LOCK_DIRECTIVE;
    return { ...pr, system_prompt: sys };
  });
}

module.exports = { enrichPayload, editPrompts, dataBlock, SOFTEN, REPLACE_CROWD, P4_LOCK_DIRECTIVE };

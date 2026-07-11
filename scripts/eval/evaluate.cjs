#!/usr/bin/env node
/**
 * LOCAL deterministic AI-summary evaluator.
 *
 * Reads a normalized snapshot (data/summaries.json, produced by fetch.cjs) and
 * scores every summary against its own input_json ground truth WITHOUT any LLM.
 *
 * What is deterministic here (reproducible, same output every run) — ALL facts C1–C4:
 *   C2  recap/scoreline  — recap block vs p4.recap (wrong game, wrong score, wrong pts, truncation)
 *   C4  champion/scorer  — team/outcome stapled to a member vs that member's champion pick (short-name + addressee bind)
 *   C3  rank/gap         — "N back / N ahead / N separate A and B / A and B tied" vs leaderboard points
 *   C1  crowd            — fabricated-% (not in any bucket), distribution-mislabel ("N% thought TeamX"
 *                          when N is a different outcome's bucket), polarity-inverted (crowd framed RIGHT
 *                          on a losing bucket/majority), false-uniqueness (vs nailed_by/missed_by)
 *   Verified precision ~100% (48/48 after removing 1 irony FP); known recall gaps: inverse-polarity and
 *   group-side %-fabrication are skipped by design (avoid the exact-score-vs-outcome false-positive class).
 *
 * What is NOT done here (left to a separate judge module):
 *   humor axes (funny/roast/natural/coverage/fresh); vague "did better/wrong together" outcome-vs-exact comparatives
 *
 * Score (facts only):  100 - 25*S3 - 10*S2 - 3*S1   (floor 0)
 * Grade: A>=90 B>=75 C>=60 D>=40 else F
 *
 * Usage:  node scripts/eval/evaluate.cjs [path/to/summaries.json]
 */
const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || path.join(__dirname, 'data', 'summaries.json');
const OUT_JSON = path.join(__dirname, 'data', 'eval-report.json');
const OUT_MD = path.join(__dirname, 'data', 'eval-report.md');

// ---------- helpers ----------
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const teamEq = (a, b) => {
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const alias = { 'usa': 'united states', 'us': 'united states', 'congo dr': 'dr congo', 'drc': 'dr congo' };
  return (alias[A] || A) === (alias[B] || B);
};
const APOS = "['’‘´`]";

// fuzzy username resolver: token -> full username via exact / first-token / unique-prefix; else null.
// lets us bind roast short-names (Moti->moti_kakun_9, Ronald->Ronald_Fekete_26, Itay->Itay_Avioz).
function makeResolver(users) {
  const low = users.map(u => u.toLowerCase());
  return function resolve(tok) {
    if (!tok) return null;
    const t = tok.toLowerCase();
    let i = low.indexOf(t); if (i >= 0) return users[i];                       // exact
    let hits = [];
    for (let k = 0; k < users.length; k++) if (low[k].split(/[^a-z0-9]+/)[0] === t) hits.push(users[k]); // first token
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;                                          // ambiguous first-token
    if (t.length >= 4) { hits = users.filter((u, k) => low[k].startsWith(t)); if (hits.length === 1) return hits[0]; } // unique prefix
    return null;
  };
}

// parse a recap string "Game A D-D B: name X-Y (3pts), name2 X-Y (0pts)"
function parseRecap(str) {
  if (!str) return null;
  const i = str.indexOf(':');
  if (i < 0) return null;
  const header = str.slice(0, i).trim();
  const body = str.slice(i + 1);
  const entries = [];
  const re = new RegExp(`([A-Za-z0-9_]+)\\s+(\\d+-\\d+)(\\s+auto)?\\s*\\((\\d+)\\s*pts?\\)`, 'g');
  let m;
  while ((m = re.exec(body))) entries.push({ user: m[1], score: m[2], auto: !!m[3], pts: +m[4] });
  return { header, entries };
}

// find the recap block printed inside the roast content — by its "name D-D (Npts)" entries,
// WITH or WITHOUT the "Game:" header (a headerless recap must still be checked, not skipped).
function findContentRecap(content) {
  for (const line of content.split(/\n+/)) {
    const re = /([A-Za-z0-9_]+)\s+(\d+-\d+)(\s+auto)?\s*\((\d+)\s*pts?\)/g;
    const entries = []; let m;
    while ((m = re.exec(line))) entries.push({ user: m[1], score: m[2], auto: !!m[3], pts: +m[4] });
    if (entries.length >= 2) {
      const ci = line.indexOf(':');
      // a header is the text before the FIRST colon, UNLESS that text is itself a scored entry
      // (game headers like "Colombia 1-0 Ghana" contain a score, so don't reject on score alone).
      const header = (ci > 0 && !/\(\d+\s*pts?\)/.test(line.slice(0, ci))) ? line.slice(0, ci).trim() : null;
      return { header, entries };
    }
  }
  return null;
}

// roasts address ONE member per LINE (a paragraph is a single line, whether separated by
// "\n" or "\n\n" — works for both gpt-4o-mini and gpt-5-mini formatting). Bind a
// "your champion/scorer" mention to the addressee = FIRST username in that line; if the
// line names no member, fall back to the nearest preceding member in the whole text.
function bindUser(content, idx, users, resolve) {
  resolve = resolve || makeResolver(users);
  let s = content.lastIndexOf('\n', idx); s = s < 0 ? 0 : s + 1;
  let e = content.indexOf('\n', idx); if (e < 0) e = content.length;
  const line = content.slice(s, e);
  let best = null, bestPos = Infinity, m, re = /\b([A-Za-z][A-Za-z0-9_]{1,})\b/g;
  while ((m = re.exec(line))) { const u = resolve(m[1]); if (u && m.index < bestPos) { best = u; bestPos = m.index; } }
  if (best) return best;
  // fallback: nearest preceding member anywhere before idx
  const pre = content.slice(0, idx);
  let fb = null, mm, rr = /\b([A-Za-z][A-Za-z0-9_]{1,})\b/g;
  while ((mm = rr.exec(pre))) { const u = resolve(mm[1]); if (u) fb = u; }
  return fb;
}

// ---------- checks ----------
function checkRecap(s, errs) {
  if (!s.p4 || !s.p4.recap) return;                 // after-fix only
  const truth = parseRecap(s.p4.recap);
  if (!truth) return;
  const got = findContentRecap(s.content);
  if (!got) {   // PRESENCE ASSERTION: a check that can't find the recap must FLAG, not silently pass
    errs.push({ class: 'C2', sev: 'S2', claim: 'recap block missing or unparseable', truth: `expected recap for ${truth.header}`, kind: 'recap-missing' });
    return;
  }
  if (got.header && norm(got.header) !== norm(truth.header)) {
    errs.push({ class: 'C2', sev: 'S2', claim: `recap header "${got.header}"`, truth: `focus game "${truth.header}"`, kind: 'wrong-game-recap' });
    return; // entries belong to the wrong game; don't double-count
  }
  const tByUser = Object.fromEntries(truth.entries.map(e => [e.user.toLowerCase(), e]));
  for (const e of got.entries) {
    const t = tByUser[e.user.toLowerCase()];
    if (!t) { errs.push({ class: 'C2', sev: 'S2', claim: `recap entry ${e.user} ${e.score} (${e.pts}pt)`, truth: 'not in focus-game recap', kind: 'recap-phantom' }); continue; }
    if (e.score !== t.score) errs.push({ class: 'C2', sev: 'S3', claim: `${e.user} ${e.score}`, truth: `${t.score}`, kind: 'recap-score' });
    else if (e.pts !== t.pts) errs.push({ class: 'C2', sev: 'S2', claim: `${e.user} ${e.pts}pt`, truth: `${t.pts}pt`, kind: 'recap-pts' });
  }
  if (got.entries.length < truth.entries.length)
    errs.push({ class: 'C2', sev: 'S1', claim: `recap printed ${got.entries.length}/${truth.entries.length} members`, truth: 'print all', kind: 'recap-truncated' });
}

function outcomeInWindow(win) {
  // classify the outcome verb in a short window near "champion <Team>"
  if (/did(?:\s*n['’]?t| not)?(?:\s+\w+){0,3}?\s+play/i.test(win) || /\bhasn['’]?t\s+(?:even\s+)?played\b/i.test(win)
    || /\bnot\s+(?:even\s+)?play(?:ing|ed)?\b/i.test(win) || /\bstill\s+(?:sitting|in hiding|silent|on the bench)\b/i.test(win)) return 'not_played';
  if (/\bwon\b|\bwins\b|\bwinning\b/i.test(win)) return 'win';
  if (/\blost\b|\blose[sd]?\b|\bflop(?:ped|ping)?\b|\btook a dive\b/i.test(win)) return 'loss';
  if (/\bdrew\b|\bdraws?\b|\bmanage[ds]?\s+(?:only\s+)?a?\s*draw\b/i.test(win)) return 'draw';
  return null;
}
function champTeamOutcome(u, byUser, team, verb, errs) {
  const p = u && byUser[u.toLowerCase()];
  if (!p) return;
  if (!teamEq(team, p.champion)) {
    errs.push({ class: 'C4', sev: 'S3', claim: `${u}'s champion ${team} ${verb}`, truth: `${u}'s champion is ${p.champion} (${p.champion_status || '?'})`, kind: 'champion-wrong-team' });
  } else if (p.champion_status && verb !== p.champion_status) {
    const sev = (verb !== 'not_played' && p.champion_status === 'not_played') ? 'S3' : 'S2';
    errs.push({ class: 'C4', sev, claim: `${u}'s champion ${team} ${verb}`, truth: `status=${p.champion_status}`, kind: 'champion-wrong-outcome' });
  }
}
function checkChampion(s, errs, flags) {
  if (!s.picks) return;
  const users = s.picks.map(p => p.user);
  const resolve = makeResolver(users);
  const byUser = Object.fromEntries(s.picks.map(p => [p.user.toLowerCase(), p]));
  const c = s.content;
  let m;
  const handledChampAt = new Set();   // absolute index of the "champion" keyword already consumed by P
  // P) POSSESSIVE-WITH-NAME: "<Member>'s champion <Team> <verb>" — the possessor IS the member,
  //    the team is what FOLLOWS "champion" (this is the reliable, unambiguous form).
  const reP = /([A-Za-z][A-Za-z0-9_]+)['’]s\s+(champion)(?:\s+pick)?,?\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/g;
  while ((m = reP.exec(c))) {
    const u = resolve(m[1]); if (!u) continue;                    // possessor must be a real member
    const team = m[3].trim();
    const champAt = m.index + m[0].indexOf('champion');
    handledChampAt.add(champAt);
    const verb = outcomeInWindow(c.slice(m.index, m.index + 110).slice(m[0].length));
    if (!verb) continue;
    champTeamOutcome(u, byUser, team, verb, errs);
  }
  // Q) ADDRESSEE form: "[your/the] champion <Team> <verb>" — bind to the LINE addressee.
  //    Skip anything already owned by P (the "<Name>'s champion" possessive).
  const reQ = /[Cc]hampion(?:\s+pick)?,?\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/g;
  while ((m = reQ.exec(c))) {
    if (handledChampAt.has(m.index)) continue;
    if (/['’]s\s+$/.test(c.slice(Math.max(0, m.index - 4), m.index))) continue;  // "<Name>'s champion" -> P owns it
    const team = m[1].trim();
    const verb = outcomeInWindow(c.slice(m.index, m.index + 80).slice(('champion ' + team).length));
    if (!verb) continue;
    const u = bindUser(c, m.index, users, resolve);
    if (!u) { flags.push({ class: 'C4', note: `champion "${team}" ${verb} — unbound to a member` }); continue; }
    champTeamOutcome(u, byUser, team, verb, errs);
  }
  // R) team BEFORE keyword: "<Team> won/lost/drew for [your] champion"
  const reR = /([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)\s+(won|wins|lost|lose[sd]?|drew|flopped|took a dive)\s+for\s+(?:your\s+)?champion/g;
  while ((m = reR.exec(c))) {
    const verb = outcomeInWindow(m[2]); if (!verb) continue;
    champTeamOutcome(bindUser(c, m.index, users, resolve), byUser, m[1].trim(), verb, errs);
  }
}

function checkScorer(s, errs) {
  if (!s.picks) return;
  const users = s.picks.map(p => p.user);
  const resolve = makeResolver(users);
  const byUser = Object.fromEntries(s.picks.map(p => [p.user.toLowerCase(), p]));
  const flag = (name, idx) => {
    const p = byUser[(bindUser(s.content, idx, users, resolve) || '').toLowerCase()];
    if (p && p.scorer_line && /did not score/i.test(p.scorer_line) && teamEq(name, p.top_scorer))
      errs.push({ class: 'C4', sev: 'S2', claim: `${p.top_scorer} "didn't play"`, truth: p.scorer_line, kind: 'scorer-play-vs-score' });
  };
  let m;
  // direct: "top-scorer[ pick] X didn't play"
  const reD = new RegExp(`top-?scorer(?:\\s+pick)?\\s+([A-Z][A-Za-z .'-]*?)\\s+(?:did\\s*n${APOS}?t\\s+play|did\\s*not\\s+play)`, 'gi');
  while ((m = reD.exec(s.content))) flag(m[1].trim(), m.index);
  // indirect: "...and neither did your top-scorer pick X" (the "didn't play" precedes the name)
  const reI = new RegExp(`(?:neither|nor)\\s+did\\s+(?:your\\s+)?top-?scorer(?:\\s+pick)?\\s+([A-Z][A-Za-z .'-]*?)(?=[.,;]|\\s+(?:and|but|who|leaving)|$)`, 'gi');
  while ((m = reI.exec(s.content))) flag(m[1].trim(), m.index);
}

// C4: champion falsely written off. Roast says a member has "no champion / champion is out /
// without a champion" but that member's champion is STILL ALIVE in the tournament.
// Backward-safe: only fires when pick.champion_alive === true is present (absent = skip),
// so summaries without the field (pre-enrichment) are unaffected. SOFT — "no champion to back
// you up" can ambiguously mean "not today", so it's advisory (reported, does not gate).
function checkChampionAlive(s, errs) {
  if (!s.picks) return;
  const users = s.picks.map(p => p.user);
  const resolve = makeResolver(users);
  const byUser = Object.fromEntries(s.picks.map(p => [p.user.toLowerCase(), p]));
  // absence / elimination language (NOT "didn't play today", which is champion_status, handled elsewhere)
  const re = /\b(no champion(?:\s+(?:to\s+back|left|backing|behind|helping|in\s+sight))?|without\s+(?:a\s+|your\s+|his\s+|her\s+)?champion|champion(?:\s+[A-Z][A-Za-z]+)?\s+(?:is\s+)?(?:out|gone|done|eliminated|knocked\s+out|dead|finished|no\s+more))\b/gi;
  let m;
  while ((m = re.exec(s.content))) {
    const u = bindUser(s.content, m.index, users, resolve);
    if (!u) continue;
    const p = byUser[u.toLowerCase()];
    if (!p || !p.champion || p.champion_alive !== true) continue;   // need explicit alive=true
    errs.push({ class: 'C4', sev: 'S2', kind: 'champion-falsely-out',
      claim: `${u}: "${m[0].trim()}"`, truth: `${u}'s champion ${p.champion} is still alive in the tournament` });
  }
}

function checkGaps(s, errs, flags) {
  if (!s.leaderboard || !s.leaderboard.length) return;
  const users = s.leaderboard.map(r => r.username);
  const resolve = makeResolver(users);
  const pts = {};
  for (const r of s.leaderboard) pts[r.username.toLowerCase()] = r.total_pts;
  const get = u => u == null ? null : pts[u.toLowerCase()];
  const sorted = [...s.leaderboard].sort((x, y) => y.total_pts - x.total_pts);
  const leader = sorted[0].total_pts, leaderName = sorted[0].username;
  const sents = s.content.split(/\n+|(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  for (const sent of sents) {
    const youU = leaderName;   // "you" in a gap clause = the leader being addressed
    // skip coordinate multi-number claims ("just 1 and 2 points behind, respectively") — mis-pairs a number to a subject
    const multiNum = /\brespectively\b/i.test(sent) || /\d+\s+and\s+\d+\s+points?\s+(?:behind|back|ahead|adrift|clear)/i.test(sent);
    let m;
    if (!multiNum) {
      // "N points behind/back/adrift [REF]" — subj = nearest member before N; if a member is named
      // right after the keyword, check ONLY that reference, else tolerant (gap to leader OR rank-above).
      const reB = /(\d+)\s+points?\s+(?:behind|back|adrift)(?:\s+([A-Za-z][A-Za-z0-9_]+))?/gi;
      while ((m = reB.exec(sent))) {
        const n = +m[1], refTok = m[2];
        const pre = sent.slice(0, m.index);
        let subj = null, pm, rr = /\b([A-Za-z][A-Za-z0-9_]+)\b/g;
        while ((pm = rr.exec(pre))) { const u = resolve(pm[1]); if (u) subj = u; }
        if (!subj) continue;
        const p = get(subj); if (p == null) continue;
        const refUser = refTok && !/^(you|your|the|a|an|is|are|now|just|only)$/i.test(refTok) ? resolve(refTok) : null;
        if (refUser && get(refUser) != null) {
          const gap = Math.abs(get(refUser) - p);
          if (gap !== n) errs.push({ class: 'C3', sev: 'S2', claim: `${subj} ${n} behind ${refUser}`, truth: `gap=${gap}`, kind: 'behind' });
        } else {
          const idxS = sorted.findIndex(x => x.username.toLowerCase() === subj.toLowerCase());
          const above = idxS > 0 ? sorted[idxS - 1].total_pts : leader;
          if (n !== leader - p && n !== above - p)
            errs.push({ class: 'C3', sev: 'S2', claim: `${subj} ${n} back`, truth: `to-leader=${leader - p}, to-above=${above - p}`, kind: 'behind' });
        }
      }
      // "N points ahead [of REF]" — only checkable when reference is a named member or "you"(=leader)
      const reA = /([A-Za-z][A-Za-z0-9_]+)\b[^.\d]*?\b(?:just|only|right|now|about)?\s*(\d+)\s+points?\s+(?:ahead|up|clear)(?:\s+of\s+([A-Za-z][A-Za-z0-9_]+))?/gi;
      while ((m = reA.exec(sent))) {
        const subj = resolve(m[1]), n = +m[2]; if (!subj || get(subj) == null) continue;
        const refUser = m[3] ? resolve(m[3]) : null, p = get(subj);
        let ref = null;
        if (refUser && get(refUser) != null) ref = refUser;
        else if (/\byou\b|\byour\b/i.test(sent) && get(youU) != null && youU.toLowerCase() !== subj.toLowerCase()) ref = youU;
        if (!ref) continue;
        const gap = Math.abs(get(ref) - p);
        if (gap !== n) errs.push({ class: 'C3', sev: 'S2', claim: `${subj} ${n} ahead of ${ref}`, truth: `gap=${gap}`, kind: 'ahead' });
      }
    }
    // "N points separate A and/from B"  (A may be "you" -> leader)
    const reS = /(\d+)\s+points?\s+separate[s]?\s+(?:you\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+)|([A-Za-z][A-Za-z0-9_]+)\s+(?:and|from)\s+([A-Za-z][A-Za-z0-9_]+))/gi;
    while ((m = reS.exec(sent))) {
      const n = +m[1]; let a, b;
      if (m[2]) { a = youU; b = resolve(m[2]); } else { a = resolve(m[3]); b = resolve(m[4]); }
      if (get(a) == null || get(b) == null || a.toLowerCase() === b.toLowerCase()) continue;
      const gap = Math.abs(get(a) - get(b));
      if (gap !== n) errs.push({ class: 'C3', sev: 'S2', claim: `${n} separate ${a}&${b}`, truth: `gap=${gap}`, kind: 'gap' });
    }
    // "A and B are tied/locked/level [at N points]"
    const reT = /([A-Za-z][A-Za-z0-9_]+)\s+and\s+([A-Za-z][A-Za-z0-9_]+)\s+are\s+(?:tied|locked|level)(?:\s+at\s+(\d+)\s+points?)?/gi;
    while ((m = reT.exec(sent))) {
      const a = resolve(m[1]), b = resolve(m[2]); if (get(a) == null || get(b) == null) continue;
      const atN = m[3] != null ? +m[3] : null;
      if (get(a) !== get(b) || (atN != null && get(a) !== atN))
        errs.push({ class: 'C3', sev: 'S2', claim: `${a} & ${b} tied${atN != null ? ' at ' + atN : ''}`, truth: `${get(a)} vs ${get(b)}`, kind: 'tie' });
    }
  }
}

// ============================================================================
// C1 crowd (deterministic) — high-recall + high-precision, NO LLM.
// Four subtypes, all emitted as { class:'C1', sev:'S2', claim, truth, kind }:
//   fabricated-pct      : an N% that matches no real dist bucket           (checkPercents)
//   distribution-mislabel: "N% [verb] <Team|draw>" where N is a REAL bucket
//                          for a DIFFERENT outcome than the one claimed
//   polarity-inverted   : the group/field framed RIGHT when its majority (or
//                          the specific %-bucket cited) actually backed a loser
//   false-uniqueness-*  : "only one missed"/"everyone was wrong" vs nailed/missed
//
// Precision guards (why we DON'T flag some plausible cases):
//   * games are matched ONLY by team names IN the sentence (no focus fallback);
//   * polarity is evaluated per clause-fragment with exactly one clear subject;
//   * the negative direction ("group framed WRONG") is deliberately NOT flagged
//     from bare "wrong/missed" because the roast routinely means "missed the
//     exact score" even when the crowd got the OUTCOME right (backing a winner
//     that didn't hit the predicted scoreline) — that would be a false positive;
//   * a POS claim negated by "no one/0%/didn't/…" is skipped;
//   * a %-number is only paired with a team when a linking verb sits between
//     them and the team is not introduced by "against/vs/over" (the opponent).
// ============================================================================
function checkPercents(s, errs, flags) {
  // fabricated-% : every N% must exist as a real bucket (or its complement) in some game
  if (!s.games || !s.games.length) return;
  const set = new Set();
  for (const g of s.games) for (const d of [g.dist_group, g.dist_global]) {
    if (!d) continue;
    for (const k of ['home_pct', 'draw_pct', 'away_pct']) if (d[k] != null) { set.add(+d[k]); set.add(100 - +d[k]); }
  }
  set.add(100); set.add(0);
  const seen = new Set();
  let m; const re = /(\d+)\s*%/g;
  while ((m = re.exec(s.content))) {
    const n = +m[1];
    if (seen.has(n)) continue; seen.add(n);
    if (!set.has(n)) errs.push({ class: 'C1', sev: 'S2', claim: `printed ${n}% not in any dist bucket`, truth: 'not a real group/global bucket value (fabricated)', kind: 'fabricated-pct' });
  }
}

const esc = s => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reW = s => new RegExp(`\\b${esc(s)}\\b`, 'i');
function outcomeOf(g) {
  const r = (g.result || '').toLowerCase();
  if (/away/.test(r)) return 'away';
  if (/home/.test(r)) return 'home';
  if (/draw/.test(r)) return 'draw';
  const m = r.match(/(\d+)\s*-\s*(\d+)/); if (m) { const h = +m[1], a = +m[2]; return h > a ? 'home' : a > h ? 'away' : 'draw'; }
  return null;
}
function majOf(d) {
  if (!d) return null;
  const e = [['home', d.home_pct], ['draw', d.draw_pct], ['away', d.away_pct]].filter(x => x[1] != null);
  if (!e.length) return null;
  e.sort((a, b) => b[1] - a[1]);
  if (e.length > 1 && e[0][1] === e[1][1]) return null; // tie -> no clear majority
  return e[0][0];
}
const pctBucket = (d, o) => (!d ? null : d[o + '_pct']);
// game named by a team IN this text (NO focus fallback → precision)
function gameInText(txt, games) {
  for (const g of games) if (g.home_team && g.away_team && reW(g.home_team).test(txt) && reW(g.away_team).test(txt)) return g;
  for (const g of games) if ((g.home_team && reW(g.home_team).test(txt)) || (g.away_team && reW(g.away_team).test(txt))) return g;
  return null;
}
const SUBJ_GLOBAL = /\b(other groups?|competitors?|competition|the field|the (?:whole )?world|globally|global (?:majority|average|crowd)|all (?:other )?(?:groups|competitors)|rest of the (?:competition|competitors|field|world))\b/i;
const SUBJ_GROUP = /\b(this group|the group|our group|your group|you guys|you all|all of (?:you|us)|the rest of us|rest of the group|of this group|of the group)\b|\b(?:%|percent) of (?:you|us)\b|\bof (?:you|us)\b|\bwe\b|\bus\b/i;
const POS_RE = /\b(nailed|got it right|got the (?:draw|win|result|score|call|outcome) right|saw it coming|see it coming|on point|spot on|knew better|read it right|better read|had the right idea|the right idea|had the sense|were right|was right|are right|right to call|right about|correctly|hit it)\b/i;
const NEG_RE = /\b(missed|got it wrong|were wrong|was wrong|wrong|floundered|flopped|fell flat|failed|fooled|did\s*n['’]?t see|couldn['’]?t see|misread|misguided|blindsided|clueless|bad guessers?|out of touch|left in the dust|struggled|off the mark)\b/i;
const NEGATION = /(not|no one|nobody|none|never|hardly|barely|couldn['’]?t|did\s*n['’]?t|failed to|0\s*%|zero)\s*$/i;
const VERB = /(thought|backed|had|pick(?:ed|ing)?|went with|expected|believ\w+|predicted|sure|for|to win|winning|would win|\bwin\b|call(?:ed|ing)?)/i;
const UNIQ_MISS = /\b(?:the )?only (?:one|member|player)(?: in (?:the|this) group)? (?:to|who) (?:miss|got it wrong|get it wrong)/i;
const UNIQ_ALL = /\b(everyone|everybody)(?: was| got it| else was)? wrong\b|\ball (?:of (?:us|you) )?(?:missed|got it wrong|were wrong)\b|\bnot a single (?:one|member|person) (?:got|nailed|had it)\b|\b(?:nobody|no one) (?:got it right|nailed it|nailed the|had it right|called it)\b|\bwhole group (?:missed|got it wrong)\b/i;

// polarity of a clause-fragment: 'pos' | 'neg' | null (null when mixed or negated)
function polarityOf(fr) {
  const pm = POS_RE.exec(fr), nm = NEG_RE.exec(fr);
  const pos = !!pm, neg = !!nm;
  if (pos === neg) return null;                 // need exactly one direction
  const idx = pos ? pm.index : nm.index;
  if (NEGATION.test(fr.slice(Math.max(0, idx - 22), idx))) return null; // "no one nailed" / "0% got it right"
  return pos ? 'pos' : 'neg';
}
// split a sentence into clauses so the group-claim and the field-claim are judged apart
function splitFrags(sent) {
  return sent.split(/\s*(?:\bwhile\b|\bbut\b|\bwhereas\b|\byet\b|\bhowever\b|\bmeanwhile\b|;|—|–|\s-\s)\s*/i).map(x => x.trim()).filter(Boolean);
}
// distribution-mislabel: "N% [of ..] VERB <Team|draw>" (or "<draw> at N%") where N is a
// real bucket of dist d but for a DIFFERENT outcome than the one the text attributes it to.
function crowdMislabel(fr, g, d, errs, tag) {
  if (!d) return false;
  const targets = [];
  if (g.home_team) targets.push([g.home_team, 'home']);
  if (g.away_team) targets.push([g.away_team, 'away']);
  targets.push(['draw', 'draw']);
  for (const pm of fr.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
    const n = +pm[1];
    const fwd = fr.slice(pm.index + pm[0].length, pm.index + pm[0].length + 42);
    const bwd = fr.slice(Math.max(0, pm.index - 34), pm.index);
    for (const [name, slot] of targets) {
      const tre = name === 'draw' ? /\bdraw\b/i : reW(name);
      let claimed = null;
      const fm = tre.exec(fwd);
      if (fm && VERB.test(fwd.slice(0, fm.index))) claimed = slot;
      if (claimed === null) {
        const rre = name === 'draw' ? /\bdraw\b\s+(?:at|for|by|with)\s*$/i : new RegExp(`\\b${esc(name)}\\b\\s+(?:at|for|by|with)\\s*$`, 'i');
        if (rre.test(bwd)) claimed = slot;
      }
      if (claimed === null) continue;
      // opponent guard: a team introduced by against/vs/over is the OTHER side, not the backed one
      if (slot !== 'draw' && fm) {
        const pre = fwd.slice(Math.max(0, fm.index - 9), fm.index);
        if (/\b(against|vs\.?|over|beat|versus)\s*$/i.test(pre)) continue;
      }
      const cb = pctBucket(d, claimed);
      const others = ['home', 'draw', 'away'].filter(o => o !== claimed);
      const matchesOther = others.some(o => d[o + '_pct'] != null && d[o + '_pct'] === n);
      if (cb != null && n !== cb && matchesOther) {
        errs.push({ class: 'C1', sev: 'S2', kind: 'distribution-mislabel',
          claim: `"${n}% → ${name}" (${tag}) in ${g.match}`,
          truth: `${n}% is the ${others.find(o => d[o + '_pct'] === n)} bucket; ${claimed}=${cb}%` });
        return true;
      }
    }
  }
  return false;
}
// false-uniqueness (after-era only — needs nailed_by / missed_by)
function crowdUniqueness(sent, g, errs) {
  if (Array.isArray(g.missed_by) && g.missed_by.length > 1 && UNIQ_MISS.test(sent))
    errs.push({ class: 'C1', sev: 'S2', kind: 'false-uniqueness-miss', claim: `"only one missed" (${g.match})`, truth: `${g.missed_by.length} missed: ${g.missed_by.join(',')}` });
  if (Array.isArray(g.nailed_by) && g.nailed_by.length > 0 && UNIQ_ALL.test(sent) && /(wrong|missed|got it|nailed|right)/i.test(sent))
    errs.push({ class: 'C1', sev: 'S2', kind: 'false-uniqueness-all', claim: `"everyone wrong / nobody nailed it" (${g.match})`, truth: `${g.nailed_by.length} nailed: ${g.nailed_by.join(',')}` });
}

function checkCrowd(s, errs) {
  if (!s.games || !s.games.length) return;
  const sents = s.content.split(/\n+|(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  for (const sent of sents) {
    const g = gameInText(sent, s.games);
    if (!g) continue;
    crowdUniqueness(sent, g, errs);
    const out = outcomeOf(g);
    if (!out) continue;
    const frags = splitFrags(sent);
    // irony/negation marker anywhere in the sentence flips a "saw it coming"-style POS into sarcasm
    // ("believed in the mythical victory") — skip polarity for the whole sentence (mislabel stays: it's factual)
    const irony = /\b(mythical|supposed|so-?called|fabled|imaginary|fictional|fantasy|would-be|delusion(?:al)?)\b/i.test(sent);
    let lastSubj = null;                        // carry subject across " - "/"," splits (mislabel only)
    for (const fr of frags) {
      const gl = SUBJ_GLOBAL.test(fr), gp = SUBJ_GROUP.test(fr);
      let mlSubj = (gl && !gp) ? 'global' : ((gp && !gl) ? 'group' : null);
      if (mlSubj) lastSubj = mlSubj; else if (!gl && !gp) mlSubj = lastSubj;   // inherit only when the fragment has NO subject at all
      const mlDist = mlSubj === 'global' ? g.dist_global : (mlSubj === 'group' ? g.dist_group : null);
      if (crowdMislabel(fr, g, mlDist, errs, mlSubj || '?')) continue;         // one C1 per fragment (mislabel supersedes polarity)
      if (irony) continue;                                                     // sarcastic "saw it coming" — not a real polarity claim
      if (gl === gp) continue;                                                 // polarity needs exactly one clear subject
      const subj = gl ? 'global' : 'group';
      const d = gl ? g.dist_global : g.dist_group;
      if (!d) continue;
      const pol = polarityOf(fr);
      if (!pol) continue;
      const win = pctBucket(d, out);            // % who backed the actual result in this dist
      const maj = majOf(d);
      const nums = [...fr.matchAll(/(\d+)\s*(?:%|percent)/gi)].map(x => +x[1]);
      const isBucket = n => [d.home_pct, d.draw_pct, d.away_pct].some(b => b != null && b === n);
      const exactTalk = /\b(exact|scoreline|the score|precise|nail(?:ed)? the \d)\b/i.test(fr);
      if (pol === 'pos') {
        // (1) percent-anchored: a specific non-winning bucket % is framed as "right"
        const bad = nums.find(n => isBucket(n) && win != null && n !== win);
        if (bad != null) {
          errs.push({ class: 'C1', sev: 'S2', kind: 'polarity-inverted',
            claim: `${subj} framed RIGHT citing ${bad}% (a non-winning bucket) in ${g.match}`,
            truth: `only ${win}% backed the result (${out})` });
          continue;
        }
        // (2) majority-anchored: no winner-% cited, but the subject's majority backed a loser
        if (!nums.some(n => n === win) && maj && maj !== out) {
          errs.push({ class: 'C1', sev: 'S2', kind: 'polarity-inverted',
            claim: `${subj} framed RIGHT in ${g.match}`,
            truth: `${subj} majority backed ${maj} ≠ result ${out}` });
        }
      } else if (pol === 'neg' && !exactTalk) {
        // (3) INVERSE polarity: subject framed as WRONG but its majority actually backed the WINNER.
        //     Guarded against exact-score talk ("missed the scoreline" ≠ wrong outcome).
        if (maj && maj === out) {
          errs.push({ class: 'C1', sev: 'S2', kind: 'inverse-polarity',
            claim: `${subj} framed WRONG in ${g.match}`,
            truth: `${subj} majority backed ${maj} = result ${out} (they were right)` });
        }
      }
    }
  }
}

// structural integrity (a check that CAN'T run must flag, not silently pass)
function checkStructure(s, errs) {
  const c = s.content || '';
  if (/(^|\n)\s*P[1-6]\s*(\r?\n|$)/.test(c))
    errs.push({ class: 'C2', sev: 'S1', claim: 'literal P1–P6 scaffold labels leaked into output', truth: 'no section labels', kind: 'scaffold-leak' });
  if (c.replace(/\s+/g, ' ').trim().length < 120)
    errs.push({ class: 'C2', sev: 'S2', claim: `summary too short (${c.length} chars)`, truth: 'expected a full multi-paragraph roast', kind: 'too-short' });
}

// ---------- scoring & gate ----------
const PEN = { S3: 25, S2: 10, S1: 3 };
function scoreOf(errs) {
  const s = 100 - errs.reduce((a, e) => a + PEN[e.sev], 0);
  return Math.max(0, s);
}
const gradeOf = s => s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F';
// HARD kinds = high-precision, deterministic → these decide the gate. SOFT kinds (crowd polarity/
// mislabel/inverse/uniqueness/group-pct) are advisory (can false-positive) → reported, never gate.
const HARD_KINDS = new Set([
  'champion-wrong-team', 'champion-wrong-outcome', 'scorer-play-vs-score',
  'recap-score', 'recap-pts', 'recap-missing', 'wrong-game-recap', 'recap-phantom',
  'gap', 'behind', 'ahead', 'tie', 'fabricated-pct', 'scaffold-leak', 'too-short',
]);
const tierOf = e => HARD_KINDS.has(e.kind) ? 'hard' : 'soft';
// gate FAILS on any hard S3 or hard S2 (real, high-confidence factual defect). S1 + soft = pass-with-notes.
const gateOf = errs => errs.some(e => tierOf(e) === 'hard' && (e.sev === 'S3' || e.sev === 'S2')) ? 'FAIL' : 'PASS';

// ---------- main ----------
function ensureTeams(games) {
  for (const g of games || []) {
    if ((!g.home_team || !g.away_team) && g.match) {
      const m = g.match.match(/^(.*?)\s+\d+\s*-\s*\d+\s+(.*)$/);
      if (m) { g.home_team = g.home_team || m[1].trim(); g.away_team = g.away_team || m[2].trim(); }
    }
  }
}
function evalOne(s) {
  ensureTeams(s.games);
  const errs = [], flags = [];
  checkStructure(s, errs);
  checkRecap(s, errs);
  checkChampion(s, errs, flags);
  checkScorer(s, errs);
  checkChampionAlive(s, errs);
  checkGaps(s, errs, flags);
  checkPercents(s, errs, flags);
  checkCrowd(s, errs);
  for (const e of errs) e.tier = tierOf(e);
  const counts = { S3: 0, S2: 0, S1: 0 };
  for (const e of errs) counts[e.sev]++;
  const byClass = { C1: 0, C2: 0, C3: 0, C4: 0 };
  for (const e of errs) byClass[e.class] = (byClass[e.class] || 0) + 1;
  const gate = gateOf(errs);
  const hard = errs.filter(e => e.tier === 'hard');
  const score = scoreOf(errs);
  return {
    group: s.group, date: s.date, version_tag: s.version_tag, era: s.era,
    gate, hard_errors: hard.length,               // gate = FAIL when a hard factual defect exists (escalate to gpt-5-mini)
    score, grade: gradeOf(score), clean: errs.length === 0,
    counts, byClass, errors: errs, needs_judge: flags,
  };
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`No snapshot at ${IN}. Run:  node scripts/eval/fetch.cjs   (needs SUPABASE_SERVICE_ROLE_KEY)`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const rows = data.map(evalOne);

  const seg = (name, f) => {
    const g = rows.filter(f);
    if (!g.length) return null;
    const S3 = g.reduce((a, r) => a + r.counts.S3, 0), S2 = g.reduce((a, r) => a + r.counts.S2, 0), S1 = g.reduce((a, r) => a + r.counts.S1, 0);
    return { name, n: g.length, mean: +(g.reduce((a, r) => a + r.score, 0) / g.length).toFixed(1), S3, S2, S1, clean: g.filter(r => r.clean).length };
  };
  const before = seg('BEFORE (<=06-30)', r => r.date <= '2026-06-30');
  const after = seg('AFTER  (>=07-01)', r => r.date >= '2026-07-01');

  fs.writeFileSync(OUT_JSON, JSON.stringify({ generated: null, rows, before, after }, null, 2));

  // markdown
  let md = `# Local Eval Report (deterministic facts only)\n\n`;
  md += `Snapshot: ${rows.length} summaries. Score = 100 − 25·S3 − 10·S2 − 3·S1.\n\n`;
  md += `| Segment | n | mean | S3 | S2 | S1 | clean |\n|---|---|---|---|---|---|---|\n`;
  for (const x of [before, after]) if (x) md += `| ${x.name} | ${x.n} | ${x.mean} | ${x.S3} | ${x.S2} | ${x.S1} | ${x.clean} |\n`;
  md += `\n## Per-summary\n\n| group | date | score | grade | S3/S2/S1 | hard errors |\n|---|---|---|---|---|---|\n`;
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group))) {
    const es = r.errors.map(e => `${e.class}·${e.sev} ${e.kind}`).join('; ') || '—';
    md += `| ${r.group} | ${r.date} | ${r.score} | ${r.grade} | ${r.counts.S3}/${r.counts.S2}/${r.counts.S1} | ${es} |\n`;
  }
  fs.writeFileSync(OUT_MD, md);

  const gateFail = rows.filter(r => r.gate === 'FAIL');
  console.log(`Evaluated ${rows.length} summaries. GATE: ${rows.length - gateFail.length} pass / ${gateFail.length} fail (escalate).`);
  if (before) console.log(`BEFORE n=${before.n} mean=${before.mean} S3=${before.S3} S2=${before.S2} clean=${before.clean}`);
  if (after) console.log(`AFTER  n=${after.n} mean=${after.mean} S3=${after.S3} S2=${after.S2} clean=${after.clean}`);
  if (gateFail.length) console.log('  FAIL:', gateFail.map(r => `${r.group} ${r.date}`).join(' | '));
  console.log(`Reports: ${path.relative(process.cwd(), OUT_JSON)} , ${path.relative(process.cwd(), OUT_MD)}`);
}

module.exports = { evalOne, gateOf, tierOf, HARD_KINDS };
if (require.main === module) main();

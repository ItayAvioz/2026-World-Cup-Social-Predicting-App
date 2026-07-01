// Post-processor prototype: inject p4.locked as the crowd paragraph, scrub stray crowd asides elsewhere.
// Pure code, no LLM. Operates on the v8 winner text (which was generated with p4 in the payload).

// A sentence is a "crowd claim" if it talks about group/field/competitors predicting + implies right/wrong.
const CROWD_SUBJECT = /\b(the group|this group|your group|our group|the field|the whole field|the rest of (the )?(field|competition|competitors|groups|us)|the rest of us|other groups|competitors|the competition|everyone else|the crowd|you all|all of you|the majority)\b/i;
const PCT = /\d+\s*%|\d+\s*percent/i;
const SCORE = /\b\d+\s*-\s*\d+\b/;
const VERDICT = /\b(wrong|missed|miss it|flopped|floundered|clueless|no clue|nailed|nailed it|right|correct|delivered|saw it|saw .* coming|got it|fooled|delusion|lost in|couldn'?t|could not|get close|prophets?|thought|leaned|way to go|called it|same idea|in sync|showed them|struggled|head-scratcher)\b/i;
function isCrowdClaim(s) { return CROWD_SUBJECT.test(s) && (PCT.test(s) || SCORE.test(s) || VERDICT.test(s)); }

// A gap claim = a number-of-points in a standings/gap context (behind, off the lead, separates, tail, etc.)
const GAP_CTX = /\b(behind|off the lead|separat\w+|[- ]point gap|between (you|them)|on (your|his|her|their) (tail|heels)|breathing down|ahead of|points? back|points? clear|points? adrift|trail\w*|lead\w* by|margin)\b/i;
const NUM_POINTS = /\b\d+\s*[- ]?points?\b|\b\d+[- ]point\b/i;
function isGapClaim(s) { return GAP_CTX.test(s) && NUM_POINTS.test(s); }

function splitSentences(text) {
  // keep the scoreline line + "Tomorrow's danger" intact; split prose on sentence boundaries
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
}

const DROP = Symbol('drop');
function classify(para) {
  const isScoreLine = /:\s*[A-Za-z].*\(\d+pt/.test(para) || /^[A-Za-z].*\d-\d.*\(\d+pt/.test(para);
  const isDanger = /^Tomorrow'?s danger/i.test(para.trim());
  if (isScoreLine) return { kind: 'score' };
  if (isDanger) return { kind: 'keep' };
  const sentences = splitSentences(para);
  const crowd = sentences.filter(isCrowdClaim);
  if (!crowd.length) return { kind: 'clean' };
  const heavy = crowd.join(' ').length > para.length * 0.5;
  return { kind: heavy ? 'crowd' : 'mixed', sentences };
}

// Lock all fact-heavy lines: crowd (P4) + scoreline recap + standings/gaps.
// Prose keeps only humor; every hard fact comes from an injected code-built line.
function injectAndScrub(text, p4, standings) {
  const paras = text.split(/\n\s*\n/);
  const info = paras.map(classify);
  let slot = -1;
  for (let i = 0; i < info.length; i++) if (info[i].kind === 'crowd') slot = i;

  const out = paras.map((para, i) => {
    const c = info[i];
    if (c.kind === 'score') {
      if (p4 && p4.recap && p4.focus_game && para.includes(p4.focus_game)) return p4.recap;
      return para;
    }
    if (c.kind === 'keep') return para;                     // Tomorrow's danger
    if (c.kind === 'crowd' && i === slot && p4 && p4.locked) return p4.locked;
    // every other prose paragraph: strip crowd + gap claims, keep the humor
    const sentences = c.sentences || splitSentences(para);
    const kept = sentences.filter(s => !isCrowdClaim(s) && !isGapClaim(s)).join(' ').trim();
    return kept.length >= 20 ? kept : DROP;
  }).filter(x => x !== DROP);

  // insert standings line (gap facts) and, if no crowd slot existed, the locked crowd line — before the scoreline block
  const insertBeforeScore = (line) => {
    if (!line) return;
    const idx = out.findIndex(pr => /:\s*[A-Za-z].*\(\d+pt/.test(pr));
    if (idx >= 0) out.splice(idx, 0, line); else out.push(line);
  };
  if (slot === -1 && p4 && p4.locked) insertBeforeScore(p4.locked);
  insertBeforeScore(standings);
  return out.join('\n\n');
}

module.exports = { injectAndScrub };

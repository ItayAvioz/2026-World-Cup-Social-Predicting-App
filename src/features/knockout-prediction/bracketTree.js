// Shared Road-to-Final bracket structure (official FIFA 2026).
// Single source of truth for both the display bracket (Picks.jsx) and the
// knockout prediction feature. Pure data — no React.
//
// Node ids: L1–L8 / R1–R8 = the 16 Round-of-32 slots (left / right halves,
// top→bottom exactly as the official bracket). LA–LD/RA–RD = R16, LQ1/LQ2/
// RQ1/RQ2 = QF, LS/RS = SF, F = Final, B = 3rd-place (bronze).

export const PHASE_LABEL = {
  group: 'Group Stage',
  r32:   'Round of 32',
  r16:   'Round of 16',
  qf:    'Quarter-Finals',
  sf:    'Semi-Finals',
  third: '3rd Place',
  final: 'Final',
}

// Column layout for rendering — left flows inward, right is mirrored.
export const LEFT_COLS = [
  { phase: 'r32', nodes: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'] },
  { phase: 'r16', nodes: ['LA', 'LB', 'LC', 'LD'] },
  { phase: 'qf',  nodes: ['LQ1', 'LQ2'] },
  { phase: 'sf',  nodes: ['LS'] },
]
export const RIGHT_COLS = [
  { phase: 'sf',  nodes: ['RS'] },
  { phase: 'qf',  nodes: ['RQ1', 'RQ2'] },
  { phase: 'r16', nodes: ['RA', 'RB', 'RC', 'RD'] },
  { phase: 'r32', nodes: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'] },
]

// Which child nodes feed each non-R32 node (winners advance; B = the two SF losers).
export const BRACKET_CHILDREN = {
  LA: ['L1', 'L2'], LB: ['L3', 'L4'], LC: ['L5', 'L6'], LD: ['L7', 'L8'],
  RA: ['R1', 'R2'], RB: ['R3', 'R4'], RC: ['R5', 'R6'], RD: ['R7', 'R8'],
  LQ1: ['LA', 'LB'], LQ2: ['LC', 'LD'], RQ1: ['RA', 'RB'], RQ2: ['RC', 'RD'],
  LS: ['LQ1', 'LQ2'], RS: ['RQ1', 'RQ2'],
  F: ['LS', 'RS'], B: ['LS', 'RS'],
}

// Non-R32 nodes per phase, ordered so each round is placed after its children.
export const NODES_BY_PHASE = {
  r16: ['LA', 'LB', 'LC', 'LD', 'RA', 'RB', 'RC', 'RD'],
  qf:  ['LQ1', 'LQ2', 'RQ1', 'RQ2'],
  sf:  ['LS', 'RS'],
  final: ['F'],
}

// Prediction tap nodes per round (what the user picks the winner of).
// QF prediction = winners chosen at R16 nodes; SF = at QF nodes; Final = at SF nodes.
export const PICK_NODES = {
  r16: NODES_BY_PHASE.r16,  // 8 → produces the predicted QF teams
  qf:  NODES_BY_PHASE.qf,   // 4 → produces the predicted SF teams
  sf:  NODES_BY_PHASE.sf,   // 2 → produces the predicted finalists (+ losers = 3rd/4th)
}

// The round a pick at a node contributes to (the team picked there REACHES this round).
export const NODE_PICK_ROUND = { r16: 'qf', qf: 'sf', sf: 'final' }

// ⚠️ FILL ON LAUNCH DAY: map each R32 game's api_fixture_id → bracket slot.
export const R32_SLOTS = {
  1561329: 'L3',  // South Africa (2A) v Canada (2B)
  1562344: 'R1',  // Brazil (1C) v Japan (2F)
  1562345: 'L4',  // Netherlands (1F) v Morocco (2C)
  1562586: 'L7',  // United States (1D) v Bosnia-Herzegovina (3rd B)
  1565176: 'L1',  // Germany (1E) v Paraguay (3rd D)
  1565177: 'L2',  // France (1I) v Sweden (3rd F)
  1564789: 'R2',  // Ivory Coast (2E) v Norway (2I)
  1565179: 'R5',  // Argentina (1J) v Cape Verde (2H)
  1565178: 'R6',  // Australia (2D) v Egypt (2G)
  1567306: 'R3',  // Mexico (1A) v Ecuador (3rd E)
  1567307: 'R4',  // England (1L) v DR Congo (3rd K)
  1567308: 'L8',  // Belgium (1G) v Senegal (3rd I)
  1567311: 'L6',  // Spain (1H) v Austria (2J)
  1567309: 'L5',  // Portugal (2K) v Croatia (2L)
  1567312: 'R7',  // Switzerland (1B) v Algeria (3rd J)
  1567310: 'R8',  // Colombia (1K) v Ghana (3rd L)
}

export const TEAM_SHORT = {
  'Bosnia-Herzegovina': 'Bosnia',
  'Czech Republic':     'Czechia',
  'United States':      'USA',
  'Saudi Arabia':       'Saudi',
  'South Africa':       'S. Africa',
  'Ivory Coast':        'Ivory C.',
  'New Zealand':        'N. Zealand',
}

// Place each knockout game onto its fixed bracket node (shared by display + predict).
// R32 → R32_SLOTS by api_fixture_id; R16+ → winner-chaining via knockout_winner.
export function placeGamesOnNodes(games) {
  const byNode = {}
  for (const g of games) {
    if (g.phase !== 'r32') continue
    const node = R32_SLOTS[g.api_fixture_id]
    if (node) byNode[node] = g
  }
  const winnerOf = n => byNode[n]?.knockout_winner ?? null
  for (const phase of ['r16', 'qf', 'sf', 'final']) {
    const gs = games.filter(g => g.phase === phase)
    for (const node of NODES_BY_PHASE[phase]) {
      const winners = BRACKET_CHILDREN[node].map(winnerOf)
      const g = gs.find(x => winners.includes(x.team_home) || winners.includes(x.team_away))
      if (g) byNode[node] = g
    }
  }
  const bronze = games.find(g => g.phase === 'third' && g.team_home !== 'TBD' && g.team_away !== 'TBD')
  if (bronze) byNode.B = bronze
  return byNode
}

// The two candidate teams for a prediction node, given current actual results
// (byNode from placeGamesOnNodes) and the user's upstream picks.
//  - R16 node  → the two ACTUAL R32 winners feeding it (need R32 decided)
//  - QF/SF node → the user's picks at its two child nodes
export function nodeCandidates(node, byNode, picks) {
  const kids = BRACKET_CHILDREN[node]
  if (!kids) return [null, null]
  if (NODES_BY_PHASE.r16.includes(node)) {
    return kids.map(k => byNode[k]?.knockout_winner ?? null)  // actual R32 winners
  }
  return kids.map(k => picks[k] ?? null)  // user's upstream picks
}

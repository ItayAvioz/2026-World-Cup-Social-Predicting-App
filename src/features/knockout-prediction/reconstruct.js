// Convert between the per-node tap state and the per-round arrays stored in the DB.
import { PICK_NODES, NODE_PICK_ROUND, BRACKET_CHILDREN, nodeCandidates } from './bracketTree.js'

// child node id → its parent node id (toward the final). For cascade-clear.
export const PARENT_OF = (() => {
  const m = {}
  for (const [parent, kids] of Object.entries(BRACKET_CHILDREN)) {
    if (parent === 'B') continue // bronze shares SF children but isn't a pick parent
    for (const k of kids) m[k] = parent
  }
  return m
})()

// picks (node→team) → { qf:[], sf:[], final:[], third:[] }
export function picksToRounds(picks) {
  const qf    = PICK_NODES.r16.map(n => picks[n]).filter(Boolean)
  const sf    = PICK_NODES.qf.map(n => picks[n]).filter(Boolean)
  const final = PICK_NODES.sf.map(n => picks[n]).filter(Boolean)
  // 3rd/4th = SF losers: for each SF node, its two candidate finalists minus the picked one.
  const third = []
  for (const sfNode of PICK_NODES.sf) {
    const winner = picks[sfNode]
    if (!winner) continue
    for (const qfNode of BRACKET_CHILDREN[sfNode]) {
      const cand = picks[qfNode]
      if (cand && cand !== winner) third.push(cand)
    }
  }
  return { qf, sf, final, third }
}

// Saved round arrays + actual results (byNode) → per-node tap state.
// Rebuilds R16 picks from the qf array (match each to its R16 node by candidates),
// then QF picks from sf, then SF picks from final — each using upstream picks.
export function roundsToPicks(rounds, byNode) {
  const picks = {}
  const qfSet    = new Set(rounds.qf ?? [])
  const sfSet    = new Set(rounds.sf ?? [])
  const finalSet = new Set(rounds.final ?? [])
  // R16 nodes: candidates are the actual R32 winners
  for (const node of PICK_NODES.r16) {
    const [c1, c2] = nodeCandidates(node, byNode, picks)
    picks[node] = (c1 && qfSet.has(c1)) ? c1 : (c2 && qfSet.has(c2)) ? c2 : null
  }
  for (const node of PICK_NODES.qf) {
    const [c1, c2] = nodeCandidates(node, byNode, picks)
    picks[node] = (c1 && sfSet.has(c1)) ? c1 : (c2 && sfSet.has(c2)) ? c2 : null
  }
  for (const node of PICK_NODES.sf) {
    const [c1, c2] = nodeCandidates(node, byNode, picks)
    picks[node] = (c1 && finalSet.has(c1)) ? c1 : (c2 && finalSet.has(c2)) ? c2 : null
  }
  return picks
}

// Set a node's winner and clear any now-invalid downstream (parent-direction) picks.
export function setPickCascade(picks, node, team) {
  const next = { ...picks }
  const old = next[node]
  next[node] = team
  if (old && old !== team) {
    let child = node
    let parent = PARENT_OF[child]
    while (parent && next[parent] === old) {
      next[parent] = null
      child = parent
      parent = PARENT_OF[child]
    }
  }
  return next
}

export { NODE_PICK_ROUND }

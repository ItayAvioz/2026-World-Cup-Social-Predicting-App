import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase.js'
import { placeGamesOnNodes } from './bracketTree.js'
import { roundsToPicks, picksToRounds } from './reconstruct.js'
import { computeKnockoutScore } from './scoring.js'
import ReadonlyBracket from './ReadonlyBracket.jsx'

// Group-scoped bracket viewer. Reveals every group member's knockout bracket —
// BUT only if the current user filled their own (enforced server-side by the
// get_group_knockout_brackets RPC, which raises must_fill_bracket otherwise).
// Non-fillers are excluded from the returned rows too.
export default function GroupBrackets({ groupId, games, userId, teamCodeMap }) {
  const [rows, setRows]     = useState(null)   // flat [{user_id,username,round,team}]
  const [state, setState]   = useState('loading') // loading | ready | must_fill | error
  const [selected, setSelected] = useState(null)   // user_id of the open bracket

  const byNode = useMemo(() => placeGamesOnNodes(games || []), [games])

  useEffect(() => {
    let cancelled = false
    if (!groupId) { setState('error'); return }
    setState('loading')
    ;(async () => {
      const { data, error } = await supabase.rpc('get_group_knockout_brackets', { p_group_id: groupId })
      if (cancelled) return
      if (error) {
        setState(error.message?.includes('must_fill_bracket') ? 'must_fill' : 'error')
        return
      }
      setRows(data ?? [])
      setState('ready')
    })()
    return () => { cancelled = true }
  }, [groupId])

  // Group flat rows → one entry per member: { user_id, username, picks, score }.
  const members = useMemo(() => {
    if (!rows) return []
    const byUser = new Map()
    for (const r of rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user_id: r.user_id, username: r.username, rounds: {} })
      const m = byUser.get(r.user_id)
      ;(m.rounds[r.round] ||= []).push(r.team)
    }
    const out = []
    for (const m of byUser.values()) {
      const picks = roundsToPicks(m.rounds, byNode)
      const score = computeKnockoutScore(picksToRounds(picks), games || [])
      out.push({ user_id: m.user_id, username: m.username, picks, pts: score.total })
    }
    // Highest points first; current user always visible (they must have filled to get here).
    out.sort((a, b) => b.pts - a.pts || a.username.localeCompare(b.username))
    return out
  }, [rows, byNode, games])

  // Default-open: the current user's own bracket, else the top-scoring member.
  useEffect(() => {
    if (state !== 'ready' || members.length === 0) return
    setSelected(prev => (prev && members.some(m => m.user_id === prev)) ? prev
      : (members.find(m => m.user_id === userId)?.user_id ?? members[0].user_id))
  }, [state, members, userId])

  if (state === 'loading') return <p className="rtf-empty">Loading…</p>
  if (state === 'must_fill') return (
    <div className="rtf-gb-locked">
      <div className="rtf-gb-locked-icon" aria-hidden="true">🔒</div>
      <p className="rtf-gb-locked-title">Fill your own bracket first</p>
      <p className="rtf-gb-locked-sub">Once you've made your knockout bracket, you'll be able to see everyone else's in this group.</p>
    </div>
  )
  if (state === 'error') return <p className="rtf-empty">Couldn't load group brackets. Try again.</p>
  if (members.length === 0) return <p className="rtf-empty">No one in this group has filled a bracket yet.</p>

  const open = members.find(m => m.user_id === selected) ?? members[0]

  return (
    <div className="rtf-gb">
      <div className="rtf-gb-members" role="tablist" aria-label="Group members">
        {members.map(m => (
          <button
            key={m.user_id}
            role="tab"
            aria-selected={m.user_id === open.user_id}
            className={`rtf-gb-chip${m.user_id === open.user_id ? ' rtf-gb-chip--active' : ''}${m.user_id === userId ? ' rtf-gb-chip--me' : ''}`}
            onClick={() => setSelected(m.user_id)}
          >
            <span className="rtf-gb-chip-name">{m.username}{m.user_id === userId ? ' (you)' : ''}</span>
            <span className="rtf-gb-chip-pts">{m.pts}</span>
          </button>
        ))}
      </div>
      <ReadonlyBracket picks={open.picks} games={games} teamCodeMap={teamCodeMap} />
    </div>
  )
}

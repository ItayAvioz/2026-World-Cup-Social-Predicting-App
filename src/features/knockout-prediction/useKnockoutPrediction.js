import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { placeGamesOnNodes } from './bracketTree.js'
import { picksToRounds, roundsToPicks, setPickCascade } from './reconstruct.js'
import { computeKnockoutScore } from './scoring.js'
import { isPredictLocked } from './constants.js'

// Owns the user's knockout prediction tap-state, persistence, and live score.
// `games` = the same games list Picks already loads (for actual results + R16 matchups).
export function useKnockoutPrediction(userId, games) {
  const [picks, setPicks]   = useState({})   // node → predicted winning team
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)

  const byNode = useMemo(() => placeGamesOnNodes(games || []), [games])
  const locked = isPredictLocked()

  // Load own saved picks once games + user are ready
  useEffect(() => {
    let cancelled = false
    if (!userId || !games || games.length === 0) return
    ;(async () => {
      const { data } = await supabase
        .from('knockout_pick')
        .select('round, team')
        .eq('user_id', userId)
      if (cancelled) return
      const rounds = { qf: [], sf: [], final: [], third: [] }
      ;(data ?? []).forEach(r => { if (rounds[r.round]) rounds[r.round].push(r.team) })
      setPicks(roundsToPicks(rounds, byNode))
      setLoaded(true)
      setDirty(false)
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, games])

  const setPick = useCallback((node, team) => {
    if (locked) return
    setPicks(p => setPickCascade(p, node, team))
    setDirty(true)
  }, [locked])

  const save = useCallback(async () => {
    if (locked) return { error: { message: 'predictions_locked' } }
    setSaving(true)
    const r = picksToRounds(picks)
    const { error } = await supabase.rpc('save_knockout_picks', {
      p_qf: r.qf, p_sf: r.sf, p_final: r.final, p_third: r.third,
    })
    setSaving(false)
    if (!error) setDirty(false)
    return { error }
  }, [picks, locked])

  // Live score = current prediction vs actual results
  const score = useMemo(
    () => computeKnockoutScore(picksToRounds(picks), games || []),
    [picks, games]
  )

  // Progress: how many of the 14 pick-nodes are filled
  const filled = useMemo(
    () => ['LA','LB','LC','LD','RA','RB','RC','RD','LQ1','LQ2','RQ1','RQ2','LS','RS']
      .filter(n => picks[n]).length,
    [picks]
  )

  return { picks, byNode, setPick, save, saving, dirty, locked, loaded, score, filled }
}

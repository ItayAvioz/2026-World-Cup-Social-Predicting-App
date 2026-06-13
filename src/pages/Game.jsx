import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useDataCache } from '../context/DataCacheContext.jsx'
import { logEvent } from '../lib/analytics.ts'
import { TEAMS } from '../lib/teams.js'
import { getVenue } from '../lib/venues.js'
import Layout from '../components/Layout.jsx'

const TEAM_CODE = Object.fromEntries(TEAMS.filter(t => t.code).map(t => [t.name, t.code]))
const flagUrl = (name) => {
  const code = TEAM_CODE[name]
  return code ? `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${code}.svg` : null
}

function FlagImg({ name, src, className }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <div className="gm-flag-ph" />
  return <img src={src} alt={`${name} flag`} className={className} onError={() => setBroken(true)} />
}

const PHASE_LABEL = {
  group: 'Group Stage',
  r32:   'Round of 32',
  r16:   'Round of 16',
  qf:    'Quarter-Final',
  sf:    'Semi-Final',
  third: 'Third Place',
  final: 'Final',
}

function fmtKickoff(iso) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone:'Asia/Jerusalem' })
  const time = d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Jerusalem' })
  return `${date} · ${time} IDT`
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Jerusalem' }) + ' IDT'
}


// compact per-member outcome badge for finished games (admin group-predictions list)
function memberBadge(pe) {
  if (pe === 3) return { text: '⭐ Exact',   color: '#4ade80' }
  if (pe === 1) return { text: '✓ Correct', color: '#fbbf24' }
  return { text: '✗ Miss', color: 'var(--muted)' }
}

function pointsLabel(pred, game) {
  if (!pred || game.score_home === null) return null
  if (pred.points_earned === 3) return { text: '⭐ Exact score — 3 pts', cls: 'gm-my-result--exact' }
  if (pred.points_earned === 1) return { text: '✓ Correct outcome — 1 pt', cls: 'gm-my-result--correct' }
  return { text: '✗ Missed', cls: 'gm-my-result--miss' }
}

export default function Game() {
  const { id: gameId } = useParams()
  const [searchParams] = useSearchParams()
  const urlGroupId = searchParams.get('group')
  const { user } = useAuth()
  const { showToast } = useToast()
  const cache = useDataCache()
  const isAdmin = user?.email === 'itayavioz1@gmail.com'  // test-gated features (only visible to this user)
  useEffect(() => { if (user?.id) logEvent(supabase, user.id, 'page_view', 'game') }, [])

  const [game,            setGame]            = useState(null)
  const [myPred,          setMyPred]          = useState(undefined)  // undefined=loading, null=no pick
  const [teamStats,       setTeamStats]       = useState([])
  const [playerStats,     setPlayerStats]     = useState([])
  const [gameEvents,      setGameEvents]      = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [groupInputs,      setGroupInputs]      = useState({}) // { [groupId|'ungrouped']: { home, away } }
  const [submittingGroups, setSubmittingGroups] = useState({})
  // resolvedGroupId: undefined=still resolving, string=group UUID, null=ungrouped user (valid)
  const [resolvedGroupId, setResolvedGroupId] = useState(undefined)
  const [allGroups,       setAllGroups]       = useState([])   // [{ id, name }]
  const [allGroupPreds,   setAllGroupPreds]   = useState([])   // [{ groupId, groupName, pred }]
  const [teamForm,        setTeamForm]        = useState({})   // { teamName: ['W','L','D',...] }
  // [admin test] revealed predictions of all members in the active group (after KO). null=N/A
  const [memberPreds,        setMemberPreds]        = useState(null)
  const [memberPredsLoading, setMemberPredsLoading] = useState(false)

  // Resolve which group this prediction belongs to.
  // Priority: (1) ?group= URL param  (2) user's first joined group  (3) null = ungrouped.
  // DB supports group_id=NULL on predictions (M36) with UNIQUE NULLS NOT DISTINCT.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function resolve() {
      const { data: memberships } = await supabase
        .from('group_members')
        .select('group_id, groups(id, name)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: true })
      if (cancelled) return
      const groups = (memberships ?? []).map(m => ({ id: m.group_id, name: m.groups?.name ?? m.group_id }))
      setAllGroups(groups)
      if (urlGroupId) {
        setResolvedGroupId(urlGroupId)
      } else {
        setResolvedGroupId(groups[0]?.id ?? null)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [user, urlGroupId])

  useEffect(() => {
    if (!gameId || !user || resolvedGroupId === undefined) return
    loadGame()
  }, [gameId, user, resolvedGroupId])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setGroupInputs(prev => ({
      ...prev,
      ungrouped: myPred ? { home: String(myPred.pred_home), away: String(myPred.pred_away) } : (prev.ungrouped ?? { home:'', away:'' })
    }))
  }, [myPred])

  useEffect(() => {
    if (allGroupPreds.length === 0) return
    setGroupInputs(prev => {
      const next = { ...prev }
      for (const { groupId, pred } of allGroupPreds) {
        if (!(groupId in next)) next[groupId] = pred ? { home: String(pred.pred_home), away: String(pred.pred_away) } : { home:'', away:'' }
      }
      return next
    })
  }, [allGroupPreds])

  async function loadGame() {
    setLoading(true)
    setError(null)

    // Build prediction query — group_id may be a UUID or NULL (ungrouped users)
    const predQuery = supabase.from('predictions')
      .select('pred_home, pred_away, is_auto, updated_at, points_earned')
      .eq('game_id', gameId)
      .eq('user_id', user.id)
    const myPredQuery = resolvedGroupId === null
      ? predQuery.is('group_id', null).maybeSingle()
      : predQuery.eq('group_id', resolvedGroupId).maybeSingle()

    const [gameRes, myPredRes] = await Promise.all([
      supabase.from('games')
        .select('*, game_odds(*), game_team_stats(*)')
        .eq('id', gameId)
        .single(),
      myPredQuery,
    ])

    if (gameRes.error) {
      setError('Failed to load game.')
      setLoading(false)
      return
    }

    const g = gameRes.data
    setGame(g)
    setMyPred(myPredRes.data ?? null)
    setLoading(false)

    // Load predictions for all groups
    if (allGroups.length > 0) {
      const { data: allPreds } = await supabase
        .from('predictions')
        .select('group_id, pred_home, pred_away, is_auto, points_earned')
        .eq('game_id', gameId)
        .eq('user_id', user.id)
        .in('group_id', allGroups.map(g => g.id))
      const mapped = allGroups.map(grp => ({
        groupId:   grp.id,
        groupName: grp.name,
        pred:      (allPreds ?? []).find(p => p.group_id === grp.id) ?? null,
      }))
      setAllGroupPreds(mapped)
    }

    // [admin test] Group members' revealed predictions for the active group.
    // RLS reveals other members' picks once kick_off_time <= now (incl. finished games).
    // Per-game fetch only (≤ group size rows) — never hits the 1000-row PostgREST cap.
    const isPastKO = new Date() >= new Date(g.kick_off_time)
    if (isAdmin && isPastKO && resolvedGroupId) {
      setMemberPredsLoading(true)
      const { data: mPreds } = await supabase
        .from('predictions')
        .select('user_id, pred_home, pred_away, is_auto, points_earned, profiles(username)')
        .eq('game_id', gameId)
        .eq('group_id', resolvedGroupId)
      setMemberPreds(mPreds ?? [])
      setMemberPredsLoading(false)
    } else {
      setMemberPreds(null)
    }

    // Load team form (individual results in order)
    const { data: formGames } = await supabase
      .from('games')
      .select('team_home, team_away, score_home, score_away, kick_off_time, knockout_winner, went_to_extra_time, went_to_penalties, phase')
      .or(`team_home.in.(${[g.team_home, g.team_away].map(t => `"${t}"`).join(',')}),team_away.in.(${[g.team_home, g.team_away].map(t => `"${t}"`).join(',')})`)
      .not('score_home', 'is', null)
      .order('kick_off_time', { ascending: true })

    if (formGames) {
      const form = {}
      for (const team of [g.team_home, g.team_away]) {
        form[team] = formGames
          .filter(fg => fg.team_home === team || fg.team_away === team)
          .map(fg => {
            const isHome = fg.team_home === team
            const scored   = isHome ? fg.score_home : fg.score_away
            const conceded = isHome ? fg.score_away : fg.score_home
            if (scored > conceded) return 'W'
            if (scored < conceded) return 'L'
            if (fg.knockout_winner) {
              const won = fg.knockout_winner === team
              const suffix = fg.went_to_penalties ? '·P' : '·ET'
              return (won ? 'W' : 'L') + suffix
            }
            return 'D'
          })
      }
      setTeamForm(form)
    }

    // Load team tournament stats + player stats (finished games only)
    const promises = [
      supabase.from('team_tournament_stats').select('*').in('team', [g.team_home, g.team_away]),
    ]
    if (g.score_home !== null) {
      promises.push(supabase.from('game_player_stats').select('*').eq('game_id', gameId))
      promises.push(supabase.from('game_events').select('*').eq('game_id', gameId).order('minute').order('minute_extra', { nullsFirst: true }))
    }
    const [{ data: stats }, pRes, evRes] = await Promise.all(promises)
    if (stats) setTeamStats(stats)
    if (pRes?.data) setPlayerStats(pRes.data)
    if (evRes?.data) setGameEvents(evRes.data)

  }

  async function submitGroupPred(e, groupId) {
    e.preventDefault()
    const key = groupId ?? 'ungrouped'
    const input = groupInputs[key] ?? {}
    const h = parseInt(input.home, 10)
    const a = parseInt(input.away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      showToast('Enter a valid score (0 or more for each team)', 'error')
      return
    }
    setSubmittingGroups(s => ({ ...s, [key]: true }))
    const { data, error: err } = await supabase
      .from('predictions')
      .upsert(
        { user_id: user.id, game_id: gameId, group_id: groupId, pred_home: h, pred_away: a },
        { onConflict: 'user_id,game_id,group_id' }
      )
      .select('pred_home, pred_away, is_auto, updated_at, points_earned, group_id')
      .single()
    setSubmittingGroups(s => ({ ...s, [key]: false }))
    if (err) {
      if (err.code === '42501') showToast('Predictions are locked for this game', 'error')
      else showToast('Failed to save prediction', 'error')
      return
    }
    logEvent(supabase, user.id, 'prediction_submit', 'game')
    if (groupId === resolvedGroupId) setMyPred(data)
    setAllGroupPreds(prev => prev.map(gp => gp.groupId === groupId ? { ...gp, pred: data } : gp))
    cache.invalidate(`dashboard:${user.id}`)
    showToast('Prediction saved!')
  }

  // ── Loading skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <Layout title="Game">
        <div className="gm-page">
          <div className="dash-skeleton" style={{ height:'120px', borderRadius:12, marginBottom:'1rem' }} />
          <div className="dash-skeleton" style={{ height:'80px', borderRadius:12, marginBottom:'.75rem' }} />
          <div className="dash-skeleton" style={{ height:'100px', borderRadius:12 }} />
        </div>
      </Layout>
    )
  }

  // ── Error state ───────────────────────────────────────────────────
  if (error) {
    return (
      <Layout title="Game">
        <div className="gm-page">
          <div className="grp-error">
            <span>{error}</span>
            <button className="grp-error-retry" onClick={loadGame}>Retry</button>
          </div>
        </div>
      </Layout>
    )
  }

  if (!game) return null

  // ── Derived state ─────────────────────────────────────────────────
  const pastKO   = new Date() >= new Date(game.kick_off_time)
  const finished = game.score_home !== null
  const isKO     = game.phase !== 'group'
  const resolvedGroupName = allGroups.find(gp => gp.id === resolvedGroupId)?.name
  const oddsData = game.game_odds?.[0] ?? null
  const within3Days = (new Date(game.kick_off_time) - new Date()) <= 3 * 24 * 60 * 60 * 1000
  const odds = within3Days ? oddsData : null
  const venue    = getVenue(game.team_home, game.team_away)
  const phaseLabel = PHASE_LABEL[game.phase] ?? game.phase

  const homeFlag  = flagUrl(game.team_home)
  const awayFlag  = flagUrl(game.team_away)
  const homeStats = teamStats.find(s => s.team === game.team_home) ?? null
  const awayStats = teamStats.find(s => s.team === game.team_away) ?? null
  const pLabel = pointsLabel(myPred, game)

  return (
    <Layout title={`${game.team_home} vs ${game.team_away}`}>
      <div className="gm-page">

        {/* ── Game Header ────────────────────────────────────────── */}
        <div className="gm-header">
          <div className="gm-header-body">

            {/* Teams row */}
            <div className="gm-header-teams">
              {/* Home */}
              <div className="gm-team">
                <FlagImg name={game.team_home} src={homeFlag} className="gm-flag" />
                <span className="gm-team-name">{game.team_home}</span>
              </div>

              {/* Center */}
              <div className="gm-center">
                {finished ? (
                  <>
                    <span className="gm-score-display">{game.score_home}–{game.score_away}</span>
                    <span className="gm-center-label">FT</span>
                  </>
                ) : pastKO ? (
                  <>
                    <span className="gm-center-live">LIVE</span>
                    <span className="gm-center-label">{fmtTime(game.kick_off_time)}</span>
                  </>
                ) : (
                  <>
                    <span className="gm-center-vs">vs</span>
                    <span className="gm-center-label">{fmtTime(game.kick_off_time)}</span>
                  </>
                )}
              </div>

              {/* Away */}
              <div className="gm-team gm-team--right">
                <FlagImg name={game.team_away} src={awayFlag} className="gm-flag" />
                <span className="gm-team-name">{game.team_away}</span>
              </div>
            </div>

            {/* Meta row: phase + group + venue */}
            <div className="gm-meta">
              <span className={`gm-phase-tag${isKO ? ' gm-phase-tag--ko' : ''}`}>
                {phaseLabel}
              </span>
              {game.group_name && <span className="gm-meta-sep">·</span>}
              {game.group_name && <span className="gm-meta-text">Group {game.group_name}</span>}
              {venue && <><span className="gm-meta-sep">·</span><span className="gm-meta-text">{venue.venue}, {venue.city}</span></>}
              {!pastKO && (
                <span className="gm-meta-date">{fmtKickoff(game.kick_off_time)}</span>
              )}
            </div>

            {/* Prediction rows — one per group */}
            {allGroupPreds.length > 0 ? (
              <div className="gm-all-group-preds">
                {allGroupPreds.map(({ groupId, groupName, pred }) => {
                  const gPLabel = pointsLabel(pred, game)
                  const input = groupInputs[groupId] ?? { home:'', away:'' }
                  const isSaving = !!submittingGroups[groupId]
                  return (
                    <div key={groupId} className="gm-header-pred">
                      <div className="gm-pred-group-name">{groupName}</div>
                      {finished ? (
                        <>
                          {pred && (
                            <div className="gm-header-pred-main">
                              <span className="gm-my-pick-score">{pred.pred_home}–{pred.pred_away}</span>
                              <span className="gm-my-pick-label">Your pick</span>
                              {pred.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                            </div>
                          )}
                          {gPLabel && <span className={`gm-header-pred-result ${gPLabel.cls}`}>{gPLabel.text}</span>}
                        </>
                      ) : pastKO ? (
                        pred ? (
                          <div className="gm-header-pred-main">
                            <span className="gm-my-pick-score">{pred.pred_home}–{pred.pred_away}</span>
                            <span className="gm-my-pick-label">Your pick</span>
                            {pred.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                          </div>
                        ) : (
                          <span className="gm-locked-msg">🔒 No prediction submitted</span>
                        )
                      ) : (
                        <form onSubmit={e => submitGroupPred(e, groupId)} className="gm-pred-form" style={{ width:'100%' }}>
                          <div className="gm-predict-row" style={{ marginBottom:'.4rem' }}>
                            <span className="gm-predict-team">{game.team_home}</span>
                            <div className="gm-predict-inputs">
                              <input type="number" min="0" max="20" inputMode="numeric" className="gm-input"
                                value={input.home}
                                onChange={e => setGroupInputs(p => ({ ...p, [groupId]: { ...p[groupId], home: e.target.value } }))}
                                placeholder="0" aria-label={`${game.team_home} goals`} required />
                              <span className="gm-input-sep">–</span>
                              <input type="number" min="0" max="20" inputMode="numeric" className="gm-input"
                                value={input.away}
                                onChange={e => setGroupInputs(p => ({ ...p, [groupId]: { ...p[groupId], away: e.target.value } }))}
                                placeholder="0" aria-label={`${game.team_away} goals`} required />
                            </div>
                            <span className="gm-predict-team">{game.team_away}</span>
                          </div>
                          <button type="submit" className="btn btn-gold btn-full" disabled={isSaving} style={{ minHeight:'44px' }}>
                            {isSaving ? 'Saving…' : pred ? '✏️ Update' : '⚽ Predict'}
                          </button>
                        </form>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : myPred !== undefined && (
              <div className="gm-header-pred">
                {finished ? (
                  <>
                    {myPred && (
                      <div className="gm-header-pred-main">
                        <span className="gm-my-pick-score">{myPred.pred_home}–{myPred.pred_away}</span>
                        <span className="gm-my-pick-label">Your pick</span>
                        {myPred.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                      </div>
                    )}
                    {pLabel && <span className={`gm-header-pred-result ${pLabel.cls}`}>{pLabel.text}</span>}
                  </>
                ) : pastKO ? (
                  myPred ? (
                    <div className="gm-header-pred-main">
                      <span className="gm-my-pick-score">{myPred.pred_home}–{myPred.pred_away}</span>
                      <span className="gm-my-pick-label">Your pick</span>
                      {myPred.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                    </div>
                  ) : (
                    <span className="gm-locked-msg">🔒 No prediction submitted</span>
                  )
                ) : (
                  <form onSubmit={e => submitGroupPred(e, resolvedGroupId)} className="gm-pred-form" style={{ width:'100%' }}>
                    <div className="gm-predict-row" style={{ marginBottom:'.4rem' }}>
                      <span className="gm-predict-team">{game.team_home}</span>
                      <div className="gm-predict-inputs">
                        <input type="number" min="0" max="20" inputMode="numeric" className="gm-input"
                          value={groupInputs.ungrouped?.home ?? ''}
                          onChange={e => setGroupInputs(p => ({ ...p, ungrouped: { ...p.ungrouped, home: e.target.value } }))}
                          placeholder="0" aria-label={`${game.team_home} goals`} required />
                        <span className="gm-input-sep">–</span>
                        <input type="number" min="0" max="20" inputMode="numeric" className="gm-input"
                          value={groupInputs.ungrouped?.away ?? ''}
                          onChange={e => setGroupInputs(p => ({ ...p, ungrouped: { ...p.ungrouped, away: e.target.value } }))}
                          placeholder="0" aria-label={`${game.team_away} goals`} required />
                      </div>
                      <span className="gm-predict-team">{game.team_away}</span>
                    </div>
                    <button type="submit" className="btn btn-gold btn-full" disabled={!!submittingGroups.ungrouped} style={{ minHeight:'44px' }}>
                      {submittingGroups.ungrouped ? 'Saving…' : myPred ? '✏️ Update' : '⚽ Predict'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ET / penalties info */}
            {finished && (game.went_to_extra_time || game.went_to_penalties) && (
              <div className="gm-header-extra">
                {game.went_to_extra_time && game.et_score_home !== null && (
                  <span>E.T. {game.et_score_home}–{game.et_score_away}</span>
                )}
                {game.went_to_penalties && game.penalty_score_home !== null && (
                  <span>Pens {game.penalty_score_home}–{game.penalty_score_away}</span>
                )}
              </div>
            )}

            {/* Events timeline inside header */}
            {finished && gameEvents.length > 0 && (
              <div className="gm-events gm-header-events">
                {gameEvents.map((ev, i) => {
                  const isHome = ev.team === game.team_home
                  const icon   = ev.event_type === 'goal' ? '⚽' : '🟥'
                  const min    = ev.minute_extra ? `${ev.minute}+${ev.minute_extra}'` : `${ev.minute}'`
                  // Tag goal type from api detail: penalty (P) / own goal (OG).
                  // Own goal is tagged by api to the beneficiary team, so it already
                  // renders on the correct side — no remap needed.
                  const tag    = ev.detail === 'Own Goal' ? ' (OG)' : ev.detail === 'Penalty' ? ' (P)' : ''
                  return (
                    <div className="gm-event-row" key={i}>
                      <span className="gm-event-home">{isHome ? `${ev.player_name ?? '?'} ${min}${tag}` : ''}</span>
                      <span className="gm-event-icon">{icon}</span>
                      <span className="gm-event-away">{!isHome ? `${min}${tag} ${ev.player_name ?? '?'}` : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Game Stats (finished games) ───────────────────────── */}
        {finished && (() => {
          const hSt = game.game_team_stats?.find(s => s.team === game.team_home) ?? null
          const aSt = game.game_team_stats?.find(s => s.team === game.team_away) ?? null
          if (!hSt && !aSt) return null

          const statRow = (label, hVal, aVal) => (
            <div className="gm-gstat-row" key={label}>
              <span className="gm-gstat-val">{hVal ?? '—'}</span>
              <span className="gm-gstat-label">{label}</span>
              <span className="gm-gstat-val gm-gstat-val--right">{aVal ?? '—'}</span>
            </div>
          )

          return (
            <div className="gm-section">
              <div className="gm-section-head">
                <span className="gm-section-label">Match Stats</span>
              </div>
              <div className="gm-section-body" style={{ paddingBottom:'.75rem' }}>
                <div className="gm-gstat-head">
                  <span>{game.team_home}</span>
                  <span>{game.team_away}</span>
                </div>
                {statRow('Possession', hSt?.possession != null ? `${hSt.possession}%` : null, aSt?.possession != null ? `${aSt.possession}%` : null)}
                {statRow('Total Passes', hSt?.passes_total, aSt?.passes_total)}
                {statRow('% Accuracy Passes', hSt?.passes_accuracy != null ? `${hSt.passes_accuracy}%` : null, aSt?.passes_accuracy != null ? `${aSt.passes_accuracy}%` : null)}
                {statRow('Shots', hSt?.shots_total, aSt?.shots_total)}
                {statRow('On Target', hSt?.shots_on_target, aSt?.shots_on_target)}
                {statRow('Inside Box', hSt?.shots_insidebox, aSt?.shots_insidebox)}
                {statRow('Corners', hSt?.corners, aSt?.corners)}
                {statRow('Fouls', hSt?.fouls, aSt?.fouls)}
                {statRow('🟨 Yellow Cards', hSt?.yellow_cards, aSt?.yellow_cards)}
                {statRow('🟥 Red Cards', hSt?.red_cards, aSt?.red_cards)}
                {statRow('Offsides', hSt?.offsides, aSt?.offsides)}
                {statRow('xG', hSt?.xg != null ? parseFloat(hSt.xg).toFixed(2) : null, aSt?.xg != null ? parseFloat(aSt.xg).toFixed(2) : null)}
              </div>
            </div>
          )
        })()}

        {/* ── Odds (pre-KO) ──────────────────────────────────────── */}
        {!pastKO && (
          <div className="gm-section">
            <div className="gm-section-head">
              <span className="gm-section-label">Odds</span>
            </div>
            <div className="gm-section-body">
              <div className="gm-odds">
                <div className="gm-odds-item">
                  <div className="gm-odds-label">Home Win</div>
                  <div className={`gm-odds-val${odds ? ' gm-odds-val--draw' : ''}`}>
                    {odds ? parseFloat(odds.home_win).toFixed(2) : '—'}
                  </div>
                </div>
                <div className="gm-odds-item">
                  <div className="gm-odds-label">{isKO ? 'AET / Draw' : 'Draw'}</div>
                  <div className={`gm-odds-val${odds ? ' gm-odds-val--draw' : ''}`}>
                    {odds ? parseFloat(odds.draw).toFixed(2) : '—'}
                  </div>
                </div>
                <div className="gm-odds-item">
                  <div className="gm-odds-label">Away Win</div>
                  <div className={`gm-odds-val${odds ? ' gm-odds-val--draw' : ''}`}>
                    {odds ? parseFloat(odds.away_win).toFixed(2) : '—'}
                  </div>
                </div>
              </div>
              <div className="gm-odds-ou">
                <div />
                <div className="gm-odds-item">
                  <div className="gm-odds-label">Under 2.5<br/>goals</div>
                  <div className={`gm-odds-val${odds?.under_2_5 ? ' gm-odds-val--draw' : ''}`}>
                    {odds?.under_2_5 ? parseFloat(odds.under_2_5).toFixed(2) : '—'}
                  </div>
                </div>
                <div className="gm-odds-item">
                  <div className="gm-odds-label">Over 2.5<br/>goals</div>
                  <div className={`gm-odds-val${odds?.over_2_5 ? ' gm-odds-val--draw' : ''}`}>
                    {odds?.over_2_5 ? parseFloat(odds.over_2_5).toFixed(2) : '—'}
                  </div>
                </div>
                <div />
              </div>
              {!odds && <p className="gm-no-stats" style={{ marginTop:'.5rem' }}>Odds available closer to kickoff</p>}
            </div>
          </div>
        )}

        {/* ── Team Stats (pre-KO only) ──────────────────────────── */}
        {!pastKO && (
          <div className="gm-section">
            <div className="gm-section-head">
              <span className="gm-section-label">Tournament Teams Record</span>
            </div>
            <div className="gm-section-body" style={{ padding:'.75rem 1rem' }}>
              <div className="gm-gstat-row" style={{ borderBottom:'none' }}>
                <span className="gm-gstat-val">
                  <span className="gm-form">
                    {(teamForm[game.team_home] ?? []).length > 0
                      ? (teamForm[game.team_home] ?? []).map((r, i) => (
                          <span key={i} className={`gm-form-badge gm-form-badge--${r.replace('·','').toLowerCase()}`}>{r}</span>
                        ))
                      : <span style={{ color:'var(--muted)', fontSize:'.78rem' }}>—</span>
                    }
                  </span>
                </span>
                <span className="gm-gstat-label">Record<br/><span style={{fontSize:'9px',opacity:.6}}>oldest → latest</span></span>
                <span className="gm-gstat-val gm-gstat-val--right">
                  <span className="gm-form" style={{ justifyContent:'flex-end' }}>
                    {(teamForm[game.team_away] ?? []).length > 0
                      ? (teamForm[game.team_away] ?? []).map((r, i) => (
                          <span key={i} className={`gm-form-badge gm-form-badge--${r.replace('·','').toLowerCase()}`}>{r}</span>
                        ))
                      : <span style={{ color:'var(--muted)', fontSize:'.78rem' }}>—</span>
                    }
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {!pastKO && (
          <div className="gm-section">
            <div className="gm-section-head">
              <span className="gm-section-label">Tournament Avg Stats</span>
            </div>
            <div className="gm-section-body" style={{ paddingBottom:'.75rem' }}>
              <div className="gm-gstat-head">
                <span>{game.team_home}</span>
                <span>{game.team_away}</span>
              </div>
              {(() => {
                const h = homeStats
                const a = awayStats
                const sr = (label, hVal, aVal) => (
                  <div className="gm-gstat-row" key={label}>
                    <span className="gm-gstat-val">{hVal ?? '—'}</span>
                    <span className="gm-gstat-label">{label}</span>
                    <span className="gm-gstat-val gm-gstat-val--right">{aVal ?? '—'}</span>
                  </div>
                )
                return (
                  <>
                    {sr('Goals Scored avg', h?.avg_goals_scored ?? null, a?.avg_goals_scored ?? null)}
                    {sr('Goals Conceded avg', h?.avg_goals_conceded ?? null, a?.avg_goals_conceded ?? null)}
                    {sr('Possession avg',
                      h?.avg_possession != null ? `${h.avg_possession}%` : null,
                      a?.avg_possession != null ? `${a.avg_possession}%` : null
                    )}
                    {sr('Shots avg', h?.avg_shots_total, a?.avg_shots_total)}
                    {sr('On Target avg', h?.avg_shots_on_target, a?.avg_shots_on_target)}
                    {sr('Corners avg', h?.avg_corners, a?.avg_corners)}
                    {sr('Fouls avg', h?.avg_fouls, a?.avg_fouls)}
                    {sr('🟨 Yellow Cards avg', h?.avg_yellow_cards, a?.avg_yellow_cards)}
                    {sr('🟥 Red Cards avg', h?.avg_red_cards, a?.avg_red_cards)}
                    {sr('Offsides avg', h?.avg_offsides, a?.avg_offsides)}
                  </>
                )
              })()}
              {(!homeStats && !awayStats) && (
                <p className="gm-no-stats" style={{ marginTop:'.5rem' }}>
                  First tournament game · Stats appear after kickoff · FIFA rankings & form coming soon
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Group Predictions note ───────────────────────────── */}
        <div className="gm-section">
          <div className="gm-section-head">
            <span className="gm-section-label">Group Predictions</span>
            {isAdmin && pastKO && resolvedGroupId && resolvedGroupName && (
              <span style={{ fontSize:'.75rem', color:'var(--muted)' }}>{resolvedGroupName}</span>
            )}
          </div>
          <div className="gm-section-body">
            {!pastKO ? (
              <>
                <p className="gm-reveal-msg">
                  🔒 Predictions reveal at kickoff · {fmtKickoff(game.kick_off_time)}
                </p>
                <p className="gm-reveal-msg" style={{ marginTop:'.3rem' }}>
                  👥 View your group's picks in the <strong>Groups</strong> page
                </p>
              </>
            ) : isAdmin && resolvedGroupId ? (
              memberPredsLoading ? (
                <p className="gm-reveal-msg">Loading group predictions…</p>
              ) : !memberPreds || memberPreds.length === 0 ? (
                <p className="gm-reveal-msg">No group predictions for this game.</p>
              ) : (
                <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:'.45rem' }}>
                  {[...memberPreds]
                    .sort((a, b) => (b.points_earned ?? -1) - (a.points_earned ?? -1))
                    .map(p => {
                      const badge = finished ? memberBadge(p.points_earned) : null
                      return (
                        <li key={p.user_id} style={{ display:'flex', alignItems:'center', gap:'.5rem', fontSize:'.9rem' }}>
                          <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {p.profiles?.username ?? '—'}
                            {p.user_id === user.id && <span style={{ color:'var(--muted)' }}> (you)</span>}
                          </span>
                          <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:600 }}>
                            {p.pred_home}–{p.pred_away}
                          </span>
                          {p.is_auto && (
                            <span style={{ fontSize:'.65rem', color:'var(--muted)', textTransform:'uppercase' }}>auto</span>
                          )}
                          {badge && (
                            <span style={{ fontSize:'.7rem', fontWeight:600, color:badge.color }}>{badge.text}</span>
                          )}
                        </li>
                      )
                    })}
                </ul>
              )
            ) : (
              <p className="gm-reveal-msg">
                👥 See your group's predictions in the <strong>Groups</strong> page
              </p>
            )}
          </div>
        </div>

      </div>
    </Layout>
  )
}

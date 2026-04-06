import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
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
  const time = d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jerusalem' })
  return `${date} · ${time} IDT`
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jerusalem' }) + ' IDT'
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

  const [game,            setGame]            = useState(null)
  const [myPred,          setMyPred]          = useState(undefined)  // undefined=loading, null=no pick
  const [teamStats,       setTeamStats]       = useState([])
  const [playerStats,     setPlayerStats]     = useState([])
  const [gameEvents,      setGameEvents]      = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [predInput,       setPredInput]       = useState({ home:'', away:'' })
  const [editing,         setEditing]         = useState(false)
  const [submitting,      setSubmitting]      = useState(false)
  // resolvedGroupId: undefined=still resolving, string=group UUID, null=ungrouped user (valid)
  const [resolvedGroupId, setResolvedGroupId] = useState(undefined)

  // Resolve which group this prediction belongs to.
  // Priority: (1) ?group= URL param  (2) user's first joined group  (3) null = ungrouped.
  // DB supports group_id=NULL on predictions (M36) with UNIQUE NULLS NOT DISTINCT.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function resolve() {
      if (urlGroupId) {
        if (!cancelled) setResolvedGroupId(urlGroupId)
        return
      }
      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!cancelled) setResolvedGroupId(data?.group_id ?? null)
    }
    resolve()
    return () => { cancelled = true }
  }, [user, urlGroupId])

  useEffect(() => {
    if (!gameId || !user || resolvedGroupId === undefined) return
    loadGame()
  }, [gameId, user, resolvedGroupId])   // eslint-disable-line react-hooks/exhaustive-deps

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

  async function submitPred(e) {
    e.preventDefault()
    const h = parseInt(predInput.home, 10)
    const a = parseInt(predInput.away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      showToast('Enter a valid score (0 or more for each team)', 'error')
      return
    }
    if (resolvedGroupId === undefined) return  // still resolving, should be rare
    setSubmitting(true)
    const { data, error: err } = await supabase
      .from('predictions')
      .upsert(
        { user_id: user.id, game_id: gameId, group_id: resolvedGroupId, pred_home: h, pred_away: a },
        { onConflict: 'user_id,game_id,group_id' }
      )
      .select('pred_home, pred_away, is_auto, updated_at, points_earned')
      .single()
    setSubmitting(false)
    if (err) {
      if (err.code === '42501') showToast('Predictions are locked for this game', 'error')
      else showToast('Failed to save prediction', 'error')
      return
    }
    setMyPred(data)
    setEditing(false)
    setPredInput({ home:'', away:'' })
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

  const showForm = editing || (!myPred && !pastKO)

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

            {/* Prediction row inside header */}
            {myPred !== undefined && (myPred || pastKO) && (
              <div className="gm-header-pred">
                {myPred ? (
                  <>
                    <div className="gm-header-pred-main">
                      <span className="gm-my-pick-score">{myPred.pred_home}–{myPred.pred_away}</span>
                      <span className="gm-my-pick-label">Your pick</span>
                      {myPred.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                    </div>
                    {finished ? (
                      pLabel && <span className={`gm-header-pred-result ${pLabel.cls}`}>{pLabel.text}</span>
                    ) : pastKO ? (
                      <span className="gm-locked-msg">🔒 Locked</span>
                    ) : (
                      !editing && (
                        <button
                          className="btn btn-outline"
                          style={{ fontSize:'.75rem', padding:'4px 12px', minHeight:'unset' }}
                          onClick={() => { setPredInput({ home: String(myPred.pred_home), away: String(myPred.pred_away) }); setEditing(true) }}
                        >
                          ✏️ Edit
                        </button>
                      )
                    )}
                  </>
                ) : (
                  <span className="gm-locked-msg">🔒 No prediction submitted</span>
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
                  return (
                    <div className="gm-event-row" key={i}>
                      <span className="gm-event-home">{isHome ? `${ev.player_name ?? '?'} ${min}` : ''}</span>
                      <span className="gm-event-icon">{icon}</span>
                      <span className="gm-event-away">{!isHome ? `${min} ${ev.player_name ?? '?'}` : ''}</span>
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

        {/* ── Prediction Entry (form only, pre-KO) ──────────────── */}
        {!pastKO && showForm && (
          <div className="gm-section">
            <div className="gm-section-head">
              <span className="gm-section-label">Your Prediction</span>
            </div>
            <div className="gm-section-body">
              <form onSubmit={submitPred}>
                <div className="gm-predict-row">
                  <span className="gm-predict-team">{game.team_home}</span>
                  <div className="gm-predict-inputs">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      inputMode="numeric"
                      className="gm-input"
                      value={predInput.home}
                      onChange={e => setPredInput(p => ({ ...p, home: e.target.value }))}
                      placeholder="0"
                      aria-label={`${game.team_home} goals`}
                      required
                    />
                    <span className="gm-input-sep">–</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      inputMode="numeric"
                      className="gm-input"
                      value={predInput.away}
                      onChange={e => setPredInput(p => ({ ...p, away: e.target.value }))}
                      placeholder="0"
                      aria-label={`${game.team_away} goals`}
                      required
                    />
                  </div>
                  <span className="gm-predict-team">{game.team_away}</span>
                </div>
                <div className="gm-predict-actions">
                  {editing && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ minHeight:'48px' }}
                      onClick={() => { setEditing(false); setPredInput({ home:'', away:'' }) }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn btn-gold btn-full"
                    disabled={submitting}
                  >
                    {submitting ? 'Saving…' : myPred ? '⚽ Update Prediction' : '⚽ Predict'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

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
              <span className="gm-section-label">Tournament Stats</span>
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
                    {sr('Record',
                      h ? `${h.wins ?? 0}W ${h.draws ?? 0}D ${h.losses ?? 0}L` : null,
                      a ? `${a.wins ?? 0}W ${a.draws ?? 0}D ${a.losses ?? 0}L` : null
                    )}
                    {sr('Goals',
                      h ? `${h.avg_goals_scored ?? '—'} / ${h.avg_goals_conceded ?? '—'}` : null,
                      a ? `${a.avg_goals_scored ?? '—'} / ${a.avg_goals_conceded ?? '—'}` : null
                    )}
                    {sr('Possession',
                      h?.avg_possession != null ? `${h.avg_possession}%` : null,
                      a?.avg_possession != null ? `${a.avg_possession}%` : null
                    )}
                    {sr('Shots', h?.avg_shots_total, a?.avg_shots_total)}
                    {sr('On Target', h?.avg_shots_on_target, a?.avg_shots_on_target)}
                    {sr('Corners', h?.avg_corners, a?.avg_corners)}
                    {sr('Fouls', h?.avg_fouls, a?.avg_fouls)}
                    {sr('🟨 Yellow Cards', h?.avg_yellow_cards, a?.avg_yellow_cards)}
                    {sr('🟥 Red Cards', h?.avg_red_cards, a?.avg_red_cards)}
                    {sr('Offsides', h?.avg_offsides, a?.avg_offsides)}
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

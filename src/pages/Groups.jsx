import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { TEAMS } from '../lib/teams.js'
import { getVenue } from '../lib/venues.js'
import Layout from '../components/Layout.jsx'
import Modal from '../components/Modal.jsx'

const RENAME_DEADLINE = new Date('2026-06-11T19:00:00Z')
const TEAM_CODE = Object.fromEntries(TEAMS.filter(t => t.code).map(t => [t.name, t.code]))
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

function fmtKickoff(iso) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

function computeDist(preds) {
  const total = preds.length
  if (!total) return null
  const homeWins = preds.filter(p => p.pred_home > p.pred_away).length
  const draws    = preds.filter(p => p.pred_home === p.pred_away).length
  const awayWins = preds.filter(p => p.pred_home < p.pred_away).length
  const g01 = preds.filter(p => p.pred_home + p.pred_away <= 1).length
  const g23 = preds.filter(p => { const g = p.pred_home + p.pred_away; return g >= 2 && g <= 3 }).length
  const g4p = preds.filter(p => p.pred_home + p.pred_away >= 4).length
  return {
    total, homeWins, draws, awayWins,
    homePct: Math.round((homeWins / total) * 100),
    drawPct: Math.round((draws    / total) * 100),
    awayPct: Math.round((awayWins / total) * 100),
    g01, g23, g4p,
    g01Pct: Math.round((g01 / total) * 100),
    g23Pct: Math.round((g23 / total) * 100),
    g4pPct: Math.round((g4p / total) * 100),
  }
}

export default function Groups() {
  const { user }       = useAuth()
  const { showToast }  = useToast()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()

  const [groups,          setGroups]          = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [manage,          setManage]          = useState(null) // group id with manage section open

  const selectGroup = id => { sessionStorage.setItem('groups_tab', id); setSelectedGroupId(id) }

  // Modal states
  const [createOpen,  setCreateOpen]  = useState(false)
  const [joinOpen,    setJoinOpen]    = useState(false)
  const [renameOpen,  setRenameOpen]  = useState(false)
  const [renameGroup, setRenameGroup] = useState(null)

  // Form values
  const [createName, setCreateName] = useState('')
  const [joinCode,   setJoinCode]   = useState('')
  const [joinError,  setJoinError]  = useState('')
  const [renameName, setRenameName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Confirm inactive
  const [confirmId, setConfirmId] = useState(null)
  const confirmTimer              = useRef(null)

  // Per-group leaderboards
  const [leaderboards, setLeaderboards] = useState({})
  const [lbErrors,     setLbErrors]     = useState({})
  const [lbLoading,    setLbLoading]    = useState(false)

  // Focus games + all predictions for them
  const [focusGames,      setFocusGames]      = useState([])
  const [focusLoading,    setFocusLoading]    = useState(true)
  const [myFocusPredMaps, setMyFocusPredMaps] = useState({})  // { [game_id]: { [group_id]: pred } }
  const [allGamePreds,    setAllGamePreds]     = useState({})  // { [game_id]: pred[] }
  const [predsLoading,  setPredsLoading]  = useState(false)
  const [globalPredStats, setGlobalPredStats] = useState({})  // { [game_id]: stats }

  // ── Load groups + members ──────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    setError(null)
    const { data, error: e } = await supabase
      .from('groups')
      .select('id, name, invite_code, created_by, group_members(user_id, is_inactive, profiles(username))')
      .order('created_at')
    if (e) { setError(e.message); setLoading(false); return }
    const list = data ?? []
    setGroups(list)
    setSelectedGroupId(prev => {
      const stored = sessionStorage.getItem('groups_tab')
      if (stored && list.some(g => g.id === stored)) return stored
      return list[0]?.id ?? null
    })
    setLoading(false)
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  // ── Per-group leaderboards ─────────────────────────────────────────────
  useEffect(() => {
    if (!groups.length) return
    setLbLoading(true)
    Promise.all(
      groups.map(g =>
        supabase.rpc('get_group_leaderboard', { p_group_id: g.id })
          .then(({ data, error }) => ({ groupId: g.id, rows: data ?? [], err: error?.message ?? null }))
      )
    ).then(results => {
      const map = {}
      const errMap = {}
      results.forEach(r => {
        map[r.groupId] = r.rows
        if (r.err) errMap[r.groupId] = r.err
      })
      setLeaderboards(map)
      setLbErrors(errMap)
      setLbLoading(false)
    })
  }, [groups])

  // ── Focus games (next upcoming or just kicked off — up to 2 parallel) ───
  useEffect(() => {
    if (!user) return
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    supabase.from('games')
      .select('id, team_home, team_away, kick_off_time, score_home, score_away, phase, went_to_extra_time, et_score_home, et_score_away, went_to_penalties, penalty_score_home, penalty_score_away')
      .gte('kick_off_time', twoHoursAgo)
      .order('kick_off_time')
      .limit(2)
      .then(({ data }) => {
        if (!data?.length) { setFocusGames([]); setFocusLoading(false); return }
        const firstKO = data[0].kick_off_time
        const games = data.filter(g => g.kick_off_time === firstKO)
        setFocusGames(games)
        setFocusLoading(false)
        supabase.from('predictions')
          .select('pred_home, pred_away, is_auto, group_id, game_id')
          .in('game_id', games.map(g => g.id))
          .eq('user_id', user.id)
          .then(({ data: preds }) => {
            const maps = {}
            preds?.forEach(p => {
              if (!maps[p.game_id]) maps[p.game_id] = {}
              maps[p.game_id][p.group_id] = p
            })
            setMyFocusPredMaps(maps)
          })
      })
  }, [user])

  // ── Load predictions for all focus games (after KO — RLS reveals them) ──
  useEffect(() => {
    if (!focusGames.length) return
    if (new Date() <= new Date(focusGames[0].kick_off_time)) return
    setPredsLoading(true)
    setGlobalPredStats({})
    const gameIds = focusGames.map(g => g.id)
    Promise.all([
      supabase.from('predictions')
        .select('user_id, group_id, game_id, pred_home, pred_away, is_auto, profiles(username)')
        .in('game_id', gameIds),
      ...focusGames.map(g =>
        supabase.rpc('get_global_prediction_stats', { p_game_id: g.id })
          .then(r => ({ gameId: g.id, stats: r.data?.[0] ?? null }))
      ),
    ]).then(([{ data: preds }, ...statsResults]) => {
      const predsByGame = {}
      preds?.forEach(p => {
        if (!predsByGame[p.game_id]) predsByGame[p.game_id] = []
        predsByGame[p.game_id].push(p)
      })
      setAllGamePreds(predsByGame)
      const statsMap = {}
      statsResults.forEach(r => { statsMap[r.gameId] = r.stats })
      setGlobalPredStats(statsMap)
      setPredsLoading(false)
    })
  }, [focusGames])

  // ── Pre-fill join from URL or localStorage ─────────────────────────────
  useEffect(() => {
    const urlCode = searchParams.get('invite')
    const stored  = localStorage.getItem('wc2026_pending_invite')
    const code    = urlCode || stored
    if (code) {
      setJoinCode(code.toUpperCase())
      setJoinOpen(true)
      if (stored) localStorage.removeItem('wc2026_pending_invite')
    }
  }, [searchParams])

  // ── Create group ───────────────────────────────────────────────────────
  const handleCreate = async ev => {
    ev.preventDefault()
    const name = createName.trim()
    if (!name) return
    setSubmitting(true)
    const { error } = await supabase.rpc('create_group', { group_name: name })
    setSubmitting(false)
    if (error) {
      if (error.message === 'max_groups_reached') showToast('You can be in at most 3 groups', 'error')
      else showToast(error.message || 'Failed to create group', 'error')
      return
    }
    showToast('Group created!', 'success')
    setCreateOpen(false)
    setCreateName('')
    loadGroups()
  }

  // ── Join group ─────────────────────────────────────────────────────────
  const handleJoin = async ev => {
    ev.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    setJoinError('')
    setSubmitting(true)
    const { error } = await supabase.rpc('join_group', { p_invite_code: code })
    setSubmitting(false)
    if (error) {
      let msg = error.message || 'Failed to join group'
      if (error.message === 'group_full')       msg = 'This group is full (max 10 members)'
      else if (error.message === 'invalid_invite_code') msg = 'Invalid invite code — check and try again'
      else if (error.message === 'already_member')  msg = "You're already a member of this group"
      else if (error.message === 'max_groups_reached') msg = 'You can be in at most 3 groups'
      else if (error.message === 'tournament_started') msg = 'Cannot join groups after tournament starts'
      setJoinError(msg)
      return
    }
    showToast('Joined group!', 'success')
    setJoinOpen(false)
    setJoinCode('')
    setJoinError('')
    loadGroups()
  }

  // ── Rename group ───────────────────────────────────────────────────────
  const handleRename = async ev => {
    ev.preventDefault()
    const name = renameName.trim()
    if (!name || !renameGroup) return
    setSubmitting(true)
    const { error } = await supabase.from('groups').update({ name }).eq('id', renameGroup.id)
    setSubmitting(false)
    if (error) { showToast(error.message || 'Failed to rename', 'error'); return }
    showToast('Group renamed!', 'success')
    setRenameOpen(false)
    setRenameGroup(null)
    loadGroups()
  }

  // ── Toggle inactive (confirm step) ────────────────────────────────────
  const handleToggleInactive = async (groupId, memberId, current) => {
    if (confirmId !== memberId) {
      setConfirmId(memberId)
      clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000)
      return
    }
    clearTimeout(confirmTimer.current)
    setConfirmId(null)
    const { error: e } = await supabase
      .from('group_members')
      .update({ is_inactive: !current })
      .eq('group_id', groupId)
      .eq('user_id', memberId)
    if (e) { showToast(e.message || 'Failed to update member', 'error'); return }
    showToast(current ? 'Member reactivated' : 'Member marked inactive', 'success')
    loadGroups()
  }

  // ── Copy invite link ───────────────────────────────────────────────────
  const copyInvite = async code => {
    const base = window.location.href.replace(/app\.html.*$/, '')
    const link = `${base}index.html?invite=${code}`
    try {
      await navigator.clipboard.writeText(link)
      showToast('Invite link copied!', 'success')
    } catch {
      showToast('Copy failed — code: ' + code, 'error')
    }
  }

  const canRename     = new Date() < RENAME_DEADLINE
  const myGroupCount  = groups.length
  const canCreateMore = myGroupCount < 3
  const focusPastKO   = focusGames.length > 0 ? new Date() > new Date(focusGames[0].kick_off_time) : false

  return (
    <Layout title="Groups" leftSlot={<div className="nav-spacer" />}>
      <div className="grp-page">

        {/* ── Page header ── */}
        <div className="grp-page-header">
          <h1 className="grp-page-title">My Groups</h1>
          <div className="grp-header-actions">
            <button className="btn btn-outline btn-sm" onClick={() => setJoinOpen(true)} disabled={!canCreateMore} title={!canCreateMore ? 'Max 3 groups reached' : undefined}>Join</button>
            <button
              className="btn btn-gold btn-sm"
              onClick={() => setCreateOpen(true)}
              disabled={!canCreateMore}
              title={!canCreateMore ? 'Max 3 groups reached' : undefined}
            >
              + Create
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="grp-error">
            <span>⚠️ {error}</span>
            <button className="grp-error-retry" onClick={loadGroups}>Retry</button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="grp-loading">
            <div className="dash-skeleton" style={{ height: '14rem', marginBottom: '.75rem', borderRadius: 'var(--radius)' }} />
            <div className="dash-skeleton" style={{ height: '14rem', borderRadius: 'var(--radius)' }} />
          </div>
        )}

        {/* ── Empty state + template preview ── */}
        {!loading && groups.length === 0 && (
          <>
            <div className="grp-empty">
              <div className="grp-empty-icon">👥</div>
              <p className="grp-empty-title">No groups yet</p>
              <p className="grp-empty-sub">Create a group and share the invite link with friends, or enter an invite code to join one.</p>
              <div className="grp-empty-actions">
                <button className="btn btn-outline btn-sm" onClick={() => setJoinOpen(true)}>Join with Code</button>
                <button className="btn btn-gold btn-sm" onClick={() => setCreateOpen(true)}>+ Create Group</button>
              </div>
            </div>

            {/* Template preview card */}
            <div className="grp-card grp-card--template">
              <div className="grp-template-label">👁 Group Board Preview</div>

              {/* Header */}
              <div className="grp-card-top">
                <div className="grp-card-title-row">
                  <h2 className="grp-card-name" style={{ opacity: .4 }}>My Group Name</h2>
                  <span className="grp-member-badge">3<span className="grp-member-badge-cap">/10</span></span>
                  <span className="grp-captain-badge">👑 Captain</span>
                </div>
                <div className="grp-invite-row">
                  <span className="grp-code-label">Code</span>
                  <span className="grp-code-val" style={{ opacity: .4 }}>ABC123</span>
                </div>
                <div className="grp-card-actions">
                  <button className="btn btn-outline btn-xs" disabled>🔗 Invite</button>
                  <button className="btn btn-outline btn-xs" disabled>✏️ Rename</button>
                  <button className="btn btn-outline btn-xs grp-toggle-btn" disabled>Manage ▾</button>
                </div>
              </div>

              {/* Leaderboard — skeleton rows with flag placeholders */}
              <div className="grp-section">
                <div className="grp-section-label">Group Board</div>
                <div className="grp-lb">
                  <div className="grp-lb-col-labels">
                    <span>#</span><span>Player</span><span>🏆</span><span>⚽ Top Scorer</span><span>Pts</span>
                  </div>
                  {[1, 2, 3].map(rank => (
                    <div key={rank} className={`grp-lb-row${rank === 1 ? ' grp-lb-row--me' : ''}`}>
                      <span className="grp-lb-rank">#{rank}</span>
                      <span className="grp-lb-name grp-skeleton-text" style={{ width: '5rem' }}>&nbsp;</span>
                      <div className="grp-lb-champ">
                        <div className="grp-tpl-flag" />
                      </div>
                      <span className="grp-lb-scorer grp-skeleton-text" style={{ width: '4.5rem' }}>&nbsp;</span>
                      <span className="grp-lb-pts grp-skeleton-text" style={{ width: '1.75rem' }}>&nbsp;</span>
                    </div>
                  ))}
                  <p className="grp-lb-pretournament">🗓 Scores start June 11 · Champion & scorer picks open soon</p>
                </div>
              </div>

              {/* Game + predictions — full skeleton template */}
              <div className="grp-section grp-game-section">
                <div className="grp-section-label">Game Prediction · Up Next</div>

                {/* Game row — skeleton flags + venue */}
                <div className="grp-ng-game">
                  <div className="grp-ng-teams">
                    <div className="grp-ng-team">
                      <div className="grp-tpl-flag" />
                      <span className="grp-skeleton-text" style={{ width: '3.5rem', display: 'inline-block' }}>&nbsp;</span>
                    </div>
                    <div className="grp-ng-center">
                      <span className="grp-ng-vs">vs</span>
                      <span className="grp-ng-time grp-skeleton-text" style={{ width: '7rem', display: 'inline-block' }}>&nbsp;</span>
                      <span className="grp-ng-venue grp-skeleton-text" style={{ width: '9rem', display: 'inline-block' }}>&nbsp;</span>
                    </div>
                    <div className="grp-ng-team grp-ng-team--right">
                      <span className="grp-skeleton-text" style={{ width: '3.5rem', display: 'inline-block' }}>&nbsp;</span>
                      <div className="grp-tpl-flag" />
                    </div>
                  </div>
                </div>

                {/* Predict button */}
                <button
                  className="btn btn-gold btn-full grp-predict-btn"
                  disabled={focusGames.length === 0}
                  onClick={() => focusGames[0] && navigate(`/game/${focusGames[0].id}`)}
                >⚽ Enter My Prediction →</button>
                {focusGames[0] && <p className="grp-predict-note">Preview · Join a group to predict with friends</p>}

                {/* After K.O. section label */}
                <div className="grp-section-label" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '.75rem' }}>
                  Game Prediction · Results
                </div>

                {/* Predictions list — skeleton rows, one with auto badge */}
                <div className="grp-preds-list">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="grp-pred-row">
                      <span className="grp-pred-user grp-skeleton-text" style={{ width: '5rem' }}>&nbsp;</span>
                      {i === 2 && <span className="grp-auto-badge">⚡ Auto</span>}
                      <span className="grp-pred-score grp-skeleton-text" style={{ width: '2.5rem' }}>&nbsp;</span>
                    </div>
                  ))}
                </div>

                {/* Dual stats: Group vs Global */}
                <div className="grp-stats-dual">
                  {['Group', 'Global'].map(label => (
                    <div key={label} className="grp-stats-block">
                      <div className="grp-stats-title">{label}</div>
                      <div className="grp-dist">
                        <div className="grp-dist-bar">
                          <div className="grp-dist-home" style={{ width: '50%' }} />
                          <div className="grp-dist-draw" style={{ width: '30%' }} />
                          <div className="grp-dist-away" style={{ width: '20%' }} />
                        </div>
                        <div className="grp-dist-labels">
                          <span className="grp-dist-label grp-dist-label--home">🏠 —%</span>
                          <span className="grp-dist-label grp-dist-label--draw">⚖️ —%</span>
                          <span className="grp-dist-label grp-dist-label--away">✈️ —%</span>
                        </div>
                        <div className="grp-dist-bar grp-dist-bar--goals" style={{ marginTop: '.5rem' }}>
                          <div className="grp-dist-g01" style={{ width: '35%' }} />
                          <div className="grp-dist-g23" style={{ width: '45%' }} />
                          <div className="grp-dist-g4p" style={{ width: '20%' }} />
                        </div>
                        <div className="grp-dist-labels">
                          <span className="grp-dist-label grp-dist-label--g01">⚽ 0–1: —%</span>
                          <span className="grp-dist-label grp-dist-label--g23">⚽ 2–3: —%</span>
                          <span className="grp-dist-label grp-dist-label--g4p">⚽ 4+: —%</span>
                        </div>
                        <div className="grp-dist-stats">
                          <span className="grp-dist-total">— predictions</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Groups list ── */}
        {!loading && groups.length > 0 && (
          <>
            {/* Group tabs — one per group */}
            <div className="pk-tab-sw grp-group-tabs" role="tablist" aria-label="Select group">
              {groups.map(g => (
                <button
                  key={g.id}
                  role="tab"
                  aria-selected={selectedGroupId === g.id}
                  className={`pk-tab-btn${selectedGroupId === g.id ? ' pk-tab-btn--active' : ''}`}
                  onClick={() => selectGroup(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>

            <div className="grp-list">
            {groups.filter(g => g.id === selectedGroupId).map(group => {
              const isCaptain    = group.created_by === user?.id
              const members      = group.group_members ?? []
              const lbRowsRaw    = leaderboards[group.id] ?? []
              const lbError      = lbErrors[group.id] ?? null
              const memberIds    = new Set(members.map(m => m.user_id))
              const isManageOpen = manage === group.id

              // If leaderboard RPC returned rows, use them.
              // If RPC failed, show error. If empty (pre-tournament), build placeholder from members.
              const lbRows = lbRowsRaw.length > 0
                ? lbRowsRaw
                : members.map((m, i) => ({
                    user_id:           m.user_id,
                    username:          m.profiles?.username ?? 'Unknown',
                    group_rank:        i + 1,
                    champion_team:     null,
                    top_scorer_player: null,
                    total_points:      0,
                    exact_scores:      0,
                    _placeholder:      true,
                  }))

              return (
                <div key={group.id} className="grp-card">

                  {/* ── Card header ── */}
                  <div className="grp-card-top">
                    <div className="grp-card-title-row">
                      <h2 className="grp-card-name">{group.name}</h2>
                      <span className="grp-member-badge">
                        {members.length}<span className="grp-member-badge-cap">/10</span>
                      </span>
                      {isCaptain && <span className="grp-captain-badge">👑 Captain</span>}
                    </div>
                    <div className="grp-invite-row">
                      <span className="grp-code-label">Code</span>
                      <span className="grp-code-val">{group.invite_code}</span>
                    </div>
                    <div className="grp-card-actions">
                      <button className="btn btn-outline btn-xs" onClick={() => copyInvite(group.invite_code)}>
                        🔗 Invite
                      </button>
                      {isCaptain && (
                        canRename ? (
                          <button
                            className="btn btn-outline btn-xs"
                            onClick={() => { setRenameGroup(group); setRenameName(group.name); setRenameOpen(true) }}
                          >
                            ✏️ Rename
                          </button>
                        ) : (
                          <button className="btn btn-outline btn-xs" disabled title="Locked after June 11, 2026">
                            🔒 Rename
                          </button>
                        )
                      )}
                      <button
                        className={`btn btn-outline btn-xs grp-toggle-btn${isManageOpen ? ' active' : ''}`}
                        onClick={() => setManage(isManageOpen ? null : group.id)}
                        aria-expanded={isManageOpen}
                      >
                        {isManageOpen ? 'Close ▴' : 'Manage ▾'}
                      </button>
                    </div>
                  </div>

                  {/* ── Leaderboard ── */}
                  <div className="grp-section">
                    <div className="grp-section-label">Group Board</div>
                    {lbLoading ? (
                      <div className="dash-skeleton grp-section-skeleton" />
                    ) : lbError ? (
                      <div className="grp-error">
                        <span>⚠️ Could not load leaderboard</span>
                        <button onClick={() => {
                          setLbLoading(true)
                          supabase.rpc('get_group_leaderboard', { p_group_id: group.id })
                            .then(({ data, error }) => {
                              setLeaderboards(prev => ({ ...prev, [group.id]: data ?? [] }))
                              setLbErrors(prev => ({ ...prev, [group.id]: error?.message ?? null }))
                              setLbLoading(false)
                            })
                        }}>Retry</button>
                      </div>
                    ) : members.length === 0 ? (
                      <p className="grp-section-empty">Invite friends to fill the leaderboard.</p>
                    ) : (
                      <div className="grp-lb">
                        <div className="grp-lb-col-labels">
                          <span>#</span>
                          <span>Player</span>
                          <span>🏆</span>
                          <span>⚽ Top Scorer</span>
                          <span>Pts</span>
                        </div>
                        {lbRows.map((row, idx) => {
                          const flagCode = row.champion_team ? TEAM_CODE[row.champion_team] : null
                          const isMe     = row.user_id === user?.id
                          const rank     = row.group_rank ?? (idx + 1)
                          return (
                            <div key={row.user_id} className={`grp-lb-row${isMe ? ' grp-lb-row--me' : ''}${row._placeholder ? ' grp-lb-row--pre' : ''}`}>
                              <span className="grp-lb-rank">#{rank}</span>
                              <span className="grp-lb-name">
                                {row.username}{isMe ? ' ★' : ''}
                              </span>
                              <div className="grp-lb-champ">
                                {flagCode
                                  ? <img
                                      className="grp-lb-flag"
                                      src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${flagCode}.svg`}
                                      alt={`${row.champion_team} flag`}
                                      title={row.champion_team}
                                    />
                                  : <span className="grp-lb-dash">—</span>
                                }
                              </div>
                              <span className="grp-lb-scorer" title={row.top_scorer_player ?? ''}>
                                {row.top_scorer_player ?? '—'}
                              </span>
                              <span className={`grp-lb-pts${row._placeholder ? ' grp-lb-pts--muted' : ''}`}>
                                {row.total_points ?? 0}
                              </span>
                            </div>
                          )
                        })}
                        {lbRowsRaw.length === 0 && members.length > 0 && (
                          <p className="grp-lb-pretournament">
                            🗓 Scores start June 11 · Champion & scorer picks open soon
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Next game(s) / group predictions — always visible ── */}
                  <div className="grp-section grp-game-section">
                    <div className="grp-section-label">Game Prediction · Up Next</div>

                    {focusLoading ? (
                      <div className="dash-skeleton grp-section-skeleton" />
                    ) : focusGames.length === 0 ? (
                      /* No game yet — template layout */
                      <>
                        <div className="grp-ng-game">
                          <div className="grp-ng-teams">
                            <div className="grp-ng-team">
                              <div className="grp-tpl-flag" />
                              <span className="grp-skeleton-text" style={{ width: '3.5rem', display: 'inline-block' }}>&nbsp;</span>
                            </div>
                            <div className="grp-ng-center">
                              <span className="grp-ng-vs">vs</span>
                              <span className="grp-ng-time grp-skeleton-text" style={{ width: '7rem', display: 'inline-block' }}>&nbsp;</span>
                              <span className="grp-ng-venue grp-skeleton-text" style={{ width: '9rem', display: 'inline-block' }}>&nbsp;</span>
                            </div>
                            <div className="grp-ng-team grp-ng-team--right">
                              <span className="grp-skeleton-text" style={{ width: '3.5rem', display: 'inline-block' }}>&nbsp;</span>
                              <div className="grp-tpl-flag" />
                            </div>
                          </div>
                        </div>
                        <button className="btn btn-gold btn-full grp-predict-btn" disabled>⚽ Enter My Prediction →</button>
                      </>
                    ) : (
                      focusGames.map((game, idx) => {
                        const myPred = myFocusPredMaps[game.id]?.[group.id] ?? null
                        return (
                          <div key={game.id}>
                            {idx > 0 && <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', margin: '.75rem 0' }} />}
                            <div className="grp-ng-game">
                              <div className="grp-ng-teams">
                                <div className="grp-ng-team">
                                  {TEAM_CODE[game.team_home] && (
                                    <img className="grp-ng-flag" src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${TEAM_CODE[game.team_home]}.svg`} alt={`${game.team_home} flag`} />
                                  )}
                                  <span className="grp-ng-name">{game.team_home}</span>
                                </div>
                                <div className="grp-ng-center">
                                  {game.score_home !== null
                                    ? <>
                                        <span className="grp-ng-score">{game.score_home}–{game.score_away}</span>
                                        {game.went_to_extra_time && (
                                          <span className="grp-ng-extra">
                                            {game.et_score_home !== null && `E.T. ${game.et_score_home}–${game.et_score_away}`}
                                            {game.went_to_penalties && game.penalty_score_home !== null && `  Pens ${game.penalty_score_home}–${game.penalty_score_away}`}
                                          </span>
                                        )}
                                      </>
                                    : <span className="grp-ng-vs">vs</span>
                                  }
                                  <span className="grp-ng-time">{fmtKickoff(game.kick_off_time)}</span>
                                  {(() => { const v = getVenue(game.team_home, game.team_away); return v ? <span className="grp-ng-venue">{v.venue} · {v.city}</span> : null })()}
                                </div>
                                <div className="grp-ng-team grp-ng-team--right">
                                  <span className="grp-ng-name">{game.team_away}</span>
                                  {TEAM_CODE[game.team_away] && (
                                    <img className="grp-ng-flag" src={`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${TEAM_CODE[game.team_away]}.svg`} alt={`${game.team_away} flag`} />
                                  )}
                                </div>
                              </div>
                            </div>
                            {myPred && !focusPastKO ? (
                              <>
                                <div className="gm-predict-row">
                                  <span className="gm-predict-team">{game.team_home}</span>
                                  <div className="gm-predict-inputs">
                                    <div className="gm-pick-box">{myPred.pred_home}</div>
                                    <span className="gm-input-sep">–</span>
                                    <div className="gm-pick-box">{myPred.pred_away}</div>
                                  </div>
                                  <span className="gm-predict-team">{game.team_away}</span>
                                </div>
                                {myPred.is_auto && (
                                  <div style={{ textAlign:'center', margin:'.25rem 0' }}>
                                    <span className="grp-auto-badge">⚡ Auto</span>
                                  </div>
                                )}
                                <button
                                  className="btn btn-outline btn-full"
                                  style={{ minHeight:'48px' }}
                                  onClick={() => navigate(`/game/${game.id}?group=${group.id}`)}
                                >✏️ Edit Prediction</button>
                              </>
                            ) : (
                              <button
                                className="btn btn-gold btn-full grp-predict-btn"
                                onClick={() => navigate(`/game/${game.id}?group=${group.id}`)}
                                disabled={focusPastKO}
                              >
                                {focusPastKO ? '🔒 Predictions Locked' : '⚽ Enter My Prediction →'}
                              </button>
                            )}

                            {/* ── Results for this game ── */}
                            {(() => {
                              const gameAllPreds = allGamePreds[game.id] ?? []
                              const gameGroupPreds = gameAllPreds.filter(p => memberIds.has(p.user_id) && p.group_id === group.id)
                              const gameGlobalStats = globalPredStats[game.id] ?? null
                              const gDist = focusPastKO ? computeDist(gameGroupPreds) : null
                              const tDist = (() => {
                                if (!focusPastKO || !gameGlobalStats) return null
                                const s = gameGlobalStats
                                const tot = Number(s.total)
                                if (!tot) return null
                                const hw = Number(s.home_wins), dr = Number(s.draws), aw = Number(s.away_wins)
                                const g01 = Number(s.g01), g23 = Number(s.g23), g4p = Number(s.g4p)
                                return {
                                  total: tot, homeWins: hw, draws: dr, awayWins: aw, g01, g23, g4p,
                                  homePct: Math.round((hw  / tot) * 100),
                                  drawPct: Math.round((dr  / tot) * 100),
                                  awayPct: Math.round((aw  / tot) * 100),
                                  g01Pct:  Math.round((g01 / tot) * 100),
                                  g23Pct:  Math.round((g23 / tot) * 100),
                                  g4pPct:  Math.round((g4p / tot) * 100),
                                }
                              })()
                              const renderDistBlock = (label, dist) => (
                                <div key={label} className="grp-stats-block">
                                  <div className="grp-stats-title">{label}</div>
                                  <div className="grp-dist">
                                    <div className="grp-dist-bar">
                                      <div className="grp-dist-home" style={{ width: dist ? `${dist.homePct}%` : '50%' }} />
                                      <div className="grp-dist-draw" style={{ width: dist ? `${dist.drawPct}%` : '30%' }} />
                                      <div className="grp-dist-away" style={{ width: dist ? `${dist.awayPct}%` : '20%' }} />
                                    </div>
                                    <div className="grp-dist-labels">
                                      <span className="grp-dist-label grp-dist-label--home">🏠 {dist ? `${dist.homeWins} (${dist.homePct}%)` : '—%'}</span>
                                      <span className="grp-dist-label grp-dist-label--draw">⚖️ {dist ? `${dist.draws} (${dist.drawPct}%)` : '—%'}</span>
                                      <span className="grp-dist-label grp-dist-label--away">✈️ {dist ? `${dist.awayWins} (${dist.awayPct}%)` : '—%'}</span>
                                    </div>
                                    <div className="grp-dist-bar grp-dist-bar--goals" style={{ marginTop: '.5rem' }}>
                                      <div className="grp-dist-g01" style={{ width: dist ? `${dist.g01Pct}%` : '35%' }} />
                                      <div className="grp-dist-g23" style={{ width: dist ? `${dist.g23Pct}%` : '45%' }} />
                                      <div className="grp-dist-g4p" style={{ width: dist ? `${dist.g4pPct}%` : '20%' }} />
                                    </div>
                                    <div className="grp-dist-labels">
                                      <span className="grp-dist-label grp-dist-label--g01">⚽ 0–1: {dist ? `${dist.g01Pct}%` : '—%'}</span>
                                      <span className="grp-dist-label grp-dist-label--g23">⚽ 2–3: {dist ? `${dist.g23Pct}%` : '—%'}</span>
                                      <span className="grp-dist-label grp-dist-label--g4p">⚽ 4+: {dist ? `${dist.g4pPct}%` : '—%'}</span>
                                    </div>
                                    <div className="grp-dist-stats">
                                      <span className="grp-dist-total">{dist ? `${dist.total} predictions` : '— predictions'}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                              return (
                                <div className="grp-section" style={{ marginTop: '.5rem' }}>
                                  <div className="grp-section-label" style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '.75rem' }}>
                                    Game Prediction · Results
                                  </div>
                                  {!focusPastKO ? (
                                    <div className="grp-preds-list">
                                      {[1, 2, 3].map(i => (
                                        <div key={i} className="grp-pred-row">
                                          <span className="grp-pred-user grp-skeleton-text" style={{ width: '5rem' }}>&nbsp;</span>
                                          {i === 2 && <span className="grp-auto-badge">⚡ Auto</span>}
                                          <span className="grp-pred-score grp-skeleton-text" style={{ width: '2.5rem' }}>&nbsp;</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : predsLoading ? (
                                    <div className="dash-skeleton grp-section-skeleton" />
                                  ) : gameGroupPreds.length === 0 ? (
                                    <p className="grp-section-empty">No predictions submitted for this group.</p>
                                  ) : (
                                    <div className="grp-preds-list">
                                      {gameGroupPreds.map(p => (
                                        <div key={p.user_id} className="grp-pred-row">
                                          <span className="grp-pred-user">{p.profiles?.username ?? '—'}</span>
                                          {p.is_auto && <span className="grp-auto-badge">⚡ Auto</span>}
                                          <span className="grp-pred-score">{p.pred_home}–{p.pred_away}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="grp-stats-dual">
                                    {renderDistBlock('Group', gDist)}
                                    {renderDistBlock('Global', tDist)}
                                  </div>
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* ── Manage members (collapsible) ── */}
                  {isManageOpen && (
                    <div className="grp-members-list">
                      {members.length === 0 ? (
                        <p className="grp-members-empty">No members yet.</p>
                      ) : (
                        members.map(m => {
                          const uname     = m.profiles?.username ?? 'Unknown'
                          const isMe      = m.user_id === user?.id
                          const isCap     = m.user_id === group.created_by
                          const canToggle = isCaptain && !isMe
                          const isPending = confirmId === m.user_id
                          return (
                            <div
                              key={m.user_id}
                              className={`grp-member-row${m.is_inactive ? ' grp-member-inactive' : ''}`}
                            >
                              <div className="grp-member-info">
                                <span className="grp-member-name">
                                  {uname}
                                  {isMe  && <span className="grp-member-you"> (you)</span>}
                                  {isCap && <span className="grp-member-cap"> 👑</span>}
                                </span>
                                {m.is_inactive && <span className="grp-inactive-tag">Inactive</span>}
                              </div>
                              {canToggle && (
                                <button
                                  className={`btn btn-xs grp-inactive-btn${m.is_inactive ? ' grp-inactive-btn--on' : ''}${isPending ? ' grp-inactive-btn--confirm' : ''}`}
                                  onClick={() => handleToggleInactive(group.id, m.user_id, m.is_inactive)}
                                  title="Mark as inactive if this member has stopped playing."
                                >
                                  {isPending ? 'Sure?' : m.is_inactive ? 'Reactivate' : 'Set Inactive'}
                                </button>
                              )}
                            </div>
                          )
                        })
                      )}
                      {isCaptain && (
                        <p className="grp-inactive-hint">
                          💡 <strong>Set Inactive</strong> — member still earns auto-predict points but appears dimmed on the leaderboard.
                        </p>
                      )}
                      <p className="grp-members-note">
                        Members are permanent. To remove a member or delete the group, contact the admin.
                      </p>
                    </div>
                  )}

                </div>
              )
            })}
            </div>
          </>
        )}

        {!loading && !canCreateMore && (
          <p className="grp-max-note">You're in the maximum of 3 groups.</p>
        )}

      </div>

      {/* ── Create modal ── */}
      <Modal isOpen={createOpen} onClose={() => { setCreateOpen(false); setCreateName('') }}>
        <h2 className="modal-title">Create Group</h2>
        <form onSubmit={handleCreate} className="modal-form">
          <div className="form-group">
            <label htmlFor="create-group-name">Group Name</label>
            <input
              id="create-group-name"
              type="text"
              placeholder="e.g. The Lads ⚽"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              maxLength={30}
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-gold btn-full" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Group'}
          </button>
          <p className="grp-modal-note">Max 3 groups per user · Max 10 members per group</p>
        </form>
      </Modal>

      {/* ── Join modal ── */}
      <Modal isOpen={joinOpen} onClose={() => { setJoinOpen(false); setJoinCode(''); setJoinError('') }}>
        <h2 className="modal-title">Join a Group</h2>
        <form onSubmit={handleJoin} className="modal-form">
          <div className="form-group">
            <label htmlFor="join-code">Invite Code</label>
            <input
              id="join-code"
              type="text"
              placeholder="e.g. ABC123"
              value={joinCode}
              onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError('') }}
              maxLength={6}
              required
              autoFocus
              className={joinError ? 'input-error' : undefined}
              style={{ letterSpacing: '0.15em', fontFamily: "'Oswald', sans-serif", fontSize: '1.2rem' }}
            />
            {joinError && <span className="field-error" style={{ display: 'block' }}>{joinError}</span>}
          </div>
          <button type="submit" className="btn btn-gold btn-full" disabled={submitting}>
            {submitting ? 'Joining…' : 'Join Group'}
          </button>
        </form>
      </Modal>

      {/* ── Rename modal ── */}
      <Modal isOpen={renameOpen} onClose={() => { setRenameOpen(false); setRenameGroup(null) }}>
        <h2 className="modal-title">Rename Group</h2>
        <form onSubmit={handleRename} className="modal-form">
          <div className="form-group">
            <label htmlFor="rename-group">New Name</label>
            <input
              id="rename-group"
              type="text"
              placeholder="Group name"
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              maxLength={30}
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-gold btn-full" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Name'}
          </button>
          <p className="grp-modal-note">Group names lock on June 11, 2026 at 22:00 IDT.</p>
        </form>
      </Modal>

    </Layout>
  )
}

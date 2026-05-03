import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { logEvent } from '../lib/analytics.ts'
import { useToast } from '../context/ToastContext.jsx'
import Layout from '../components/Layout.jsx'
import { supabase } from '../lib/supabase.js'
import { TEAMS } from '../lib/teams.js'

const PICKS_DEADLINE = '2026-06-11T19:00:00Z'

const PHASE_LABEL = {
  group: 'Group Stage',
  r32:   'Round of 32',
  r16:   'Round of 16',
  qf:    'Quarter-Finals',
  sf:    'Semi-Finals',
  third: '3rd Place',
  final: 'Final',
}
const PHASE_ORDER = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final']

function FlagImg({ name, code, className }) {
  const [broken, setBroken] = useState(false)
  if (!code || broken) return <div className={`${className}-ph`} />
  const src = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${code}.svg`
  return <img src={src} alt={`${name} flag`} className={className} onError={() => setBroken(true)} />
}

function fmtKickoff(dt) {
  const d = new Date(dt)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export default function Picks() {
  const { session } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const user = session?.user
  useEffect(() => { if (user?.id) logEvent(supabase, user.id, 'page_view', 'picks') }, [user?.id])

  const isLocked = new Date() >= new Date(PICKS_DEADLINE)
  const activeGroupRef = useRef(null)
  const gamesLoadedRef = useRef(false)
  const predCtxRef = useRef(undefined)  // undefined = not yet set

  // ── Tab state ─────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('picks_tab') || 'picks')

  const switchTab = tab => { sessionStorage.setItem('picks_tab', tab); setActiveTab(tab) }

  // ── DB-driven teams + players ──────────────────────────────────
  const [dbTeams, setDbTeams]       = useState([])
  const [dbPlayers, setDbPlayers]   = useState([])
  const [champOdds, setChampOdds]   = useState({}) // { team_name: best_odds }

  // ── Groups + picks state ──────────────────────────────────────
  const [groups, setGroups]               = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError]     = useState(false)
  const [picksLoading, setPicksLoading]   = useState(false)
  const [picksError, setPicksError]       = useState(false)

  const [savedChampion, setSavedChampion] = useState(null)
  const [savedPlayer, setSavedPlayer]     = useState(null)
  const [selChampion, setSelChampion]     = useState(null)
  const [selPlayer, setSelPlayer]         = useState(null)
  const [saving, setSaving]               = useState({ champion: false, topScorer: false })
  const [champSearch, setChampSearch]     = useState('')
  const [search, setSearch]               = useState('')

  // ── Predictions tab state ─────────────────────────────────────
  const [games, setGames]             = useState([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [gamesError, setGamesError]   = useState(false)
  const [myPreds, setMyPreds]         = useState({}) // { [gameId]: { pred_home, pred_away, is_auto } }
  const [predInputs, setPredInputs]   = useState({}) // { [gameId]: { home, away } }
  const [savingPred, setSavingPred]   = useState({}) // { [gameId]: bool }
  const [predsLoading, setPredsLoading] = useState(false)

  // ── Tournament results state ───────────────────────────────────
  const [tournamentChampion, setTournamentChampion] = useState(undefined) // undefined=loading, null=not yet, string=winner
  const [topScorers, setTopScorers]                 = useState(undefined) // undefined=loading, []=not yet, [{player_name,total_goals}]

  // ── Effects ───────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    loadGroups()
    loadTournamentResults()
    loadCandidates()
  }, [user])

  async function loadCandidates() {
    const [{ data: t }, { data: p }, { data: o }] = await Promise.all([
      supabase.from('teams').select('name, flag_code, group_name, is_tbd').order('group_name').order('is_tbd'),
      supabase.from('top_scorer_candidates').select('name, team_name, flag_code, api_player_id').eq('is_active', true).order('name'),
      supabase.from('champion_odds').select('team_name, odds'),
    ])
    if (t) setDbTeams(t)
    if (p) setDbPlayers(p.map(r => ({ name: r.name, team: r.team_name, code: r.flag_code, apiId: r.api_player_id })))
    if (o) {
      const map = {}
      for (const row of o) map[row.team_name] = parseFloat(row.odds)
      setChampOdds(map)
    }
  }

  useEffect(() => {
    if (!user || groupsLoading) return
    if (groups.length > 0 && !selectedGroupId) return
    loadPicks(groups.length > 0 ? selectedGroupId : null)
  }, [user, selectedGroupId, groupsLoading])

  // Load games when Predictions tab first activated
  useEffect(() => {
    if (activeTab !== 'predictions' || !user) return
    if (!gamesLoadedRef.current) loadGames()
  }, [activeTab, user])

  // Load predictions when context changes in Predictions tab
  useEffect(() => {
    if (activeTab !== 'predictions' || !user || groupsLoading) return
    const ctx = groups.length > 0 ? selectedGroupId : null
    if (groups.length > 0 && !selectedGroupId) return // selectedGroupId not yet set
    loadMyPredictions(ctx)
  }, [activeTab, selectedGroupId, groupsLoading])

  // ── Groups + picks loaders ────────────────────────────────────

  async function loadGroups() {
    setGroupsLoading(true)
    setGroupsError(false)
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select('joined_at, groups(id, name)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: true })
      if (error) throw error
      const gs = (data ?? []).map(r => r.groups).filter(Boolean)
      setGroups(gs)
      if (gs.length > 0) {
        activeGroupRef.current = gs[0].id
        setSelectedGroupId(gs[0].id)
      }
    } catch {
      setGroupsError(true)
    } finally {
      setGroupsLoading(false)
    }
  }

  async function loadPicks(groupId) {
    setPicksLoading(true)
    setPicksError(false)
    try {
      let q1 = supabase.from('champion_pick').select('team').eq('user_id', user.id)
      q1 = groupId !== null ? q1.eq('group_id', groupId) : q1.is('group_id', null)
      let q2 = supabase.from('top_scorer_pick').select('player_name').eq('user_id', user.id)
      q2 = groupId !== null ? q2.eq('group_id', groupId) : q2.is('group_id', null)
      const [{ data: cp, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
        q1.maybeSingle(), q2.maybeSingle()
      ])
      if (activeGroupRef.current !== groupId) return
      if (e1 || e2) { setPicksError(true); return }
      setSavedChampion(cp?.team ?? null)
      setSelChampion(cp?.team ?? null)
      setSavedPlayer(ts ?? null)
      setSelPlayer(ts ? (dbPlayers.find(s => s.name === ts.player_name) ?? null) : null)
    } catch {
      if (activeGroupRef.current !== groupId) return
      setPicksError(true)
    } finally {
      if (activeGroupRef.current === groupId) setPicksLoading(false)
    }
  }

  async function loadTournamentResults() {
    const [{ data: finalGame }, { data: statsRows }] = await Promise.all([
      supabase.from('games').select('knockout_winner').eq('phase', 'final').maybeSingle(),
      supabase.from('player_tournament_stats').select('player_name, team, total_goals').order('total_goals', { ascending: false }).limit(20),
    ])
    setTournamentChampion(finalGame?.knockout_winner ?? null)
    if (statsRows && statsRows.length > 0) {
      const maxGoals = statsRows[0].total_goals
      setTopScorers(maxGoals > 0 ? statsRows.filter(r => r.total_goals === maxGoals) : [])
    } else {
      setTopScorers([])
    }
  }

  function selectGroup(id) {
    if (id === selectedGroupId) return
    activeGroupRef.current = id
    setSelectedGroupId(id)
    setChampSearch('')
    setSearch('')
  }

  // ── Picks save handlers ───────────────────────────────────────

  async function saveChampion() {
    const contextGroupId = groups.length > 0 ? selectedGroupId : null
    if (!selChampion || isLocked) return
    if (groups.length > 0 && !contextGroupId) return
    setSaving(s => ({ ...s, champion: true }))
    const row = { user_id: user.id, team: selChampion }
    if (contextGroupId !== null) row.group_id = contextGroupId
    const { error } = await supabase.from('champion_pick').upsert(row, { onConflict: 'user_id,group_id' })
    setSaving(s => ({ ...s, champion: false }))
    if (error) {
      if (error.code === '42501') showToast('Picks are locked', 'error')
      else showToast('Failed to save — try again', 'error')
    } else {
      setSavedChampion(selChampion)
      showToast('Champion pick saved!', 'success')
      logEvent(supabase, user.id, 'pick_submit', 'picks')
    }
  }

  async function saveTopScorer() {
    const contextGroupId = groups.length > 0 ? selectedGroupId : null
    if (!selPlayer || isLocked) return
    if (groups.length > 0 && !contextGroupId) return
    setSaving(s => ({ ...s, topScorer: true }))
    const row = { user_id: user.id, player_name: selPlayer.name, top_scorer_api_id: selPlayer.apiId ?? null }
    if (contextGroupId !== null) row.group_id = contextGroupId
    const { error } = await supabase.from('top_scorer_pick').upsert(row, { onConflict: 'user_id,group_id' })
    setSaving(s => ({ ...s, topScorer: false }))
    if (error) {
      if (error.code === '42501') showToast('Picks are locked', 'error')
      else showToast('Failed to save — try again', 'error')
    } else {
      setSavedPlayer({ player_name: selPlayer.name })
      showToast('Top scorer pick saved!', 'success')
      logEvent(supabase, user.id, 'pick_submit', 'picks')
    }
  }

  // ── Predictions loaders ───────────────────────────────────────

  async function loadGames() {
    if (gamesLoadedRef.current) return
    setGamesLoading(true)
    setGamesError(false)
    try {
      const { data, error } = await supabase
        .from('games')
        .select('id, team_home, team_away, kick_off_time, score_home, score_away, phase, et_score_home, et_score_away, penalty_score_home, penalty_score_away, went_to_extra_time, went_to_penalties')
        .order('kick_off_time')
      if (error) throw error
      setGames(data ?? [])
      gamesLoadedRef.current = true
    } catch {
      setGamesError(true)
      gamesLoadedRef.current = false
    } finally {
      setGamesLoading(false)
    }
  }

  async function loadMyPredictions(contextGroupId) {
    predCtxRef.current = contextGroupId
    setPredsLoading(true)
    try {
      let q = supabase
        .from('predictions')
        .select('game_id, pred_home, pred_away, is_auto')
        .eq('user_id', user.id)
      q = contextGroupId !== null ? q.eq('group_id', contextGroupId) : q.is('group_id', null)
      const { data } = await q
      if (predCtxRef.current !== contextGroupId) return // stale
      const map = {}
      const inputs = {}
      ;(data ?? []).forEach(p => {
        map[p.game_id] = { pred_home: p.pred_home, pred_away: p.pred_away, is_auto: p.is_auto }
        inputs[p.game_id] = { home: String(p.pred_home), away: String(p.pred_away) }
      })
      setMyPreds(map)
      setPredInputs(inputs)
    } finally {
      if (predCtxRef.current === contextGroupId) setPredsLoading(false)
    }
  }

  // ── Prediction entry handlers ─────────────────────────────────

  function handlePredInput(gameId, side, val) {
    setPredInputs(p => ({
      ...p,
      [gameId]: { ...(p[gameId] ?? {}), [side]: val },
    }))
  }

  function isPredChanged(gameId) {
    const input = predInputs[gameId]
    if (!input || input.home === '' || input.home === undefined ||
        input.away === '' || input.away === undefined) return false
    const h = parseInt(input.home, 10)
    const a = parseInt(input.away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return false
    const existing = myPreds[gameId]
    if (!existing) return true
    return h !== existing.pred_home || a !== existing.pred_away
  }

  async function savePred(gameId) {
    const input = predInputs[gameId]
    if (!input) return
    const h = parseInt(input.home, 10)
    const a = parseInt(input.away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      showToast('Enter valid scores (0 or more)', 'error')
      return
    }
    setSavingPred(s => ({ ...s, [gameId]: true }))
    const contextGroupId = groups.length > 0 ? selectedGroupId : null
    const existing = myPreds[gameId]
    let error
    if (existing) {
      let q = supabase
        .from('predictions')
        .update({ pred_home: h, pred_away: a })
        .eq('user_id', user.id)
        .eq('game_id', gameId)
      q = contextGroupId !== null ? q.eq('group_id', contextGroupId) : q.is('group_id', null)
      ;({ error } = await q)
    } else {
      const row = { user_id: user.id, game_id: gameId, pred_home: h, pred_away: a }
      if (contextGroupId !== null) row.group_id = contextGroupId
      ;({ error } = await supabase.from('predictions').insert(row))
    }
    setSavingPred(s => ({ ...s, [gameId]: false }))
    if (error) {
      if (error.code === '42501') showToast('Locked — game has started', 'error')
      else showToast('Failed to save', 'error')
    } else {
      setMyPreds(p => ({ ...p, [gameId]: { ...(p[gameId] ?? {}), pred_home: h, pred_away: a, is_auto: false } }))
      showToast('Saved!', 'success')
    }
  }

  // ── Memos ─────────────────────────────────────────────────────

  // team name → country code lookup for flags (DB-driven + static fallback for predictions tab)
  const teamCodeMap = useMemo(() => {
    const m = {}
    TEAMS.forEach(t => { m[t.name] = t.code })
    dbTeams.forEach(t => { if (t.flag_code) m[t.name] = t.flag_code })
    return m
  }, [dbTeams])

  const allTeams = useMemo(() => {
    if (dbTeams.length === 0) return []
    return dbTeams.map(t => ({
      name: t.name, code: t.flag_code, group: t.group_name, tbd: t.is_tbd,
    }))
  }, [dbTeams])

  const filteredTeams = useMemo(() => {
    const q = champSearch.toLowerCase()
    if (!q) return allTeams
    return allTeams.filter(t =>
      t.name.toLowerCase().includes(q) || `group ${t.group}`.includes(q)
    )
  }, [champSearch, allTeams])

  const filteredPlayers = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return dbPlayers
    return dbPlayers.filter(p =>
      p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
    )
  }, [search, dbPlayers])

  const gamesByPhase = useMemo(() => {
    const map = {}
    games.forEach(g => {
      if (!map[g.phase]) map[g.phase] = []
      map[g.phase].push(g)
    })
    return map
  }, [games])

  // Count how many future predictable games have been predicted
  const predProgress = useMemo(() => {
    const predictable = games.filter(g =>
      new Date() < new Date(g.kick_off_time) &&
      g.team_home !== 'TBD' && g.team_away !== 'TBD'
    )
    const done = predictable.filter(g => myPreds[g.id])
    return { total: predictable.length, done: done.length }
  }, [games, myPreds])

  const champChanged  = selChampion !== savedChampion
  const playerChanged = selPlayer?.name !== savedPlayer?.player_name

  const savedChampCode = savedChampion
    ? (dbTeams.find(t => t.name === savedChampion)?.flag_code ?? teamCodeMap[savedChampion] ?? null)
    : null
  const savedPlayerCode = savedPlayer
    ? (dbPlayers.find(s => s.name === savedPlayer.player_name)?.code ?? null)
    : null
  const champResultCode = tournamentChampion
    ? (dbTeams.find(t => t.name === tournamentChampion)?.flag_code ?? teamCodeMap[tournamentChampion] ?? null)
    : null

  const selectedGroup = groups.find(g => g.id === selectedGroupId)

  // ── Render ────────────────────────────────────────────────────

  return (
    <Layout title="My Picks">
      <div className="pk-page">

        {/* ── Page tab switcher ── */}
        <div className="pk-tab-sw" role="tablist" aria-label="Picks section">
          <button
            role="tab"
            aria-selected={activeTab === 'picks'}
            className={`pk-tab-btn${activeTab === 'picks' ? ' pk-tab-btn--active' : ''}`}
            onClick={() => switchTab('picks')}
          >
            🏆 Picks
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'predictions'}
            className={`pk-tab-btn${activeTab === 'predictions' ? ' pk-tab-btn--active' : ''}`}
            onClick={() => switchTab('predictions')}
          >
            ⚽ Predictions
          </button>
        </div>

        {/* ── Group selector — shared between tabs ── */}
        {!groupsLoading && !groupsError && groups.length > 0 && (
          <div className="pk-group-tabs" role="tablist" aria-label="Select group">
            {groups.map(g => (
              <button
                key={g.id}
                role="tab"
                aria-selected={selectedGroupId === g.id}
                className={`pk-group-tab${selectedGroupId === g.id ? ' pk-group-tab--active' : ''}`}
                onClick={() => selectGroup(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* ── Content area ── */}

        {/* Loading skeleton */}
        {groupsLoading ? (
          <>
            <div className="pk-skeleton-tabs">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="pk-skeleton-tab" />)}
            </div>
            <div className="pk-section">
              <div className="pk-section-head"><span className="pk-section-title">🏆 Champion</span></div>
              <div className="pk-skeleton-rows">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pk-skeleton-row" />)}
              </div>
            </div>
          </>
        ) : groupsError ? (
          /* Groups error */
          <div className="pk-section" style={{ padding:'2rem 1rem', textAlign:'center' }}>
            <div style={{ fontSize:'1.8rem', marginBottom:'.75rem' }}>⚠️</div>
            <p style={{ color:'var(--muted)', marginBottom:'1rem', fontSize:'.9rem' }}>
              Couldn't load your data.
            </p>
            <button className="btn btn-outline" onClick={loadGroups}>Try again</button>
          </div>

        ) : activeTab === 'picks' ? (
          /* ═══════════════ PICKS TAB ═══════════════ */
          <>
            <>
                {/* Lock warning bar */}
                <div className="pk-lock-bar">
                  <span className="pk-lock-icon" aria-hidden="true">{isLocked ? '🔒' : '⏰'}</span>
                  <p className="pk-lock-text">
                    {isLocked
                      ? <><strong>Picks are locked.</strong> The tournament has started — picks are final.</>
                      : <><strong>Picks lock Jun 11, 2026 · 22:00 IDT.</strong> No pick = auto-assigned.</>
                    }
                  </p>
                </div>

                {/* ── Tournament Result Cards ── */}
                <div className="pk-result-cards">
                  <div className="pk-result-card">
                    <div className="pk-result-card-title">🏆 Champion</div>
                    {tournamentChampion === undefined ? (
                      <div className="pk-result-card-skeleton" />
                    ) : tournamentChampion ? (
                      <div className="pk-result-card-val">
                        <FlagImg name={tournamentChampion} code={champResultCode} className="pk-player-flag" />
                        <span>{tournamentChampion}</span>
                      </div>
                    ) : (
                      <div className="pk-result-card-empty">Decided after the Final</div>
                    )}
                  </div>
                  <div className="pk-result-card">
                    <div className="pk-result-card-title">⚽ Top Scorer</div>
                    {topScorers === undefined ? (
                      <div className="pk-result-card-skeleton" />
                    ) : topScorers.length > 0 ? (
                      <div className="pk-result-card-scorers">
                        {topScorers.map(p => {
                          const code = dbPlayers.find(s => s.name === p.player_name)?.code ?? null
                          return (
                            <div key={p.player_name} className="pk-result-card-val">
                              <FlagImg name={p.player_name} code={code} className="pk-player-flag" />
                              <span>{p.player_name}</span>
                              <span className="pk-result-goals">{p.total_goals}G</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="pk-result-card-empty">Decided after the tournament</div>
                    )}
                  </div>
                </div>

                {/* Picks loading skeleton */}
                {picksLoading ? (
                  <>
                    <div className="pk-section">
                      <div className="pk-section-head"><span className="pk-section-title">🏆 Champion</span></div>
                      <div className="pk-skeleton-rows">
                        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pk-skeleton-row" />)}
                      </div>
                    </div>
                    <div className="pk-section">
                      <div className="pk-section-head"><span className="pk-section-title">⚽ Top Scorer</span></div>
                      <div className="pk-skeleton-rows">
                        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pk-skeleton-row" />)}
                      </div>
                    </div>
                  </>
                ) : picksError ? (
                  <div className="pk-section" style={{ padding:'2rem 1rem', textAlign:'center' }}>
                    <div style={{ fontSize:'1.5rem', marginBottom:'.6rem' }}>⚠️</div>
                    <p style={{ color:'var(--muted)', marginBottom:'1rem', fontSize:'.85rem' }}>
                      Couldn't load picks for this group.
                    </p>
                    <button className="btn btn-outline" onClick={() => loadPicks(selectedGroupId)}>Try again</button>
                  </div>
                ) : (
                  <>
                    {/* ── Champion Pick ── */}
                    <div className="pk-section">
                      <div className="pk-section-head">
                        <h2 className="pk-section-title">🏆 Champion</h2>
                        {isLocked && <span className="pk-locked-badge">🔒 Locked</span>}
                      </div>
                      {isLocked ? (
                        savedChampion ? (
                          <div className="pk-my-pick-display">
                            <FlagImg name={savedChampion} code={savedChampCode} className="pk-flag-lg" />
                            <div>
                              <div className="pk-my-pick-label">Your champion pick · {selectedGroup?.name}</div>
                              <div className="pk-my-pick-val">{savedChampion}</div>
                            </div>
                          </div>
                        ) : (
                          <p className="pk-no-pick-msg">No pick made — auto-assigned at tournament start.</p>
                        )
                      ) : (
                        <div className="pk-section-body">
                          <p className="pk-group-note">{selectedGroup ? <>Pick for <strong>{selectedGroup.name}</strong> — each group has its own champion pick.</> : 'Your personal pick — join a group to compete with friends.'}</p>
                          <input
                            className="pk-player-search"
                            type="text"
                            placeholder="Search team or group…"
                            value={champSearch}
                            onChange={e => setChampSearch(e.target.value)}
                            aria-label="Search champion candidates"
                          />
                          <div className="pk-player-list pk-champ-list" aria-label="Champion candidates">
                            <div className="pk-champ-list-header">
                              <span className="pk-champ-list-header-spacer" />
                              <span className="pk-champ-list-header-odds">Champion Odds</span>
                              <span className="pk-champ-list-header-group">Group</span>
                            </div>
                            {filteredTeams.map(t => (
                              <button
                                key={t.name}
                                className={`pk-player-row${selChampion === t.name ? ' pk-player-row--selected' : ''}${t.tbd ? ' pk-player-row--tbd' : ''}`}
                                onClick={() => !t.tbd && setSelChampion(t.name === selChampion ? null : t.name)}
                                disabled={t.tbd}
                                aria-pressed={selChampion === t.name}
                                aria-label={t.tbd ? `TBD slot — ${t.name}` : `Pick ${t.name} as champion`}
                              >
                                {t.tbd
                                  ? <div className="pk-player-flag-ph" />
                                  : <FlagImg name={t.name} code={t.code} className="pk-player-flag" />
                                }
                                <span className={`pk-player-name${selChampion === t.name ? ' pk-player-name--sel' : ''}`}>
                                  {t.tbd ? 'TBD' : t.name}
                                </span>
                                {!t.tbd && champOdds[t.name] != null && (
                                  <span className="pk-champ-odds">{champOdds[t.name].toFixed(1)}x</span>
                                )}
                                <span className="pk-player-team">Group {t.group}</span>
                              </button>
                            ))}
                          </div>
                          <div className="pk-save-row" style={{ marginTop:'.5rem' }}>
                            <p className="pk-current-pick">
                              {savedChampion
                                ? <>Current: <strong>{savedChampion}</strong></>
                                : <span>No pick yet</span>
                              }
                            </p>
                            <button
                              className="btn btn-gold"
                              onClick={saveChampion}
                              disabled={!selChampion || !champChanged || saving.champion}
                              style={{ minHeight: 48 }}
                            >
                              {saving.champion ? 'Saving…' : 'Save Pick'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Top Scorer Pick ── */}
                    <div className="pk-section">
                      <div className="pk-section-head">
                        <h2 className="pk-section-title">⚽ Top Scorer</h2>
                        {isLocked && <span className="pk-locked-badge">🔒 Locked</span>}
                      </div>
                      {isLocked ? (
                        savedPlayer ? (
                          <div className="pk-my-pick-display">
                            <FlagImg name={savedPlayer.player_name} code={savedPlayerCode} className="pk-player-flag" />
                            <div>
                              <div className="pk-my-pick-label">Your top scorer pick · {selectedGroup?.name}</div>
                              <div className="pk-my-pick-val">{savedPlayer.player_name}</div>
                            </div>
                          </div>
                        ) : (
                          <p className="pk-no-pick-msg">No pick made — auto-assigned at tournament start.</p>
                        )
                      ) : (
                        <div className="pk-section-body">
                          <p className="pk-group-note">{selectedGroup ? <>Pick for <strong>{selectedGroup.name}</strong> — each group has its own top scorer pick.</> : 'Your personal pick — join a group to compete with friends.'}</p>
                          <input
                            className="pk-player-search"
                            type="text"
                            placeholder="Search player or team…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            aria-label="Search top scorer candidates"
                          />
                          <div className="pk-player-list" role="listbox" aria-label="Top scorer candidates">
                            {filteredPlayers.length === 0 ? (
                              <p style={{ color:'var(--muted)', fontSize:'.85rem', padding:'.5rem .7rem' }}>
                                No players match your search.
                              </p>
                            ) : filteredPlayers.map(p => (
                              <button
                                key={p.name}
                                className={`pk-player-row${selPlayer?.name === p.name ? ' pk-player-row--selected' : ''}`}
                                onClick={() => setSelPlayer(p.name === selPlayer?.name ? null : p)}
                                role="option"
                                aria-selected={selPlayer?.name === p.name}
                              >
                                <FlagImg name={p.team} code={p.code} className="pk-player-flag" />
                                <span className={`pk-player-name${selPlayer?.name === p.name ? ' pk-player-name--sel' : ''}`}>
                                  {p.name}
                                </span>
                                <span className="pk-player-team">{p.team}</span>
                              </button>
                            ))}
                          </div>
                          <div className="pk-save-row" style={{ marginTop:'.5rem' }}>
                            <p className="pk-current-pick">
                              {savedPlayer
                                ? <>Current: <strong>{savedPlayer.player_name}</strong></>
                                : <span>No pick yet</span>
                              }
                            </p>
                            <button
                              className="btn btn-gold"
                              onClick={saveTopScorer}
                              disabled={!selPlayer || !playerChanged || saving.topScorer}
                              style={{ minHeight: 48 }}
                            >
                              {saving.topScorer ? 'Saving…' : 'Save Pick'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
            </>
          </>

        ) : (
          /* ═══════════════ PREDICTIONS TAB ═══════════════ */
          <>
            {/* Context label */}
            {groups.length > 0 && selectedGroup && (
              <p className="pd-context-label">
                Predicting for <strong>{selectedGroup.name}</strong>
              </p>
            )}

            {/* Progress */}
            {!gamesLoading && !predsLoading && games.length > 0 && predProgress.total > 0 && (
              <p className="pd-progress">
                {predProgress.done} / {predProgress.total} games predicted
                {predProgress.done === predProgress.total && predProgress.total > 0 && ' ✓'}
              </p>
            )}

            {/* Scoring note */}
            {!gamesLoading && games.length > 0 && (
              <>
                <p className="pd-scoring-note">Score calculated on 90-min result · Knockout stages also show extra time &amp; penalties</p>
                <p className="pd-scoring-note">No pick = auto-assigned at kickoff.</p>
              </>
            )}

            {/* Loading state */}
            {(gamesLoading || predsLoading) ? (
              <div className="pk-section" style={{ padding:'2rem 1rem', textAlign:'center' }}>
                <p style={{ color:'var(--muted)', fontSize:'.9rem' }}>Loading games…</p>
              </div>
            ) : gamesError ? (
              <div className="pk-section" style={{ padding:'2rem 1rem', textAlign:'center' }}>
                <div style={{ fontSize:'1.5rem', marginBottom:'.6rem' }}>⚠️</div>
                <p style={{ color:'var(--muted)', marginBottom:'1rem', fontSize:'.85rem' }}>
                  Couldn't load games.
                </p>
                <button className="btn btn-outline" onClick={() => { gamesLoadedRef.current = false; loadGames() }}>
                  Try again
                </button>
              </div>
            ) : games.length === 0 ? (
              <div className="pk-section" style={{ padding:'2rem 1rem', textAlign:'center' }}>
                <p style={{ color:'var(--muted)', fontSize:'.9rem' }}>No games scheduled yet.</p>
              </div>
            ) : (
              /* ── Games list ── */
              <div className="pd-games">
                {PHASE_ORDER.filter(ph => gamesByPhase[ph]).map(ph => (
                  <div key={ph}>
                    <div className="pd-phase-head">{PHASE_LABEL[ph]}</div>
                    {gamesByPhase[ph].map(game => {
                      const pastKO = new Date() >= new Date(game.kick_off_time)
                      const isTBD  = game.team_home === 'TBD' || game.team_away === 'TBD'
                      const locked = pastKO || isTBD
                      const myPred = myPreds[game.id]
                      const input  = predInputs[game.id]
                      const changed = isPredChanged(game.id)

                      return (
                        <div
                          key={game.id}
                          className={`pd-row${locked ? ' pd-row--locked' : ''}`}
                          onClick={() => navigate(`/game/${game.id}${selectedGroupId ? `?group=${selectedGroupId}` : ''}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => e.key === 'Enter' && navigate(`/game/${game.id}${selectedGroupId ? `?group=${selectedGroupId}` : ''}`)}
                          aria-label={`${game.team_home} vs ${game.team_away}`}
                        >
                          {/* Match row: teams + prediction in center */}
                          <div className="pd-match">
                            <div className="pd-team pd-team--home">
                              <FlagImg
                                name={game.team_home}
                                code={teamCodeMap[game.team_home]}
                                className="pk-player-flag"
                              />
                              <span className="pd-tname">{game.team_home}</span>
                            </div>

                            {/* Prediction center */}
                            {locked ? (
                              <div className="pd-vs-locked">
                                {myPred ? (
                                  <>
                                    <span className="pd-pick-label">your pick</span>
                                    <span className="pd-my-score">{myPred.pred_home}–{myPred.pred_away}</span>
                                    {myPred.is_auto && <span className="pd-auto">auto</span>}
                                  </>
                                ) : (
                                  <span className="pd-no-pred">–</span>
                                )}
                              </div>
                            ) : (
                              <div className="pd-vs" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="0"
                                  max="20"
                                  className="pd-inp"
                                  value={input?.home ?? ''}
                                  placeholder="0"
                                  onChange={e => handlePredInput(game.id, 'home', e.target.value)}
                                  aria-label={`${game.team_home} goals`}
                                />
                                <span className="pd-vsep">–</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="20"
                                  className="pd-inp"
                                  value={input?.away ?? ''}
                                  placeholder="0"
                                  onChange={e => handlePredInput(game.id, 'away', e.target.value)}
                                  aria-label={`${game.team_away} goals`}
                                />
                              </div>
                            )}

                            <div className="pd-team pd-team--away">
                              <span className="pd-tname">{game.team_away}</span>
                              <FlagImg
                                name={game.team_away}
                                code={teamCodeMap[game.team_away]}
                                className="pk-player-flag"
                              />
                            </div>
                          </div>

                          {/* Result row: always shown — 90-min always, ET+pens knockout only */}
                          <div className="pd-result-row">
                            <div className="pd-res-item">
                              <span className="pd-res-label">90'</span>
                              <span className="pd-res-val">
                                {game.score_home !== null ? `${game.score_home}–${game.score_away}` : '–'}
                              </span>
                            </div>
                            {game.phase !== 'group' && (
                              <div className="pd-res-item">
                                <span className="pd-res-label">E.T.</span>
                                <span className="pd-res-val">
                                  {game.went_to_extra_time && game.et_score_home !== null
                                    ? `${game.et_score_home}–${game.et_score_away}` : '–'}
                                </span>
                              </div>
                            )}
                            {game.phase !== 'group' && (
                              <div className="pd-res-item">
                                <span className="pd-res-label">pens</span>
                                <span className="pd-res-val">
                                  {game.went_to_penalties && game.penalty_score_home !== null
                                    ? `${game.penalty_score_home}–${game.penalty_score_away}` : '–'}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Meta row: kickoff + save button (pre-KO) / state (post-KO) */}
                          <div className="pd-meta">
                            {isTBD ? (
                              <div className="pd-meta-tbd">
                                <span className="pd-kickoff">{fmtKickoff(game.kick_off_time)}</span>
                                <span className="pd-lock-note">Matchup TBD</span>
                              </div>
                            ) : (
                              <>
                                <span className="pd-kickoff">{fmtKickoff(game.kick_off_time)}</span>
                                {!pastKO && (
                                  <button
                                    className="pd-save-btn"
                                    onClick={e => { e.stopPropagation(); savePred(game.id) }}
                                    disabled={!changed || savingPred[game.id]}
                                    aria-label="Save prediction"
                                  >
                                    {savingPred[game.id] ? '…' : myPred ? 'Update' : 'Save'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </Layout>
  )
}

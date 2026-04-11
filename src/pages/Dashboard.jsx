import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { TEAMS } from '../lib/teams.js'
import Layout from '../components/Layout.jsx'
import TrophyImg from '../assets/Trophy.jfif'
import { getVenue } from '../lib/venues.js'

const KICKOFF_TIME     = new Date('2026-06-11T19:00:00Z')
const FINAL_DATE       = new Date('2026-07-19T19:00:00Z')
const TOTAL_GAMES      = 104
const FINAL_DATE_LABEL = FINAL_DATE.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' })
const FINAL_TIME_LABEL = FINAL_DATE.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }) + ' IL'
const TEAM_CODE    = Object.fromEntries(TEAMS.filter(t => t.code).map(t => [t.name, t.code]))
const MEDAL        = { 1: '🥇', 2: '🥈', 3: '🥉' }
const pad          = n => String(n).padStart(2, '0')

function calcClock(nextGames) {
  const now = new Date()
  const isPreTournament = now < KICKOFF_TIME
  const nextUnplayed = nextGames.find(g => g.score_home === null && new Date(g.kick_off_time) > now)
  const target = isPreTournament
    ? KICKOFF_TIME
    : nextUnplayed ? new Date(nextUnplayed.kick_off_time) : null

  if (!target) return { days: 0, time: null, label: '' }

  const diff = Math.max(0, target - now)
  const days  = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins  = Math.floor((diff % 3600000) / 60000)
  const secs  = Math.floor((diff % 60000) / 1000)

  return {
    days,
    time: `${pad(hours)}:${pad(mins)}:${pad(secs)}`,
    label: isPreTournament
      ? (days === 1 ? 'DAY TO KICKOFF' : 'DAYS TO KICKOFF')
      : 'TO NEXT GAME',
  }
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtGameDate(dateStr) {
  if (!dateStr) return ''
  const today = new Date().toISOString().slice(0, 10)
  if (dateStr === today) return '⚡ Today\'s Games'
  const d = new Date(dateStr + 'T12:00:00Z')
  return '📅 ' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate           = useNavigate()
  const { showToast }      = useToast()
  const baseUsername       = user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'Player'

  // ── Profile sheet state ───────────────────────────────
  const gearBtnRef        = useRef(null)
  const sheetInputRef     = useRef(null)
  const [profileOpen,     setProfileOpen]     = useState(false)
  const [renameVal,       setRenameVal]       = useState('')
  const [renameError,     setRenameError]     = useState(null)
  const [renameLoading,   setRenameLoading]   = useState(false)
  const [deleteConfirm,   setDeleteConfirm]   = useState(false)
  const [deleteLoading,   setDeleteLoading]   = useState(false)
  const [displayUsername, setDisplayUsername] = useState(null) // null = use baseUsername

  const username = displayUsername ?? baseUsername

  const [groups,    setGroups]    = useState([])
  const [lb,        setLb]        = useState([])
  const [teamStats, setTeamStats] = useState({})
  const [streaks,   setStreaks]   = useState({})
  const [nextGames, setNextGames] = useState([])
  const [nextDate,  setNextDate]  = useState(null)
  const [myPreds,   setMyPreds]   = useState({})
  const [groupRanks, setGroupRanks] = useState([])
  const [groupRanksLoading, setGroupRanksLoading] = useState(false)
  const [champPickMap, setChampPickMap] = useState({})  // { [group_id]: { team, is_auto } }
  const [topScorerMap, setTopScorerMap] = useState({})  // { [group_id]: { player_name, is_auto } }
  const [showAllLb,       setShowAllLb]       = useState(false)
  const [predStats,       setPredStats]       = useState({})  // { [group_id]: { exactPct, predictPct, streak } }
  const [completedGames,  setCompletedGames]  = useState(0)
  const [finalClock,      setFinalClock]      = useState({ days:0, hours:0, mins:0, secs:0 })
  const [clock,     setClock]     = useState({ days: 0, time: '00:00:00', label: 'TO KICKOFF' })
  const [loading,   setLoading]   = useState(true)
  const [lbLoading, setLbLoading] = useState(false)
  const [error,     setError]     = useState(null)

  // Live clock + final countdown
  useEffect(() => {
    const tick = () => {
      setClock(calcClock(nextGames))
      const diff  = Math.max(0, FINAL_DATE - new Date())
      setFinalClock({
        days:  Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins:  Math.floor((diff % 3600000)  / 60000),
        secs:  Math.floor((diff % 60000)    / 1000),
      })
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [nextGames])

  // Load groups
  useEffect(() => {
    supabase.from('groups').select('id, name')
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); setLoading(false); return }
        const g = data ?? []
        setGroups(g)
        setLoading(false)
      })
  }, [])

  // Load global leaderboard
  useEffect(() => {
    if (loading) return
    setLbLoading(true)
    supabase.rpc('get_leaderboard').then(({ data, error: e }) => {
      if (e) setError(e.message)
      setLb(data ?? [])
      setLbLoading(false)
    })
  }, [loading])

  // Load team stats + win streaks
  useEffect(() => {
    if (!lb.length) return
    const champTeams = [...new Set(lb.filter(r => r.champion_team).map(r => r.champion_team))]
    if (!champTeams.length) return

    const orFilter = champTeams.flatMap(t => [`team_home.eq.${t}`, `team_away.eq.${t}`]).join(',')
    Promise.all([
      supabase.from('team_tournament_stats').select('*').in('team', champTeams),
      supabase.from('games')
        .select('team_home, team_away, score_home, score_away, kick_off_time')
        .not('score_home', 'is', null)
        .or(orFilter)
        .order('kick_off_time', { ascending: false }),
    ]).then(([{ data: sData }, { data: gData }]) => {
      const statsMap = {}
      sData?.forEach(s => { statsMap[s.team] = s })
      setTeamStats(statsMap)

      const streakMap = {}
      champTeams.forEach(team => {
        const tg = (gData ?? []).filter(g => g.team_home === team || g.team_away === team)
        let streak = 0
        for (const g of tg) {
          const isHome = g.team_home === team
          if ((isHome ? g.score_home : g.score_away) > (isHome ? g.score_away : g.score_home)) streak++
          else break
        }
        streakMap[team] = streak
      })
      setStreaks(streakMap)
    })
  }, [lb])

  // Load rank in every group
  useEffect(() => {
    if (!user || loading) return
    if (!groups.length) { setGroupRanksLoading(false); return }
    setGroupRanksLoading(true)
    Promise.all(
      groups.map(g =>
        supabase.rpc('get_group_leaderboard', { p_group_id: g.id }).then(({ data, error }) => {
          if (error) return { groupId: g.id, groupName: g.name, groupRank: null, globalRank: null, rpcError: error.message }
          const row = data?.find(r => r.user_id === user.id)
          return { groupId: g.id, groupName: g.name, groupRank: row?.group_rank ?? null, globalRank: row?.global_rank ?? null }
        })
      )
    ).then(ranks => {
      setGroupRanks(ranks)
      setGroupRanksLoading(false)
    })
  }, [groups, user, loading])

  // Load user picks + prediction stats
  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('champion_pick').select('team, group_id, is_auto').eq('user_id', user.id),
      supabase.from('top_scorer_pick').select('player_name, group_id, is_auto').eq('user_id', user.id),
      supabase.from('predictions').select('game_id, group_id, pred_home, pred_away, points_earned, is_auto').eq('user_id', user.id),
      supabase.from('games').select('id, score_home, score_away, kick_off_time').not('score_home', 'is', null).gte('kick_off_time', '2026-04-11').order('kick_off_time', { ascending: true }).order('id', { ascending: false }).limit(150),
    ]).then(([{ data: cpRows }, { data: tsRows }, { data: preds }, { data: finGames }]) => {
      const cpMap = {}
      cpRows?.forEach(r => { cpMap[r.group_id] = r })
      setChampPickMap(cpMap)
      const tsMap = {}
      tsRows?.forEach(r => { tsMap[r.group_id] = r })
      setTopScorerMap(tsMap)
      setCompletedGames(finGames?.length ?? 0)
      if (preds && finGames) {
        const outcome = (h, a) => h > a ? 'H' : h < a ? 'A' : 'D'
        const finishedGameIds = new Set(finGames.map(g => g.id))
        const byGroup = {}
        preds.forEach(p => {
          if (!byGroup[p.group_id]) byGroup[p.group_id] = []
          byGroup[p.group_id].push(p)
        })
        const statsMap = {}
        Object.entries(byGroup).forEach(([gid, gPreds]) => {
          const finishedPreds = gPreds.filter(p => finishedGameIds.has(p.game_id))
          const total   = finishedPreds.length
          const correct = finishedPreds.filter(p => p.points_earned >= 1).length
          const exact   = finishedPreds.filter(p => p.points_earned === 3).length
          const predMap = {}
          gPreds.forEach(p => { predMap[p.game_id] = p })
          let streak = 0
          for (const g of finGames) {
            const p = predMap[g.id]
            if (!p) continue
            const isCorrect = outcome(p.pred_home, p.pred_away) === outcome(g.score_home, g.score_away)
            if (streak === 0 || (isCorrect ? streak > 0 : streak < 0)) {
              streak += isCorrect ? 1 : -1
            } else {
              streak = isCorrect ? 1 : -1
            }
          }
          statsMap[gid] = {
            predictPct: total > 0 ? Math.round((correct / total) * 100) : 0,
            exactPct:   total > 0 ? Math.round((exact / total) * 100) : 0,
            streak,
          }
        })
        setPredStats(statsMap)
      }
    })
  }, [user])

  // Load game day (today if has unfinished games, else next day)
  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    supabase.from('games')
      .select('id, team_home, team_away, kick_off_time, score_home, score_away, phase, went_to_extra_time, et_score_home, et_score_away, went_to_penalties, penalty_score_home, penalty_score_away')
      .gte('kick_off_time', todayStr + 'T00:00:00Z')
      .order('kick_off_time')
      .limit(50)
      .then(({ data }) => {
        if (!data?.length) return
        const todayGames = data.filter(g => g.kick_off_time.slice(0, 10) === todayStr)
        const allDone    = todayGames.length > 0 && todayGames.every(g => g.score_home !== null)

        let displayGames, displayDate
        if (!allDone && todayGames.length > 0) {
          displayGames = todayGames
          displayDate  = todayStr
        } else {
          const future = data.filter(g => g.kick_off_time.slice(0, 10) > todayStr)
          if (future.length) {
            displayDate  = future[0].kick_off_time.slice(0, 10)
            displayGames = future.filter(g => g.kick_off_time.slice(0, 10) === displayDate)
          }
        }
        if (displayGames?.length) { setNextGames(displayGames); setNextDate(displayDate) }
      })
  }, [])

  // Load my predictions for game day — all groups, keyed by game_id → array of {groupId, groupName, pred_home, pred_away}
  useEffect(() => {
    if (!nextGames.length || !user || !groups.length) return
    supabase.from('predictions')
      .select('game_id, group_id, pred_home, pred_away')
      .eq('user_id', user.id)
      .in('game_id', nextGames.map(g => g.id))
      .then(({ data }) => {
        const map = {}
        data?.forEach(p => {
          const grp = groups.find(g => g.id === p.group_id)
          if (!grp) return
          if (!map[p.game_id]) map[p.game_id] = []
          map[p.game_id].push({ groupId: p.group_id, groupName: grp.name, pred_home: p.pred_home, pred_away: p.pred_away })
        })
        setMyPreds(map)
      })
  }, [nextGames, user, groups])

  const isLocked = new Date() >= KICKOFF_TIME

  // ── Profile sheet actions ────────────────────────────
  // Escape key closes sheet
  useEffect(() => {
    if (!profileOpen) return
    const handler = e => { if (e.key === 'Escape') closeSheet() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [profileOpen])

  function openSheet() {
    setRenameVal(username)
    setRenameError(null)
    setDeleteConfirm(false)
    setProfileOpen(true)
    setTimeout(() => sheetInputRef.current?.focus(), 50) // focus input after sheet animates in
  }

  function closeSheet() {
    setProfileOpen(false)
    setDeleteConfirm(false)
    gearBtnRef.current?.focus() // return focus to gear button
  }

  async function saveUsername() {
    const val = renameVal.trim()
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(val)) {
      setRenameError('3–20 characters: letters, numbers and _ only')
      return
    }
    if (val === username) { closeSheet(); return }
    setRenameLoading(true)
    setRenameError(null)
    const { error } = await supabase.from('profiles').update({ username: val }).eq('id', user.id)
    if (error) {
      setRenameError(error.message === 'username_taken' ? 'Username already taken' : 'Could not update username')
      setRenameLoading(false)
      return
    }
    await supabase.auth.updateUser({ data: { username: val } })
    setDisplayUsername(val)
    setRenameLoading(false)
    closeSheet()
    showToast('Username updated!')
  }

  async function deleteAccount() {
    if (!deleteConfirm) { setDeleteConfirm(true); return }
    setDeleteLoading(true)
    const { error } = await supabase.rpc('delete_account')
    if (error) {
      const msg = error.message === 'account_locked'        ? 'Account locked after June 11'
                : error.message === 'cannot_delete_in_group' ? 'Leave all groups first'
                : 'Could not delete account'
      setRenameError(msg)
      setDeleteConfirm(false)
      setDeleteLoading(false)
      return
    }
    await supabase.auth.signOut()
    window.location.href = './index.html'
  }

  const noGroups   = !loading && groups.length === 0
  const myRank     = (() => {
    const rows = lb.filter(r => r.user_id === user?.id)
    if (!rows.length) return null
    return Math.min(...rows.map(r => Number(r.rank)))
  })()

  const tourneyPct = Math.round((completedGames / TOTAL_GAMES) * 100)

  return (
    <Layout title="Dashboard" showBack={false}
      leftSlot={<button className="btn btn-gold btn-nav-sm" onClick={() => navigate('/groups')}>+ Create Group</button>}
      rightSlot={<button ref={gearBtnRef} className="prof-gear-btn" onClick={openSheet} aria-label="Profile settings">⚙️</button>}
    >

      {/* ── HERO — countdown + greeting only ── */}
      <div className="dash-hero">
        <div className="dash-countdown-row">
          <img src={TrophyImg} className="dash-trophy-img" alt="World Cup Trophy" />
          <div className="dash-cd-block">
            {clock.days > 0 && <span className="dash-cd-days">{clock.days}</span>}
            <div className="dash-cd-right">
              {clock.time && <span className="dash-cd-time">{clock.time}</span>}
              <span className="dash-cd-label">{clock.label}</span>
            </div>
          </div>
        </div>
        <h1 className="dash-greeting">
          Hey, <span className="dash-greeting-name">{username}</span> 👋
        </h1>
        {myRank !== null && (
          <div className="dash-rank-badge">
            {MEDAL[myRank] ?? `#${myRank}`}
            {' '}
            {/* TODO: add tiered messages for mid/high rank (rank 4+) — e.g. motivational or funny text based on rank % */}
            {myRank === 1 ? "You're leading!" : myRank <= 3 ? 'Top 3 — podium!' : `Rank #${myRank}`}
          </div>
        )}
        {/* Tournament progress + time to final */}
        <div className="dash-hero-progress">
          <div className="dash-progress-track">
            <div className="dash-progress-fill" style={{width:`${tourneyPct}%`}} />
          </div>
          {/* Row 1 (mobile): champion left · progress right */}
          <div className="dash-progress-row1">
            <span className="dash-progress-final">🏆 2026 World Cup Champion</span>
            <span className="dash-progress-label">{completedGames} / {TOTAL_GAMES} games · {tourneyPct}%</span>
          </div>
          {/* Row 2 (mobile): countdown left · date right */}
          <div className="dash-progress-row2">
            <span className="dash-progress-clock">{finalClock.days}d {pad(finalClock.hours)}h {pad(finalClock.mins)}m {pad(finalClock.secs)}s</span>
            <span className="dash-progress-date">{FINAL_DATE_LABEL} · {FINAL_TIME_LABEL}</span>
          </div>
        </div>
      </div>

      {/* ── 3-COLUMN BODY LAYOUT ── */}
      <div className="dash-layout">

        {/* ── LEFT: controls + leaderboard ── */}
        <div className="dash-col-left">

          {error && (
            <div className="dash-error">
              <span>⚠️ {error}</span>
              <button onClick={() => window.location.reload()}>Retry</button>
            </div>
          )}

          <div className="lb-global-title">Global Leaderboard</div>

          <div className="dash-section">
            {lbLoading ? (
              <div className="dash-skeletons">
                <div className="dash-skeleton" />
                <div className="dash-skeleton" />
                <div className="dash-skeleton" />
              </div>
            ) : lb.length === 0 ? (
              <div className="dash-empty">
                <p className="dash-empty-sub">No predictions yet — games start June 11</p>
              </div>
            ) : (
              <div className="lb-table">
                <div className="lb-col-header">
                  <span>#</span>
                  <span>Player</span>
                  <span>Group</span>
                  <span>🏆</span>
                  <span>Top Scorer</span>
                  <span>Pts</span>
                </div>
                {(showAllLb ? lb : lb.slice(0, 5)).map(row => {
                  const isMe     = row.user_id === user?.id
                  const flagCode = row.champion_team ? TEAM_CODE[row.champion_team] : null
                  const stats    = row.champion_team ? teamStats[row.champion_team] : null
                  const streak   = row.champion_team ? (streaks[row.champion_team] ?? 0) : 0
                  const gp       = Number(stats?.games_played ?? 0)
                  const winPct   = gp > 0 ? Math.round((Number(stats.wins) / gp) * 100) : null
                  const shotAcc  = Number(stats?.avg_shots_total) > 0
                    ? Math.round((Number(stats.avg_shots_on_target) / Number(stats.avg_shots_total)) * 100) : null
                  return (
                    <div key={`${row.user_id}-${row.group_id ?? 'nogroup'}`} className={`lb-row${isMe ? ' lb-row--me' : ''}`}>
                      <div className="lb-row-top">
                        <span className="lb-rank">#{row.rank}</span>
                        <span className="lb-name">{row.username}{isMe ? ' ★' : ''}</span>
                        <span className="lb-group-name">{row.group_name ?? '—'}</span>
                        {flagCode
                          ? <img className="lb-champ-flag" src={`https://flagcdn.com/w40/${flagCode}.png`}
                              alt={`${row.champion_team} flag`} title={row.champion_team} />
                          : <span className="lb-champ-empty">—</span>
                        }
                        <span className="lb-top-scorer" title={row.top_scorer_player ?? ''}>
                          {row.top_scorer_player ?? '—'}
                        </span>
                        <span className="lb-pts">{row.total_points ?? 0}<span className="lb-pts-label"> {(row.total_points ?? 0) === 1 ? 'pt' : 'pts'}</span></span>
                      </div>
                      {row.champion_team && stats && (
                        <div className="lb-team-row">
                          <span className="lb-team-name">{row.champion_team}</span>
                          <div className="lb-stats-pills">
                            <span className="lb-stat-pill">{stats.wins}W {stats.draws}D {stats.losses}L</span>
                            {stats.avg_goals_scored != null && <span className="lb-stat-pill">⚽ {stats.avg_goals_scored}/g</span>}
                            {winPct != null && <span className={`lb-stat-pill${winPct >= 60 ? ' lb-stat-green' : ''}`}>Win {winPct}%</span>}
                            {shotAcc != null && <span className="lb-stat-pill lb-stat-gold">🎯 {shotAcc}%</span>}
                            {streak > 1 && <span className="lb-stat-pill lb-stat-fire">🔥 {streak} streak</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {lb.length > 5 && (
                  <button className="lb-show-more" onClick={() => setShowAllLb(v => !v)}>
                    {showAllLb ? '▲ Show less' : `▼ Show all ${lb.length}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: next games ── */}
        <div className="dash-col-center">
          {nextGames.length > 0 ? (
            <div className="dash-section">
              <h2 className="dash-section-label">{fmtGameDate(nextDate)}</h2>
              <div className="today-games">
                {nextGames.map(game => {
                  const finished  = game.score_home !== null
                  const gamePreds = myPreds[game.id] ?? []
                  const homeCode  = TEAM_CODE[game.team_home]
                  const awayCode  = TEAM_CODE[game.team_away]
                  const venue     = getVenue(game.team_home, game.team_away)
                  return (
                    <div key={game.id} className="today-game-card">
                      {/* Main clickable area — navigates with first group */}
                      <div className="tg-card-main" role="button" tabIndex={0}
                        onClick={() => navigate(`/game/${game.id}${groups[0] ? `?group=${groups[0].id}` : ''}`)}
                        onKeyDown={e => e.key === 'Enter' && navigate(`/game/${game.id}${groups[0] ? `?group=${groups[0].id}` : ''}`)}>
                        {venue && (
                          <div className="tg-venue">
                            <span className="tg-venue-round">{venue.round}</span>
                            <span className="tg-venue-info">🏟 {venue.venue} · {venue.city} · {venue.capacity}</span>
                          </div>
                        )}
                        <div className="tg-teams">
                          <div className="tg-team">
                            {homeCode && <img className="tg-flag" src={`https://flagcdn.com/w40/${homeCode}.png`} alt={`${game.team_home} flag`} />}
                            <span className="tg-name">{game.team_home}</span>
                          </div>
                          {finished ? (
                            <div className="tg-score-col">
                              <div className="tg-score">{game.score_home}–{game.score_away}</div>
                              {game.went_to_extra_time && (
                                <div className="tg-score-extra">
                                  {game.et_score_home !== null && `E.T. ${game.et_score_home}–${game.et_score_away}`}
                                  {game.went_to_penalties && game.penalty_score_home !== null && `  Pens ${game.penalty_score_home}–${game.penalty_score_away}`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="tg-vs-col">
                              <div className="tg-kickoff">{fmtTime(game.kick_off_time)}</div>
                              <div className="tg-vs">vs</div>
                            </div>
                          )}
                          <div className="tg-team tg-team--right">
                            {awayCode && <img className="tg-flag" src={`https://flagcdn.com/w40/${awayCode}.png`} alt={`${game.team_away} flag`} />}
                            <span className="tg-name">{game.team_away}</span>
                          </div>
                        </div>
                      </div>
                      {/* Per-group prediction chips */}
                      {!finished && groups.length > 0 && (
                        <div className="tg-group-preds">
                          {groups.map(grp => {
                            const gp = gamePreds.find(p => p.groupId === grp.id)
                            return (
                              <button key={grp.id}
                                className={`tg-group-chip${gp ? ' tg-group-chip--predicted' : ''}`}
                                onClick={() => navigate(`/game/${game.id}?group=${grp.id}`)}>
                                <span className="tg-chip-group">{grp.name}</span>
                                {gp
                                  ? <span className="tg-chip-score">{gp.pred_home}–{gp.pred_away}</span>
                                  : <span className="tg-chip-cta">→</span>
                                }
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="dash-section">
              <h2 className="dash-section-label">📅 Next Games</h2>
              <div className="dash-empty"><p className="dash-empty-sub">Schedule loading…</p></div>
            </div>
          )}
        </div>

        {/* ── RIGHT: My Stats — always visible ── */}
        <aside className="dash-col-right" aria-label="My Stats">
          <h2 className="dash-section-label dash-stats-label-pad">My Stats</h2>

          {/* Loading skeleton */}
          {(loading || groupRanksLoading) && (
            <div className="dash-gc-skeleton">
              <div className="dash-skeleton dash-skeleton--tall" />
            </div>
          )}

          {/* Group cards — one per group */}
          {!loading && !groupRanksLoading && groupRanks.length > 0 && (
            <div className="dash-group-cards">
              {groupRanks.map(gr => {
                const cp = champPickMap[gr.groupId]
                const ts = topScorerMap[gr.groupId]
                const flagCode = cp?.team ? TEAM_CODE[cp.team] : null
                const lbRow = lb.find(r => r.user_id === user?.id && r.group_id === gr.groupId)
                const globalRankDisplay = lbRow?.rank ?? null
                return (
                <div key={gr.groupId} className="dash-group-card">
                  <div className="dash-gc-name">{gr.groupName}</div>
                  {gr.rpcError && (
                    <div className="dash-gc-rpc-error">⚠️ {gr.rpcError}</div>
                  )}
                  <div className="dash-gc-ranks">
                    <div className="dash-gc-rank-item">
                      <span className="dash-gc-rank-val">{gr.groupRank ? `#${gr.groupRank}` : '—'}</span>
                      <span className="dash-gc-rank-label">Group Rank</span>
                    </div>
                    <div className="dash-gc-divider" />
                    <div className="dash-gc-rank-item">
                      <span className="dash-gc-rank-val">{globalRankDisplay ? `#${globalRankDisplay}` : (lbLoading ? '…' : '—')}</span>
                      <span className="dash-gc-rank-label">Global Rank</span>
                    </div>
                  </div>
                  <div className="dash-gc-divider-h" />
                  <div className="dash-stats-rows">
                    <div className="dash-stats-row">
                      <span className="dash-stats-label">Champion</span>
                      <div className="dash-stats-pick">
                        {flagCode && <img src={`https://flagcdn.com/w40/${flagCode}.png`} alt={cp.team + ' flag'} className="dash-stats-flag" />}
                        <span className="dash-stats-val">{cp?.team ?? <span className="dash-stats-empty">—</span>}</span>
                      </div>
                    </div>
                    <div className="dash-stats-row">
                      <span className="dash-stats-label">Top Scorer</span>
                      <span className="dash-stats-val">{ts?.player_name ?? <span className="dash-stats-empty">—</span>}</span>
                    </div>
                  </div>
                  <div className="dash-gc-divider-h" />
                  <div className="dash-metrics">
                    {(() => { const s = predStats[gr.groupId]; return (<>
                    <div className="dash-metric">
                      <span className="dash-metric-val">{s?.exactPct ?? 0}%</span>
                      <span className="dash-metric-label">Exact</span>
                    </div>
                    <div className="dash-metric">
                      <span className="dash-metric-val">{s?.predictPct ?? 0}%</span>
                      <span className="dash-metric-label">Predicted</span>
                    </div>
                    <div className="dash-metric">
                      <span className="dash-metric-val">{s?.streak ?? 0}</span>
                      <span className="dash-metric-label">Streak {(s?.streak ?? 0) < 0 ? '❄️' : '🔥'}</span>
                    </div>
                    </>)})()}
                  </div>
                </div>
              )
              })}
            </div>
          )}

          {/* No groups — full template with placeholders */}
          {!loading && !groupRanksLoading && groupRanks.length === 0 && (
            <div className="dash-group-card">
              <div className="dash-gc-name dash-stats-empty">Group Name</div>
              <div className="dash-gc-ranks">
                <div className="dash-gc-rank-item">
                  <span className="dash-gc-rank-val dash-stats-empty">—</span>
                  <span className="dash-gc-rank-label">Group Rank</span>
                </div>
                <div className="dash-gc-divider" />
                <div className="dash-gc-rank-item">
                  <span className="dash-gc-rank-val dash-stats-empty">—</span>
                  <span className="dash-gc-rank-label">Global Rank</span>
                </div>
              </div>
              <div className="dash-gc-divider-h" />
              <div className="dash-stats-rows">
                <div className="dash-stats-row">
                  <span className="dash-stats-label">Champion</span>
                  <div className="dash-stats-pick">
                    <span className="dash-stats-val dash-stats-empty">—</span>
                  </div>
                </div>
                <div className="dash-stats-row">
                  <span className="dash-stats-label">Top Scorer</span>
                  <span className="dash-stats-val dash-stats-empty">—</span>
                </div>
              </div>
              <div className="dash-gc-divider-h" />
              <div className="dash-metrics">
                <div className="dash-metric">
                  <span className="dash-metric-val">{predStats?.predictPct ?? 0}%</span>
                  <span className="dash-metric-label">Predicted</span>
                </div>
                <div className="dash-metric">
                  <span className="dash-metric-val">{predStats?.exactPct ?? 0}%</span>
                  <span className="dash-metric-label">Exact</span>
                </div>
                <div className="dash-metric">
                  <span className="dash-metric-val">{predStats?.streak ?? 0}</span>
                  <span className="dash-metric-label">Streak {(predStats?.streak ?? 0) < 0 ? '❄️' : '🔥'}</span>
                </div>
              </div>
            </div>
          )}
        </aside>

      </div>{/* end dash-layout */}

      {/* ── Profile bottom sheet ── */}
      {profileOpen && <div className="prof-overlay" onClick={closeSheet} />}
      <div className={`prof-sheet${profileOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="Profile settings">
        <div className="prof-sheet-handle" />
        <div className="prof-sheet-header">
          <span className="prof-sheet-title">My Profile</span>
          <button className="prof-sheet-close" onClick={closeSheet} aria-label="Close">✕</button>
        </div>

        {/* Username rename */}
        <div className="prof-section">
          <div className="prof-section-title">Username</div>
          <label htmlFor="prof-username-input" className="sr-only">Username</label>
          <div className="prof-field">
            <input
              ref={sheetInputRef}
              id="prof-username-input"
              className="prof-input"
              value={renameVal}
              onChange={e => { setRenameVal(e.target.value); setRenameError(null) }}
              disabled={isLocked || renameLoading}
              maxLength={20}
              placeholder="Username"
            />
            {!isLocked && (
              <button
                className="btn btn-gold prof-save-btn"
                onClick={saveUsername}
                disabled={renameLoading || renameVal.trim() === username}
              >
                {renameLoading ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {renameError && <div className="prof-error">{renameError}</div>}
          <div className="prof-lock-note">
            {isLocked ? '🔒 Locked · Jun 11, 2026 · 22:00 IDT' : '⏰ Locks Jun 11, 2026 · 22:00 IDT'}
          </div>
        </div>

        <div className="prof-divider" />

        {/* Sign out */}
        <div className="prof-section">
          <button className="btn btn-outline btn-full" onClick={signOut}>Sign out</button>
        </div>

        <div className="prof-divider" />

        {/* Delete account */}
        <div className="prof-section">
          <div className="prof-section-title prof-danger-title">Danger Zone</div>
          {groups.length > 0 ? (
            <div className="prof-lock-note">Not available — you're a member of a group</div>
          ) : isLocked ? (
            <div className="prof-lock-note">🔒 Deletion locked after Jun 11, 2026</div>
          ) : (
            <>
              {deleteConfirm && (
                <div className="prof-delete-confirm">This is permanent and cannot be undone.</div>
              )}
              <button
                className={`prof-delete-btn${deleteConfirm ? ' prof-delete-btn--confirm' : ''}`}
                onClick={deleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : deleteConfirm ? 'Confirm — Delete My Account' : 'Delete account'}
              </button>
              {deleteConfirm && (
                <button className="prof-cancel-link" onClick={() => setDeleteConfirm(false)}>Cancel</button>
              )}
            </>
          )}
        </div>
      </div>

    </Layout>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { logEvent } from '../lib/analytics.ts'
import Layout from '../components/Layout.jsx'

const TRUNCATE_LIMIT = 300
const REACTIONS      = ['🔥', '😂', '😭', '👑']

function fmtSummaryDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtGeneratedAt(iso) {
  const d = new Date(iso)
  return (
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' · ' +
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  )
}

function loadStoredReactions() {
  const rx = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('af_rx_')) rx[key.slice(6)] = localStorage.getItem(key)
  }
  return rx
}

function loadStoredLastSeen() {
  const ls = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('af_seen_')) ls[key.slice(8)] = localStorage.getItem(key)
  }
  return ls
}

export default function AiFeed() {
  const { user }      = useAuth()
  const navigate      = useNavigate()
  const { showToast } = useToast()
  useEffect(() => { if (user?.id) logEvent(supabase, user.id, 'page_view', 'ai_feed') }, [])

  const [groups,         setGroups]         = useState(null)   // null = loading
  const [selectedId,     setSelectedId]     = useState(null)
  const [summaries,      setSummaries]      = useState(null)   // null = loading
  const [groupsError,    setGroupsError]    = useState(null)
  const [summariesError, setSummariesError] = useState(null)
  const [expanded,       setExpanded]       = useState({})     // { [id]: bool }
  const [reactions,      setReactions]      = useState(() => loadStoredReactions())
  const [lastSeen,       setLastSeen]       = useState(() => loadStoredLastSeen())
  const [nextGame,       setNextGame]       = useState(undefined) // undefined=loading, null=none
  const [dailyOpen,      setDailyOpen]      = useState({})     // { [summaryId]: bool }
  const [dailyData,      setDailyData]      = useState({})     // { [summaryId]: { loading, rows, error } }
  const [totalOpen,      setTotalOpen]      = useState({})     // { [summaryId]: bool }

  useEffect(() => {
    loadGroups()
    loadNextGame()
  }, [user])

  // When selected group changes: load summaries + mark previous as seen on cleanup
  useEffect(() => {
    if (!selectedId) return
    loadSummaries(selectedId)
    return () => {
      const ts = new Date().toISOString()
      localStorage.setItem('af_seen_' + selectedId, ts)
      setLastSeen(prev => ({ ...prev, [selectedId]: ts }))
    }
  }, [selectedId])

  async function loadGroups() {
    setGroupsError(null)
    const { data, error } = await supabase
      .from('groups')
      .select('id, name')
      .order('created_at')
    if (error) { setGroupsError(error.message); setGroups([]); return }
    const list = data || []
    setGroups(list)
    const saved   = sessionStorage.getItem('aifeed_group')
    const initial = list.find(g => g.id === saved) ? saved : list[0]?.id ?? null
    setSelectedId(initial)
  }

  async function loadSummaries(groupId) {
    setSummaries(null)
    setSummariesError(null)
    const { data, error } = await supabase
      .from('ai_summaries')
      .select('id, date, content, games_count, generated_at, input_json, display_data')
      .eq('group_id', groupId)
      .order('date', { ascending: false })
      .limit(30)
    if (error) { setSummariesError(error.message); setSummaries([]); return }
    setSummaries(data || [])
  }

  async function loadNextGame() {
    const { data } = await supabase
      .from('games')
      .select('kick_off_time')
      .is('score_home', null)
      .gt('kick_off_time', new Date().toISOString())
      .order('kick_off_time')
      .limit(1)
    setNextGame(data?.[0] ?? null)
  }

  function selectGroup(id) {
    sessionStorage.setItem('aifeed_group', id)
    setSelectedId(id)
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function toggleDaily(summaryId, groupId, date) {
    const isOpen = dailyOpen[summaryId]
    setDailyOpen(prev => ({ ...prev, [summaryId]: !isOpen }))
    if (!isOpen && !dailyData[summaryId]) {
      await loadDailyStandings(summaryId, groupId, date)
    }
  }

  async function loadDailyStandings(summaryId, groupId, date) {
    setDailyData(prev => ({ ...prev, [summaryId]: { loading: true, rows: [], error: null } }))
    const nextDate = new Date(date + 'T00:00:00Z')
    nextDate.setDate(nextDate.getDate() + 1)
    const nextDateStr = nextDate.toISOString().slice(0, 10)

    const [{ data: members, error: mErr }, { data: games, error: gErr }] = await Promise.all([
      supabase.from('group_members').select('user_id, profiles(username)').eq('group_id', groupId),
      supabase.from('games').select('id')
        .gte('kick_off_time', `${date}T00:00:00Z`)
        .lt('kick_off_time', `${nextDateStr}T00:00:00Z`),
    ])

    if (mErr) {
      setDailyData(prev => ({ ...prev, [summaryId]: { loading: false, rows: [], error: mErr.message } }))
      return
    }

    const allMembers = (members || []).map(m => ({
      uid: m.user_id,
      username: m.profiles?.username ?? '?',
    }))

    if (gErr || !games?.length) {
      const rows = allMembers.map(m => ({ username: m.username, pts: 0 }))
      setDailyData(prev => ({ ...prev, [summaryId]: { loading: false, rows, error: null } }))
      return
    }

    const { data: preds, error: pErr } = await supabase
      .from('predictions')
      .select('user_id, points_earned')
      .eq('group_id', groupId)
      .in('game_id', games.map(g => g.id))

    if (pErr) {
      setDailyData(prev => ({ ...prev, [summaryId]: { loading: false, rows: [], error: pErr.message } }))
      return
    }

    const ptsByUser = {}
    for (const p of preds || []) {
      ptsByUser[p.user_id] = (ptsByUser[p.user_id] ?? 0) + (p.points_earned ?? 0)
    }

    const rows = allMembers
      .map(m => ({ username: m.username, pts: ptsByUser[m.uid] ?? 0 }))
      .sort((a, b) => b.pts - a.pts || a.username.localeCompare(b.username))
    setDailyData(prev => ({ ...prev, [summaryId]: { loading: false, rows, error: null } }))
  }

  function toggleTotal(summaryId) {
    setTotalOpen(prev => ({ ...prev, [summaryId]: !prev[summaryId] }))
  }

  function setReaction(summaryId, emoji) {
    const next = reactions[summaryId] === emoji ? null : emoji
    setReactions(prev => ({ ...prev, [summaryId]: next }))
    if (next) localStorage.setItem('af_rx_' + summaryId, next)
    else localStorage.removeItem('af_rx_' + summaryId)
  }

  function shareCard(summary, groupName) {
    const text = `${groupName} · ${fmtSummaryDate(summary.date)}\n\n${summary.content}\n\n— WC2026`
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
      return
    }
    // desktop — clipboard
    try {
      navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'))
    } catch (_) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        showToast('Copied to clipboard!')
      } catch (_2) {
        showToast('Could not copy', 'error')
      }
    }
  }

  function isNew(summary) {
    const seen = lastSeen[selectedId]
    if (!seen) return false // first visit — don't mark everything as new
    return new Date(summary.generated_at) > new Date(seen)
  }

  // ── Next game hint text ──────────────────────────────────
  let nextHint = null
  if (nextGame) {
    const d       = new Date(nextGame.kick_off_time)
    const isToday = d.toDateString() === new Date().toDateString()
    nextHint = isToday
      ? '⚽ Games on tonight — summary drops after they finish'
      : `📅 Next games: ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
  }

  // ── Loading groups ───────────────────────────────────────
  if (groups === null) {
    return (
      <Layout title="AI Feed">
        <SkeletonCards />
      </Layout>
    )
  }

  // ── Groups error ─────────────────────────────────────────
  if (groupsError) {
    return (
      <Layout title="AI Feed">
        <div className="af-empty">
          <div className="af-empty-icon">⚠️</div>
          <div className="af-empty-text">Failed to load groups.</div>
          <button className="btn btn-outline" style={{ marginTop: '1rem' }} onClick={loadGroups}>Retry</button>
        </div>
      </Layout>
    )
  }

  // ── No groups ─────────────────────────────────────────────
  if (groups.length === 0) {
    return (
      <Layout title="AI Feed">
        <div className="af-empty">
          <div className="af-empty-icon">🤖</div>
          <div className="af-empty-text">AI summaries are generated nightly per group.<br />Join or create a group to get started.</div>
          <button className="btn btn-gold" style={{ marginTop: '1.25rem' }} onClick={() => navigate('/groups')}>Go to Groups</button>
        </div>
      </Layout>
    )
  }

  const selectedGroup = groups.find(g => g.id === selectedId)
  const useTabs       = groups.length <= 4

  return (
    <Layout title="AI Feed">
      <div className="af-page">

        {/* ── Group selector ─────────────────────────────── */}
        {useTabs ? (
          <div className="af-tabs" role="tablist">
            {groups.map(g => (
              <button
                key={g.id}
                role="tab"
                aria-selected={g.id === selectedId}
                className={`af-tab${g.id === selectedId ? ' active' : ''}`}
                onClick={() => selectGroup(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="af-selector-row">
            <select
              className="group-selector"
              value={selectedId ?? ''}
              onChange={e => selectGroup(e.target.value)}
              aria-label="Select group"
            >
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Next game hint — always at top ──────────────── */}
        {nextHint && <div className="af-next-hint">{nextHint}</div>}

        {/* ── Loading summaries ───────────────────────────── */}
        {summaries === null && <SkeletonCards />}

        {/* ── Error ───────────────────────────────────────── */}
        {summaries !== null && summariesError && (
          <div className="af-empty">
            <div className="af-empty-icon">⚠️</div>
            <div className="af-empty-text">Failed to load summaries.</div>
            <button className="btn btn-outline" style={{ marginTop: '1rem' }} onClick={() => loadSummaries(selectedId)}>Retry</button>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────── */}
        {summaries !== null && !summariesError && summaries.length === 0 && (
          <div className="af-empty">
            <div className="af-empty-icon">🤖</div>
            <div className="af-empty-text">No summaries yet.<br />Summaries are generated nightly after games finish.</div>
          </div>
        )}

        {/* ── Summary cards ───────────────────────────────── */}
        {summaries !== null && !summariesError && summaries.length > 0 && (
          <div className="af-list">
            {summaries.map(s => {
              const isLong     = s.content.length > TRUNCATE_LIMIT
              const isExpanded = expanded[s.id]
              const displayText = isLong && !isExpanded
                ? s.content.slice(0, TRUNCATE_LIMIT) + '…'
                : s.content
              const cardIsNew  = isNew(s)
              const myReaction = reactions[s.id] ?? null

              return (
                <div key={s.id} className="af-card">

                  {/* Sticky date header */}
                  <div className="af-card-header">
                    <div className="af-card-date">
                      {fmtSummaryDate(s.date)}
                      {cardIsNew && <span className="af-new-badge">NEW</span>}
                    </div>
                    {s.games_count > 0 && (
                      <div className="af-card-games">{s.games_count} game{s.games_count !== 1 ? 's' : ''}</div>
                    )}
                  </div>

                  {/* Content with truncation */}
                  <div className="af-card-content">{displayText}</div>
                  {isLong && (
                    <button className="af-read-more" onClick={() => toggleExpand(s.id)}>
                      {isExpanded ? 'Show less ↑' : 'Read more ↓'}
                    </button>
                  )}

                  {/* Daily + Total standings toggles */}
                  <div className="af-standings-row">
                    <button
                      className="af-daily-toggle"
                      onClick={() => toggleDaily(s.id, selectedId, s.date)}
                    >
                      {dailyOpen[s.id] ? '▲ Hide day' : '📊 Day standings'}
                    </button>
                    <button
                      className="af-daily-toggle"
                      onClick={() => toggleTotal(s.id)}
                    >
                      {totalOpen[s.id] ? '▲ Hide total' : '🏆 Total standings'}
                    </button>
                  </div>

                  {dailyOpen[s.id] && (
                    <div className="af-daily-table">
                      {dailyData[s.id]?.loading && (
                        <div className="af-daily-loading">Loading…</div>
                      )}
                      {!dailyData[s.id]?.loading && dailyData[s.id]?.rows?.length > 0 && (
                        <table>
                          <thead>
                            <tr><th>#</th><th>Player</th><th>Pts today</th></tr>
                          </thead>
                          <tbody>
                            {dailyData[s.id].rows.map((row, i) => (
                              <tr key={row.username} className={i === 0 ? 'af-daily-top' : ''}>
                                <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                                <td>{row.username}</td>
                                <td className="af-daily-pts">{row.pts}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {!dailyData[s.id]?.loading && !dailyData[s.id]?.rows?.length && (
                        <div className="af-daily-loading">No data yet</div>
                      )}
                    </div>
                  )}

                  {totalOpen[s.id] && (() => {
                    const lb = s.input_json?.leaderboard ?? []
                    const globalRanks = s.display_data?.global_ranks ?? null
                    return (
                      <div className="af-daily-table">
                        {lb.length === 0 ? (
                          <div className="af-daily-loading">No data for this summary</div>
                        ) : (
                          <table>
                            <thead>
                              <tr>
                                <th>Grp</th>
                                <th>Player</th>
                                <th>Total pts</th>
                                {globalRanks && <th>Global</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {lb.map((row, i) => (
                                <tr key={row.user} className={i === 0 ? 'af-daily-top' : ''}>
                                  <td>{row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}</td>
                                  <td>{row.user}</td>
                                  <td className="af-daily-pts">{row.total_pts}</td>
                                  {globalRanks && (
                                    <td style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>
                                      {globalRanks[row.user] != null ? `#${globalRanks[row.user]}` : '—'}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })()}

                  {/* Footer: timestamp + share + reactions */}
                  <div className="af-card-footer">
                    <div className="af-footer-left">
                      <span>Generated at {fmtGeneratedAt(s.generated_at)}</span>
                      <button
                        className="af-share-btn"
                        onClick={() => shareCard(s, selectedGroup?.name ?? 'Group')}
                        aria-label="Share this summary"
                      >
                        ↗ Share
                      </button>
                    </div>
                    <div className="af-reactions" role="group" aria-label="React to summary">
                      {REACTIONS.map(emoji => (
                        <button
                          key={emoji}
                          className={`af-reaction-btn${myReaction === emoji ? ' selected' : ''}`}
                          onClick={() => setReaction(s.id, emoji)}
                          aria-label={`React ${emoji}`}
                          aria-pressed={myReaction === emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              )
            })}
          </div>
        )}

      </div>
    </Layout>
  )
}

function SkeletonCards() {
  return (
    <div className="af-list">
      {[1, 2, 3].map(i => (
        <div key={i} className="af-card" style={{ minHeight: '7rem' }}>
          <div className="af-skeleton" style={{ height: '.7rem', width: '45%', marginBottom: '1rem' }} />
          <div className="af-skeleton" style={{ height: '.6rem', width: '100%', marginBottom: '.45rem' }} />
          <div className="af-skeleton" style={{ height: '.6rem', width: '88%', marginBottom: '.45rem' }} />
          <div className="af-skeleton" style={{ height: '.6rem', width: '72%' }} />
        </div>
      ))}
    </div>
  )
}

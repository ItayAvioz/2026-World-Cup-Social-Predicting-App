import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDataCache } from '../context/DataCacheContext.jsx'
import { logEvent } from '../lib/analytics.ts'
import Layout from '../components/Layout.jsx'

const TOURNAMENT_START = '2026-06-11'
const OPTION_LABELS    = { a: 'A', b: 'B', c: 'C', d: 'D' }
const OPTIONS          = ['a', 'b', 'c', 'd']

function todayUTC() { return new Date().toISOString().slice(0, 10) }

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function pct(correct, total) {
  if (!total) return '—'
  return Math.round((correct / total) * 100) + '%'
}

// Section label matching .dash-section-label style
function SectionLabel({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '.5rem',
      fontFamily: 'Inter, sans-serif', fontSize: '.7rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--accent)',
      marginBottom: '.9rem',
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(245,197,24,.2) 0%, transparent 100%)' }} />
    </div>
  )
}

// Circular SVG countdown timer
function CircleTimer({ timeLeft, total = 40 }) {
  const r    = 34
  const circ = 2 * Math.PI * r
  const hot  = timeLeft <= 10
  const col  = hot ? 'var(--red)' : 'var(--accent)'
  return (
    <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
      <svg width="88" height="88" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="44" cy="44" r={r} fill="none"
          stroke={col} strokeWidth="5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - timeLeft / total)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke .3s' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: col, lineHeight: 1 }}>
          {timeLeft}
        </span>
        <span style={{ fontSize: '.58rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>sec</span>
      </div>
    </div>
  )
}

// Live countdown to next question
function NextQuestionCard({ availableUntil }) {
  const target = new Date(availableUntil).getTime()
  const [diff, setDiff] = useState(Math.max(0, target - Date.now()))

  useEffect(() => {
    const id = setInterval(() => setDiff(Math.max(0, target - Date.now())), 1000)
    return () => clearInterval(id)
  }, [target])

  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  const pad = n => String(n).padStart(2, '0')
  const done = diff === 0

  // Format next date label
  const nextDate = new Date(availableUntil)
  const isToday = nextDate.toDateString() === new Date().toDateString()
  const isTomorrow = nextDate.toDateString() === new Date(Date.now() + 86400000).toDateString()
  const dateLabel = isToday ? 'today' : isTomorrow ? 'tomorrow' : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div style={{
      marginTop: '1rem',
      background: 'var(--bg3)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '1.1rem 1.2rem',
      display: 'flex', alignItems: 'center', gap: '1rem',
    }}>
      {/* Clock icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: 'rgba(245,197,24,.1)', border: '1px solid rgba(245,197,24,.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '.25rem' }}>
          Next question
        </div>
        {done ? (
          <div style={{ fontSize: '.9rem', fontWeight: 600, color: 'var(--accent)' }}>
            Available now — refresh!
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '.4rem' }}>
            <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>
              {pad(h)}:{pad(m)}:{pad(s)}
            </span>
            <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
              · {dateLabel} at {new Date(availableUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Trivia() {
  const { user } = useAuth()
  const cache    = useDataCache()

  const [pageState,  setPageState]  = useState('loading')
  const [question,   setQuestion]   = useState(null)
  const [result,     setResult]     = useState(null)
  const [timeLeft,   setTimeLeft]   = useState(40)
  const [submitting, setSubmitting] = useState(false)
  const [stats,      setStats]      = useState({ total_pts: 0, correct: 0, total: 0 })

  const timerRef  = useRef(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    if (user?.id) { logEvent(supabase, user.id, 'page_view', 'trivia'); loadPage() }
    return () => { cancelRef.current = true }
  }, [user?.id])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  async function loadPage() {
    const today = todayUTC()
    if (cancelRef.current) return
    const isTestMode = localStorage.getItem('wc2026_test_mode') === '1'
    if (today < TOURNAMENT_START && !isTestMode) { setPageState('pre_tournament'); return }

    const nowISO = new Date().toISOString()
    const [{ data: q }, { data: answers }] = await Promise.all([
      supabase
        .from('trivia_questions')
        .select('id, question_date, available_from, available_until, question_text, option_a, option_b, option_c, option_d')
        .lte('available_from', nowISO)
        .gt('available_until', nowISO)
        .order('available_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('trivia_answers').select('points_earned, is_correct').eq('user_id', user.id),
    ])

    if (cancelRef.current) return
    setStats({
      total_pts: answers?.reduce((s, a) => s + a.points_earned, 0) ?? 0,
      correct:   answers?.filter(a => a.is_correct).length ?? 0,
      total:     answers?.length ?? 0,
    })

    if (!q) { setPageState('no_question'); return }
    setQuestion(q)

    const { data: existing } = await supabase
      .from('trivia_answers').select('selected_option, is_correct, points_earned')
      .eq('question_id', q.id).eq('user_id', user.id).maybeSingle()

    if (cancelRef.current) return
    if (existing) {
      let correctOption = localStorage.getItem(`trivia_correct_${q.id}`)
      let explanation   = localStorage.getItem(`trivia_expl_${q.id}`)
      // Cross-device fallback: this device never saw the reveal — fetch via RPC.
      if (!correctOption) {
        const { data: secret } = await supabase.rpc('get_my_trivia_result', { p_question_id: q.id })
        if (secret) {
          correctOption = secret.correct_option ?? null
          explanation   = secret.explanation ?? null
          if (correctOption) localStorage.setItem(`trivia_correct_${q.id}`, correctOption)
          if (explanation)   localStorage.setItem(`trivia_expl_${q.id}`, explanation)
        }
      }
      if (cancelRef.current) return
      setResult({
        is_correct:      existing.is_correct,
        correct_option:  correctOption || null,
        explanation:     explanation || null,
        points_earned:   existing.points_earned,
        selected_option: existing.selected_option,
      })
      setPageState('result')
      return
    }

    const now = Date.now()
    if (now < new Date(q.available_from).getTime()) { setPageState('not_yet'); return }
    if (now > new Date(q.available_until).getTime()) { setPageState('no_question'); return }
    setPageState('idle')
  }

  function openQuestion() {
    setTimeLeft(40)
    setPageState('active')
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current); timerRef.current = null
          handleSubmit('timeout'); return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSubmit(selected) {
    if (submitting || !question) return
    setSubmitting(true)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }

    const { data, error } = await supabase.rpc('submit_trivia_answer', {
      p_question_id: question.id, p_selected_option: selected,
    })
    if (error) { setSubmitting(false); return }

    localStorage.setItem(`trivia_correct_${question.id}`, data.correct_option)
    if (data.explanation) localStorage.setItem(`trivia_expl_${question.id}`, data.explanation)

    setResult({ ...data, selected_option: selected })
    setPageState('result')
    setSubmitting(false)
    setStats(prev => ({
      total_pts: prev.total_pts + data.points_earned,
      correct:   prev.correct + (data.is_correct ? 1 : 0),
      total:     prev.total + 1,
    }))
    cache.invalidate(`dashboard:${user.id}`)
    logEvent(supabase, user.id, 'trivia_answer', data.is_correct ? 'correct' : 'wrong')
  }

  // ── Option button ─────────────────────────────────────────────
  function OptionBtn({ opt, correct_option, selected_option, onSelect, disabled }) {
    const isCorrect  = opt === correct_option
    const isSelected = opt === selected_option
    const isTimeout  = selected_option === 'timeout'
    const showResult = !!correct_option

    let bg     = 'var(--bg2)'
    let border = 'var(--border)'
    let color  = 'var(--text)'
    let badgeBg  = 'rgba(245,197,24,.1)'
    let badgeCol = 'var(--accent)'

    if (showResult) {
      if (isCorrect)                         { bg = 'rgba(46,204,113,.1)'; border = '#2ecc71'; color = '#2ecc71'; badgeBg = 'rgba(46,204,113,.2)'; badgeCol = '#2ecc71' }
      else if (isSelected && !isTimeout)     { bg = 'rgba(231,76,60,.1)';  border = '#e74c3c'; color = '#e74c3c'; badgeBg = 'rgba(231,76,60,.2)'; badgeCol = '#e74c3c' }
      else                                   { color = 'var(--muted)'; badgeCol = 'var(--muted)'; badgeBg = 'var(--border)' }
    }

    return (
      <button
        disabled={disabled}
        onClick={() => onSelect?.(opt)}
        style={{
          display: 'flex', alignItems: 'center', gap: '.8rem',
          width: '100%', textAlign: 'left',
          background: bg, border: `1px solid ${border}`,
          borderRadius: 10, padding: '.8rem .95rem',
          color, cursor: disabled ? 'default' : 'pointer',
          fontSize: '.9rem', fontWeight: 500,
          transition: 'border-color .15s, background .15s',
        }}
      >
        <span style={{
          flexShrink: 0, width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 7, background: badgeBg,
          fontSize: '.75rem', fontWeight: 800, color: badgeCol,
          fontFamily: 'Oswald, sans-serif',
        }}>
          {OPTION_LABELS[opt]}
        </span>
        <span style={{ flex: 1 }}>{question?.[`option_${opt}`] || ''}</span>
        {isCorrect   && <span style={{ fontSize: '.9rem', color: '#2ecc71' }}>✓</span>}
        {isSelected && !isCorrect && !isTimeout && <span style={{ fontSize: '.9rem', color: '#e74c3c' }}>✗</span>}
      </button>
    )
  }

  // ── Stats bar ─────────────────────────────────────────────────
  function StatsBar() {
    return (
      <div style={{ marginBottom: '1.25rem' }}>
        <SectionLabel>My Stats</SectionLabel>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
          gap: 1, background: 'var(--border)',
          border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
        }}>
          {[
            { label: 'Trivia pts', value: stats.total_pts, col: 'var(--accent)' },
            { label: 'Correct',    value: `${stats.correct}/${stats.total}`, col: 'var(--accent)' },
            { label: 'Accuracy',   value: pct(stats.correct, stats.total), col: 'var(--accent)' },
          ].map(({ label, value, col }) => (
            <div key={label} style={{ background: 'var(--bg2)', padding: '.9rem .4rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: '1.45rem', fontWeight: 700, color: col }}>
                {value}
              </div>
              <div style={{ fontSize: '.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '.2rem' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  const card = {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '1.4rem',
  }

  if (pageState === 'loading') {
    return (
      <Layout title="Trivia" showBack={false}>
        <div className="af-empty"><div className="af-empty-icon">⚽</div><div className="af-empty-text">Loading…</div></div>
      </Layout>
    )
  }

  // ── PRE-TOURNAMENT ───────────────────────────────────────────
  if (pageState === 'pre_tournament') {
    return (
      <Layout title="Trivia" showBack={false}>
        <div style={{ padding: '1.2rem 1.2rem 2rem' }}>

          {/* Main card */}
          <div style={{ ...card, marginBottom: '1rem', textAlign: 'center', padding: '2rem 1.5rem' }}>
            {/* Badge inside card */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.4rem' }}>
              <span className="hero-badge">⚽ Coming June 11</span>
            </div>

            {/* SVG question mark icon */}
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'rgba(245,197,24,.12)', border: '1px solid rgba(245,197,24,.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.1rem',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="3"/>
              </svg>
            </div>

            <div style={{
              fontFamily: 'Oswald, sans-serif', fontSize: '1.6rem', fontWeight: 700,
              color: 'var(--accent)', letterSpacing: '2px', marginBottom: '.6rem',
            }}>
              Daily Trivia
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', lineHeight: 1.7, margin: 0 }}>
              Starting <strong style={{ color: 'var(--text)' }}>June 11</strong>, a new football trivia question
              will appear here every day during the tournament.
            </p>
          </div>

          {/* Rules */}
          <SectionLabel>How it works</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {[
              {
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
                label: '40 seconds to answer', sub: 'Timer starts when you open the question',
              },
              {
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
                label: 'Correct answer = 1 point', sub: 'Wrong answer or time out = 0 points',
              },
              {
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
                label: 'Available daily from 22:00', sub: 'New question every day, 24h window',
              },
              {
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
                label: 'Counts toward the final leaderboard', sub: 'Points added to group & global boards when the tournament ends',
              },
            ].map(({ icon, label, sub }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'flex-start', gap: '.9rem',
                background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '.85rem 1rem',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: 'rgba(245,197,24,.1)', border: '1px solid rgba(245,197,24,.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{icon}</div>
                <div>
                  <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>{label}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.2rem', lineHeight: 1.4 }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  // ── TOURNAMENT PAGES ─────────────────────────────────────────
  return (
    <Layout title="Trivia" showBack={false}>
      <div style={{ padding: '1.2rem 1.2rem 2rem' }}>
        <StatsBar />

        {/* NO QUESTION */}
        {pageState === 'no_question' && (
          <div className="af-empty" style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div className="af-empty-icon">📅</div>
            <div className="af-empty-text">No question today<br />Come back at 22:00!</div>
          </div>
        )}

        {/* NOT YET */}
        {pageState === 'not_yet' && question && (
          <div className="af-empty" style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div className="af-empty-icon">🔒</div>
            <div className="af-empty-text">
              Today's question unlocks at{' '}
              <strong style={{ color: 'var(--accent)' }}>{fmtTime(question.available_from)}</strong>
            </div>
          </div>
        )}

        {/* IDLE */}
        {pageState === 'idle' && (
          <div style={{ ...card, textAlign: 'center', padding: '2rem 1.5rem' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(245,197,24,.1)', border: '1px solid rgba(245,197,24,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.6rem', margin: '0 auto .9rem',
            }}>⚽</div>
            <div style={{
              fontFamily: 'Oswald, sans-serif', fontSize: '1.2rem',
              color: 'var(--text)', marginBottom: '.4rem', letterSpacing: '.5px',
            }}>
              Today's Question is Ready
            </div>
            <div style={{ fontSize: '.83rem', color: 'var(--muted)', marginBottom: '1.6rem' }}>
              You have <strong style={{ color: 'var(--accent)' }}>40 seconds</strong> once you open it
            </div>
            <button className="btn btn-gold" style={{ width: '100%', borderRadius: 10, padding: '1rem', fontSize: '.95rem' }} onClick={openQuestion}>
              Open Today's Question
            </button>
          </div>
        )}

        {/* ACTIVE */}
        {pageState === 'active' && (
          <div style={card}>
            <SectionLabel>Question</SectionLabel>

            {/* Timer + question text */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <CircleTimer timeLeft={timeLeft} />
              <p style={{ flex: 1, margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.6 }}>
                {question?.question_text}
              </p>
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: '1.1rem' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${(timeLeft / 40) * 100}%`,
                background: timeLeft <= 10 ? 'var(--red)' : 'var(--accent)',
                transition: 'width 1s linear, background .3s',
              }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {OPTIONS.map(opt => (
                <OptionBtn key={opt} opt={opt} correct_option={null} selected_option={null} disabled={submitting} onSelect={handleSubmit} />
              ))}
            </div>
          </div>
        )}

        {/* RESULT */}
        {pageState === 'result' && result && question && (
          <div style={card}>
            {/* Result banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '.9rem',
              borderRadius: 10, padding: '1rem 1.1rem', marginBottom: '1.1rem',
              background: result.is_correct ? 'rgba(46,204,113,.1)' : 'rgba(231,76,60,.1)',
              border: `1px solid ${result.is_correct ? '#2ecc71' : '#e74c3c'}`,
            }}>
              <span style={{ fontSize: '1.8rem' }}>
                {result.is_correct ? '😄' : result.selected_option === 'timeout' ? '⏰' : '😔'}
              </span>
              <div>
                <div style={{
                  fontFamily: 'Oswald, sans-serif', fontSize: '1.1rem', fontWeight: 700,
                  color: result.is_correct ? '#2ecc71' : '#e74c3c', letterSpacing: '.5px',
                }}>
                  {result.is_correct
                    ? `Goallllll! ${result.points_earned} pt`
                    : result.selected_option === 'timeout' ? "Time's up — 0 pts" : 'Missed!'}
                </div>
                {!result.is_correct && result.correct_option && (
                  <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                    Correct answer: <strong style={{ color: '#2ecc71' }}>{OPTION_LABELS[result.correct_option]}</strong>
                  </div>
                )}
              </div>
            </div>

            <SectionLabel>Question</SectionLabel>
            <p style={{ fontSize: '.95rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.6, marginBottom: '1rem' }}>
              {question.question_text}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: result.explanation ? '1rem' : 0 }}>
              {OPTIONS.map(opt => (
                <OptionBtn key={opt} opt={opt} correct_option={result.correct_option} selected_option={result.selected_option} disabled onSelect={null} />
              ))}
            </div>

            {result.explanation && (
              <div style={{
                display: 'flex', gap: '.75rem', alignItems: 'flex-start',
                background: 'rgba(245,197,24,.06)', border: '1px solid rgba(245,197,24,.18)',
                borderRadius: 9, padding: '.85rem 1rem', marginTop: '.5rem',
              }}>
                <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '.05rem' }}>💡</span>
                <span style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.65 }}>{result.explanation}</span>
              </div>
            )}
          </div>
        )}

        {/* NEXT QUESTION CARD — shown after answering */}
        {pageState === 'result' && question && (
          <NextQuestionCard availableUntil={question.available_until} />
        )}
      </div>
    </Layout>
  )
}

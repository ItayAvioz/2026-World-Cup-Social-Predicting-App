// AskBot — in-app AI assistant (DEV ONLY)
// A small floating chat widget that talks to the `ask` Edge Function.
// Dev-guarded: renders nothing on the prod host.
//
// The EF does all the work (classify → tools/RAG/crew → answer); this is just
// the chat surface: message bubbles, input, a tiny meta tag per bot reply.

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const IS_PROD =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'pickyguessers.com' || window.location.hostname === 'www.pickyguessers.com')

const SUGGESTIONS = [
  'What is the coming game?',
  'Who is the top scorer?',
  'How am I doing?',
  'How many points for an exact score?',
]

export default function AskBot() {
  if (IS_PROD) return null

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState([
    { role: 'bot', text: "Hi! Ask me about the tournament, stats, your groups, or how the app works. ⚽" },
  ])
  const [loading, setLoading] = useState(false)
  const bodyRef = useRef(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [msgs, loading, open])

  async function ask(q) {
    const question = (q ?? input).trim()
    if (!question || loading) return
    setInput('')
    // P3/v27: send the last 3 user turns + the last bot ANSWER + the last resolved spec —
    // the EF borrows entities structurally ("how many goals does HE have?" works).
    // v30: take the LITERAL last bot message — filtering on `m.spec` presence meant a bot
    // reply that happened to arrive without a resolved spec got silently skipped, and the
    // NEXT question would echo a STALE answer from an earlier turn as last_answer/prev_spec
    // instead of the true most recent one. `prev_spec` below already no-ops when spec is
    // missing, so dropping the filter only ever makes last_answer more accurate, never less.
    const history = msgs.filter((m) => m.role === 'user').slice(-3).map((m) => m.text)
    const lastBot = [...msgs].reverse().find((m) => m.role === 'bot')
    const body = { question, history }
    if (lastBot?.text) body.last_answer = lastBot.text
    if (lastBot?.spec) body.prev_spec = { teams: lastBot.spec.teams ?? [], dim: lastBot.spec.dim ?? null }
    setMsgs((m) => [...m, { role: 'user', text: question }])
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('ask', { body })
      if (error) throw error
      const meta = [
        data?.spec?.intent,
        data?.llm_used ? 'llm' : 'instant',
        data?.retrieved ? `${data.retrieved} cards` : null,
      ].filter(Boolean).join(' · ')
      setMsgs((m) => [...m, { role: 'bot', text: data?.answer ?? 'No answer.', meta, spec: data?.spec }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: 'Something went wrong: ' + (e?.message ?? e), meta: 'error' }])
    } finally {
      setLoading(false)
    }
  }

  const S = {
    launch: { position: 'fixed', right: 16, bottom: 140, zIndex: 9999, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 16px', fontWeight: 700, boxShadow: '0 2px 12px rgba(0,0,0,.45)', cursor: 'pointer' },
    panel: { position: 'fixed', right: 16, bottom: 190, zIndex: 9999, width: 340, maxWidth: 'calc(100vw - 32px)', height: 460, maxHeight: 'calc(100vh - 220px)', background: '#0f0f10', color: '#eee', border: '1px solid #2a2a2a', borderRadius: 14, boxShadow: '0 10px 40px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    head: { padding: '10px 12px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 14 },
    bodyBox: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
    user: { alignSelf: 'flex-end', background: '#1d4ed8', color: '#fff', padding: '8px 11px', borderRadius: '12px 12px 2px 12px', maxWidth: '85%', fontSize: 14, whiteSpace: 'pre-wrap' },
    bot: { alignSelf: 'flex-start', background: '#1c1c1e', color: '#eee', padding: '8px 11px', borderRadius: '12px 12px 12px 2px', maxWidth: '90%', fontSize: 14, whiteSpace: 'pre-wrap' },
    meta: { fontSize: 10, opacity: 0.45, marginTop: 3 },
    foot: { padding: 8, borderTop: '1px solid #222', display: 'flex', gap: 6 },
    input: { flex: 1, background: '#000', color: '#eee', border: '1px solid #333', borderRadius: 9, padding: '9px 10px', fontSize: 14 },
    send: { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 9, padding: '0 14px', fontWeight: 700, cursor: 'pointer' },
    chip: { background: '#191919', color: '#bbb', border: '1px solid #2a2a2a', borderRadius: 999, padding: '4px 9px', fontSize: 11, cursor: 'pointer' },
  }

  return (
    <>
      <button style={S.launch} onClick={() => setOpen((o) => !o)}>{'🤖'} Ask (dev)</button>
      {open && (
        <div style={S.panel}>
          <div style={S.head}>
            <span>{'🤖'} WC Assistant</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }}>{'×'}</button>
          </div>
          <div style={S.bodyBox} ref={bodyRef}>
            {msgs.map((m, i) => (
              <div key={i} style={m.role === 'user' ? S.user : S.bot}>
                {m.text}
                {m.meta && <div style={S.meta}>{m.meta}</div>}
              </div>
            ))}
            {loading && <div style={S.bot}>{'…'}</div>}
            {msgs.length <= 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} style={S.chip} onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <div style={S.foot}>
            <input
              style={S.input}
              value={input}
              placeholder="Ask anything…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
            />
            <button style={S.send} onClick={() => ask()} disabled={loading}>{loading ? '…' : 'Send'}</button>
          </div>
        </div>
      )}
    </>
  )
}

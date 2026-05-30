// EnvBadge — fixed-position dev indicator
// Shows red "DEV" badge ONLY when the page is loaded over localhost / 127.0.0.1.
// On production (pickyguessers.com) or any other host, returns null (invisible).
//
// Purpose: visual canary so it's instantly obvious which Supabase backend the
// app is talking to. Tied to the same hostname check used by js/supabase.js +
// src/lib/supabase.js for routing.

export default function EnvBadge() {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isDev = host === 'localhost' || host === '127.0.0.1' || host === ''
  if (!isDev) return null
  return (
    <div
      style={{
        position: 'fixed',
        top:      '8px',
        right:    '8px',
        zIndex:   9999,
        padding:  '3px 8px',
        background: '#dc2626',
        color:    '#fff',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.5px',
        borderRadius: '4px',
        boxShadow: '0 1px 3px rgba(0,0,0,.5)',
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      DEV
    </div>
  )
}

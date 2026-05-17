import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import { useToast } from './context/ToastContext.jsx'
import { supabase } from './lib/supabase.js'
import { useHeartbeat } from './lib/analytics.ts'
import Dashboard from './pages/Dashboard.jsx'
import Game      from './pages/Game.jsx'
import Picks     from './pages/Picks.jsx'
import Groups    from './pages/Groups.jsx'
import AiFeed    from './pages/AiFeed.jsx'
import Trivia    from './pages/Trivia.jsx'

function AuthGuard({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', color:'var(--muted)' }}>
        Loading…
      </div>
    )
  }

  if (!session) {
    window.location.href = './index.html'
    return null
  }

  return children
}

function InstallBanner() {
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const [dismissed, setDismiss] = useState(() => localStorage.getItem('wc2026_install_banner') === '1')
  const [deferredPrompt, setDeferredPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (isInStandaloneMode || dismissed) return null
  if (!isIos && !deferredPrompt) return null

  const dismiss = () => { localStorage.setItem('wc2026_install_banner', '1'); setDismiss(true) }

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') dismiss()
  }

  return (
    <div style={{
      position: 'fixed', bottom: '72px', left: '12px', right: '12px', zIndex: 9999,
      background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px',
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)', fontSize: '0.85rem', color: '#f0f0f0'
    }}>
      <span style={{ fontSize: '1.4rem' }}>⚽</span>
      {deferredPrompt
        ? <span style={{ flex: 1 }}>Install the app for quick access</span>
        : <span style={{ flex: 1 }}>Install: tap <strong>Share</strong> → <strong>Add to Home Screen</strong></span>
      }
      {deferredPrompt && (
        <button onClick={install} style={{
          background: '#f5c518', border: 'none', color: '#000', fontWeight: 600,
          padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap'
        }}>Install</button>
      )}
      <button onClick={dismiss} style={{
        background: 'none', border: 'none', color: '#888', fontSize: '1.2rem',
        cursor: 'pointer', padding: '0 4px', lineHeight: 1
      }}>✕</button>
    </div>
  )
}

function AppInner() {
  const { user } = useAuth()
  const { showToast } = useToast()
  useHeartbeat(supabase, user?.id)

  useEffect(() => {
    if (!user?.id) return
    const name = localStorage.getItem('wc2026_welcome')
    if (name) {
      localStorage.removeItem('wc2026_welcome')
      showToast(`Welcome to the app, ${name}!`)
    }
  }, [user?.id])

  return <InstallBanner />
}

export default function App() {
  return (
    <HashRouter>
      <AppInner />
      <Routes>
        <Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
        <Route path="/game/:id"  element={<AuthGuard><Game /></AuthGuard>} />
        <Route path="/picks"     element={<AuthGuard><Picks /></AuthGuard>} />
        <Route path="/groups"    element={<AuthGuard><Groups /></AuthGuard>} />
        <Route path="/ai-feed"   element={<AuthGuard><AiFeed /></AuthGuard>} />
        <Route path="/trivia"    element={<AuthGuard><Trivia /></AuthGuard>} />
        <Route path="*"          element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </HashRouter>
  )
}

import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './context/AuthContext.jsx'
import { useToast } from './context/ToastContext.jsx'
import { supabase } from './lib/supabase.js'
import { useHeartbeat } from './lib/analytics.ts'
import Dashboard from './pages/Dashboard.jsx'
import Game      from './pages/Game.jsx'
import Picks     from './pages/Picks.jsx'
import Groups    from './pages/Groups.jsx'
import AiFeed    from './pages/AiFeed.jsx'

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

  return null
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
        <Route path="*"          element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </HashRouter>
  )
}

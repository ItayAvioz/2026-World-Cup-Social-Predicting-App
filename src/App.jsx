import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'

if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('ios')
}

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

const VAPID_PUBLIC_KEY = 'BJ20vvrlNRoYvxDAes6ZRhNx76MDWV-Oblzbohn98B2vGLZMSVQSbCG9CiVyqewFFFvV2E0WqPKmPiHmH0MMTac'

// Capture beforeinstallprompt at module level — fires before React mounts, would be missed by component-level listeners
let _deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  _deferredInstallPrompt = e
})

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

async function subscribeUserToPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    })
    const json = sub.toJSON()
    const { endpoint, keys: { p256dh, auth } } = json
    const { error } = await supabase.from('push_subscriptions').upsert(
      { user_id: userId, endpoint, p256dh, auth },
      { onConflict: 'user_id,endpoint' }
    )
    if (error) console.error('[push] upsert failed:', error.message, error.details)
    else console.log('[push] subscription saved for', userId)
  } catch (e) {
    console.error('[push] subscribe failed:', e)
  }
}

const notifSupported = typeof Notification !== 'undefined'

function NotificationPrompt({ userId, onGranted }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!userId || !notifSupported) return
    if (Notification.permission !== 'default') return
    if (localStorage.getItem('wc2026_notif_asked') === '1') return
    const t = setTimeout(() => setShow(true), 10000)
    return () => clearTimeout(t)
  }, [userId])

  if (!show) return null

  const ask = async () => {
    setShow(false)
    localStorage.setItem('wc2026_notif_asked', '1')
    if (!notifSupported) return
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      await subscribeUserToPush(userId)
      onGranted()
    }
  }

  const dismiss = () => {
    setShow(false)
    localStorage.setItem('wc2026_notif_asked', '1')
  }

  return (
    <div style={{
      position: 'fixed', bottom: '72px', left: '12px', right: '12px', zIndex: 9999,
      background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px',
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)', fontSize: '0.85rem', color: '#f0f0f0'
    }}>
      <span style={{ fontSize: '1.4rem' }}>🔔</span>
      <span style={{ flex: 1 }}>Get notified before kickoff, daily trivia & when AI summary is ready</span>
      <button onClick={ask} style={{
        background: '#f5c518', border: 'none', color: '#000', fontWeight: 600,
        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap'
      }}>Allow</button>
      <button onClick={dismiss} style={{
        background: 'none', border: 'none', color: '#888', fontSize: '1.2rem',
        cursor: 'pointer', padding: '0 4px', lineHeight: 1
      }}>✕</button>
    </div>
  )
}

function InstallBanner({ show }) {
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const [dismissed, setDismiss] = useState(() => localStorage.getItem('wc2026_install_banner') === '1')
  // Initialise from module-level capture (event may have fired before this component mounted)
  const [deferredPrompt, setDeferredPrompt] = useState(() => _deferredInstallPrompt)

  useEffect(() => {
    if (_deferredInstallPrompt) setDeferredPrompt(_deferredInstallPrompt)
    const handler = (e) => { e.preventDefault(); _deferredInstallPrompt = e; setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!show || isInStandaloneMode || dismissed) return null
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
      position: 'fixed', bottom: '72px', left: '12px', right: '12px', zIndex: 9998,
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
  const [notifGranted, setNotifGranted] = useState(
    () => notifSupported && Notification.permission === 'granted'
  )
  useHeartbeat(supabase, user?.id)

  useEffect(() => {
    if (!user?.id) return
    const name = localStorage.getItem('wc2026_welcome')
    if (name) {
      localStorage.removeItem('wc2026_welcome')
      showToast(`Welcome to the app, ${name}!`)
    }
    if (notifSupported && Notification.permission === 'granted') subscribeUserToPush(user.id)
  }, [user?.id])

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  // Show notification prompt: Android always, iPhone only when installed
  const canPrompt = !isIos || isStandalone

  return (
    <>
      {canPrompt && <NotificationPrompt userId={user?.id} onGranted={() => setNotifGranted(true)} />}
      <InstallBanner show={notifGranted || isIos} />
    </>
  )
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

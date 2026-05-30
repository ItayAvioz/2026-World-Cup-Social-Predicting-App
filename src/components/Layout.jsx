import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'
import FeedbackButton from './FeedbackButton.jsx'
import HowToPlay from './HowToPlay.jsx'
import EnvBadge from './EnvBadge.jsx'

export default function Layout({ title, children, showBack = true, rightSlot, leftSlot }) {
  const navigate = useNavigate()
  const [htpOpen, setHtpOpen] = useState(false)

  return (
    <div className="page-shell">
      <div className="side-deco side-deco-left" aria-hidden="true"><span>USA · CANADA · MEXICO</span></div>
      <div className="side-deco side-deco-right" aria-hidden="true"><span>WORLD CUP · 2026</span></div>
      <nav className="page-nav">
        <div className="nav-side nav-side-left">
          {leftSlot ?? (showBack
            ? <button className="page-back" onClick={() => navigate(-1)}>← Back</button>
            : null
          )}
        </div>
        <a href="./index.html" className="nav-logo" title="Home">⚽ WC2026</a>
        <div className="nav-side nav-side-right">
          <button className="htp-icon-btn" onClick={() => setHtpOpen(true)} aria-label="How to Play"><span className="htp-icon-i">i</span></button>
          {rightSlot ?? null}
        </div>
      </nav>
      <div className="page-body">
        {children}
      </div>
      <BottomNav />
      <FeedbackButton />
      <HowToPlay isOpen={htpOpen} onClose={() => setHtpOpen(false)} />
      <EnvBadge />
    </div>
  )
}

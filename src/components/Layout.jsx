import { useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'
import FeedbackButton from './FeedbackButton.jsx'

export default function Layout({ title, children, showBack = true, rightSlot, leftSlot }) {
  const navigate = useNavigate()

  return (
    <div className="page-shell">
      <div className="side-deco side-deco-left" aria-hidden="true"><span>USA · CANADA · MEXICO</span></div>
      <div className="side-deco side-deco-right" aria-hidden="true"><span>WORLD CUP · 2026</span></div>
      <nav className="page-nav">
        {leftSlot ?? (showBack
          ? <button className="page-back" onClick={() => navigate(-1)}>← Back</button>
          : <div className="nav-spacer" />
        )}
        <div className="nav-logo">⚽ WC2026</div>
        {rightSlot ?? <div className="nav-spacer" />}
      </nav>
      <div className="page-body">
        {children}
      </div>
      <BottomNav />
      <FeedbackButton />
    </div>
  )
}

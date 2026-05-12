import { NavLink } from 'react-router-dom'

const IconHome = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
)

const IconGroups = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="3.5"/>
    <path d="M2 21v-1.5A4.5 4.5 0 016.5 15h5A4.5 4.5 0 0116 19.5V21"/>
    <path d="M16 3.5a3.5 3.5 0 010 7M22 21v-1.5a4.5 4.5 0 00-3.5-4.38"/>
  </svg>
)

const IconPicks = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
  </svg>
)

const IconAI = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/>
  </svg>
)

const IconTrivia = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

const TABS = [
  { to: '/dashboard', label: 'Dashboard', Icon: IconHome   },
  { to: '/groups',    label: 'Groups',    Icon: IconGroups },
  { to: '/picks',     label: 'Picks',     Icon: IconPicks  },
  { to: '/ai-feed',   label: 'AI Feed',   Icon: IconAI     },
  { to: '/trivia',    label: 'Trivia',    Icon: IconTrivia },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `bottom-nav-tab${isActive ? ' active' : ''}`}
        >
          <span className="bottom-nav-icon"><Icon /></span>
          <span className="bottom-nav-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

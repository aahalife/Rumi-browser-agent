import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { CloseIcon, MenuIcon } from './Icons'

const MENU: [string, string][] = [
  ['/home', 'Home'],
  ['/visits', 'Visits'],
  ['/messages', 'Messages'],
  ['/results', 'Test Results'],
  ['/medications', 'Medications'],
  ['/health-summary', 'Health Summary'],
  ['/care-team', 'Care Team'],
  ['/schedule', 'Schedule an Appointment'],
  ['/billing', 'Billing'],
  ['/video-visits', 'Video Visits'],
]

interface Props {
  title: string
  subtitle?: string
  greeting?: boolean
  children: ReactNode
}

export function Layout({ title, subtitle, greeting, children }: Props) {
  const [open, setOpen] = useState<boolean>(false)
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const { patient, logout } = useAuth()
  const navigate = useNavigate()
  const initials = patient ? `${patient.first_name[0] ?? ''}${patient.last_name[0] ?? ''}` : ''

  async function onLogout() {
    setOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </button>
        <div className="brand" aria-label="AmalgamRx Hospitals">
          <span className="brand-line">AmalgamRx</span>
          <span className="brand-title">Hospitals</span>
        </div>
        {initials && (
          <span className="avatar" aria-label={`Signed in as ${patient?.first_name} ${patient?.last_name}`}>
            {initials}
          </span>
        )}
      </header>

      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <nav className="drawer" aria-label="Main menu" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="brand" aria-label="AmalgamRx Hospitals">
                <span className="brand-line">AmalgamRx</span>
                <span className="brand-title">Hospitals</span>
              </div>
              <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <div className="drawer-nav">
              {MENU.map(([to, label]) => (
                <NavLink key={to} to={to} onClick={() => setOpen(false)}>
                  {label}
                </NavLink>
              ))}
            </div>
            <button type="button" className="drawer-logout" onClick={onLogout}>
              Log out
            </button>
          </nav>
        </div>
      )}

      <main className="page">
        <h1 className={greeting ? 'page-title greeting' : 'page-title'}>{title}</h1>
        {subtitle && <p className="page-date">{subtitle}</p>}
        {children}
      </main>

      <p className="px-4 text-center text-xs text-slate-500">Fictional patient demo · Not connected to a healthcare provider</p>
      <footer className="footer">
        <Link to="/home">Home</Link>
        <Link to="/visits">Visits</Link>
        <Link to="/messages">Messages</Link>
      </footer>
    </div>
  )
}

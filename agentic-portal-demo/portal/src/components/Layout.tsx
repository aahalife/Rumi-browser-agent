import { useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
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
]

interface Props {
  title: string
  subtitle?: string
  greeting?: boolean
  children: ReactNode
}

export function Layout({ title, subtitle, greeting, children }: Props) {
  const [open, setOpen] = useState(false)
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
        <div className="brand">
          <span className="brand-line">Riverside Health</span>
          <span className="brand-title">CarePortal</span>
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
              <div className="brand">
                <span className="brand-line">Riverside Health</span>
                <span className="brand-title">CarePortal</span>
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

      <footer className="footer">
        <Link to="/home">Home</Link>
        <Link to="/visits">Visits</Link>
        <Link to="/messages">Messages</Link>
      </footer>
    </div>
  )
}

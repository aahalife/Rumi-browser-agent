import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTitle } from '../lib/useTitle'
import { ErrorBox } from '../components/ErrorBox'
import { Spinner } from '../components/Spinner'
import { LeafIcon } from '../components/Icons'

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/portal/')) return '/home'
  return raw.slice('/portal'.length)
}

export function LoginBrand() {
  return (
    <div className="login-brand">
      <div className="mark" aria-hidden="true">
        <LeafIcon />
      </div>
      <span className="brand-line">Riverside Health</span>
      <span className="brand-title">CarePortal</span>
    </div>
  )
}

export function LoginPage() {
  useTitle('Sign in')
  const { patient, loading, login } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const next = safeNext(params.get('next'))

  if (loading) return <Spinner />
  if (patient) return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app login-app">
      <main className="page">
        <LoginBrand />
        <h1 className="page-title">Sign in</h1>
        <form className="card form" onSubmit={onSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <ErrorBox message={error} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <Link className="link-muted" to="/forgot">
            Forgot username / password?
          </Link>
        </form>
        <aside className="demo-box">
          <p>Demo accounts</p>
          <p>
            <code>demo</code> / <code>demo123</code> is Priya Sharma
          </p>
          <p>
            <code>demo2</code> / <code>demo123</code> is James Walker
          </p>
        </aside>
      </main>
    </div>
  )
}

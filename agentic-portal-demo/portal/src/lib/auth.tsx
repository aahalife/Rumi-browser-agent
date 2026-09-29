import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError, apiFetch, post } from './api'
import type { Patient } from './types'
import { Spinner } from '../components/Spinner'
import { PORTAL_API } from './backend'

interface AuthState {
  patient: Patient | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)


// Inside the iOS app, keep a long-lived device sign-in on the phone so the assistant can
// sign the patient back in later without a password. The token goes to the app's Keychain,
// never to the assistant. Plain browsers have no message handler and skip this.
async function handOffDeviceSignIn() {
  const handler = (window as any).webkit?.messageHandlers?.careportal
  if (!handler) return
  try {
    const { token } = await post<{ token: string }>('/auth/device-token', { label: 'iPhone, CarePortal Assistant' })
    handler.postMessage({ type: 'device_token', token })
  } catch {
    // Not fatal: the patient simply signs in by hand next time.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Probe /me without the redirect-on-401 behaviour of apiFetch.
    fetch(`${PORTAL_API}/me`, { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) return (await r.json()) as Patient
        if (r.status !== 401) return null
        const refreshed = await fetch(`${PORTAL_API}/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (!refreshed.ok) return null
        const again = await fetch(`${PORTAL_API}/me`, { credentials: 'include' })
        return again.ok ? ((await again.json()) as Patient) : null
      })
      .then(setPatient)
      .catch(() => setPatient(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    try {
      await post('/auth/login', { username, password })
      await handOffDeviceSignIn()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw new Error('Invalid username or password')
      throw e
    }
    setPatient(await apiFetch<Patient>('/me'))
  }, [])

  const logout = useCallback(async () => {
    await fetch(`${PORTAL_API}/auth/logout`, { method: 'POST', credentials: 'include' })
    setPatient(null)
  }, [])

  return <AuthContext.Provider value={{ patient, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { patient, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner label="Loading your account" />
  if (!patient) {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent('/portal' + next)}`} replace />
  }
  return <>{children}</>
}

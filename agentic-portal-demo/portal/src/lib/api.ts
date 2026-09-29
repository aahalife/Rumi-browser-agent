import { PORTAL_API } from './backend'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let refreshing: Promise<boolean> | null = null

function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${PORTAL_API}/auth/refresh`, { method: 'POST', credentials: 'include', cache: 'no-store' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

function redirectToLogin() {
  const next = window.location.pathname + window.location.search
  window.location.assign('/portal/login?next=' + encodeURIComponent(next))
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
  } catch {
    // no json body
  }
  return res.statusText || `Request failed (${res.status})`
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = () =>
    fetch(PORTAL_API + path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })

  let res = await doFetch()
  if (res.status === 401) {
    const ok = await refreshOnce()
    if (!ok) {
      redirectToLogin()
      throw new ApiError(401, 'Not signed in')
    }
    res = await doFetch()
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiError(401, 'Not signed in')
    }
  }
  if (!res.ok) throw new ApiError(res.status, await readError(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

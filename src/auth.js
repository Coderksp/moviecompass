import { useSyncExternalStore } from 'react'

// Session state, backed by the API rather than the browser.
//
// The session cookie is httpOnly, so nothing here can read it — the only way to
// learn who you are is to ask the server. That is what refresh() does on load.
//
// Requests are same-origin: production serves the app and the functions from one
// domain, and local development proxies /api through Vite (see vite.config.js).
// credentials: 'include' is still set so the cookie rides along regardless.
const listeners = new Set()

// 'loading' matters: without it the app would show the sign-in page for a moment
// on every reload before the session check came back, which reads as being
// signed out and is worse than a brief blank.
let state = { status: 'loading', user: null }

function set(next) {
  state = next
  listeners.forEach((fn) => fn())
}

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

export async function refresh() {
  try {
    const { user } = await call('/api/auth/me')
    set({ status: user ? 'in' : 'out', user })
  } catch {
    // A backend that is down should leave you signed out, not stuck loading.
    set({ status: 'out', user: null })
  }
}

export async function signIn(username, password) {
  const { user } = await call('/api/auth/login', { username, password })
  set({ status: 'in', user })
  return user
}

export async function register(username, password) {
  const { user } = await call('/api/auth/register', { username, password })
  set({ status: 'in', user })
  return user
}

export async function signOut() {
  try { await call('/api/auth/logout', {}) } catch {}
  // Clear locally even if the request failed — the cookie may already be gone,
  // and leaving someone apparently signed in after they asked to leave is worse.
  set({ status: 'out', user: null })
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useSession = () => useSyncExternalStore(subscribe, () => state)
export const useUser = () => useSyncExternalStore(subscribe, () => state.user)

refresh()

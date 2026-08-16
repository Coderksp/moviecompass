import { useSyncExternalStore } from 'react'

// A demo session, not authentication. There is no server, so nothing is
// verified — this only remembers who said they were here, so the app does not
// ask again on every reload.
//
// Only a display name is ever stored. The password is read from the form and
// dropped; persisting a password client-side would be indefensible even in a
// demo, since people reuse them.
const KEY = 'moviecompass-user'
const listeners = new Set()

let user = null
try {
  const raw = localStorage.getItem(KEY)
  if (raw) user = JSON.parse(raw)
} catch {
  user = null
}

export function signIn(name, via = 'password') {
  user = { name: String(name).trim().slice(0, 40), via }
  try { localStorage.setItem(KEY, JSON.stringify(user)) } catch {}
  listeners.forEach((fn) => fn())
}

export function signOut() {
  user = null
  try { localStorage.removeItem(KEY) } catch {}
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useUser = () => useSyncExternalStore(subscribe, () => user)

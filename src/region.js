import { useSyncExternalStore } from 'react'

// Streaming rights are sold country by country, so one region choice drives both
// the modal's "Where to watch" list and the badges on every card. Keeping it here
// means changing it in the modal updates the cards behind it immediately.
const KEY = 'reelix-region'
const listeners = new Set()

let region = localStorage.getItem(KEY) || 'IN'

export function setRegion(code) {
  if (code === region) return
  region = code
  localStorage.setItem(KEY, code)
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useRegion = () => useSyncExternalStore(subscribe, () => region)

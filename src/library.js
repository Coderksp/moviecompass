import { useSyncExternalStore } from 'react'

// Your saved titles, keyed by type and id.
//
// Updates are optimistic: a heart that waits for a round trip before filling in
// feels broken. The previous value is kept so a failed request can put it back
// rather than leaving the UI claiming something the server never accepted.
const listeners = new Set()
const key = (id, mediaType) => `${mediaType || 'movie'}:${id}`

let items = new Map()   // key -> { tmdbId, mediaType, watchlist, favourite, rating }
let loaded = false

function emit() {
  // A new Map each time, so useSyncExternalStore sees a changed reference.
  items = new Map(items)
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

export async function loadLibrary() {
  try {
    const { items: rows } = await call('/api/library')
    items = new Map(rows.map((r) => [key(r.tmdbId, r.mediaType), r]))
    loaded = true
    emit()
  } catch {
    // Signed out, or the backend is down. An empty library is the right
    // fallback: it hides the rails rather than showing a broken one.
    items = new Map()
    loaded = true
    emit()
  }
}

export function clearLibrary() {
  items = new Map()
  loaded = false
  emit()
}

// `patch` carries only what is changing — { watchlist: true }, { rating: 8 } —
// so toggling a heart never silently rewrites a rating.
export async function update(movie, patch) {
  const k = key(movie.id, movie.mediaType)
  const before = items.get(k) || null

  const next = {
    tmdbId: movie.id,
    mediaType: movie.mediaType || 'movie',
    watchlist: before?.watchlist || false,
    favourite: before?.favourite || false,
    rating: before?.rating ?? null,
    ...patch,
  }
  const empty = !next.watchlist && !next.favourite && next.rating == null
  if (empty) items.delete(k); else items.set(k, next)
  emit()

  try {
    const { item } = await call('/api/library', {
      tmdbId: movie.id,
      mediaType: movie.mediaType || 'movie',
      ...patch,
    })
    if (item) items.set(k, item); else items.delete(k)
    emit()
  } catch (err) {
    if (before) items.set(k, before); else items.delete(k)
    emit()
    throw err
  }
}

export const entryFor = (id, mediaType) => items.get(key(id, mediaType)) || null

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useLibrary = () => useSyncExternalStore(subscribe, () => items)
export const useLibraryLoaded = () => useSyncExternalStore(subscribe, () => loaded)

// One entry, for a card or the modal.
export function useEntry(id, mediaType) {
  const map = useLibrary()
  return map.get(key(id, mediaType)) || null
}

// Client for the two personalised endpoints.
//
// Neither is cached across sign-ins the way the TMDB calls are: both answers
// belong to one person, and a module-level cache that outlived a sign-out would
// show the next person the last one's taste. The cache is cleared whenever the
// session changes (see src/auth.js).
const ORIGIN = import.meta.env.VITE_API_ORIGIN || ''

let cache = new Map()

export function clearPersonalCache() {
  cache = new Map()
}

function get(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${ORIGIN}${path}`, { credentials: 'include' })
        .then(async (res) => {
          if (res.status === 401) return null // signed out is not an error
          if (!res.ok) throw new Error(`Request failed (${res.status})`)
          return res.json()
        })
        .catch((err) => {
          cache.delete(path)
          throw err
        })
    )
  }
  return cache.get(path)
}

// Identity, counts, and what the model believes about your taste.
export const fetchProfile = () => get('/api/you?want=profile')

// The curated rail. Resolves with ready:false and a count of how many more
// titles are needed when there is not yet enough to go on.
export const fetchForYou = () => get('/api/you?want=picks')

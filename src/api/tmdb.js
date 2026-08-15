// Everything goes through our own serverless proxy (see /api) rather than
// straight to TMDB. The key stays on the server, and requests are made from
// Vercel — which matters because some ISPs block themoviedb.org outright, so a
// direct browser call fails for those visitors.
//
// VITE_API_ORIGIN lets a local dev server borrow a deployed proxy. Leave it
// unset in production, where the relative path is what you want.
const ORIGIN = import.meta.env.VITE_API_ORIGIN || ''

export const IMG = (path, size = 'w500') =>
  path
    ? `${ORIGIN}/api/img?path=${encodeURIComponent(`/${size}${path}`)}`
    : ''

async function get(path, params = {}) {
  const url = new URL(`${ORIGIN}/api/tmdb`, window.location.origin)
  url.searchParams.set('path', path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url)
  if (!res.ok) {
    // The proxy explains itself on failure (missing key, TMDB unreachable);
    // fall back to the status code when there's no message to show.
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error || `TMDB request failed (${res.status})`)
  }
  return res.json()
}

// The rails shown on the home page. Each is a TMDB endpoint.
export const CATEGORIES = [
  { id: 'trending', title: 'Trending now', path: '/trending/movie/week' },
  { id: 'top_rated', title: 'Critically acclaimed', path: '/movie/top_rated' },
  { id: 'popular', title: 'Popular this month', path: '/movie/popular' },
  { id: 'action', title: 'Adrenaline rush', path: '/discover/movie', params: { with_genres: 28, sort_by: 'popularity.desc' } },
  { id: 'comedy', title: 'Feel-good comedies', path: '/discover/movie', params: { with_genres: 35, sort_by: 'popularity.desc' } },
  { id: 'scifi', title: 'Worlds beyond', path: '/discover/movie', params: { with_genres: 878, sort_by: 'popularity.desc' } },
  { id: 'horror', title: 'After dark', path: '/discover/movie', params: { with_genres: 27, sort_by: 'popularity.desc' } },
]

export async function fetchCategory(cat) {
  const data = await get(cat.path, cat.params || {})
  return data.results.filter((m) => m.backdrop_path || m.poster_path)
}

export async function fetchFeatured() {
  const data = await get('/trending/movie/week')
  const withBackdrop = data.results.filter((m) => m.backdrop_path && m.overview)
  return withBackdrop[Math.floor(Math.random() * Math.min(5, withBackdrop.length))]
}

// Returns a YouTube key for the best available trailer, or null.
const trailerCache = new Map()
export async function fetchTrailerKey(movieId) {
  if (trailerCache.has(movieId)) return trailerCache.get(movieId)
  const data = await get(`/movie/${movieId}/videos`)
  const vids = data.results || []
  const pick =
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
    vids.find((v) => v.site === 'YouTube' && v.type === 'Teaser') ||
    vids.find((v) => v.site === 'YouTube')
  const key = pick ? pick.key : null
  trailerCache.set(movieId, key)
  return key
}

export async function searchMovies(query) {
  if (!query.trim()) return []
  const data = await get('/search/movie', { query, include_adult: false })
  return data.results.filter((m) => m.poster_path || m.backdrop_path)
}

// Full detail payload for the modal: overview, runtime, genres, cast, reviews and
// streaming availability all in one request via TMDB's append_to_response.
const detailsCache = new Map()
export async function fetchMovieDetails(movieId) {
  if (detailsCache.has(movieId)) return detailsCache.get(movieId)
  const data = await get(`/movie/${movieId}`, {
    append_to_response: 'credits,reviews,watch/providers',
  })
  detailsCache.set(movieId, data)
  return data
}

// Countries offered in the "Where to watch" picker. Availability is licensed
// per territory, so the same film streams in one country and doesn't in another.
export const WATCH_REGIONS = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'AE', label: 'UAE' },
  { code: 'SG', label: 'Singapore' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'JP', label: 'Japan' },
]

// Normalises TMDB's per-region provider payload into the four buckets we render.
// Returns null when the film has no listing in that country at all.
export function providersForRegion(results, region) {
  const r = results?.[region]
  if (!r) return null
  const buckets = {
    link: r.link,
    stream: r.flatrate || [],
    free: [...(r.free || []), ...(r.ads || [])],
    rent: r.rent || [],
    buy: r.buy || [],
  }
  const total =
    buckets.stream.length + buckets.free.length + buckets.rent.length + buckets.buy.length
  return total ? buckets : null
}

// The modal already has the full payload from append_to_response.
export function watchProviders(details, region) {
  return providersForRegion(details?.['watch/providers']?.results, region)
}

// Cards only have list data, so they need their own lookup. This endpoint returns
// every region for one film in a small payload, and the cache means switching
// country never refetches. Cards request it lazily as they scroll into view.
const providerCache = new Map()
export function fetchWatchProviders(movieId) {
  if (!providerCache.has(movieId)) {
    providerCache.set(
      movieId,
      get(`/movie/${movieId}/watch/providers`)
        .then((d) => d.results || {})
        .catch(() => {
          providerCache.delete(movieId) // let a later card retry
          return {}
        })
    )
  }
  return providerCache.get(movieId)
}

// Letterboxd has no public API, but this redirect resolves a TMDB id to the
// film's Letterboxd page. Handy for a "view reviews on Letterboxd" link.
export const letterboxdUrl = (tmdbId) => `https://letterboxd.com/tmdb/${tmdbId}/`

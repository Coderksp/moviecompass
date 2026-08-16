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

// TMDB names the same field differently for films and series: title/name and
// release_date/first_air_date. Rather than teach every component both shapes,
// series are reshaped into the film keys on the way in, and carry a mediaType
// so the per-item lookups know which endpoint to hit.
const normalize = (item, mediaType) => ({
  ...item,
  mediaType: mediaType || item.media_type,
  title: item.title || item.name,
  release_date: item.release_date || item.first_air_date,
})

const hasArt = (m) => m.backdrop_path || m.poster_path

export const MEDIA_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Series' },
]

// The rails on the home page, interleaved so the unfiltered view alternates
// between films and series rather than showing all of one then all of the other.
export const CATEGORIES = [
  { id: 'trending', mediaType: 'movie', title: 'Trending films', path: '/trending/movie/week' },
  { id: 'tv_trending', mediaType: 'tv', title: 'Trending series', path: '/trending/tv/week' },
  { id: 'top_rated', mediaType: 'movie', title: 'Critically acclaimed', path: '/movie/top_rated' },
  { id: 'tv_top', mediaType: 'tv', title: 'Best-reviewed series', path: '/tv/top_rated' },
  { id: 'popular', mediaType: 'movie', title: 'Popular this month', path: '/movie/popular' },
  { id: 'tv_air', mediaType: 'tv', title: 'On the air now', path: '/tv/on_the_air' },
  { id: 'action', mediaType: 'movie', title: 'Adrenaline rush', path: '/discover/movie', params: { with_genres: 28, sort_by: 'popularity.desc' } },
  { id: 'tv_drama', mediaType: 'tv', title: 'Bingeable dramas', path: '/discover/tv', params: { with_genres: 18, sort_by: 'popularity.desc' } },
  { id: 'comedy', mediaType: 'movie', title: 'Feel-good comedies', path: '/discover/movie', params: { with_genres: 35, sort_by: 'popularity.desc' } },
  { id: 'tv_korean', mediaType: 'tv', title: 'Korean picks', path: '/discover/tv', params: { with_original_language: 'ko', sort_by: 'popularity.desc' } },
  { id: 'scifi', mediaType: 'movie', title: 'Worlds beyond', path: '/discover/movie', params: { with_genres: 878, sort_by: 'popularity.desc' } },
  { id: 'tv_scifi', mediaType: 'tv', title: 'Sci-fi & fantasy series', path: '/discover/tv', params: { with_genres: 10765, sort_by: 'popularity.desc' } },
  { id: 'horror', mediaType: 'movie', title: 'After dark', path: '/discover/movie', params: { with_genres: 27, sort_by: 'popularity.desc' } },
]

export async function fetchCategory(cat) {
  const data = await get(cat.path, cat.params || {})
  return data.results.filter(hasArt).map((m) => normalize(m, cat.mediaType))
}

// media is 'all' | 'movie' | 'tv' — the hero follows whatever filter is active.
export async function fetchFeatured(media = 'all') {
  const data = await get(`/trending/${media === 'all' ? 'all' : media}/week`)
  const pool = data.results
    .filter((m) => m.backdrop_path && m.overview && m.media_type !== 'person')
    .map((m) => normalize(m, media === 'all' ? undefined : media))
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * Math.min(5, pool.length))]
}

// Search covers both types in one request. People are filtered out — this is a
// title search, and an actor row in the grid would have nothing to open.
export async function searchTitles(query) {
  if (!query.trim()) return []
  const data = await get('/search/multi', { query, include_adult: false })
  return data.results
    .filter((m) => (m.media_type === 'movie' || m.media_type === 'tv') && hasArt(m))
    .map((m) => normalize(m))
}

// Films and series share numeric id spaces, so every cache below is keyed by
// type as well — without it, tv/1399 would collide with movie/1399.
const key = (id, mediaType) => `${mediaType || 'movie'}:${id}`

// Returns a YouTube key for the best available trailer, or null.
const trailerCache = new Map()
export async function fetchTrailerKey(id, mediaType = 'movie') {
  const k = key(id, mediaType)
  if (trailerCache.has(k)) return trailerCache.get(k)
  const data = await get(`/${mediaType}/${id}/videos`)
  const vids = data.results || []
  const pick =
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
    vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
    vids.find((v) => v.site === 'YouTube' && v.type === 'Teaser') ||
    vids.find((v) => v.site === 'YouTube')
  const trailer = pick ? pick.key : null
  trailerCache.set(k, trailer)
  return trailer
}

// Full detail payload for the modal: overview, runtime, genres, cast, reviews and
// streaming availability all in one request via TMDB's append_to_response.
const detailsCache = new Map()
export async function fetchMovieDetails(id, mediaType = 'movie') {
  const k = key(id, mediaType)
  if (detailsCache.has(k)) return detailsCache.get(k)
  const data = await get(`/${mediaType}/${id}`, {
    append_to_response: 'credits,reviews,watch/providers',
  })
  detailsCache.set(k, normalize(data, mediaType))
  return detailsCache.get(k)
}

// Countries offered in the "Where to watch" picker. Availability is licensed
// per territory, so the same title streams in one country and doesn't in another.
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
// Returns null when the title has no listing in that country at all.
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
// every region for one title in a small payload, and the cache means switching
// country never refetches. Cards request it lazily as they scroll into view.
const providerCache = new Map()
export function fetchWatchProviders(id, mediaType = 'movie') {
  const k = key(id, mediaType)
  if (!providerCache.has(k)) {
    providerCache.set(
      k,
      get(`/${mediaType}/${id}/watch/providers`)
        .then((d) => d.results || {})
        .catch(() => {
          providerCache.delete(k) // let a later card retry
          return {}
        })
    )
  }
  return providerCache.get(k)
}

// Letterboxd is films only, so series link to their TMDB page instead.
export const externalUrl = ({ id, mediaType }) =>
  mediaType === 'tv'
    ? { href: `https://www.themoviedb.org/tv/${id}`, label: 'View on TMDB' }
    : { href: `https://letterboxd.com/tmdb/${id}/`, label: 'View on Letterboxd' }

// Series report seasons and episodes where films report a runtime.
export function lengthLabel(data) {
  if (data.mediaType === 'tv') {
    const s = data.number_of_seasons
    const e = data.number_of_episodes
    if (!s) return null
    return `${s} season${s === 1 ? '' : 's'}${e ? ` · ${e} episodes` : ''}`
  }
  return data.runtime
    ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m`
    : null
}

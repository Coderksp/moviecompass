// Talking to TMDB from inside a serverless function.
//
// Shared by /api/similar and /api/you, which ask the same questions of the same
// API and differ only in what they are asking on behalf of — one film, or
// everything a person has saved.
const TMDB = 'https://api.themoviedb.org/3'

// Generous enough for TMDB on a slow day, short enough that a hung upstream
// cannot hold a function open until the platform kills it.
const UPSTREAM_TIMEOUT = 6000

export async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  url.searchParams.set('api_key', process.env.TMDB_API_KEY)

  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) })
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`)
  return res.json()
}

// Certifications live under a different key per media type, and neither is
// returned unless it is asked for by name. Bundling them into the lookup each
// title already makes means the maturity feature costs no extra requests.
export const CERTIFICATION = { movie: 'release_dates', tv: 'content_ratings' }

// Everything the ranker wants about one title, in a single request.
export const fullDetail = (id, mediaType) =>
  tmdb(`/${mediaType}/${id}`, {
    append_to_response: `keywords,credits,${CERTIFICATION[mediaType]}`,
  })

// TMDB names the same fields differently for films and series. Normalising on
// the way in means the model never has to know which it is looking at.
export const normalize = (item, mediaType) => ({
  ...item,
  mediaType,
  title: item.title || item.name,
  release_date: item.release_date || item.first_air_date,
})

// A title with no art cannot be rendered as a card, and one nobody has rated is
// usually an incomplete record rather than a discovery.
export const usable = (item) =>
  (item.poster_path || item.backdrop_path) && !item.adult && (item.vote_count || 0) >= 5

export const listFrom = (data, mediaType) =>
  (data?.results || []).filter(usable).map((m) => normalize(m, mediaType))

// A generator that fails takes its list out of the fusion and nothing else. The
// ranking degrades — fewer lists voting — rather than the request collapsing
// because one discover query timed out.
export const safely = (promise, source) =>
  promise
    .then((items) => ({ source, items }))
    .catch(() => ({ source, items: [] }))

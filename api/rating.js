// Public-opinion film ratings from IMDb, via OMDb.
//
// TMDB's own scores are too thin to rank regional cinema — a defining Tamil film
// might carry 74 votes there, against tens of thousands on IMDb. OMDb exposes
// IMDb's rating and vote count behind a free self-serve key.
//
// Get one at https://www.omdbapi.com/apikey.aspx and set OMDB_API_KEY. Without
// it this reports available:false and the client falls back to a TMDB-based
// score, so the feature degrades quietly rather than breaking the page.
//
// Two hops per film: TMDB resolves its id to an IMDb id, then OMDb returns the
// rating. That is why the client sends a shortlist rather than a filmography.
const TMDB = 'https://api.themoviedb.org/3'
const OMDB = 'https://www.omdbapi.com/'
const MAX_IDS = 8

const imdbIdCache = new Map()

async function imdbId(tmdbId, tmdbKey) {
  if (imdbIdCache.has(tmdbId)) return imdbIdCache.get(tmdbId)
  const res = await fetch(`${TMDB}/movie/${tmdbId}/external_ids?api_key=${tmdbKey}`)
  if (!res.ok) return null
  const id = (await res.json())?.imdb_id || null
  imdbIdCache.set(tmdbId, id)
  return id
}

async function imdbRating(imdb, omdbKey) {
  const res = await fetch(`${OMDB}?apikey=${omdbKey}&i=${imdb}&tomatoes=false`)
  if (!res.ok) return null
  const d = await res.json()
  if (d.Response !== 'True') return null
  const score = parseFloat(d.imdbRating)
  if (!Number.isFinite(score)) return null            // OMDb sends "N/A" as a string
  const votes = parseInt(String(d.imdbVotes).replace(/,/g, ''), 10)
  return { score, votes: Number.isFinite(votes) ? votes : 0 }
}

export default async function handler(req, res) {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .slice(0, MAX_IDS)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (!ids.length) return res.status(400).json({ error: 'No ids given.' })

  const omdbKey = process.env.OMDB_API_KEY
  const tmdbKey = process.env.TMDB_API_KEY

  // No key is a normal state, not an error — the client falls back.
  if (!omdbKey || !tmdbKey) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400')
    return res.status(200).json({ source: 'imdb', available: false, ratings: {} })
  }

  try {
    const ratings = {}
    // Sequential on purpose: the free tier is 1,000 calls a day, and parallel
    // bursts are the quickest way to spend it.
    for (const id of ids) {
      const imdb = await imdbId(id, tmdbKey).catch(() => null)
      if (!imdb) continue
      const r = await imdbRating(imdb, omdbKey).catch(() => null)
      if (r) ratings[id] = r
    }
    // Ratings drift slowly; a day at the edge keeps well inside the quota.
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).json({ source: 'imdb', available: true, scale: 10, ratings })
  } catch (err) {
    // A quota or key failure must never take the page down with it.
    return res.status(200).json({ source: 'imdb', available: false, ratings: {} })
  }
}

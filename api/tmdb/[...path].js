// Proxies the TMDB API from the server instead of the browser.
//
// Two reasons this exists. First, several ISPs (notably in India) drop
// connections to themoviedb.org, so a browser-side call fails for a large share
// of visitors no matter how healthy the site is — Vercel's network is not
// blocked, so the request succeeds from here. Second, the key now lives in a
// server-only env var and never reaches the bundle.
const TMDB = 'https://api.themoviedb.org/3'

export default async function handler(req, res) {
  const key = process.env.TMDB_API_KEY
  if (!key) {
    return res
      .status(500)
      .json({ error: 'TMDB_API_KEY is not set on the server.' })
  }

  const segments = req.query.path
  const path = (Array.isArray(segments) ? segments : [segments])
    .filter(Boolean)
    .join('/')

  const url = new URL(`${TMDB}/${path}`)
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'path') url.searchParams.set(k, v)
  }
  url.searchParams.set('api_key', key)

  try {
    const upstream = await fetch(url)
    const body = await upstream.text()

    // Allows a local dev server to borrow a deployed proxy when TMDB is
    // unreachable from the machine you're coding on.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    // Film metadata barely moves hour to hour, and caching at the edge keeps us
    // comfortably inside TMDB's rate limit.
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400'
    )
    return res.status(upstream.status).send(body)
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach TMDB.' })
  }
}

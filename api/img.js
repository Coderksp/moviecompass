// Proxies TMDB's image CDN for the same reason as the API proxy: image.tmdb.org
// is blocked on the same networks, so posters and backdrops would come through
// broken even when the metadata loads fine.
const IMAGES = 'https://image.tmdb.org/t/p'

export default async function handler(req, res) {
  const { path = '' } = req.query

  // The host is fixed, so this can only ever reach TMDB — but reject traversal
  // rather than relying on URL normalisation to save us.
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
    return res.status(400).json({ error: 'Invalid image path.' })
  }

  try {
    const upstream = await fetch(IMAGES + path)
    if (!upstream.ok) return res.status(upstream.status).end()

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'image/jpeg'
    )
    // TMDB image URLs are content-addressed, so a given path never changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    return res.status(200).send(buf)
  } catch (err) {
    return res.status(502).end()
  }
}

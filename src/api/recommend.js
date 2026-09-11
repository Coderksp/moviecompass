// Client for the recommendation endpoint.
//
// The rail is fetched in two passes against the same endpoint. The first asks
// for the ranking alone, which is TMDB work and comes back quickly. The second
// asks for the ranking *and* the written reasons, which involves a model and
// does not.
//
// Waiting for the second before showing anything would mean a spinner sitting
// where a list of films was already available, on the slowest connection of the
// people most likely to be on a phone. So the posters arrive first and the
// captions fade in underneath them. The ranking is deterministic, so both passes
// agree on the order and nothing moves when the reasons land.
const ORIGIN = import.meta.env.VITE_API_ORIGIN || ''

const cache = new Map()

function request(id, mediaType, explain) {
  const key = `${mediaType}:${id}:${explain ? 'why' : 'list'}`
  if (!cache.has(key)) {
    const url = new URL(`${ORIGIN}/api/similar`, window.location.origin)
    url.searchParams.set('id', id)
    url.searchParams.set('type', mediaType || 'movie')
    if (explain) url.searchParams.set('explain', '1')

    cache.set(
      key,
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Recommendations failed (${res.status})`)
          return res.json()
        })
        .catch((err) => {
          cache.delete(key) // a network blip should not poison the film forever
          throw err
        })
    )
  }
  return cache.get(key)
}

// The ranking, as fast as it can be had.
export const fetchSimilar = (id, mediaType) => request(id, mediaType, false)

// The same ranking with written reasons. Resolves to the rule-written ones when
// no model key is configured on the server, which is the normal state until one
// is added — so the caller never has to know whether Claude was involved.
export const fetchSimilarReasons = (id, mediaType) => request(id, mediaType, true)

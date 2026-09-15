// Loading one person's library and turning it into a taste.
//
// Both the personalised rail and the profile screen need exactly this, and it is
// the expensive half of either — a database read plus a full TMDB lookup per
// saved title. Doing it in one place means the profile page and the rail cannot
// disagree about what somebody likes, and that a visit to one warms the other.
import { sql } from './db.js'
import { profile } from './recommend.js'
import { fullDetail } from './tmdb.js'
import { buildTaste } from './taste.js'

// Someone with six hundred saved titles has a taste that the most recent forty
// describe perfectly well, and fetching all six hundred to discover that would
// be absurd.
const LIBRARY_LIMIT = 40

// Fewer than this and there is nothing to learn from. Two favourites describe an
// evening, not a taste, and a rail built on them would be a rail about one film.
export const MIN_SIGNALS = 3

async function load(userId) {
  const rows = await sql`
    select tmdb_id, media_type, in_watchlist, is_favourite, rating
    from user_titles
    where user_id = ${userId}
    order by updated_at desc
    limit ${LIBRARY_LIMIT}
  `
  const entries = rows.map((r) => ({
    tmdbId: r.tmdb_id,
    mediaType: r.media_type,
    watchlist: r.in_watchlist,
    favourite: r.is_favourite,
    rating: r.rating,
  }))

  // A title whose lookup fails is dropped rather than failing the whole thing.
  const profiles = await Promise.all(
    entries.map((e) =>
      fullDetail(e.tmdbId, e.mediaType)
        .then((d) => profile(d, e.mediaType))
        .catch(() => null)
    )
  )

  return { entries, profiles, taste: buildTaste(entries, profiles) }
}

// Keyed by who is asking and by what their library currently holds, so saving or
// rating something rebuilds on the next load rather than serving an answer that
// ignores what they just said.
const cache = new Map()
const MAX_CACHED = 32

export async function fingerprintOf(userId) {
  const stamp = await sql`
    select count(*)::int as n, coalesce(max(updated_at), now()) as latest
    from user_titles where user_id = ${userId}
  `
  return `${stamp[0].n}:${new Date(stamp[0].latest).getTime()}`
}

export function viewerTaste(userId, fingerprint) {
  const key = `${userId}:${fingerprint}`
  if (!cache.has(key)) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
    cache.set(
      key,
      load(userId).catch((err) => {
        cache.delete(key) // let the next request try again
        throw err
      })
    )
  }
  return cache.get(key)
}

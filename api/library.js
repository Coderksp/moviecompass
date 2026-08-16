import { sql } from './_lib/db.js'
import { requireUser, applyCors } from './_lib/session.js'

// Watchlist, favourites and your own rating for a title — one row each, since
// they are one relationship and always read together.
//
// Only ids are stored. Titles and posters come from TMDB through the existing
// cached endpoints, so a poster that changes upstream is not frozen here, and
// there is no second copy of the catalogue to keep in step.
export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const user = await requireUser(req, res)
  if (!user) return

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        select tmdb_id, media_type, in_watchlist, is_favourite, rating, updated_at
        from user_titles
        where user_id = ${user.id}
        order by updated_at desc
      `
      return res.status(200).json({ items: rows.map(shape) })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST.' })

    const body = req.body || {}
    const tmdbId = Number(body.tmdbId)
    const mediaType = body.mediaType === 'tv' ? 'tv' : 'movie'

    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({ error: 'A valid tmdbId is required.' })
    }

    // Absent means "leave alone"; present means "set to this". Without the
    // distinction there is no way to clear a rating without also clearing the
    // flags, since null would be ambiguous.
    const watchlist = 'watchlist' in body ? Boolean(body.watchlist) : null
    const favourite = 'favourite' in body ? Boolean(body.favourite) : null
    const ratingGiven = 'rating' in body
    const rating = ratingGiven && body.rating != null ? Number(body.rating) : null

    if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) {
      return res.status(400).json({ error: 'A rating must be a whole number from 1 to 10.' })
    }

    const rows = await sql`
      insert into user_titles (user_id, tmdb_id, media_type, in_watchlist, is_favourite, rating)
      values (
        ${user.id}, ${tmdbId}, ${mediaType},
        coalesce(${watchlist}::boolean, false),
        coalesce(${favourite}::boolean, false),
        ${rating}::smallint
      )
      on conflict (user_id, tmdb_id, media_type) do update set
        in_watchlist = coalesce(${watchlist}::boolean, user_titles.in_watchlist),
        is_favourite = coalesce(${favourite}::boolean, user_titles.is_favourite),
        rating       = case when ${ratingGiven}::boolean
                            then ${rating}::smallint
                            else user_titles.rating end,
        updated_at   = now()
      returning tmdb_id, media_type, in_watchlist, is_favourite, rating, updated_at
    `

    const row = rows[0]

    // A row that is no longer saved, favourited or rated carries no meaning, so
    // it goes rather than accumulating as dead weight.
    if (!row.in_watchlist && !row.is_favourite && row.rating == null) {
      await sql`
        delete from user_titles
        where user_id = ${user.id} and tmdb_id = ${tmdbId} and media_type = ${mediaType}
      `
      return res.status(200).json({ item: null })
    }

    return res.status(200).json({ item: shape(row) })
  } catch (err) {
    console.error('library failed:', err)
    return res.status(500).json({ error: 'Could not update your library.' })
  }
}

const shape = (r) => ({
  tmdbId: r.tmdb_id,
  mediaType: r.media_type,
  watchlist: r.in_watchlist,
  favourite: r.is_favourite,
  rating: r.rating,
  updatedAt: r.updated_at,
})

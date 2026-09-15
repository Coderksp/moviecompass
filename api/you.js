// Everything about the person who is signed in.
//
// Two answers behind one route: `?want=profile` is who you are and what the app
// has worked out about your taste, `?want=picks` is the curated rail built from
// it. They were separate endpoints and are separate modules still — the logic
// lives in _lib/profileview.js and _lib/foryou.js — but they share a function,
// because Vercel's Hobby plan allows twelve serverless functions per deployment
// and this project had grown to exactly twelve before either existed.
//
// That is a deployment constraint rather than a design one, and it is a cheap
// one to satisfy here: both answers need the same session, the same library and
// the same taste profile, and asking for one warms the cache for the other.
import { requireUser, applyCors } from './_lib/session.js'
import { profileBody } from './_lib/profileview.js'
import { forYouBody } from './_lib/foryou.js'

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const user = await requireUser(req, res)
  if (!user) return

  const want = req.query.want === 'picks' ? 'picks' : 'profile'

  if (want === 'picks' && !process.env.TMDB_API_KEY) {
    return res.status(500).json({ error: 'TMDB_API_KEY is not set on the server.' })
  }

  try {
    const body = want === 'picks' ? await forYouBody(user) : await profileBody(user)

    // Private in both cases, and never shared. These answers belong to one
    // person, so an edge cache would be a data leak rather than an optimisation.
    // The rail gets a short window only to stop a double render paying for the
    // whole pipeline twice; the profile is cheap enough to always be fresh.
    res.setHeader(
      'Cache-Control',
      want === 'picks' ? 'private, max-age=120' : 'private, no-store'
    )
    return res.status(200).json(body)
  } catch (err) {
    console.error(`you?want=${want} failed:`, err)
    return res.status(500).json({
      error:
        want === 'picks'
          ? 'Could not build your recommendations.'
          : 'Could not load your profile.',
    })
  }
}

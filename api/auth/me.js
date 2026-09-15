import { readToken, clearSessionCookie, applyCors } from '../_lib/session.js'
import { sql } from '../_lib/db.js'

// The session cookie is httpOnly, so the client cannot read it to find out who
// it is. This endpoint is how the app learns whether it is signed in on load.
//
// The token carries only an id and a handle, which is all that should be signed
// into a thirty-day credential — a name or a picture stored there would be
// whatever was true a month ago. So the display details are read from the
// database on each check, and changing your Google picture is reflected the next
// time the app loads rather than the next time your session expires.
// The session, as a thing rather than two verbs. GET reads it; DELETE ends it.
//
// Ending it used to be its own function at /api/auth/logout. It was folded in
// here when the project hit Vercel's twelve-function ceiling, and the pairing is
// honest enough to keep regardless: this route is the session, and signing out
// is deleting it. DELETE rather than GET for the same reason logout was POST —
// nobody should be signed out by something prefetching a link.
export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method === 'DELETE' || req.method === 'POST') {
    clearSessionCookie(res)
    return res.status(200).json({ ok: true })
  }

  try {
    const token = await readToken(req)
    // A signed-out visitor is a normal state, not an error — 200 with a null
    // user keeps the client from having to treat 401 as routine.
    if (!token) return res.status(200).json({ user: null })

    try {
      const rows = await sql`
        select id, username, email, display_name, avatar_url, created_at
        from users where id = ${token.id} limit 1
      `
      const row = rows[0]
      // A valid token for an account that no longer exists is a signed-out
      // visitor, not an error.
      if (!row) return res.status(200).json({ user: null })

      return res.status(200).json({
        user: {
          id: row.id,
          username: row.username,
          name: row.display_name || row.username,
          avatar: row.avatar_url || null,
          memberSince: row.created_at,
        },
      })
    } catch (err) {
      // The database being unreachable should not sign everybody out. The token
      // alone proves who they are; only the decoration is missing.
      console.error('profile lookup failed:', err?.message || err)
      return res.status(200).json({
        user: { id: token.id, username: token.username, name: token.username, avatar: null },
      })
    }
  } catch (err) {
    return res.status(200).json({ user: null })
  }
}

import { readToken, applyCors } from '../_lib/session.js'

// The session cookie is httpOnly, so the client cannot read it to find out who
// it is. This endpoint is how the app learns whether it is signed in on load.
export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    const user = await readToken(req)
    // A signed-out visitor is a normal state, not an error — 200 with a null
    // user keeps the client from having to treat 401 as routine.
    return res.status(200).json({ user: user || null })
  } catch (err) {
    return res.status(200).json({ user: null })
  }
}

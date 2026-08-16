import { clearSessionCookie, applyCors } from '../_lib/session.js'

// POST rather than GET: a signed-out user should be the result of a deliberate
// action, not of something prefetching a link.
export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  clearSessionCookie(res)
  return res.status(200).json({ ok: true })
}

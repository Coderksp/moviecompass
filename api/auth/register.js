import bcrypt from 'bcryptjs'
import { sql } from '../_lib/db.js'
import { createToken, setSessionCookie, applyCors } from '../_lib/session.js'

// Cost 12: roughly a quarter-second per hash on serverless hardware. High enough
// that offline cracking of a stolen dump is expensive, low enough that a real
// sign-in does not feel slow.
const BCRYPT_COST = 12

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const { username, password } = req.body || {}

  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return res.status(400).json({
      error: '3–24 characters, using letters, numbers, dot, underscore or hyphen.',
    })
  }
  // Length is the only rule worth enforcing. Composition rules ("must contain a
  // symbol") push people toward predictable substitutions and shorter passwords.
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }
  if (password.length > 200) {
    return res.status(400).json({ error: 'Password is too long.' })
  }

  const name = username.trim()

  try {
    const existing = await sql`
      select 1 from users where lower(username) = lower(${name}) limit 1
    `
    if (existing.length) {
      return res.status(409).json({ error: 'That username is taken.' })
    }

    const hash = await bcrypt.hash(password, BCRYPT_COST)
    const rows = await sql`
      insert into users (username, password_hash)
      values (${name}, ${hash})
      returning id, username
    `
    const user = rows[0]

    setSessionCookie(res, await createToken(user))
    return res.status(201).json({ user: { id: user.id, username: user.username } })
  } catch (err) {
    // The unique index is the real guard against two requests racing past the
    // check above; the check just gives a nicer message when there is no race.
    if (String(err?.message || '').includes('users_username_lower_idx')) {
      return res.status(409).json({ error: 'That username is taken.' })
    }
    console.error('register failed:', err)
    return res.status(500).json({ error: 'Could not create the account.' })
  }
}

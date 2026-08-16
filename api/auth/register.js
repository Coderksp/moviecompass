import bcrypt from 'bcryptjs'
import { sql } from '../_lib/db.js'
import { createToken, setSessionCookie, applyCors } from '../_lib/session.js'

// Cost 12: roughly a quarter-second per hash on serverless hardware. High enough
// that offline cracking of a stolen dump is expensive, low enough that a real
// sign-in does not feel slow.
const BCRYPT_COST = 12

// An email is accepted as an identifier as well as a plain username. Browsers
// autofill an email into any field marked autocomplete="username", so rejecting
// one means fighting the password manager on every sign-up.
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const looksLikeEmail = (v) => v.includes('@')

export function validIdentifier(v) {
  if (typeof v !== 'string') return false
  const s = v.trim()
  // Emails get their own bounds — the 24-character username cap would reject
  // most real addresses.
  return looksLikeEmail(s) ? EMAIL_RE.test(s) && s.length <= 254 : USERNAME_RE.test(s)
}

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const { username, password } = req.body || {}

  if (!validIdentifier(username)) {
    return res.status(400).json({
      error: 'Use an email address, or 3–24 characters of letters, numbers, dot, underscore or hyphen.',
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
    // An email identifier is stored in both columns: username is what you sign
    // in and display as, email is what a Google or Facebook account will later
    // be matched against so the same person does not end up with two accounts.
    const email = looksLikeEmail(name) ? name : null
    const rows = await sql`
      insert into users (username, email, password_hash)
      values (${name}, ${email}, ${hash})
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

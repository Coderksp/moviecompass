import bcrypt from 'bcryptjs'
import { sql } from '../_lib/db.js'
import { createToken, setSessionCookie, applyCors } from '../_lib/session.js'

// A bcrypt hash of a value nobody knows. When the username does not exist we
// still compare against this, so a missing account takes the same ~250ms as a
// wrong password. Without it, response timing tells an attacker which usernames
// are real, which is the first step of a credential stuffing run.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7BwHqSAyIfx4iCiiIsyLL9YtxSlNRNu'

const MAX_ATTEMPTS = 8
const WINDOW_MINUTES = 15

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const { username, password } = req.body || {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' })
  }
  const name = username.trim()

  try {
    const recent = await sql`
      select count(*)::int as n from login_attempts
      where lower(username) = lower(${name})
        and attempted > now() - interval '${WINDOW_MINUTES} minutes'
    `
    if ((recent[0]?.n || 0) >= MAX_ATTEMPTS) {
      return res.status(429).json({
        error: `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`,
      })
    }

    const rows = await sql`
      select id, username, password_hash from users
      where lower(username) = lower(${name}) limit 1
    `
    const user = rows[0]

    // Always run a comparison, even with no user, to keep the timing flat.
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH)

    if (!user || !user.password_hash || !ok) {
      await sql`insert into login_attempts (username) values (${name})`
      // One message for every failure. Saying "no such user" versus "wrong
      // password" hands over a list of which accounts exist.
      return res.status(401).json({ error: 'Invalid username or password.' })
    }

    await sql`delete from login_attempts where lower(username) = lower(${name})`
    setSessionCookie(res, await createToken(user))
    return res.status(200).json({ user: { id: user.id, username: user.username } })
  } catch (err) {
    console.error('login failed:', err)
    return res.status(500).json({ error: 'Could not sign in.' })
  }
}

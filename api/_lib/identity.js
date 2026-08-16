import { sql } from './db.js'

// Resolves a provider identity to an account, creating one only when it is
// genuinely a new person.
//
// The order matters. Matching the provider id first is exact — it is the same
// Google account signing in again. Falling back to email is what stops someone
// who registered with a password from getting a second, separate account the
// first time they press "Continue with Google".
export async function findOrCreateUser({ provider, providerId, email, name }) {
  const linked = await sql`
    select u.id, u.username
    from user_identities i
    join users u on u.id = i.user_id
    where i.provider = ${provider} and i.provider_id = ${providerId}
    limit 1
  `
  if (linked.length) return linked[0]

  if (email) {
    const existing = await sql`
      select id, username from users where lower(email) = lower(${email}) limit 1
    `
    if (existing.length) {
      const user = existing[0]
      await sql`
        insert into user_identities (user_id, provider, provider_id)
        values (${user.id}, ${provider}, ${providerId})
        on conflict (provider, provider_id) do nothing
      `
      return user
    }
  }

  const username = await freeUsername(name || email || provider)
  const created = await sql`
    insert into users (username, email, password_hash)
    values (${username}, ${email || null}, null)
    returning id, username
  `
  const user = created[0]
  await sql`
    insert into user_identities (user_id, provider, provider_id)
    values (${user.id}, ${provider}, ${providerId})
    on conflict (provider, provider_id) do nothing
  `
  return user
}

// Display names from a provider collide freely, so a suffix is appended until
// one is free. The unique index is still the real guard against a race.
async function freeUsername(seed) {
  const base =
    String(seed).split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20) || 'user'
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}${i}`
    if (candidate.length < 3) continue
    const taken = await sql`
      select 1 from users where lower(username) = lower(${candidate}) limit 1
    `
    if (!taken.length) return candidate
  }
  return `${base}${Date.now().toString(36).slice(-5)}`
}

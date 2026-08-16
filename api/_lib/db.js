import { neon } from '@neondatabase/serverless'

// Files under api/ starting with an underscore are not routed by Vercel, so
// this is shared code rather than an endpoint.
//
// Neon's driver speaks Postgres over HTTP. That matters here: a serverless
// function may run in hundreds of concurrent instances, and a normal TCP pool
// would exhaust the database's connection limit almost immediately.
let cached = null

export function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set on the server.')
  }
  if (!cached) cached = neon(process.env.DATABASE_URL)
  return cached
}

// Always called as a tagged template — sql`select * from users where id = ${id}`
// — so values are sent as bound parameters and never concatenated into the
// query text. This is what makes SQL injection impossible here, not escaping.
export const sql = (strings, ...values) => db()(strings, ...values)

import crypto from 'node:crypto'
import { db } from '../_lib/db.js'
import { STATEMENTS } from '../_lib/schema.js'

// Runs the schema from Vercel rather than from your machine.
//
// Some ISPs (the same ones that block themoviedb.org) also block Neon's compute
// endpoint, which makes Neon's own SQL editor unusable from an affected
// connection. Vercel is not blocked, so the migration runs from there instead.
//
// This endpoint can create and alter tables, so it is inert unless
// MIGRATE_SECRET is set, and it refuses without a matching secret. Unset the
// variable — or delete this file — once the schema is in place.
function authorised(req) {
  const expected = process.env.MIGRATE_SECRET
  if (!expected) return false
  const given = req.query?.secret || req.headers?.['x-migrate-secret'] || ''
  const a = Buffer.from(String(given))
  const b = Buffer.from(expected)
  // Compared in constant time so the response cannot be used to guess it.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')

  if (!process.env.MIGRATE_SECRET) {
    return res.status(404).json({ error: 'Not found.' })
  }
  if (!authorised(req)) {
    return res.status(403).json({ error: 'Forbidden.' })
  }

  try {
    const client = db()
    // .query() rather than the tagged form: these are fixed DDL statements held
    // in code, not values, and the tagged form exists to bind values safely.
    // Nothing here comes from the request.
    for (const statement of STATEMENTS) {
      await client.query(statement)
    }

    // Report what actually exists afterwards, so a 200 means the schema is
    // really there rather than merely that nothing threw.
    const result = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`
    )
    const rows = result?.rows || result || []

    return res.status(200).json({
      ok: true,
      statementsRun: STATEMENTS.length,
      tables: rows.map((t) => t.table_name),
    })
  } catch (err) {
    console.error('migrate failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}

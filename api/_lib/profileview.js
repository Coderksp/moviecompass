// Who you are here, and what the app has worked out about you.
//
// The second half is the point. A recommender that cannot show its reasoning
// asks to be trusted for no reason, and "we think you like Tamil thrillers by
// Lokesh Kanagaraj, mostly from the last five years" is both checkable and
// correctable — if it is wrong, the fix is visible: rate something.
//
// Under _lib for the same reason as ./foryou.js: one route, /api/you, serves
// both, because the Hobby plan allows twelve functions and this project is at
// twelve.
import { sql } from './db.js'
import { tasteSummary } from './taste.js'
import { viewerTaste, fingerprintOf, MIN_SIGNALS } from './viewer.js'

// The languages the app can browse by, which are the ones a taste is likely to
// be expressed in. Anything else falls back to its code rather than pretending
// to a name we do not have.
const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
  kn: 'Kannada', ko: 'Korean', ja: 'Japanese', zh: 'Chinese', fr: 'French',
  es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', th: 'Thai', tr: 'Turkish',
}

const languageName = (code) => LANGUAGE_NAMES[code] || String(code || '').toUpperCase()

// The certificate scale the model reasons on, said back in words.
const MATURITY_LABEL = ['family viewing', 'mostly PG', 'mostly PG-13', 'mostly R', 'adult']

export async function profileBody(user) {
  {
    const rows = await sql`
      select id, username, email, display_name, avatar_url, created_at
      from users where id = ${user.id} limit 1
    `
    const row = rows[0]
    if (!row) return { user: null }

    // Counts come from the whole library, not the recent slice the taste is
    // built from — these are totals somebody can check against their own rails,
    // and a number that disagreed with the shelf beneath it would read as a bug.
    const counts = await sql`
      select
        count(*) filter (where in_watchlist)    ::int as watchlist,
        count(*) filter (where is_favourite)    ::int as favourites,
        count(*) filter (where rating is not null)::int as rated,
        coalesce(round(avg(rating) filter (where rating is not null), 1), 0) as average
      from user_titles where user_id = ${user.id}
    `

    let taste = null
    let ready = false
    try {
      const fingerprint = await fingerprintOf(user.id)
      const loaded = await viewerTaste(user.id, fingerprint)
      ready = loaded.taste.loved.length >= MIN_SIGNALS
      if (ready) {
        const summary = tasteSummary(loaded.taste, languageName)
        taste = {
          ...summary,
          maturity:
            summary.maturity == null
              ? null
              : MATURITY_LABEL[Math.min(summary.maturity, MATURITY_LABEL.length - 1)],
        }
      }
    } catch (err) {
      // The taste is the interesting half but the identity is the load-bearing
      // one. A TMDB outage should cost the breakdown, not the page.
      console.error('taste summary failed:', err?.message || err)
    }

    return ({
      user: {
        id: row.id,
        username: row.username,
        name: row.display_name || row.username,
        email: row.email || null,
        avatar: row.avatar_url || null,
        memberSince: row.created_at,
      },
      counts: counts[0],
      taste,
      tasteReady: ready,
      needed: Math.max(0, MIN_SIGNALS - (counts[0]?.favourites || 0) - (counts[0]?.rated || 0)),
    })
  }
}

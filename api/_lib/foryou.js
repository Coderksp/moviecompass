// The personalised rail — recommendations for a person rather than for a title.
//
// Structurally this is /api/similar run several times over and judged
// differently. The candidate generators are the same, because "what is near
// this" is the same question however you arrived at it; what changes is that
// they are seeded from the handful of titles somebody actually rates highly, and
// that the results are scored against their whole taste instead of any one film.
//
// It lives under _lib rather than being its own route because Vercel's Hobby
// plan allows twelve serverless functions and this project sits on that ceiling.
// /api/you is the one function; this is half of what it serves.
import { profile, fuse, shortlist, diversify } from './recommend.js'
import { generate, enrich } from './candidates.js'
import { tasteScore, tasteReason, tasteConnected, because } from './taste.js'
import { viewerTaste, fingerprintOf, MIN_SIGNALS } from './viewer.js'
import { explainForYou } from './explain.js'

// How many of their titles seed the search. Each one costs a full round of
// generator queries, and past four or five the candidates are overwhelmingly
// ones the earlier seeds already found — the same films keep being near the same
// films. Four covers a taste without making the page wait.
const SEEDS = 4

const SHORTLIST = 28
const RESULTS = 16

// ---------------------------------------------------------------------------

async function buildFor(userId, fingerprint) {
  const { entries, profiles, taste } = await viewerTaste(userId, fingerprint)
  if (!entries.length) return { ready: false, saved: 0, picks: [], taste: null }

  if (taste.loved.length < MIN_SIGNALS) {
    return { ready: false, saved: taste.loved.length, picks: [], taste }
  }

  // Each seed runs the full generator set, tagged so a candidate remembers which
  // of their titles led to it. That provenance is the whole basis of the caption
  // — it is what turns "you may like this" into "because you loved Vikram".
  const seeds = taste.loved.slice(0, SEEDS)
  const perSeed = await Promise.all(
    seeds.map(async (s) => {
      const p = profiles[entries.findIndex(
        (e) => e.tmdbId === s.id && e.mediaType === s.mediaType
      )]
      if (!p) return []
      try {
        const lists = await generate(p, s.mediaType)
        return lists.map((l) => ({ ...l, seed: `${s.mediaType}:${s.id}` }))
      } catch {
        return []
      }
    })
  )

  const pool = fuse(perSeed.flat())

  // Never recommend back what they already saved, rated or watched.
  for (const key of taste.seen) pool.delete(key)
  if (!pool.size) return { ready: false, saved: taste.loved.length, picks: [], taste }

  const coarse = shortlist(
    [...pool.values()].map((entry) => {
      const cand = profile(entry.item, entry.item.mediaType)
      // Every coarse candidate is missing keywords and credits equally, so
      // scoring them against the full taste is still a fair comparison between
      // them — the absent features simply score zero across the board.
      return { entry, cand, score: tasteScore(taste, cand, entry.prior).score }
    }),
    SHORTLIST
  )

  const enriched = await enrich(coarse)

  const scored = enriched
    .map((row) => {
      const { score, parts } = tasteScore(taste, row.cand, row.entry.prior)
      const sources = because(taste, row.entry)
      return {
        score,
        parts,
        sources,
        reason: tasteReason(taste, row.cand, parts, sources),
        because: sources.map((s) => s.title),
        sharedKeywordNames: [...row.cand.keywords]
          .filter((k) => (taste.keywords.get(k) || 0) > 0)
          .map((k) => taste.keywordNames.get(k))
          .filter(Boolean)
          .slice(0, 5),
        sharedPeopleNames: [
          ...[...row.cand.directors].map((d) => taste.directorNames.get(d)),
          ...[...row.cand.cast].map((c) => taste.castNames.get(c)),
        ].filter(Boolean).slice(0, 3),
        profile: row.cand,
        item: row.full || row.entry.item,
      }
    })
    // Same rule as the modal rail: nothing is shown that cannot be described.
    .filter((p) => p.reason)
    .sort((a, b) => b.score - a.score)

  // And the same two tiers. Titles with a real claim on somebody's taste go
  // first; the rest only pad a rail that would otherwise look sparse.
  const strong = scored.filter((p) => tasteConnected(p.parts))
  const ranked =
    strong.length >= RESULTS ? strong : [...strong, ...scored.filter((p) => !tasteConnected(p.parts))]

  return {
    ready: strong.length > 0,
    saved: taste.loved.length,
    taste,
    picks: diversify(ranked, RESULTS),
  }
}

// ---------------------------------------------------------------------------

// Keyed by who is asking and by what their library currently holds, so saving or
// rating something rebuilds the rail on the next load rather than serving a
// recommendation that ignores what they just told us.
const cache = new Map()
const MAX_CACHED = 32

function cached(userId, fingerprint) {
  const key = `${userId}:${fingerprint}`
  if (!cache.has(key)) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
    cache.set(
      key,
      buildFor(userId, fingerprint).catch((err) => {
        cache.delete(key)
        throw err
      })
    )
  }
  return cache.get(key)
}

// Returns the response body. Throwing is left to the caller to turn into a
// status, so the route stays the only place that knows about HTTP.
export async function forYouBody(user) {
  {
    // Cheap enough to run on every request, and it is what makes the cache
    // correct rather than merely fast.
    const fingerprint = await fingerprintOf(user.id)
    const { ready, saved, picks, taste } = await cached(user.id, fingerprint)

    let reasons = null
    if (ready && picks.length && process.env.ANTHROPIC_API_KEY) {
      try {
        reasons = await explainForYou(
          {
            topGenres: [...taste.genreNames.values()].slice(0, 5),
            topLanguages: [...taste.languages.keys()].slice(0, 3),
            topPeople: [...taste.directorNames.values()].slice(0, 3),
            loved: taste.loved.slice(0, 6).map((l) => l.title),
            eraLabel: taste.year ? `around ${taste.year}` : null,
          },
          picks
        )
      } catch (err) {
        console.error('for-you explanation failed:', err?.message || err)
      }
    }

    // Private, and briefly. The answer belongs to one person, so a shared cache
    // would be a data leak rather than an optimisation; the short window is only
    // there to stop a double render paying for the whole pipeline twice.
    return ({
      ready,
      // What the empty state needs to say: how many more titles to rate before
      // this becomes worth showing.
      saved,
      needed: Math.max(0, MIN_SIGNALS - saved),
      canExplain: !!process.env.ANTHROPIC_API_KEY,
      explained: !!reasons,
      items: picks.map((p) => {
        const key = `${p.profile.mediaType}:${p.profile.id}`
        return {
          id: p.profile.id,
          mediaType: p.profile.mediaType,
          title: p.profile.title,
          release_date: p.item.release_date || p.item.first_air_date || null,
          poster_path: p.item.poster_path || null,
          backdrop_path: p.item.backdrop_path || null,
          vote_average: p.item.vote_average || 0,
          vote_count: p.item.vote_count || 0,
          overview: p.item.overview || '',
          original_language: p.profile.lang,
          because: p.because,
          reason: reasons?.get(key) || p.reason,
        }
      }),
    })
  }
}

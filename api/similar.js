// "More like this" — the recommendation endpoint.
//
// This file is the plumbing for one seed title: it asks ./_lib/candidates.js for
// things worth considering, hands them to the model in ./_lib/recommend.js, and
// writes the explanations. The decision about what counts as similar lives
// there, not here.
//
// It runs server-side for the same reasons the rest of /api does — the TMDB key
// stays out of the bundle, and several Indian ISPs block themoviedb.org outright
// so a browser-side call would simply fail for a large share of visitors. It
// also means one request from the phone replaces the thirty this pipeline makes.
//
// Answers are cached hard at the edge. Recommendations for a given film barely
// move week to week, and the Claude pass costs real money, so serving the same
// ranking to everyone who opens that film is both faster and cheaper.
import {
  profile,
  fuse,
  candidateKey,
  idfOver,
  coarseScore,
  fineScore,
  shortlist,
  connected,
  diversify,
  ruleReason,
} from './_lib/recommend.js'
import { tmdb, CERTIFICATION } from './_lib/tmdb.js'
import { generate, enrich } from './_lib/candidates.js'
import { explainSimilar } from './_lib/explain.js'

// How many survive stage one and get a full metadata lookup — one request each,
// in parallel, and the dominant cost of the whole endpoint.
//
// Around twenty the shortlist starts cutting titles that would have placed once
// their keywords were known, and the tail of the rail fills with whatever thin
// match was left. Far above thirty the extra requests buy nothing: a candidate
// that ranked 60th on genre and audience overlap does not climb into the top ten
// on keywords alone.
const SHORTLIST = 32
const RESULTS = 12

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

async function rank(id, mediaType) {
  const details = await tmdb(`/${mediaType}/${id}`, {
    append_to_response: `keywords,credits,recommendations,${CERTIFICATION[mediaType]}`,
  })
  const seed = profile(details, mediaType)

  const pool = fuse(await generate(seed, mediaType, details))
  pool.delete(candidateKey({ id: Number(id), mediaType }))

  if (!pool.size) return { seed, picks: [] }

  // Stage one: rank everything on what a list result already tells us, then cut
  // to a shortlist that still holds something from every generator.
  const coarse = shortlist(
    [...pool.values()].map((entry) => {
      const cand = profile(entry.item, entry.item.mediaType)
      return { entry, cand, score: coarseScore(seed, cand, entry.prior) }
    }),
    SHORTLIST
  )

  // Stage two: one full lookup each, in parallel. A failed lookup keeps its
  // list-level profile and simply scores nothing on the features it lacks.
  const enriched = await enrich(coarse)

  // Both IDF tables are built over the shortlist rather than shipped as a fixed
  // corpus, so "what is common here" is measured against the actual competition
  // for this film — the word "heist" is rare in general and unremarkable in a
  // pool generated from a heist film.
  const profiles = [seed, ...enriched.map((r) => r.cand)]
  const idf = {
    keyword: idfOver(profiles, (p) => p.keywords),
    text: idfOver(profiles, (p) => p.terms.keys()),
    // Genres too. In a pool generated from a science-fiction film nearly
    // everything is science fiction, so sharing that says little, while sharing
    // something the pool rarely sees says a lot.
    genre: idfOver(profiles, (p) => p.genres),
  }

  const scored = enriched
    .map((row) => {
      const { score, parts } = fineScore(seed, row.cand, row.entry.prior, idf)
      return {
        score,
        parts,
        reason: ruleReason(seed, row.cand, parts),
        profile: row.cand,
        item: row.full || row.entry.item,
        sources: [...row.entry.sources],
      }
    })
    // Nothing the app cannot describe is ever shown, including among the
    // fill-ins below. Without this the padding is where the embarrassments come
    // from: It's Always Sunny in Philadelphia arrived under Game of Thrones with
    // a blank caption, because the rail needed a twelfth title and stopped
    // asking questions once it did.
    .filter((p) => p.reason)
    .sort((a, b) => b.score - a.score)

  // Candidates with something concrete to say go first, and the rest are only
  // drawn on to fill a rail that would otherwise look broken. A genre-and-
  // popularity match is better than an empty row and worse than everything else.
  const strong = scored.filter((p) => connected(p.parts))
  const ranked =
    strong.length >= RESULTS
      ? strong
      : [...strong, ...scored.filter((p) => !connected(p.parts))]

  return { seed, picks: diversify(ranked, RESULTS) }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Warm instances answer the explain call without re-running the pipeline. The
// ranking is deterministic, so the two calls agree on the order either way —
// this only saves the work.
const rankCache = new Map()

// A ranking holds a couple of dozen full TMDB payloads, so this is the one
// cache here big enough to matter. Serverless instances are short-lived enough
// that it would very likely never be reached, which is exactly why it is worth
// having — a busy instance that stays warm should not grow without limit just
// because nothing ever forced the question.
const MAX_CACHED_RANKINGS = 64

function cachedRank(id, mediaType) {
  const k = `${mediaType}:${id}`
  if (!rankCache.has(k)) {
    if (rankCache.size >= MAX_CACHED_RANKINGS) {
      // Oldest first — Map iterates in insertion order.
      rankCache.delete(rankCache.keys().next().value)
    }
    rankCache.set(
      k,
      rank(id, mediaType).catch((err) => {
        rankCache.delete(k) // let the next request try again
        throw err
      })
    )
  }
  return rankCache.get(k)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (!process.env.TMDB_API_KEY) {
    return res.status(500).json({ error: 'TMDB_API_KEY is not set on the server.' })
  }

  const id = String(req.query.id || '')
  const mediaType = req.query.type === 'tv' ? 'tv' : 'movie'
  // The client asks twice on purpose: once without, to put the rail on screen,
  // then again with, to fill in the captions. Waiting on Claude before showing
  // anything would mean staring at a spinner for a list that was ready.
  const explain = req.query.explain === '1'

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'A numeric id is required.' })
  }

  try {
    const { seed, picks } = await cachedRank(id, mediaType)

    let reasons = null
    let reasonsFrom = 'rules'

    if (explain && picks.length && process.env.ANTHROPIC_API_KEY) {
      try {
        reasons = await explainSimilar(seed, picks)
        if (reasons) reasonsFrom = 'claude'
      } catch (err) {
        // No key, no quota, a timeout, a bad gateway — none of it should cost
        // the visitor their recommendations.
        console.error('claude explanation failed:', err?.message || err)
      }
    }

    const items = picks.map((p) => {
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
        // Rounded because these are shown to a person, not compared by one.
        match: Math.round(p.score * 100) / 100,
        why: p.sources,
        reason: reasons?.get(key) || p.reason,
      }
    })

    // Long at the edge, because the ranking for a given film is the same for
    // everyone and the expensive part is upstream. Stale-while-revalidate means
    // the refresh happens behind somebody else's instant response, not theirs.
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=21600, stale-while-revalidate=604800'
    )
    return res.status(200).json({
      seed: { id: seed.id, mediaType: seed.mediaType, title: seed.title },
      model: 'moviecompass-hybrid-v1',
      reasonsFrom,
      explained: reasonsFrom === 'claude',
      // Whether asking again with explain=1 could return anything better. With
      // no key configured it could not, and the client skips a second request
      // that would re-run the entire pipeline to produce identical captions.
      canExplain: !!process.env.ANTHROPIC_API_KEY,
      items,
    })
  } catch (err) {
    console.error('similar failed:', err)
    return res.status(502).json({ error: 'Could not work out what is similar.' })
  }
}

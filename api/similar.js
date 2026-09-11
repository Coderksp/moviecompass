// "More like this" — the recommendation endpoint.
//
// This file is the plumbing: it fetches candidates from TMDB, hands them to the
// model in ./_lib/recommend.js, and writes the explanations. The decision about
// what counts as similar lives there, not here.
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
  queryKeywords,
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

const TMDB = 'https://api.themoviedb.org/3'

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

// Generous enough for TMDB on a slow day, short enough that a hung upstream
// cannot hold the whole function open until the platform kills it.
const UPSTREAM_TIMEOUT = 6000

// The Claude pass is an enhancement, not the feature. If it has not answered in
// this long, the rule-written reasons ship instead — which keeps the function
// comfortably inside even a 10-second platform limit.
const CLAUDE_TIMEOUT = 8000

async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  url.searchParams.set('api_key', process.env.TMDB_API_KEY)

  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) })
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`)
  return res.json()
}

// A generator that fails takes its list out of the fusion and nothing else. The
// ranking degrades — fewer lists voting — rather than the request collapsing
// because one discover query timed out.
const safely = (promise, source) =>
  promise
    .then((items) => ({ source, items }))
    .catch(() => ({ source, items: [] }))

// TMDB names the same fields differently for films and series. Normalising on
// the way in means the model never has to know which it is looking at.
const normalize = (item, mediaType) => ({
  ...item,
  mediaType,
  title: item.title || item.name,
  release_date: item.release_date || item.first_air_date,
})

// A title with no art cannot be rendered as a card, and one nobody has rated is
// usually an incomplete record rather than a discovery.
const usable = (item) =>
  (item.poster_path || item.backdrop_path) && !item.adult && (item.vote_count || 0) >= 5

const listFrom = (data, mediaType) =>
  (data?.results || []).filter(usable).map((m) => normalize(m, mediaType))

// ---------------------------------------------------------------------------
// Keyword rarity
// ---------------------------------------------------------------------------

// How many titles carry a keyword, asked rather than assumed.
//
// Which keywords to search on is the single decision that most affects what the
// rail ends up holding, and guessing at it kept going wrong in ways that were
// obvious in hindsight: "allegory" and "manipulation" look specific next to
// "mission", so a hand-written trope list keeps them — and TMDB has tagged
// thousands of prestige films with both, so searching them returns The Lion King
// for Inception.
//
// A discover query reports its own total, so rarity is one cheap request per
// keyword and needs no corpus of our own. Results are memoised because a
// keyword's size does not meaningfully move, and because the same handful of
// keywords recurs across every film in a genre.
const rarityCache = new Map()

async function rarity(keywordId, mediaType) {
  const k = `${mediaType}:${keywordId}`
  if (!rarityCache.has(k)) {
    rarityCache.set(
      k,
      tmdb(`/discover/${mediaType}`, { with_keywords: keywordId })
        .then((d) => d.total_results ?? 0)
        .catch(() => {
          rarityCache.delete(k)
          return null // unknown, not "rare" — see the sort below
        })
    )
  }
  return rarityCache.get(k)
}

// Below this a keyword is not specific, it is unused — a typo, a one-off, or a
// tag somebody added to a single film. Searching it returns almost nothing and
// wastes one of the few slots.
const MIN_KEYWORD_FILMS = 8

// Picks what to actually search on: rare enough to mean something, common enough
// to have neighbours.
async function chooseKeywords(seed, mediaType, n = 6) {
  const shortlisted = queryKeywords(seed)
  if (!shortlisted.length) return []

  const sized = await Promise.all(
    shortlisted.map(async (id) => ({ id, count: await rarity(id, mediaType) }))
  )

  return sized
    .filter((k) => k.count != null && k.count >= MIN_KEYWORD_FILMS)
    .sort((a, b) => a.count - b.count)
    .slice(0, n)
    .map((k) => k.id)
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

// Five ways of asking "what else is like this", because each one is wrong on its
// own. Recommendations know what audiences watched next but say nothing about a
// film nobody has finished watching yet. Keywords know the premise but rank a
// shoestring imitation level with the original. Cast and crew find the people
// but not the story. The fusion step is what makes the disagreement useful.
//
// TMDB's own /similar endpoint was a sixth and has been removed. It is built
// from genres and keywords with no ranking pass, and measured across a spread of
// seeds it produced only noise — My Spy, Megalopolis and a film called Awaken
// for Inception, Die Hard for Vikram — while never once surfacing something the
// other five missed. The keyword generator asks the same question and ranks the
// answer.
async function generate(seed, mediaType, details) {
  // A pipe is OR — any one of these is enough to be a candidate. AND would be
  // nearly always empty, since few films share six specific keywords. What makes
  // the OR usable is that every keyword in it has been checked for rarity first.
  const topKeywords = (await chooseKeywords(seed, mediaType)).join('|')
  const genres = [...seed.genres].slice(0, 2).join(',')

  const lists = [
    safely(
      Promise.resolve(listFrom(details.recommendations, mediaType)),
      'recommendations'
    ),
  ]

  if (topKeywords) {
    lists.push(
      safely(
        tmdb(`/discover/${mediaType}`, {
          with_keywords: topKeywords,
          sort_by: 'popularity.desc',
          'vote_count.gte': 20,
        }).then((d) => listFrom(d, mediaType)),
        'keywords'
      )
    )
    // The same question asked of the back catalogue. Sorting by popularity
    // returns whatever is in cinemas that shares a keyword, which is how a
    // premise match gets beaten to the rail by this month's releases; sorting by
    // rating instead finds the film people still bring up years later. The vote
    // floor is high because an unpopular sort is exactly where a handful of
    // enthusiastic votes can crown something nobody has seen.
    lists.push(
      safely(
        tmdb(`/discover/${mediaType}`, {
          with_keywords: topKeywords,
          sort_by: 'vote_average.desc',
          'vote_count.gte': 300,
        }).then((d) => listFrom(d, mediaType)),
        'acclaimed'
      )
    )
  }

  // Two separate questions. "Who else did this director make something with"
  // and "what else is this actor in" are different strengths of evidence, and
  // folding them into one with_people query lets the more famous cast member
  // crowd the director out of the list entirely.
  //
  // /discover/movie filters on people directly; /discover/tv cannot, so a series
  // asks the other way round — what else these people are in.
  const directors = [...seed.directors].slice(0, 2)
  const leads = [...seed.cast].slice(0, 2)

  if (mediaType === 'movie') {
    if (directors.length) {
      lists.push(
        safely(
          tmdb('/discover/movie', {
            with_crew: directors.join('|'),
            sort_by: 'popularity.desc',
            'vote_count.gte': 10,
          }).then((d) => listFrom(d, mediaType)),
          'director'
        )
      )
    }
    if (leads.length) {
      lists.push(
        safely(
          tmdb('/discover/movie', {
            with_cast: leads.join('|'),
            sort_by: 'popularity.desc',
            'vote_count.gte': 10,
          }).then((d) => listFrom(d, mediaType)),
          'cast'
        )
      )
    }
  } else {
    // A creator's and a lead's series both come from the same endpoint, which
    // returns cast and crew credits separately — so one request covers both.
    const person = directors[0] || leads[0]
    if (person) {
      const source = directors[0] ? 'director' : 'cast'
      lists.push(
        safely(
          tmdb(`/person/${person}/tv_credits`).then((d) =>
            [...(d?.crew || []), ...(d?.cast || [])]
              .filter(usable)
              .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
              .slice(0, 20)
              .map((m) => normalize(m, 'tv'))
          ),
          source
        )
      )
    }
  }

  // The route in for regional cinema. Without it a Tamil thriller's neighbours
  // are decided almost entirely by TMDB's English-weighted lists, and the rail
  // drifts to Hollywood on popularity alone.
  if (seed.lang && genres) {
    lists.push(
      safely(
        tmdb(`/discover/${mediaType}`, {
          with_original_language: seed.lang,
          with_genres: genres,
          sort_by: 'popularity.desc',
          'vote_count.gte': 10,
        }).then((d) => listFrom(d, mediaType)),
        'language'
      )
    )
  }

  return Promise.all(lists)
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

async function rank(id, mediaType) {
  const details = await tmdb(`/${mediaType}/${id}`, {
    append_to_response: 'keywords,credits,recommendations',
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
  const enriched = await Promise.all(
    coarse.map(async (row) => {
      try {
        const full = await tmdb(`/${row.cand.mediaType}/${row.cand.id}`, {
          append_to_response: 'keywords,credits',
        })
        return { ...row, cand: profile(full, row.cand.mediaType), full }
      } catch {
        return row
      }
    })
  )

  // Both IDF tables are built over the shortlist rather than shipped as a fixed
  // corpus, so "what is common here" is measured against the actual competition
  // for this film — the word "heist" is rare in general and unremarkable in a
  // pool generated from a heist film.
  const profiles = [seed, ...enriched.map((r) => r.cand)]
  const idf = {
    keyword: idfOver(profiles, (p) => p.keywords),
    text: idfOver(profiles, (p) => p.terms.keys()),
  }

  const scored = enriched
    .map((row) => {
      const { score, parts } = fineScore(seed, row.cand, row.entry.prior, idf)
      return {
        score,
        parts,
        profile: row.cand,
        item: row.full || row.entry.item,
        sources: [...row.entry.sources],
      }
    })
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
// Explanations
// ---------------------------------------------------------------------------

// Claude is given the connections the model already found and asked to say them
// in a sentence a person would actually read. It is not asked what is similar —
// that question has been answered by this point, and letting it re-decide would
// mean the caption could describe a link the ranking never scored.
async function explainWithClaude(seed, picks) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ timeout: CLAUDE_TIMEOUT, maxRetries: 0 })

  const describe = (p) => ({
    key: `${p.profile.mediaType}:${p.profile.id}`,
    title: p.profile.title,
    year: p.profile.year,
    genres: p.profile.genreNames,
    shared_keywords: [...p.profile.keywords]
      .filter((k) => seed.keywords.has(k))
      .map((k) => seed.keywordNames.get(k))
      .filter(Boolean)
      .slice(0, 6),
    shared_cast: [...p.profile.cast]
      .filter((c) => seed.cast.has(c))
      .map((c) => seed.castNames.get(c))
      .filter(Boolean),
    shared_director: [...p.profile.directors].some((d) => seed.directors.has(d)),
    overview: String(p.item.overview || '').slice(0, 300),
  })

  const response = await client.messages.create({
    model: 'claude-opus-5',
    // The answer is a dozen short captions, so this is not a ceiling anyone
    // expects to reach. It is set well above what they need because reasoning
    // tokens are counted against it too, and running out mid-object would leave
    // unparseable JSON — which costs the whole call for nothing. Only what is
    // actually generated is billed, so the headroom is free.
    max_tokens: 8000,
    output_config: {
      // A caption apiece is not a reasoning problem, and this call sits in front
      // of a rail somebody is waiting on.
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            reasons: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['key', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['reasons'],
          additionalProperties: false,
        },
      },
    },
    system:
      'You write one-line captions explaining why a film or series was recommended ' +
      'to someone who just looked at another one. Rules: at most 14 words; no ' +
      'sentence-ending period; never begin with "If you liked" or "Similar to"; ' +
      'name the concrete thread — a shared premise, director, star, setting or mood ' +
      '— using only the connection data given; never reveal a plot twist or ending; ' +
      'never invent a link that is not in the data. Return one entry per key you ' +
      'were given, reusing the key exactly.',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          watched: {
            title: seed.title,
            year: seed.year,
            genres: seed.genreNames,
            keywords: [...seed.keywordNames.values()].slice(0, 12),
            overview: String(seed.overview || '').slice(0, 300),
          },
          recommendations: picks.map(describe),
        }),
      },
    ],
  })

  // A refusal or a truncated answer is not an error worth failing the request
  // over — the rail already has reasons.
  if (response.stop_reason === 'refusal') return null

  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) return null

  const parsed = JSON.parse(text)
  const out = new Map()
  for (const r of parsed.reasons || []) {
    if (r?.key && typeof r.reason === 'string' && r.reason.trim()) {
      out.set(r.key, r.reason.trim())
    }
  }
  return out.size ? out : null
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
        reasons = await explainWithClaude(seed, picks)
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
        reason: reasons?.get(key) || ruleReason(seed, p.profile, p.parts),
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

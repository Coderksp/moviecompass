// Finding things worth ranking, and paying for the metadata to rank them.
//
// Split out of /api/similar so the personalised rail can reuse it. The question
// "what else is like this" is the same whether "this" is the film somebody just
// opened or the five they have rated highest, and only the thing being asked
// about changes.
import { tmdb, fullDetail, listFrom, normalize, safely, usable } from './tmdb.js'
import { profile, queryKeywords } from './recommend.js'

// ---------------------------------------------------------------------------
// Keyword rarity
// ---------------------------------------------------------------------------

// How many titles carry a keyword, asked rather than assumed.
//
// Which keywords to search on is the single decision that most affects what
// comes back, and guessing at it kept going wrong in ways that were obvious in
// hindsight: "allegory" and "manipulation" look specific next to "mission", so a
// hand-written trope list keeps them — and TMDB has tagged thousands of prestige
// films with both, so searching them returns The Lion King for Inception.
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
export async function chooseKeywords(seed, mediaType, n = 6) {
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
//
// `details` may carry a recommendations block from the seed's own lookup; when
// it does not, that generator simply sits out.
export async function generate(seed, mediaType, details = {}) {
  // A pipe is OR — any one of these is enough to be a candidate. AND would be
  // nearly always empty, since few titles share six specific keywords. What
  // makes the OR usable is that every keyword in it has been checked for rarity.
  const topKeywords = (await chooseKeywords(seed, mediaType)).join('|')
  const genres = [...seed.genres].slice(0, 2).join(',')

  const lists = []

  if (details.recommendations) {
    lists.push(
      safely(
        Promise.resolve(listFrom(details.recommendations, mediaType)),
        'recommendations'
      )
    )
  }

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
    // premise match gets beaten by this month's releases; sorting by rating
    // instead finds the title people still bring up years later. The vote floor
    // is high because an unpopular sort is exactly where a handful of
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
  // are decided almost entirely by TMDB's English-weighted lists, and the
  // results drift to Hollywood on popularity alone.
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
// Enrichment
// ---------------------------------------------------------------------------

// One full lookup each, in parallel — the dominant cost of any of this. A failed
// lookup keeps its list-level profile and simply scores nothing on the features
// it lacks, rather than taking the request down with it.
export function enrich(rows) {
  return Promise.all(
    rows.map(async (row) => {
      try {
        const full = await fullDetail(row.cand.id, row.cand.mediaType)
        return { ...row, cand: profile(full, row.cand.mediaType), full }
      } catch {
        return row
      }
    })
  )
}

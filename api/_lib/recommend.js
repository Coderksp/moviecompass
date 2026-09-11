// The recommendation model: how "similar" is decided.
//
// No network calls happen here. Everything in this file is a pure function over
// TMDB payloads the caller has already fetched, which is what makes the ranking
// testable — you can feed it two films and check the score without a key, a
// quota, or a deployment.
//
// The shape is a two-stage ranker, the same arrangement a search engine uses.
// Stage one scores every candidate on features that arrive free with a list
// response (genres, year, language, votes) and keeps the best two dozen. Stage
// two pays for a full metadata lookup on just those and re-scores them on the
// features that actually decide similarity — keywords, cast, crew, the words of
// the synopsis. Scoring all 200 candidates on stage-two features would mean 200
// requests to answer one question, and the 180 that were never going to place
// would cost exactly as much as the 20 that did.

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

// TMDB returns keywords under different keys for films and series, and neither
// is present on list results at all.
const keywordList = (d) => d?.keywords?.keywords || d?.keywords?.results || []

// Keywords that describe how a film was made or packaged rather than what it is
// about. They are common enough to match almost anything, so left in they would
// quietly pull every recommendation towards "also had a credits sting".
const GENERIC_KEYWORDS = new Set([
  'woman director', 'aftercreditsstinger', 'duringcreditsstinger',
  'based on novel or book', 'based on comic', 'based on true story',
  'live action remake', 'imax', '3d', 'sequel', 'remake',
])

// Which of a title's keywords are worth measuring the rarity of.
//
// It deliberately does not judge them. An earlier version ranked keywords by a
// guess at specificity before querying, and while the guess was roughly right it
// had no way to know by how much: measured against TMDB, Inception's "high
// concept" is 9 films and "kidnapping" is 1,525 — a difference of two orders of
// magnitude that no amount of reading the words can tell you.
//
// So this only caps how many rarity lookups a cold request makes, in TMDB's own
// order, and the measurement in /api/similar.js makes the actual choice.
// Fourteen covers every keyword on all but the most exhaustively tagged titles.
export const queryKeywords = (seed, n = 14) => [...seed.keywords].slice(0, n)

// Words that carry no information about a plot. A synopsis is two sentences
// long, so a handful of these is enough to make two unrelated films look alike.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'his',
  'her', 'their', 'its', 'he', 'she', 'they', 'it', 'him', 'them', 'who', 'whom',
  'that', 'this', 'these', 'those', 'when', 'while', 'after', 'before', 'into',
  'out', 'up', 'down', 'over', 'under', 'again', 'then', 'than', 'so', 'not',
  'no', 'one', 'two', 'new', 'now', 'own', 'must', 'can', 'will', 'has', 'have',
  'had', 'him', 'himself', 'herself', 'about', 'against', 'between', 'through',
  'during', 'story', 'film', 'movie', 'series', 'life', 'man', 'woman', 'young',
])

const words = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))

// Term frequency rather than a raw list: a word the synopsis leans on twice
// should weigh more than one it mentions in passing.
function termCounts(text) {
  const counts = new Map()
  for (const w of words(text)) counts.set(w, (counts.get(w) || 0) + 1)
  return counts
}

const ids = (arr, n = Infinity) =>
  new Set((arr || []).slice(0, n).map((x) => x.id).filter(Boolean))

// Everything the model knows about one title, in the shape the scorer wants.
// Built from a full detail payload where one is available and from a list entry
// where one is not — `depth` says which, so the scorer knows whether an empty
// keyword set means "no keywords" or "not looked up yet".
export function profile(data, mediaType) {
  const full = !!(data.genres || data.credits || data.keywords)
  const kw = keywordList(data)
    .filter((k) => k.name && !GENERIC_KEYWORDS.has(k.name.toLowerCase()))

  const crew = data.credits?.crew || []
  // A series has no director in the film sense — the creator is the closest
  // equivalent, and is who people mean when they say "from the people behind".
  const directors = new Set([
    ...crew.filter((c) => c.job === 'Director').map((c) => c.id),
    ...(data.created_by || []).map((c) => c.id),
  ])

  return {
    id: data.id,
    mediaType: mediaType || data.mediaType || data.media_type || 'movie',
    title: data.title || data.name || '',
    depth: full ? 'full' : 'list',

    // Films carry genre objects when fetched whole and bare ids in a list.
    genres: data.genres ? ids(data.genres) : new Set(data.genre_ids || []),
    genreNames: (data.genres || []).map((g) => g.name),

    keywords: new Set(kw.map((k) => k.id)),
    keywordNames: new Map(kw.map((k) => [k.id, k.name])),

    // Ten is where a cast list stops describing the film and starts listing
    // everyone who walked through a scene.
    cast: ids(data.credits?.cast, 10),
    castNames: new Map((data.credits?.cast || []).slice(0, 10).map((c) => [c.id, c.name])),
    directors,
    directorNames: new Map([
      ...crew.filter((c) => c.job === 'Director').map((c) => [c.id, c.name]),
      ...(data.created_by || []).map((c) => [c.id, c.name]),
    ]),

    lang: data.original_language || null,
    year: Number(String(data.release_date || data.first_air_date || '').slice(0, 4)) || null,
    collection: data.belongs_to_collection?.id || null,

    votes: data.vote_count || 0,
    score: data.vote_average || 0,
    popularity: data.popularity || 0,
    overview: data.overview || '',
    terms: termCounts(data.overview),
  }
}

// ---------------------------------------------------------------------------
// Candidate fusion
// ---------------------------------------------------------------------------

// Each generator returns its own ranked list, and the lists disagree — TMDB's
// recommendations are built from what audiences went on to watch, the keyword
// query from what a film is about, the cast query from who is in it. Reciprocal
// rank fusion combines ranked lists without needing their scores to mean the
// same thing, which they emphatically do not: it only asks where each title
// placed. A title that shows up mid-table in three lists rightly beats one that
// topped a single list and appeared nowhere else.
//
// The constant damps the top of each list, so first place is worth a little
// more than second rather than several times more. 60 is the value the original
// paper settled on and it holds up here.
const RRF_K = 60

// How far each generator is trusted. These are calibrated against what the
// lists actually return, not against what they are called.
//
// The keyword sweep leads because it is the one we control: every keyword in it
// has been checked for how many films carry it before being sent, so it answers
// "what else is about this" rather than "what else is filed near this".
//
// A shared director is a far stronger claim than a shared supporting actor, so
// the two are separate lists rather than one query for "people involved".
export const SOURCE_WEIGHTS = {
  keywords: 0.9,
  recommendations: 0.85,
  director: 0.75,
  acclaimed: 0.7,
  cast: 0.5,
  language: 0.4,
}

export const candidateKey = (item) => `${item.mediaType || 'movie'}:${item.id}`

// lists: [{ source, items }] — returns one entry per unique title, carrying the
// fused prior and which generators produced it.
export function fuse(lists) {
  const pool = new Map()

  for (const { source, items } of lists) {
    const weight = SOURCE_WEIGHTS[source] ?? 0.5
    items.forEach((item, i) => {
      const k = candidateKey(item)
      const entry = pool.get(k) || { item, sources: new Set(), prior: 0 }
      entry.sources.add(source)
      entry.prior += weight / (RRF_K + i + 1)
      // A fuller record wins: a title that arrived from two generators should
      // keep whichever copy carries more fields.
      if (Object.keys(item).length > Object.keys(entry.item).length) entry.item = item
      pool.set(k, entry)
    })
  }

  // Normalised against the strongest candidate, so the prior lands in 0–1 and
  // sits on the same scale as every other feature regardless of how many lists
  // came back populated.
  const top = Math.max(...[...pool.values()].map((e) => e.prior), 1e-9)
  for (const entry of pool.values()) entry.prior = entry.prior / top
  return pool
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const intersect = (a, b) => {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

// Jaccard rather than raw overlap: two films sharing both of their two genres
// are more alike than two films sharing two of their six.
function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  const shared = intersect(a, b)
  return shared / (a.size + b.size - shared)
}

// Inverse document frequency over the candidate pool itself, which is the right
// corpus here: "thriller" is uninformative precisely because it is everywhere in
// this particular set of candidates, and that is measurable without shipping a
// corpus. A term in half the pool is worth a fraction of one in a twentieth.
export function idfOver(profiles, pick) {
  const df = new Map()
  for (const p of profiles) {
    for (const t of new Set(pick(p))) df.set(t, (df.get(t) || 0) + 1)
  }
  const n = Math.max(profiles.length, 1)
  const weights = new Map()
  for (const [t, count] of df) weights.set(t, Math.log(1 + n / count))
  return weights
}

// Cosine similarity with IDF weights. Shared rare terms dominate; shared common
// ones barely register.
//
// Takes a Set of ids (keywords) or a Map of term -> count (synopsis words). Both
// expose .keys() and .has(), so one function covers both; `tf` says whether the
// counts in a Map should be folded into the weight.
function weightedCosine(a, b, idf, tf = false) {
  if (!a.size || !b.size) return 0
  const weight = (bag, t) =>
    (idf.get(t) || Math.log(2)) * (tf ? bag.get(t) || 1 : 1)

  let dot = 0
  for (const t of a.keys()) {
    if (b.has(t)) dot += weight(a, t) * weight(b, t)
  }
  if (!dot) return 0

  let na = 0
  for (const t of a.keys()) na += weight(a, t) ** 2
  let nb = 0
  for (const t of b.keys()) nb += weight(b, t) ** 2
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// Films made a few years apart share a mood that films decades apart do not —
// the pacing, the effects, what an audience was assumed to already know. The
// curve is deliberately gentle: fifteen years costs about a third of the
// feature, which is a nudge rather than a wall, because a genuine classic
// should still surface next to a modern film it inspired.
const eraSimilarity = (a, b) =>
  a && b ? Math.exp(-(((a - b) / 22) ** 2)) : 0.5

// The same public-opinion scale the actor pages already use: an average scaled
// by how many people actually voted, so a 9.0 from forty viewers does not
// outrank an 8.2 from forty thousand. Capped, because past a point more votes
// say "famous", not "better".
export const publicOpinion = (p) => p.score * Math.log10(1 + p.votes)
const qualityPrior = (p) => Math.min(1, publicOpinion(p) / 35)

// How much each feature moves the final score. These are the model, in the
// sense that everything else is machinery for computing them.
//
// Keywords lead, because a shared premise is what people mean by "similar" and
// it is the one thing here measured rather than inherited. The fused prior is
// close behind — being found by several independent routes is strong evidence —
// but it is deliberately no longer the largest term: it is only as good as the
// lists feeding it, and TMDB's lists are uneven enough that letting them decide
// the ranking outright puts Solo: A Star Wars Story third for Inception.
//
// Genre is kept small on purpose. Nearly every candidate shares a genre with the
// seed by construction, so a heavy genre weight mostly reranks by popularity
// while appearing to reason about content.
//
// Language is weighted higher than it first looks like it deserves, and it costs
// nothing to do so. For an English-language seed almost every candidate matches,
// so the feature is very nearly a constant and changes no ordering at all. It
// only does work on the regional titles, where it is the difference between
// Vikram suggesting Kaithi and Vikram suggesting Die Hard because both were
// tagged "shootout".
export const WEIGHTS = {
  keyword: 0.28,
  prior: 0.24,
  people: 0.14,
  language: 0.09,
  text: 0.08,
  genre: 0.07,
  quality: 0.05,
  era: 0.05,
}

// Stage one. Only the features that arrive free on a list result, so the whole
// pool can be ranked without a single extra request.
export function coarseScore(seed, cand, prior) {
  const genre = jaccard(seed.genres, cand.genres)
  const era = eraSimilarity(seed.year, cand.year)
  const language = seed.lang && cand.lang === seed.lang ? 1 : 0
  const quality = qualityPrior(cand)

  // The weights of the absent features are redistributed across the present
  // ones, so a coarse score is comparable to a fine score rather than uniformly
  // smaller — otherwise the cut-off for stage two would drift with how much
  // metadata happened to be missing.
  const w = WEIGHTS
  const present = w.prior + w.genre + w.era + w.language + w.quality
  return (
    (w.prior * prior +
      w.genre * genre +
      w.era * era +
      w.language * language +
      w.quality * quality) /
    present
  )
}

// Stage two. Everything, on the shortlist that survived stage one.
export function fineScore(seed, cand, prior, idf) {
  const keyword = weightedCosine(seed.keywords, cand.keywords, idf.keyword)
  const genre = jaccard(seed.genres, cand.genres)
  const castOverlap = jaccard(seed.cast, cand.cast)
  const sharedDirector = intersect(seed.directors, cand.directors) > 0 ? 1 : 0
  // A shared director says more than a shared supporting actor, but a cast in
  // common is the thing people notice first, so neither is allowed to carry the
  // feature alone.
  const people = 0.55 * castOverlap + 0.45 * sharedDirector
  const text = weightedCosine(seed.terms, cand.terms, idf.text, true)
  const era = eraSimilarity(seed.year, cand.year)
  const language = seed.lang && cand.lang === seed.lang ? 1 : 0
  const quality = qualityPrior(cand)

  const w = WEIGHTS
  const score =
    w.prior * prior +
    w.keyword * keyword +
    w.genre * genre +
    w.people * people +
    w.text * text +
    w.era * era +
    w.language * language +
    w.quality * quality

  return {
    score,
    parts: { prior, keyword, genre, people, text, era, language, quality, castOverlap, sharedDirector },
  }
}

// Whether anything concrete connects this candidate to the seed — a shared
// keyword, a shared face behind or in front of the camera, overlapping language
// in the synopsis.
//
// A candidate that fails this matched on genre and vote count alone, which is
// how "science fiction, like this one" ends up recommending Solo: A Star Wars
// Story to someone who just watched Inception. Both are science fiction; that is
// the entire claim, and it is not a reason to watch anything.
//
// It doubles as an honesty check on the captions. Every reason the rail shows is
// built from the features that fired, so a candidate with nothing to say about
// itself is one the app would have to pad a sentence about.
// A shared actor is the weakest of these and needs corroborating: Joseph
// Gordon-Levitt is in both Inception and Treasure Planet, and only one of those
// is a recommendation. So a cast match has to come with the film being roughly
// the same kind of thing. A shared director carries on its own, because choosing
// a director is much closer to choosing a film.
export const connected = (parts) =>
  parts.keyword > 0.02 ||
  parts.sharedDirector === 1 ||
  parts.text > 0.08 ||
  (parts.castOverlap > 0 && parts.genre > 0.2)

// ---------------------------------------------------------------------------
// Shortlisting
// ---------------------------------------------------------------------------

// Which candidates are worth a full metadata lookup.
//
// Taking the top of the coarse ranking outright sounds right and is not, because
// the coarse score cannot see keywords, cast or crew — the very features the
// lookup exists to obtain. A film pulled in by the keyword query is there
// *because* it shares a premise, and it gets no credit for that until it has
// been looked up, so a pure top-N cut throws away the candidates most likely to
// be vindicated. TMDB's own recommendations, which score well on the features
// the coarse stage can see, would take nearly every slot.
//
// So each generator keeps a few of its own best regardless, and the remaining
// slots go to the coarse ranking. Every route in gets a hearing; the fine stage
// decides.
export function shortlist(rows, total, perSource = 4) {
  const bySource = new Map()
  for (const row of rows) {
    for (const source of row.entry.sources) {
      if (!bySource.has(source)) bySource.set(source, [])
      bySource.get(source).push(row)
    }
  }

  const chosen = new Set()
  // Weakest generator first, so its reserved slots are claimed before the
  // stronger lists have a chance to fill the shortlist with overlap.
  const order = [...bySource.keys()].sort(
    (a, b) => (SOURCE_WEIGHTS[a] ?? 0.5) - (SOURCE_WEIGHTS[b] ?? 0.5)
  )
  for (const source of order) {
    bySource
      .get(source)
      .sort((a, b) => b.score - a.score)
      .slice(0, perSource)
      .forEach((row) => chosen.add(row))
  }

  const byScore = (a, b) => b.score - a.score
  const reserved = [...chosen].sort(byScore)
  const rest = rows.filter((row) => !chosen.has(row)).sort(byScore)

  // Reserved first, so if the quotas alone overfill the shortlist it is the
  // weakest reserved candidate that goes rather than an arbitrary one.
  return [...reserved, ...rest].slice(0, total)
}

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

// Similarity between two *candidates*, which is a different question from
// similarity to the seed and is only used to spread the results out.
function candidateSimilarity(a, b) {
  const sameCollection = a.collection && a.collection === b.collection ? 1 : 0
  return Math.min(
    1,
    0.45 * jaccard(a.genres, b.genres) +
      0.25 * jaccard(a.cast, b.cast) +
      0.30 * sameCollection
  )
}

// Maximal Marginal Relevance. Ranking purely by score is how a "more like this"
// rail ends up as the same franchise five times over: every sequel is genuinely
// the most similar thing to the film, and every one of them is a useless
// recommendation to someone who just watched it.
//
// Each pick maximises relevance minus the most it resembles anything already
// picked, so the second Nolan film has to clear a higher bar than the first.
// lambda is how much relevance is traded for spread — 0.78 keeps the list
// obviously on-topic while breaking up runs.
export function diversify(ranked, count, lambda = 0.78) {
  const picked = []
  const rest = [...ranked]

  while (picked.length < count && rest.length) {
    let bestIndex = 0
    let bestValue = -Infinity

    for (let i = 0; i < rest.length; i++) {
      const worst = picked.reduce(
        (max, p) => Math.max(max, candidateSimilarity(rest[i].profile, p.profile)),
        0
      )
      const value = lambda * rest[i].score - (1 - lambda) * worst
      if (value > bestValue) {
        bestValue = value
        bestIndex = i
      }
    }
    picked.push(rest.splice(bestIndex, 1)[0])
  }
  return picked
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const list = (names) =>
  names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

// The reason shown when Claude is unavailable — and the reason Claude is asked
// to improve on rather than invent from nothing. It is assembled from the
// features that actually fired, so it can never claim a connection the model did
// not score. That is the point: a wrong explanation is worse than a plain one.
export function ruleReason(seed, cand, parts) {
  const bits = []

  const sharedDirectors = [...cand.directors].filter((d) => seed.directors.has(d))
  if (sharedDirectors.length) {
    const name = seed.directorNames.get(sharedDirectors[0]) || cand.directorNames.get(sharedDirectors[0])
    if (name) bits.push(`Directed by ${name}`)
  }

  const sharedCast = [...cand.cast].filter((c) => seed.cast.has(c)).slice(0, 2)
  if (sharedCast.length && bits.length < 2) {
    const names = sharedCast.map((c) => seed.castNames.get(c)).filter(Boolean)
    if (names.length) bits.push(`${list(names)} again`)
  }

  const sharedKeywords = [...cand.keywords]
    .filter((k) => seed.keywords.has(k))
    .map((k) => seed.keywordNames.get(k))
    .filter(Boolean)
    .slice(0, 2)
  if (sharedKeywords.length) bits.push(list(sharedKeywords))

  if (!bits.length) {
    const sharedGenres = cand.genreNames.filter((g) => seed.genreNames.includes(g)).slice(0, 2)
    if (sharedGenres.length) bits.push(`${list(sharedGenres).toLowerCase()}, like this one`)
  }

  if (!bits.length && parts.prior > 0.35) bits.push('Widely watched alongside it')

  return bits.length ? bits.join(' · ') : null
}

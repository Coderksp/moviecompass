// What a person likes, learned from what they saved.
//
// The rail in the modal answers "what is like this film". This answers "what is
// like *you*", which is a different question with a different shape: there is no
// single seed to compare against, only a few dozen titles carrying signals of
// very different strength. A film rated 10 and a film sitting unwatched on a
// watchlist are not the same evidence, and a film rated 3 is evidence pointing
// the other way.
//
// So the library is collapsed into one weighted profile — the genres, keywords,
// people, languages and era a person actually reaches for — and candidates are
// scored against that rather than against any one title.
//
// Pure functions, like recommend.js. Nothing here touches the network, which is
// what makes the weighting checkable without an account or a database.

// ---------------------------------------------------------------------------
// How much each saved title says
// ---------------------------------------------------------------------------

// A rating is the strongest statement available, because it is the only one with
// a direction — everything else can say "yes" but not "no". Neutral sits at 6
// rather than 5: on a ten-point scale people use for things they chose to watch,
// 5 is already a complaint.
//
// A favourite outranks any rating, since hearting something is a deliberate act
// and a rating is often just bookkeeping. A watchlist entry is the weakest of
// the three and deliberately so: it records intent, not a verdict — nobody has
// seen it yet, so it says what they hoped for rather than what they liked.
export function signalWeight(entry) {
  let weight = 0

  if (entry.rating != null) {
    weight = Math.max(-0.8, Math.min(1, (entry.rating - 6) / 4))
  }
  if (entry.favourite) weight = Math.max(weight, 1)
  if (entry.watchlist && entry.rating == null && !entry.favourite) weight = 0.3

  return weight
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

const add = (map, key, amount) => {
  if (key == null) return
  map.set(key, (map.get(key) || 0) + amount)
}

const remember = (names, key, name) => {
  if (key != null && name && !names.has(key)) names.set(key, name)
}

// Highest-weighted first, as [{ id, name, weight }].
function ranked(weights, names, limit) {
  return [...weights.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, weight]) => ({ id, name: names.get(id) || String(id), weight }))
}

// `entries` are the library rows; `profiles` the matching parsed TMDB payloads,
// in the same order. A row whose lookup failed is simply skipped.
export function buildTaste(entries, profiles) {
  const taste = {
    keywords: new Map(), keywordNames: new Map(),
    genres: new Map(), genreNames: new Map(),
    cast: new Map(), castNames: new Map(),
    directors: new Map(), directorNames: new Map(),
    languages: new Map(),
    // Which of their titles each person actually appeared in, strongest first.
    //
    // Without this a caption will cheerfully misattribute: the model knows
    // Laurence Fishburne is someone this person watches and that the candidate
    // shares him, and if it then reaches for the top-rated title to name, it
    // says "as in Inception" about an actor who is in The Matrix. A caption that
    // states a fact has to have the fact.
    personIn: new Map(),
    // What they have already dealt with, so nothing is recommended back to them.
    seen: new Set(),
    // Titles that carry real positive weight, strongest first — these become the
    // seeds for candidate generation and the "because you loved X" in a caption.
    loved: [],
    // Keywords and genres from the things they rated badly. Not a mirror of the
    // positive profile: disliking one war film does not mean disliking the
    // genre, so this is used as a gentle brake rather than a veto.
    dislikedKeywords: new Map(),
    dislikedGenres: new Map(),
    weight: 0,
    year: null,
    maturity: null,
  }

  let yearWeight = 0
  let yearTotal = 0
  let maturityWeight = 0
  let maturityTotal = 0

  // Rows arrive newest-saved-first, which is the wrong order for the one part of
  // this that is not a commutative sum: whichever title claims a person first is
  // the one a caption will name them from, and that should be the title they
  // feel most strongly about rather than the one they happened to save last.
  entries.forEach((entry) => taste.seen.add(`${entry.mediaType}:${entry.tmdbId}`))

  const weighted = entries
    .map((entry, i) => ({ entry, p: profiles[i], w: signalWeight(entry) }))
    .filter((row) => row.p && row.w)
    .sort((a, b) => b.w - a.w)

  weighted.forEach(({ entry, p, w }) => {

    if (w < 0) {
      const dislike = -w
      p.keywords.forEach((k) => add(taste.dislikedKeywords, k, dislike))
      p.genres.forEach((g) => add(taste.dislikedGenres, g, dislike))
      return
    }

    taste.weight += w
    taste.loved.push({
      id: p.id, mediaType: p.mediaType, title: p.title, weight: w,
      year: p.year, lang: p.lang,
    })

    p.keywords.forEach((k) => {
      add(taste.keywords, k, w)
      remember(taste.keywordNames, k, p.keywordNames.get(k))
    })
    p.genres.forEach((g) => {
      add(taste.genres, g, w)
      remember(taste.genreNames, g, p.genreNameById.get(g))
    })
    // Entries arrive strongest-first, so the first title to claim a person is
    // the most strongly-weighted one they appear in — which is the one worth
    // naming in a caption.
    p.cast.forEach((c) => {
      add(taste.cast, c, w)
      remember(taste.castNames, c, p.castNames.get(c))
      remember(taste.personIn, c, p.title)
    })
    p.directors.forEach((d) => {
      add(taste.directors, d, w)
      remember(taste.directorNames, d, p.directorNames.get(d))
      remember(taste.personIn, d, p.title)
    })
    if (p.lang) add(taste.languages, p.lang, w)

    if (p.year) { yearTotal += p.year * w; yearWeight += w }
    if (p.maturity != null) { maturityTotal += p.maturity * w; maturityWeight += w }
  })

  taste.loved.sort((a, b) => b.weight - a.weight || (b.year || 0) - (a.year || 0))
  taste.year = yearWeight ? Math.round(yearTotal / yearWeight) : null
  // Rounded to the nearest step, because the certificate scale is ordinal and a
  // person whose library averages 2.4 is a PG-13 viewer, not a fractional one.
  taste.maturity = maturityWeight ? Math.round(maturityTotal / maturityWeight) : null

  return taste
}

// ---------------------------------------------------------------------------
// Scoring against a taste
// ---------------------------------------------------------------------------

// Affinity saturates rather than accumulating without limit. Matching three
// things somebody loves is a strong signal; matching thirty is not ten times
// stronger, and without a ceiling a single sprawling blockbuster with forty
// keywords would outscore a film that simply is what they like.
const saturate = (sum, scale) => (sum > 0 ? 1 - Math.exp(-sum / scale) : 0)

// Each taste map is normalised by its own strongest entry, so "how much of what
// this person likes does this title carry" is asked on a 0-1 scale regardless of
// whether their library holds nine titles or nine hundred.
const normaliser = (map) => Math.max(...map.values(), 1e-9)

function affinity(candidateSet, weights, scale) {
  if (!candidateSet.size || !weights.size) return { value: 0, sum: 0 }
  const top = normaliser(weights)
  let sum = 0
  for (const id of candidateSet) sum += (weights.get(id) || 0) / top
  return { value: saturate(sum, scale), sum }
}

// A candidate for an audience older than the person's library is fine; one for a
// younger audience is the mistake — the same asymmetry the modal rail uses, for
// the same reason.
const maturityFit = (taste, cand) => {
  if (taste.maturity == null || cand.maturity == null) return 0.75
  if (cand.maturity >= taste.maturity) return 1
  return Math.exp(-(((taste.maturity - cand.maturity) / 1.2) ** 2))
}

const eraFit = (taste, cand) =>
  taste.year && cand.year ? Math.exp(-(((taste.year - cand.year) / 22) ** 2)) : 0.6

const qualityPrior = (p) =>
  Math.min(1, (p.score || 0) * Math.log10(1 + (p.votes || 0)) / 35)

// Keywords lead here as they do in the modal, for the same reason — a premise is
// what people mean by "like this". People matter more than they do there, though:
// choosing to watch six films by one director is a much clearer statement of
// taste than any single film sharing a director with another.
export const TASTE_WEIGHTS = {
  keyword: 0.24,
  people: 0.18,
  prior: 0.18,
  genre: 0.12,
  language: 0.10,
  maturity: 0.06,
  era: 0.06,
  quality: 0.06,
}

export function tasteScore(taste, cand, prior) {
  const keyword = affinity(cand.keywords, taste.keywords, 2.5)
  const genre = affinity(cand.genres, taste.genres, 1.8)
  const castHit = affinity(cand.cast, taste.cast, 1.6)
  const directorHit = affinity(cand.directors, taste.directors, 0.8)

  // Weighted towards the director, who is chosen, over the cast, who are often
  // simply who was available.
  const people = Math.min(1, 0.6 * directorHit.value + 0.55 * castHit.value)

  const langTop = normaliser(taste.languages)
  const language = cand.lang ? (taste.languages.get(cand.lang) || 0) / langTop : 0

  const maturity = maturityFit(taste, cand)
  const era = eraFit(taste, cand)
  const quality = qualityPrior(cand)

  const w = TASTE_WEIGHTS
  let score =
    w.keyword * keyword.value +
    w.people * people +
    w.prior * prior +
    w.genre * genre.value +
    w.language * language +
    w.maturity * maturity +
    w.era * era +
    w.quality * quality

  // The brake. Something built out of what they rated badly is pushed down but
  // never excluded outright — one bad experience with a genre is not a standing
  // instruction, and the positive signal can still outweigh it.
  const disliked = affinity(cand.keywords, taste.dislikedKeywords, 3).value
  score *= 1 - 0.25 * disliked

  return {
    score,
    parts: {
      keyword: keyword.value, people, prior, genre: genre.value, language,
      maturity, era, quality, disliked,
      directorHit: directorHit.value, castHit: castHit.value,
    },
  }
}

// The same rule the modal rail enforces, asked of a taste instead of a title.
//
// Without it the personalised rail reproduces the bug the modal one was fixed
// for: a library containing Inception recommends Zootopia, because the two share
// the tag "allegory" and a single coincidental keyword was enough. Here the
// stakes are slightly higher, since a rail on the home page is the first thing
// somebody sees and there is no film open to explain what it is responding to.
//
// A director somebody keeps returning to stands alone — that is the clearest
// statement of taste there is. Everything weaker has to be corroborated by the
// candidate also being the kind of thing they watch, for the audience they watch
// at: `genre * maturity`, the same product, for the same reason.
const KEYWORD_FLOOR = 0.12
const CORROBORATION = 0.10

export const tasteConnected = (parts) =>
  parts.directorHit > 0.2 ||
  parts.keyword > KEYWORD_FLOOR ||
  ((parts.castHit > 0 || parts.keyword > 0) &&
    parts.genre * parts.maturity > CORROBORATION)

// Which of their own titles a recommendation echoes, for the caption. Provenance
// from candidate generation rather than a guess — these are the titles whose own
// neighbours this one turned up in.
export function because(taste, entry, limit = 2) {
  return [...(entry.seeds || [])]
    .map((key) => taste.loved.find((l) => `${l.mediaType}:${l.id}` === key))
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Saying it out loud
// ---------------------------------------------------------------------------

const list = (names) =>
  names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

// The caption when Claude is not configured, and the floor it has to improve on
// when it is. Built only from what actually scored, so it can never claim a
// connection the model did not make.
export function tasteReason(taste, cand, parts, sources) {
  const echoes = sources.map((s) => s.title).filter(Boolean)

  // Every "as in X" below names the title that person is actually in, taken from
  // the profile rather than from whichever of their films ranked highest. The
  // alternative reads just as fluently and is sometimes simply false.
  const sharedDirectors = [...cand.directors]
    .filter((d) => (taste.directors.get(d) || 0) > 0)
    .map((d) => ({ name: taste.directorNames.get(d), from: taste.personIn.get(d) }))
    .filter((d) => d.name)
  if (sharedDirectors.length) {
    const d = sharedDirectors[0]
    return d.from ? `${d.name}, who made ${d.from}` : `${d.name}, whose films you save`
  }

  const sharedCast = [...cand.cast]
    .filter((c) => (taste.cast.get(c) || 0) > 0)
    .map((c) => ({ name: taste.castNames.get(c), from: taste.personIn.get(c) }))
    .filter((c) => c.name)
    .slice(0, 2)
  if (sharedCast.length) {
    const names = list(sharedCast.map((c) => c.name))
    const from = sharedCast[0].from
    return from ? `${names}, as in ${from}` : `${names}, who you watch`
  }

  if (echoes.length) {
    const sharedKeywords = [...cand.keywords]
      .filter((k) => (taste.keywords.get(k) || 0) > 0)
      .map((k) => taste.keywordNames.get(k))
      .filter(Boolean)
      .slice(0, 2)
    return sharedKeywords.length
      ? `${list(sharedKeywords)} — like ${echoes[0]}`
      : `Because you saved ${echoes[0]}`
  }

  const sharedGenres = cand.genreNames
    .filter((g) => [...taste.genreNames.values()].includes(g))
    .slice(0, 2)
  if (sharedGenres.length) return `${list(sharedGenres).toLowerCase()}, which you go for`

  return null
}

// ---------------------------------------------------------------------------
// The profile page
// ---------------------------------------------------------------------------

const ERA_LABEL = (year) => {
  if (!year) return null
  const decade = Math.floor(year / 10) * 10
  return `mostly ${decade}s`
}

// A readable account of what the model thinks, for the profile screen. Showing
// somebody the shape of their own taste is the difference between a rail that
// feels considered and one that feels like it is guessing.
export function tasteSummary(taste, languageName = (c) => c) {
  const total = taste.weight || 1
  const share = (weights, names, limit) =>
    ranked(weights, names, limit).map((x) => ({
      name: x.name,
      share: Math.round((x.weight / total) * 100),
    }))

  return {
    titles: taste.loved.length,
    genres: share(taste.genres, taste.genreNames, 5),
    languages: [...taste.languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([code, weight]) => ({
        name: languageName(code),
        share: Math.round((weight / total) * 100),
      })),
    people: [
      ...ranked(taste.directors, taste.directorNames, 3).map((d) => ({
        name: d.name, role: 'director',
      })),
      ...ranked(taste.cast, taste.castNames, 4).map((c) => ({
        name: c.name, role: 'cast',
      })),
    ].slice(0, 6),
    era: ERA_LABEL(taste.year),
    maturity: taste.maturity,
  }
}

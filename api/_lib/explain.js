// Turning the model's findings into a sentence a person would read.
//
// Claude is given the connections that were already found and asked to say them
// well. It is never asked *what* is similar — that question is answered before
// this file is reached, and letting the model re-decide would mean a caption
// could describe a link the ranking never scored.
//
// Everything here is optional. No key, a bad key, a timeout, a refusal or
// malformed JSON all resolve to null, and the caller keeps the rule-written
// captions it already had.

// The rail is an enhancement, not the feature. If Claude has not answered in
// this long the plainer captions ship instead, which keeps the function
// comfortably inside even a 10-second platform limit.
const CLAUDE_TIMEOUT = 8000

const RULES =
  'Rules: at most 14 words; no sentence-ending period; never begin with ' +
  '"If you liked" or "Similar to"; name the concrete thread — a shared premise, ' +
  'director, star, setting or mood — using only the connection data given; ' +
  'never reveal a plot twist or ending; never invent a link that is not in the ' +
  'data. Return one entry per key you were given, reusing the key exactly.'

const SCHEMA = {
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
}

// Why the last attempt produced nothing, in a few words. The captions are an
// optional layer, so a failure is swallowed rather than surfaced as an error —
// which is right for the visitor and useless for whoever has to work out why the
// feature is quietly off. This is that missing sentence.
export function describeFailure(err) {
  if (!err) return null
  const status = err.status || err.statusCode
  const detail =
    err.error?.error?.message || err.error?.message || err.message || String(err)
  return [status && `HTTP ${status}`, String(detail).slice(0, 300)]
    .filter(Boolean)
    .join(' — ')
}

async function captions(system, payload) {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const { default: Anthropic } = await import('@anthropic-ai/sdk')

  // An organisation-level key has to say which workspace to bill and scope the
  // request to; a workspace-scoped key already carries that and needs nothing.
  // Without this the first kind fails with a 400 that says exactly so, which is
  // a poor welcome for someone who has just pasted in a key that looks fine.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID
  const client = new Anthropic({
    timeout: CLAUDE_TIMEOUT,
    maxRetries: 0,
    ...(workspace
      ? { defaultHeaders: { 'anthropic-workspace-id': workspace } }
      : {}),
  })

  const response = await client.messages.create({
    model: 'claude-opus-5',
    // The answer is a dozen short captions, so this is not a ceiling anyone
    // expects to reach. It is set well above what they need because reasoning
    // tokens count against it too, and running out mid-object would leave
    // unparseable JSON — which costs the whole call for nothing. Only what is
    // actually generated is billed, so the headroom is free.
    max_tokens: 8000,
    output_config: {
      // A caption apiece is not a reasoning problem, and this call sits in front
      // of a rail somebody is waiting on.
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  })

  // A refusal or a truncated answer is not an error worth failing a request
  // over — the rail already has captions.
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
// "More like this" — captions against one title
// ---------------------------------------------------------------------------

export function explainSimilar(seed, picks) {
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

  return captions(
    'You write one-line captions explaining why a film or series was recommended ' +
      'to someone who just looked at another one. ' + RULES,
    {
      watched: {
        title: seed.title,
        year: seed.year,
        genres: seed.genreNames,
        keywords: [...seed.keywordNames.values()].slice(0, 12),
        overview: String(seed.overview || '').slice(0, 300),
      },
      recommendations: picks.map(describe),
    }
  )
}

// ---------------------------------------------------------------------------
// "For you" — captions against a person's taste
// ---------------------------------------------------------------------------

// The difference from the above is who the caption is addressed to. There is no
// single film to point back at, so the model is given the shape of somebody's
// taste and the specific titles of theirs that each recommendation echoes —
// which is what makes "because you loved Vikram" possible rather than a generic
// "you might like this".
export function explainForYou(taste, picks) {
  const describe = (p) => ({
    key: `${p.profile.mediaType}:${p.profile.id}`,
    title: p.profile.title,
    year: p.profile.year,
    genres: p.profile.genreNames,
    echoes_your: p.because || [],
    shared_keywords: p.sharedKeywordNames || [],
    shared_people: p.sharedPeopleNames || [],
    overview: String(p.item.overview || '').slice(0, 300),
  })

  return captions(
    'You write one-line captions explaining why a film or series is being ' +
      'recommended to a particular person, based on what they have rated highly ' +
      'and saved. Address the reason to them — "echoes_your" names their own ' +
      'titles that this one resembles, and using one of those by name is usually ' +
      'the best caption. ' + RULES,
    {
      their_taste: {
        favourite_genres: taste.topGenres,
        favourite_languages: taste.topLanguages,
        favourite_people: taste.topPeople,
        titles_they_loved: taste.loved,
        era: taste.eraLabel,
      },
      recommendations: picks.map(describe),
    }
  )
}

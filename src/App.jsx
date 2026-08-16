import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Row from './components/Row'
import SearchResults from './components/SearchResults'
import MovieModal from './components/MovieModal'
import MovieCard from './components/MovieCard'
import { MovieModalContext, OpenPersonContext, RequestSignInContext } from './movieModal'
import SignIn from './components/SignIn'
import { useSession } from './auth'
import { useLibrary, loadLibrary, clearLibrary } from './library'
import { fetchMovieDetails, IMG } from './api/tmdb'
import {
  CATEGORIES,
  INDUSTRIES,
  MEDIA_FILTERS,
  discoverByLanguage,
  matchLanguageQuery,
  searchMulti as searchPeopleFor,
  fetchCategory,
  fetchFeatured,
  fetchPersonCredits,
  fetchExternalRatings,
  industryLang,
  matchesIndustry,
  personStats,
  ratingShortlist,
  searchMulti,
} from './api/tmdb'

export default function App() {
  const session = useSession()
  const library = useLibrary()
  const [signInOpen, setSignInOpen] = useState(false)
  const [castPickerOpen, setCastPickerOpen] = useState(false)
  const [browse, setBrowse] = useState([])
  const [browsing, setBrowsing] = useState(false)

  // Close the panel once a session exists, whichever route got us there —
  // the password form, or coming back from Google.
  useEffect(() => {
    if (session.status === 'in') setSignInOpen(false)
  }, [session.status])

  // The library follows the session: loaded when you sign in, dropped when you
  // leave, so one person's saved titles never linger for the next.
  useEffect(() => {
    if (session.status === 'in') loadLibrary()
    else if (session.status === 'out') clearLibrary()
  }, [session.status, session.user?.id])
  const [featured, setFeatured] = useState(null)
  const [rows, setRows] = useState({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [media, setMedia] = useState('all')
  const [people, setPeople] = useState([])
  const [industry, setIndustry] = useState('all')
  const [person, setPerson] = useState(null)      // the actor being browsed
  const [credits, setCredits] = useState([])
  const [ratings, setRatings] = useState(null)    // external scores, when available

  // Rails for every type load once; the filter only decides what is shown, so
  // switching between All/Movies/Series never refetches.
  const visibleCategories = CATEGORIES.filter(
    (c) => media === 'all' || c.mediaType === media
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        for (const cat of CATEGORIES) {
          const items = await fetchCategory(cat)
          if (cancelled) return
          setRows((prev) => ({ ...prev, [cat.id]: items }))
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // The hero follows the active filter, so picking Series shows a series.
  useEffect(() => {
    let cancelled = false
    fetchFeatured(media)
      .then((f) => { if (!cancelled && f) setFeatured(f) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [media])

  const handleSearch = useCallback(async (q) => {
    setQuery(q)
    setPerson(null)               // a new query leaves whoever's filmography we were in
    if (!q.trim()) { setResults([]); setPeople([]); return }
    try {
      const { titles, people: found } = await searchMulti(q)
      setResults(titles)
      setPeople(found)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const openPerson = useCallback(async (p) => {
    setSelected(null)      // opened from a cast member, so close the film modal
    setPerson(p)
    setCredits([])
    setRatings(null)
    try {
      const items = await fetchPersonCredits(p.id)
      setCredits(items)
      // Fires only for the shortlist, and resolves to null until Letterboxd
      // credentials exist — so the header renders immediately either way.
      fetchExternalRatings(ratingShortlist(items))
        .then((r) => { if (r) setRatings(r) })
        .catch(() => {})
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Both filters apply to whichever set is on screen — an actor's filmography
  // narrows by type and industry exactly like a title search does.
  const lang = industryLang(industry)
  const visibleResults = (person ? credits : results).filter(
    (r) => (media === 'all' || r.mediaType === media) && matchesIndustry(r, lang)
  )

  // Typing a language name is a request to browse it, not to find a title by
  // that name — "tamil" as a title search returns nothing anyone wants.
  const queryLanguage = matchLanguageQuery(query)

  // Browsing a language: either typed, or chosen from a chip with nothing else
  // narrowing it. An actor always wins, since their filmography is the more
  // specific answer.
  const browseIndustry = queryLanguage || (!query.trim() && industry !== 'all'
    ? INDUSTRIES.find((i) => i.id === industry)
    : null)
  const browseMode = !person && !!browseIndustry

  // A typed language reads as "list them", so it sorts A–Z. A chip is a
  // browsing gesture, so it leads with what people actually watch. Either way
  // the sort is switchable once you are there.
  const [sort, setSort] = useState('popular')
  useEffect(() => {
    setSort(queryLanguage ? 'alpha' : 'popular')
  }, [queryLanguage?.id, industry])

  useEffect(() => {
    if (!browseMode) { setBrowse([]); return }
    let cancelled = false
    setBrowsing(true)
    discoverByLanguage(browseIndustry.lang, media, sort)
      .then((rows) => { if (!cancelled) setBrowse(rows) })
      .catch(() => { if (!cancelled) setBrowse([]) })
      .finally(() => { if (!cancelled) setBrowsing(false) })
    return () => { cancelled = true }
  }, [browseMode, browseIndustry?.lang, media, sort])

  // Computed from the unfiltered credits — these are career totals, not a count
  // of whatever survives the filters below.
  const stats = person && credits.length ? personStats(credits, ratings) : null

  return (
    <MovieModalContext.Provider value={setSelected}>
    <OpenPersonContext.Provider value={openPerson}>
    <RequestSignInContext.Provider value={() => setSignInOpen(true)}>
    <div className="app">
      <div className="aurora"><span /><span /><span /></div>
      <Navbar onSearch={handleSearch} />

      {error && (
        <div style={{
          margin: '6rem auto 0', maxWidth: 560, textAlign: 'center',
          padding: '1.5rem', borderRadius: 14,
          border: '1px solid rgba(255,46,147,0.4)', background: 'rgba(255,46,147,0.08)',
        }}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 8 }}>
            Couldn’t load films
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>{error}</p>
        </div>
      )}

      <MediaFilter
        value={media}
        onChange={setMedia}
        industry={industry}
        onIndustry={setIndustry}
        person={person}
        onClearPerson={() => setPerson(null)}
        onPickPerson={() => setCastPickerOpen(true)}
      />

      {castPickerOpen && (
        <CastPicker
          onPick={(p) => { setCastPickerOpen(false); openPerson(p) }}
          onClose={() => setCastPickerOpen(false)}
        />
      )}

      {/* Deliberately not mode="wait": that mounts the incoming view only once
          the outgoing one has finished exiting, and exits in this tree do not
          reliably complete — opening an actor from a film's cast would leave the
          filmography permanently unmounted. A crossfade needs no such gate. */}
      <AnimatePresence>
        {/* A person opened from a film's cast has no search query behind it, so
            the filmography view has to stand on its own. */}
        {browseMode ? (
          /* A language, whether typed or chosen from a chip, answers "what is
             there" — so it replaces the rails rather than sitting under them. */
          <motion.main key="browse" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <BrowseGrid
              label={browseIndustry.label}
              note={browseIndustry.note}
              items={browse}
              loading={browsing}
              sort={sort}
              onSort={setSort}
              typed={!!queryLanguage}
            />
          </motion.main>
        ) : query.trim() || person ? (
          <motion.main key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SearchResults
              query={query}
              results={visibleResults}
              people={people}
              person={person}
              stats={stats}
              onPerson={openPerson}
              onClearPerson={() => setPerson(null)}
              industry={industry}
              onIndustry={setIndustry}
            />
          </motion.main>
        ) : (
          <motion.main key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Hero movie={featured} />
            <div style={{ marginTop: '-2rem', position: 'relative', zIndex: 2 }}>
              {/* Your own rails first — what you saved outranks what is trending. */}
              <LibraryRow title="Your watchlist" field="watchlist" library={library} />
              <LibraryRow title="Your favourites" field="favourite" library={library} />
              {visibleCategories.map((cat) => (
                <Row
                  key={cat.id}
                  title={cat.title}
                  movies={rows[cat.id]}
                  anchorId={cat.id}
                />
              ))}
            </div>
            {loading && (
              <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                Loading more titles…
              </p>
            )}
          </motion.main>
        )}
      </AnimatePresence>

      <SignatureFooter />

      <MovieModal movie={selected} onClose={() => setSelected(null)} />

      {signInOpen && <SignIn onClose={() => setSignInOpen(false)} />}
    </div>
    </RequestSignInContext.Provider>
    </OpenPersonContext.Provider>
    </MovieModalContext.Provider>
  )
}

// The signature cycles through scripts. Transliterations are approximations —
// the sound of the name written in each script, not a translation.
const SIGNATURES = [
  { text: 'Sugan Prasath', script: 'English' },
  { text: 'சுகன் பிரசாத்', script: 'Tamil' },
  { text: 'सुगन प्रसाद', script: 'Hindi' },
  { text: 'సుగన్ ప్రసాద్', script: 'Telugu' },
  { text: 'സുഗൻ പ്രസാദ്', script: 'Malayalam' },
  { text: 'ಸುಗನ್ ಪ್ರಸಾದ್', script: 'Kannada' },
  { text: 'スガン・プラサート', script: 'Japanese' },
  { text: '苏甘·普拉萨特', script: 'Chinese' },
  { text: 'سوغان براساث', script: 'Arabic' },
  { text: 'Суган Прасат', script: 'Russian' },
]

function SignatureFooter() {
  const [i, setI] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SIGNATURES.length), 2400)
    return () => clearInterval(t)
  }, [])

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const current = SIGNATURES[i]

  return (
    <footer style={{
      textAlign: 'center', padding: '3.5rem 1rem 2.5rem',
      color: 'var(--text-dim)', fontSize: 13,
      borderTop: '1px solid rgba(168,85,247,0.15)',
    }}>
      <p style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, flexWrap: 'wrap', margin: 0, minHeight: 34,
      }}>
        <span>Made by</span>

        {/* A looping animation would be announced over and over, so the moving
            part is hidden from assistive tech and a static name stands in. */}
        <span style={{
          position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
        }}>
          Sugan Prasath
        </span>

        <span aria-hidden="true" style={{ display: 'inline-block' }}>
          {/* Keyed on the index, so React remounts and the entrance animation
              replays. No AnimatePresence, hence no exit to hang. */}
          <motion.span
            key={i}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="grad-text"
            style={{
              display: 'inline-block', fontFamily: 'var(--font-display)',
              fontWeight: 800, fontSize: 17, letterSpacing: '-0.01em',
              lineHeight: 1.4,
            }}
          >
            {current.text}
          </motion.span>
        </span>
      </p>

      <p aria-hidden="true" style={{
        margin: '2px 0 0', fontSize: 11, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--text-dim)', opacity: 0.6,
      }}>
        {current.script}
      </p>

    </footer>
  )
}

// Everything in a language, rather than rails of what happens to be popular.
function BrowseGrid({ label, note, items, loading, sort, onSort, typed }) {
  return (
    <section style={{ padding: '5.5rem clamp(1rem, 4vw, 3rem) 2rem', minHeight: '70vh' }}>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontWeight: 800,
        fontSize: 'clamp(1.3rem, 3vw, 2rem)', marginBottom: 4,
      }}>
        <span className="grad-text">{label}</span>
      </h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13.5, margin: '0 0 14px' }}>
        {note}
        {typed && ' · listed A–Z'}
      </p>

      {/* Typed searches default to A–Z and chips to popular, but neither choice
          should be a dead end once you are looking at the results. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[['alpha', 'A–Z'], ['popular', 'Most popular']].map(([id, text]) => {
          const active = sort === id
          return (
            <button
              key={id}
              onClick={() => onSort(id)}
              aria-pressed={active}
              style={{
                padding: '5px 14px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600,
                color: active ? '#fff' : 'var(--text-dim)',
                background: active
                  ? 'linear-gradient(100deg, var(--magenta), var(--violet))'
                  : 'rgba(26,16,41,0.7)',
                border: active ? '1px solid transparent' : '1px solid rgba(168,85,247,0.25)',
              }}
            >
              {text}
            </button>
          )
        })}
      </div>

      {loading && !items.length && (
        <p style={{ color: 'var(--text-dim)', fontSize: 15 }}>Finding titles…</p>
      )}
      {!loading && !items.length && (
        <p style={{ color: 'var(--text-dim)', fontSize: 15 }}>
          Nothing found in {label}. Try another language, or switch back to All.
        </p>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 18,
      }}>
        {items.map((m, i) => (
          <MovieCard key={`${m.mediaType}-${m.id}`} movie={m} index={i} />
        ))}
      </div>
    </section>
  )
}

// Choosing an actor without having to search for one first. The same lookup the
// search box uses, just scoped to people.
function CastPicker({ onPick, onClose }) {
  const [term, setTerm] = useState('')
  const [people, setPeople] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (term.trim().length < 2) { setPeople([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      searchPeopleFor(term)
        .then(({ people: found }) => { if (!cancelled) setPeople(found) })
        .catch(() => { if (!cancelled) setPeople([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'grid',
        placeItems: 'start center', padding: 'clamp(1rem, 8vh, 5rem) 1rem',
        background: 'rgba(5,3,10,0.72)', backdropFilter: 'blur(8px)', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 100%)', background: 'var(--bg-soft)',
          border: '1px solid rgba(168,85,247,0.22)', borderRadius: 18,
          padding: 20, boxShadow: '0 30px 80px -24px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>
            Filter by cast
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer',
              background: 'rgba(10,6,18,0.6)', color: 'var(--text)', fontSize: 16,
              display: 'grid', placeItems: 'center',
            }}
          >
            ×
          </button>
        </div>

        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Actor's name…"
          style={{
            width: '100%', padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(168,85,247,0.28)', background: 'rgba(10,6,18,0.6)',
            color: 'var(--text)', fontSize: 14.5, marginBottom: 12,
          }}
        />

        {searching && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Searching…</p>}
        {!searching && term.trim().length >= 2 && !people.length && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No actors by that name.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: 7,
                borderRadius: 10, border: 'none', background: 'none',
                cursor: 'pointer', color: 'inherit', textAlign: 'left',
              }}
            >
              <span style={{
                width: 38, height: 38, borderRadius: '50%', flex: 'none',
                overflow: 'hidden', background: 'var(--surface)',
                border: '1px solid rgba(168,85,247,0.3)',
              }}>
                {p.profile_path && (
                  <img
                    src={IMG(p.profile_path, 'w185')}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                {p.knownFor?.length > 0 && (
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)' }}>
                    {p.knownFor.join(', ')}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// A rail built from saved ids. Only ids are stored, so each title is hydrated
// through the cached details endpoint — a poster that changes upstream is never
// frozen here, and there is no second copy of the catalogue to keep in step.
function LibraryRow({ title, field, library }) {
  const [items, setItems] = useState([])

  const ids = [...library.values()]
    .filter((e) => e[field])
    .map((e) => `${e.mediaType}:${e.tmdbId}`)
    .join(',')

  useEffect(() => {
    if (!ids) { setItems([]); return }
    let cancelled = false
    const wanted = ids.split(',').map((k) => {
      const [mediaType, id] = k.split(':')
      return { id: Number(id), mediaType }
    })
    Promise.all(
      wanted.map((w) => fetchMovieDetails(w.id, w.mediaType).catch(() => null))
    ).then((rows) => {
      // Order is preserved from the store, which is newest-saved first.
      if (!cancelled) setItems(rows.filter(Boolean))
    })
    return () => { cancelled = true }
  }, [ids])

  if (!items.length) return null
  return <Row title={title} movies={items} anchorId={`lib-${field}`} />
}

// Sits under the navbar and drives the rails, the browse grid and the search
// results alike. Language and cast live here rather than inside the search view,
// because a filter that only appears after searching cannot be browsed with.
function MediaFilter({ value, onChange, industry, onIndustry, person, onClearPerson, onPickPerson }) {
  return (
    <div style={{
      position: 'sticky', top: 68, zIndex: 90,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '0.75rem 1rem 0.25rem',
    }}>
      <div style={{
        display: 'flex', gap: 4, padding: 4, borderRadius: 999,
        background: 'rgba(10,6,18,0.72)', backdropFilter: 'blur(14px)',
        border: '1px solid rgba(168,85,247,0.22)',
      }}>
        {MEDIA_FILTERS.map((f) => {
          const active = f.id === value
          return (
            <button
              key={f.id}
              onClick={() => onChange(f.id)}
              aria-pressed={active}
              style={{
                position: 'relative', padding: '7px 18px', borderRadius: 999,
                border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
                color: active ? '#fff' : 'var(--text-dim)',
                background: active
                  ? 'linear-gradient(100deg, var(--magenta), var(--violet))'
                  : 'transparent',
                transition: 'color .2s, background .2s',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center',
        maxWidth: 940,
      }}>
        {INDUSTRIES.map((ind) => {
          const active = ind.id === industry
          return (
            <button
              key={ind.id}
              onClick={() => onIndustry(ind.id)}
              aria-pressed={active}
              title={ind.note}
              style={{
                padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600,
                color: active ? '#fff' : 'var(--text-dim)',
                background: active
                  ? 'linear-gradient(100deg, var(--magenta), var(--violet))'
                  : 'rgba(10,6,18,0.7)',
                border: active ? '1px solid transparent' : '1px solid rgba(168,85,247,0.22)',
                backdropFilter: 'blur(10px)',
                transition: 'color .2s, background .2s, border-color .2s',
              }}
            >
              {ind.label}
            </button>
          )
        })}

        {/* The chosen actor reads as a removable chip rather than another
            toggle, since it is one value and clearing it is the only option. */}
        {person ? (
          <button
            onClick={onClearPerson}
            title={`Stop filtering by ${person.name}`}
            style={{
              padding: '4px 10px 4px 12px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12.5, fontWeight: 600, color: '#fff',
              background: 'rgba(0,229,255,0.18)',
              border: '1px solid rgba(0,229,255,0.5)',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            {person.name}
            <span aria-hidden="true" style={{ opacity: 0.7, fontSize: 14 }}>×</span>
          </button>
        ) : (
          <button
            onClick={onPickPerson}
            title="Filter by an actor"
            style={{
              padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)',
              background: 'rgba(10,6,18,0.7)',
              border: '1px dashed rgba(168,85,247,0.4)',
              backdropFilter: 'blur(10px)',
            }}
          >
            + Cast
          </button>
        )}
      </div>
    </div>
  )
}

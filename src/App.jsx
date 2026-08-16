import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Row from './components/Row'
import SearchResults from './components/SearchResults'
import MovieModal from './components/MovieModal'
import { MovieModalContext } from './movieModal'
import {
  CATEGORIES,
  MEDIA_FILTERS,
  fetchCategory,
  fetchFeatured,
  searchTitles,
} from './api/tmdb'

export default function App() {
  const [featured, setFeatured] = useState(null)
  const [rows, setRows] = useState({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [media, setMedia] = useState('all')

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
    if (!q.trim()) { setResults([]); return }
    try {
      const r = await searchTitles(q)
      setResults(r)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Search spans both types, so the filter applies to results too.
  const visibleResults = results.filter(
    (r) => media === 'all' || r.mediaType === media
  )

  return (
    <MovieModalContext.Provider value={setSelected}>
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

      <MediaFilter value={media} onChange={setMedia} />

      <AnimatePresence mode="wait">
        {query.trim() ? (
          <motion.main key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SearchResults query={query} results={visibleResults} />
          </motion.main>
        ) : (
          <motion.main key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Hero movie={featured} />
            <div style={{ marginTop: '-2rem', position: 'relative', zIndex: 2 }}>
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

      <footer style={{
        textAlign: 'center', padding: '3rem 1rem 2rem',
        color: 'var(--text-dim)', fontSize: 13, borderTop: '1px solid rgba(168,85,247,0.15)',
      }}>
        <p>Built with React, Vite & Framer Motion · Data by{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"
            style={{ color: 'var(--cyan)' }}>TMDB</a>
        </p>
      </footer>

      <MovieModal movie={selected} onClose={() => setSelected(null)} />
    </div>
    </MovieModalContext.Provider>
  )
}

// Sits under the navbar and drives both the rails and the search results.
function MediaFilter({ value, onChange }) {
  return (
    <div style={{
      position: 'sticky', top: 68, zIndex: 90,
      display: 'flex', justifyContent: 'center', gap: 6,
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
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { IMG, searchTitles } from '../api/tmdb'

export default function Navbar({ onSearch }) {
  const [scrolled, setScrolled] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const boxRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => onSearch(query), 350)
    return () => clearTimeout(t)
  }, [query, onSearch])

  // Live suggestion list, fetched a bit faster than the full search results.
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await searchTitles(query)
        if (!cancelled) {
          setSuggestions(r.slice(0, 6))
          setActiveIndex(-1)
        }
      } catch (_) {
        if (!cancelled) setSuggestions([])
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const pickSuggestion = (movie) => {
    setQuery(movie.title)
    onSearch(movie.title)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault()
        pickSuggestion(suggestions[activeIndex])
      } else {
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem clamp(1rem, 4vw, 3rem)',
        background: scrolled ? 'rgba(10,6,18,0.82)' : 'transparent',
        backdropFilter: scrolled ? 'blur(14px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(168,85,247,0.18)' : '1px solid transparent',
        transition: 'background 0.3s, border-color 0.3s, backdrop-filter 0.3s',
      }}
    >
      <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        {/* Compass needle angled so it also reads as a play triangle. Sized to
            match the height of the two-line wordmark beside it. */}
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
          <defs>
            <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FF2E93" />
              <stop offset="0.5" stopColor="#A855F7" />
              <stop offset="1" stopColor="#00E5FF" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="#0A0612" />
          <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#logoGrad)" strokeWidth="1.6" opacity="0.45" />
          <g transform="rotate(38 16 16)">
            <polygon points="16,5.5 20.2,16 11.8,16" fill="url(#logoGrad)" />
            <polygon points="16,26.5 20.2,16 11.8,16" fill="#A855F7" opacity="0.32" />
          </g>
          <circle cx="16" cy="16" r="1.5" fill="#0A0612" />
        </svg>
        {/* Two-line lockup: the mark carries the colour, so the name stays
            clean white and the tagline sits under it as a quiet caption. */}
        <span style={{
          display: 'inline-flex', flexDirection: 'column',
          gap: 3, lineHeight: 1,
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            // "Movie Compass" is twice the length of the old wordmark, so it
            // steps down on narrow screens to keep clear of the search box.
            fontSize: 'clamp(16px, 4.2vw, 20px)',
            letterSpacing: '-0.03em',
            fontVariationSettings: "'opsz' 40",
            color: 'var(--text)',
            whiteSpace: 'nowrap',
          }}>
            Movie Compass
          </span>
          <span className="wordmark-tagline" style={{
            fontFamily: 'var(--font-body)',
            fontWeight: 500,
            fontSize: 8.5,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
          }}>
            Find your next film
          </span>
        </span>
      </a>

      <div ref={boxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          style={{ position: 'absolute', left: 14, opacity: 0.6 }}>
          <circle cx="11" cy="11" r="7" stroke="#a99bc4" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="#a99bc4" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search films…"
          aria-label="Search films"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-autocomplete="list"
          style={{
            background: 'rgba(26,16,41,0.7)',
            border: '1px solid rgba(168,85,247,0.3)',
            borderRadius: 999,
            color: 'var(--text)',
            padding: '10px 16px 10px 40px',
            width: 'clamp(140px, 32vw, 280px)',
            fontSize: 14,
            outline: 'none',
          }}
        />

        <AnimatePresence>
          {open && query.trim() && suggestions.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 'clamp(240px, 36vw, 320px)',
                maxHeight: 360,
                overflowY: 'auto',
                background: 'rgba(18,11,29,0.97)',
                backdropFilter: 'blur(14px)',
                border: '1px solid rgba(168,85,247,0.3)',
                borderRadius: 14,
                padding: 6,
                margin: 0,
                listStyle: 'none',
                boxShadow: '0 18px 40px -12px rgba(0,0,0,0.6)',
                zIndex: 200,
              }}
            >
              {suggestions.map((m, i) => {
                const year = m.release_date ? m.release_date.slice(0, 4) : ''
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSuggestion(m)}
                      onMouseEnter={() => setActiveIndex(i)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '8px',
                        border: 'none',
                        borderRadius: 10,
                        background: activeIndex === i ? 'rgba(168,85,247,0.22)' : 'transparent',
                        color: 'var(--text)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 13.5,
                      }}
                    >
                      <span style={{
                        width: 34, height: 48, borderRadius: 6, overflow: 'hidden',
                        flex: '0 0 auto', background: 'var(--surface)',
                      }}>
                        {(m.poster_path || m.backdrop_path) && (
                          <img
                            src={IMG(m.poster_path || m.backdrop_path, 'w92')}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        )}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{
                          display: 'block', fontWeight: 600, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {m.title}
                        </span>
                        {year && (
                          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{year}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  )
}

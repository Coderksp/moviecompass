import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { IMG } from '../api/tmdb'
import { fetchForYou } from '../api/profile'
import { useOpenMovie } from '../movieModal'
import { useUser } from '../auth'
import { useLibrary } from '../library'

// "For you" — the curated rail, above everything the app shows everyone.
//
// It is deliberately the first thing under the hero for a signed-in person, and
// absent entirely for everyone else: a rail headed "for you" that is really
// "what is popular" would be worse than no rail, because it teaches people that
// the personalisation is decoration.
//
// Each card carries the reason it is there, because a recommendation you cannot
// interrogate is one you cannot correct.
export default function ForYouRow() {
  const user = useUser()
  const library = useLibrary()
  const [state, setState] = useState(null)
  const [failed, setFailed] = useState(false)

  // Re-fetched when the library changes as well as when the person does. Rating
  // something and watching the rail ignore it is the fastest way to stop
  // believing in it — the server keys its cache the same way.
  const fingerprint = library.size

  useEffect(() => {
    if (!user) { setState(null); return }
    let cancelled = false
    setFailed(false)

    fetchForYou()
      .then((data) => { if (!cancelled && data) setState(data) })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
  }, [user?.id, fingerprint])

  if (!user || failed) return null

  // Still working it out. The rail takes a real moment on a cold cache — five
  // rounds of candidate generation — so it holds its space rather than appearing
  // under the reader's thumb once they have started scrolling.
  if (!state) return <ForYouSkeleton />

  if (!state.ready) return <ForYouEmpty needed={state.needed} saved={state.saved} />

  return (
    <section style={{ margin: '2.5rem 0 1rem' }}>
      <Heading subtitle="Built from what you have rated and saved" />
      <div className="foryou-rail">
        {state.items.map((item, i) => (
          <ForYouCard key={`${item.mediaType}-${item.id}`} item={item} index={i} />
        ))}
      </div>
    </section>
  )
}

function Heading({ subtitle }) {
  return (
    <div style={{ margin: '0 clamp(1rem, 4vw, 3rem) 0.75rem' }}>
      <motion.h2
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: 'clamp(1.3rem, 2.6vw, 1.9rem)',
          letterSpacing: '-0.02em', margin: 0,
        }}
      >
        <span className="grad-text">For you</span>
      </motion.h2>
      {subtitle && (
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

function ForYouCard({ item, index }) {
  const openMovie = useOpenMovie()
  const year = item.release_date ? item.release_date.slice(0, 4) : ''
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null

  return (
    <motion.button
      type="button"
      onClick={() => openMovie(item)}
      title={`Open ${item.title}`}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: Math.min(index, 6) * 0.04 }}
      className="foryou-card"
    >
      <span className="foryou-poster">
        {item.poster_path ? (
          <img src={IMG(item.poster_path, 'w342')} alt={item.title} loading="lazy" draggable="false" />
        ) : (
          <span className="similar-poster-empty" aria-hidden="true">🎬</span>
        )}
      </span>

      <span className="foryou-title">{item.title}</span>
      <span className="similar-meta">
        {rating && <span className="similar-rating">★ {rating}</span>}
        {year && <span>{year}</span>}
        {item.mediaType === 'tv' && <span>Series</span>}
      </span>
      <span className="foryou-reason">{item.reason}</span>
    </motion.button>
  )
}

// Nothing to go on yet. It says what to do about it, because "no
// recommendations" with no explanation reads as broken rather than as empty.
function ForYouEmpty({ needed, saved }) {
  return (
    <section style={{ margin: '2.5rem 0 1rem' }}>
      <Heading />
      <div
        style={{
          margin: '0 clamp(1rem, 4vw, 3rem)',
          padding: '1.25rem 1.4rem',
          borderRadius: 16,
          border: '1px dashed rgba(168,85,247,0.35)',
          background: 'rgba(26,16,41,0.45)',
          maxWidth: 620,
        }}
      >
        <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>
          {saved > 0
            ? `Rate or favourite ${needed} more title${needed === 1 ? '' : 's'} and this
               fills with films picked for you.`
            : `Heart a film or give one a rating, and this fills with picks based on
               what you like — not on what is popular.`}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '8px 0 0' }}>
          Open any title and use ♡ or the star rating.
        </p>
      </div>
    </section>
  )
}

function ForYouSkeleton() {
  return (
    <section style={{ margin: '2.5rem 0 1rem' }}>
      <Heading subtitle="Working out what you like…" />
      <div className="foryou-rail" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="foryou-card">
            <span className="foryou-poster similar-shimmer" />
            <span className="similar-line similar-shimmer" style={{ width: '80%' }} />
            <span className="similar-line similar-shimmer" style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    </section>
  )
}

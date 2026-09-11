import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { IMG } from '../api/tmdb'
import { fetchSimilar, fetchSimilarReasons } from '../api/recommend'
import { useOpenMovie } from '../movieModal'

// "More like this" — the recommendation rail inside the detail modal.
//
// Two loads, one rail. The posters come from the fast pass and the captions
// arrive underneath them a moment later, so the row is usable before the
// sentences exist. Space for a caption is reserved from the start, because a
// rail that grows taller when the reasons land would shove the page under
// whatever the reader was looking at.
export default function SimilarTitles({ movie }) {
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)
  const openMovie = useOpenMovie()

  useEffect(() => {
    if (!movie?.id) return
    let cancelled = false
    setItems(null)
    setFailed(false)

    fetchSimilar(movie.id, movie.mediaType)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)

        // The second pass is entirely optional, and worth making only when the
        // server says a model is configured to answer it — otherwise it would
        // re-run the whole ranking to return the captions we already have. If it
        // is made and never answers, the rail simply keeps those captions.
        if (!data.canExplain) return
        return fetchSimilarReasons(movie.id, movie.mediaType).then((full) => {
          if (!cancelled && full.items?.length) setItems(full.items)
        })
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
  }, [movie?.id, movie?.mediaType])

  // A film with no neighbours worth showing gets no section at all, rather than
  // a heading over an apology.
  if (failed || (items && !items.length)) return null

  return (
    <div style={{ marginBottom: 26 }}>
      <h3 style={sectionTitle}>More like this</h3>

      <div className="similar-rail">
        {items
          ? items.map((item, i) => (
              <SimilarCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                index={i}
                onOpen={() => openMovie(item)}
              />
            ))
          : Array.from({ length: 6 }, (_, i) => <SimilarSkeleton key={i} />)}
      </div>
    </div>
  )
}

function SimilarCard({ item, index, onOpen }) {
  const year = item.release_date ? item.release_date.slice(0, 4) : ''
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      title={`Open ${item.title}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      // Capped, so the tenth card is not still animating in when someone has
      // already flicked the rail across to it.
      transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.04 }}
      className="similar-card"
    >
      <span className="similar-poster">
        {item.poster_path ? (
          <img
            src={IMG(item.poster_path, 'w342')}
            alt={item.title}
            loading="lazy"
            draggable="false"
          />
        ) : (
          <span className="similar-poster-empty" aria-hidden="true">🎬</span>
        )}
      </span>

      <span className="similar-title">{item.title}</span>

      <span className="similar-meta">
        {rating && <span className="similar-rating">★ {rating}</span>}
        {year && <span>{year}</span>}
        {item.mediaType === 'tv' && <span>Series</span>}
      </span>

      {/* The height is held whether or not there is a reason yet, so captions
          arriving late change nothing about the layout. */}
      <span className="similar-reason">
        {item.reason && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {item.reason}
          </motion.span>
        )}
      </span>
    </motion.button>
  )
}

function SimilarSkeleton() {
  return (
    <div className="similar-card similar-card--loading" aria-hidden="true">
      <span className="similar-poster similar-shimmer" />
      <span className="similar-line similar-shimmer" style={{ width: '80%' }} />
      <span className="similar-line similar-shimmer" style={{ width: '50%' }} />
    </div>
  )
}

// Matches the other section headings in the modal.
const sectionTitle = {
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-dim)', marginBottom: 12,
}

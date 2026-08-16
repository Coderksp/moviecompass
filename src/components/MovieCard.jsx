import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  IMG,
  fetchTrailerKey,
  fetchWatchProviders,
  providersForRegion,
} from '../api/tmdb'
import { useOpenMovie } from '../movieModal'
import { useRegion } from '../region'

export default function MovieCard({ movie, index }) {
  const [hovered, setHovered] = useState(false)
  const [trailerKey, setTrailerKey] = useState(null)
  const [showFrame, setShowFrame] = useState(false)
  const [providers, setProviders] = useState(null)
  const hoverTimer = useRef(null)
  const openMovie = useOpenMovie()
  const region = useRegion()

  // Only the services a subscription already covers — rent and buy are noise at
  // card size, and the modal covers them properly.
  const forRegion = providers ? providersForRegion(providers, region) : null
  const streaming = forRegion
    ? [...forRegion.stream, ...forRegion.free].slice(0, 3)
    : []

  const year = movie.release_date ? movie.release_date.slice(0, 4) : ''
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null
  const isSeries = movie.mediaType === 'tv'

  const onEnter = useCallback(() => {
    setHovered(true)
    // Small delay so quickly scanning the mouse across cards doesn't fire trailers.
    hoverTimer.current = setTimeout(async () => {
      try {
          const key = await fetchTrailerKey(movie.id, movie.mediaType)
        if (key) {
          setTrailerKey(key)
          setShowFrame(true)
        }
      } catch (_) {
        /* no trailer — poster stays */
      }
    }, 600)
  }, [movie.id])

  const onLeave = useCallback(() => {
    clearTimeout(hoverTimer.current)
    setHovered(false)
    setShowFrame(false)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: (index % 8) * 0.04 }}
      // Providers are one request per film, so only ask for the ones actually seen.
      onViewportEnter={() => {
        if (!providers) fetchWatchProviders(movie.id, movie.mediaType).then(setProviders)
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => openMovie(movie)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openMovie(movie) }}
      animate={{ scale: hovered ? 1.08 : 1, zIndex: hovered ? 20 : 1 }}
      style={{
        position: 'relative',
        flex: '0 0 auto',
        width: 'clamp(150px, 18vw, 230px)',
        aspectRatio: '2 / 3',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'var(--surface)',
        boxShadow: hovered
          ? '0 18px 50px -12px rgba(255,46,147,0.45), 0 0 0 1px rgba(168,85,247,0.5)'
          : '0 6px 20px -8px rgba(0,0,0,0.6)',
      }}
    >
      <img
        src={IMG(movie.poster_path || movie.backdrop_path, 'w500')}
        alt={movie.title}
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* Type marker, so a mixed grid never leaves you guessing. Films carry no
          badge — they are the default, and labelling both would be noise. */}
      {isSeries && (
        <motion.span
          animate={{ opacity: showFrame ? 0 : 1 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            padding: '3px 8px', borderRadius: 6,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em',
            textTransform: 'uppercase', pointerEvents: 'none',
            color: '#fff', background: 'rgba(10,6,18,0.72)',
            backdropFilter: 'blur(6px)',
            border: '1px solid rgba(0,229,255,0.45)',
          }}
        >
          Series
        </motion.span>
      )}

      {/* Streaming badges — the at-a-glance "this is already in my subscription" */}
      {streaming.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: showFrame ? 0 : 1, x: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'absolute', top: 10, left: 10,
            display: 'flex', gap: 5, pointerEvents: 'none',
          }}
        >
          {streaming.map((p) => (
            <img
              key={p.provider_id}
              src={IMG(p.logo_path, 'w92')}
              alt={p.provider_name}
              title={`Streaming on ${p.provider_name}`}
              loading="lazy"
              style={{
                width: 26, height: 26, borderRadius: 7, display: 'block',
                border: '1px solid rgba(255,255,255,0.25)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.55)',
              }}
            />
          ))}
        </motion.div>
      )}

      {/* Inline trailer that fades in on hover */}
      <AnimatePresence>
        {showFrame && trailerKey && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{ position: 'absolute', inset: 0, background: '#000' }}
          >
            <iframe
              title={`${movie.title} trailer`}
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerKey}&modestbranding=1&playsinline=1`}
              allow="autoplay; encrypted-media"
              frameBorder="0"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '180%',
                height: '180%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gradient + info overlay, brighter on hover */}
      <motion.div
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 14,
          background:
            'linear-gradient(to top, rgba(10,6,18,0.95) 8%, rgba(10,6,18,0.4) 45%, transparent 70%)',
          pointerEvents: 'none',
        }}
      >
        <h3 style={{
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16,
          lineHeight: 1.2, marginBottom: 6,
        }}>
          {movie.title}
        </h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          {rating && <span style={{ color: 'var(--amber)', fontWeight: 600 }}>★ {rating}</span>}
          {year && <span style={{ color: 'var(--text-dim)' }}>{year}</span>}
        </div>
      </motion.div>

      {/* Colorful top accent line that animates in */}
      <motion.div
        animate={{ scaleX: hovered ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          transformOrigin: 'left',
          background: 'linear-gradient(90deg, var(--magenta), var(--violet), var(--cyan))',
        }}
      />
    </motion.div>
  )
}

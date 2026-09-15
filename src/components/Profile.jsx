import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { fetchProfile } from '../api/profile'
import { signOut } from '../auth'

// Your profile, and what the app has worked out about you.
//
// The taste breakdown is the part worth having. A recommender that will not show
// its reasoning is asking to be trusted for nothing, and "Tamil 77%, Lokesh
// Kanagaraj, mostly 2010s" is both checkable and fixable — if it is wrong, the
// remedy is visible and one tap away.
export default function Profile({ onClose }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    fetchProfile()
      .then((d) => { if (!cancelled && d) setData(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'grid',
        placeItems: 'start center', padding: 'clamp(1rem, 6vh, 4rem) 1rem',
        background: 'rgba(5,3,10,0.72)', backdropFilter: 'blur(8px)', overflowY: 'auto',
      }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: 'min(480px, 100%)', background: 'var(--bg-soft)',
          border: '1px solid rgba(168,85,247,0.22)', borderRadius: 20,
          padding: 'clamp(1.25rem, 5vw, 1.75rem)',
          boxShadow: '0 30px 80px -24px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: 0,
          }}>
            Your profile
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer',
              background: 'rgba(10,6,18,0.6)', color: 'var(--text)', fontSize: 17,
              display: 'grid', placeItems: 'center',
            }}
          >
            ×
          </button>
        </div>

        {failed && (
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Could not load your profile just now.
          </p>
        )}
        {!data && !failed && (
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Loading…</p>
        )}

        {data?.user && (
          <>
            <Identity user={data.user} />
            <Counts counts={data.counts} />
            {data.taste ? (
              <Taste taste={data.taste} />
            ) : (
              <p style={{
                fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-dim)',
                margin: '20px 0 0', padding: '12px 14px', borderRadius: 12,
                border: '1px dashed rgba(168,85,247,0.3)',
              }}>
                Rate or favourite a few more titles and this will show the genres,
                languages and film-makers your recommendations are built from.
              </p>
            )}

            <button
              onClick={() => { signOut(); onClose() }}
              style={{
                marginTop: 22, width: '100%', padding: '11px 18px', borderRadius: 999,
                border: '1px solid rgba(255,46,147,0.35)', cursor: 'pointer',
                background: 'transparent', color: 'var(--text)',
                fontSize: 14, fontWeight: 600,
              }}
            >
              Sign out
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}

function Identity({ user }) {
  const [broken, setBroken] = useState(false)
  const initial = (user.name || user.username || '?').trim().charAt(0).toUpperCase()
  const since = user.memberSince
    ? new Date(user.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
      <span style={{
        width: 60, height: 60, borderRadius: '50%', flex: 'none', overflow: 'hidden',
        display: 'grid', placeItems: 'center',
        border: '1px solid rgba(168,85,247,0.4)',
        background: 'linear-gradient(120deg, rgba(255,46,147,0.25), rgba(168,85,247,0.25))',
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24,
      }}>
        {/* Falls back to the initial if the provider's image fails — a broken
            image icon where a face should be looks like a broken account. */}
        {user.avatar && !broken ? (
          <img
            src={user.avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          initial
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19,
          margin: 0, lineHeight: 1.2,
        }}>
          {user.name}
        </p>
        {user.name !== user.username && (
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '2px 0 0' }}>
            @{user.username}
          </p>
        )}
        {since && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '3px 0 0', opacity: 0.8 }}>
            Here since {since}
          </p>
        )}
      </div>
    </div>
  )
}

function Counts({ counts }) {
  if (!counts) return null
  const cells = [
    ['Rated', counts.rated],
    ['Favourites', counts.favourites],
    ['Watchlist', counts.watchlist],
  ]
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {cells.map(([label, value]) => (
        <div
          key={label}
          style={{
            flex: 1, padding: '12px 10px', borderRadius: 14, textAlign: 'center',
            background: 'rgba(26,16,41,0.7)', border: '1px solid rgba(168,85,247,0.18)',
          }}
        >
          <p style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: 0,
          }}>
            {value ?? 0}
          </p>
          <p style={{
            fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase',
            color: 'var(--text-dim)', margin: '2px 0 0',
          }}>
            {label}
          </p>
        </div>
      ))}
    </div>
  )
}

function Taste({ taste }) {
  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--text-dim)', margin: '0 0 4px',
      }}>
        Your taste
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px', opacity: 0.8 }}>
        What your recommendations are built from
      </p>

      <Bars label="Genres" rows={taste.genres} />
      <Bars label="Languages" rows={taste.languages} />

      {taste.people?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={sublabel}>People you keep coming back to</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {taste.people.map((p) => (
              <span
                key={p.name}
                title={p.role === 'director' ? 'Director or creator' : 'Cast'}
                style={{
                  padding: '4px 11px', borderRadius: 999, fontSize: 12.5,
                  border: '1px solid rgba(168,85,247,0.3)',
                  background: p.role === 'director' ? 'rgba(168,85,247,0.18)' : 'transparent',
                }}
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {(taste.era || taste.maturity) && (
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '14px 0 0' }}>
          {[taste.era, taste.maturity].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

function Bars({ label, rows }) {
  if (!rows?.length) return null
  return (
    <div style={{ marginTop: 12 }}>
      <p style={sublabel}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, minWidth: 92, flex: 'none' }}>{row.name}</span>
            <span style={{
              flex: 1, height: 6, borderRadius: 999,
              background: 'rgba(168,85,247,0.14)', overflow: 'hidden',
            }}>
              <motion.span
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, row.share)}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  display: 'block', height: '100%', borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--magenta), var(--violet))',
                }}
              />
            </span>
            <span style={{
              fontSize: 11.5, color: 'var(--text-dim)', minWidth: 32, textAlign: 'right',
            }}>
              {row.share}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const sublabel = {
  fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-dim)', margin: '0 0 6px', opacity: 0.75,
}

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { signIn, register } from '../auth'

// The sign-in gate. Accounts are real: passwords are hashed server-side and the
// session is an httpOnly cookie, so nothing sensitive is held in the page.
export default function SignIn({ onClose }) {
  const [mode, setMode] = useState('signin')       // 'signin' | 'register'
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const creating = mode === 'register'

  // A failed provider round trip comes back as a redirect carrying its reason,
  // so it has to be read from the URL rather than from a response. The param is
  // stripped afterwards, or the message would survive a refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const reason = params.get('auth_error')
    if (!reason) return
    setError(reason)
    params.delete('auth_error')
    const rest = params.toString()
    window.history.replaceState(
      {}, '', window.location.pathname + (rest ? `?${rest}` : '')
    )
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Enter a username to continue.')
    if (!password) return setError('Enter a password to continue.')

    setBusy(true)
    setError('')
    try {
      // The password goes straight to the server and is never stored here.
      await (creating ? register(name, password) : signIn(name, password))
    } catch (err) {
      // The server's message is the useful one — "that username is taken",
      // "invalid username or password", or a lockout notice.
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Escape closes it, the same as the film modal — a panel you opened by
  // choice should never feel like something you are stuck in.
  useEffect(() => {
    if (!onClose) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        display: 'grid', placeItems: 'center',
        padding: 'clamp(1rem, 5vw, 3rem)',
        background: 'rgba(5,3,10,0.72)', backdropFilter: 'blur(8px)',
        overflowY: 'auto',
      }}
    >
      {/* The panel swallows clicks so only the backdrop dismisses. */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'contents' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: 'min(400px, 100%)',
          background: 'var(--bg-soft)',
          border: '1px solid rgba(168,85,247,0.22)',
          borderRadius: 20, padding: 'clamp(1.5rem, 5vw, 2.25rem)',
          boxShadow: '0 30px 80px -24px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
            <defs>
              <linearGradient id="siGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FF2E93" />
                <stop offset="0.5" stopColor="#A855F7" />
                <stop offset="1" stopColor="#00E5FF" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="#0A0612" />
            <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#siGrad)" strokeWidth="1.6" opacity="0.45" />
            <g transform="rotate(38 16 16)">
              <polygon points="16,5.5 20.2,16 11.8,16" fill="url(#siGrad)" />
              <polygon points="16,26.5 20.2,16 11.8,16" fill="#A855F7" opacity="0.32" />
            </g>
            <circle cx="16" cy="16" r="1.5" fill="#0A0612" />
          </svg>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 800,
            fontSize: 21, letterSpacing: '-0.03em', color: 'var(--text)',
          }}>
            Movie Compass
          </span>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer',
                background: 'rgba(10,6,18,0.6)', color: 'var(--text)',
                fontSize: 17, lineHeight: 1, display: 'grid', placeItems: 'center',
              }}
            >
              ×
            </button>
          )}
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 13.5, margin: '0 0 22px', lineHeight: 1.55 }}>
          {creating
            ? 'Pick a username and a password of at least 8 characters.'
            : 'Sign in to keep a watchlist, favourites and your own ratings.'}
        </p>

        <form onSubmit={submit} noValidate>
          <Field
            label="Username or email"
            value={name}
            onChange={(v) => { setName(v); setError('') }}
            autoComplete="username"
            placeholder="sugan or you@example.com"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(v) => { setPassword(v); setError('') }}
            // Tells a password manager to offer a generated one when creating
            // an account, and the saved one when returning.
            autoComplete={creating ? 'new-password' : 'current-password'}
            placeholder="••••••••"
          />

          {error && (
            <p role="alert" style={{ color: 'var(--magenta)', fontSize: 12.5, margin: '0 0 12px' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%', padding: '12px 18px', borderRadius: 999, border: 'none',
              background: 'linear-gradient(100deg, var(--magenta), var(--violet))',
              color: '#fff', fontWeight: 700, fontSize: 14.5,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1,
            }}
          >
            {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', margin: '14px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
          {creating ? 'Already have an account?' : 'New here?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(creating ? 'signin' : 'register'); setError('') }}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--cyan)', fontSize: 13, fontWeight: 600,
            }}
          >
            {creating ? 'Sign in' : 'Create an account'}
          </button>
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <span style={{ height: 1, flex: 1, background: 'rgba(168,85,247,0.2)' }} />
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            or continue with
          </span>
          <span style={{ height: 1, flex: 1, background: 'rgba(168,85,247,0.2)' }} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {/* A full page navigation, not fetch: the browser has to follow the
              redirect to Google and come back with the session cookie set. */}
          <SocialButton
            label="Google"
            onClick={() => { window.location.href = '/api/auth/google/start' }}
          >
            <GoogleMark />
          </SocialButton>
          <SocialButton
            label="Facebook"
            onClick={() => setError('Facebook sign-in is not connected yet — use a username for now.')}
          >
            <FacebookMark />
          </SocialButton>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 11.5, margin: '20px 0 0', lineHeight: 1.6, opacity: 0.75 }}>
          Passwords are hashed on the server and the session is an httpOnly cookie,
          so nothing sensitive is kept in this page.
        </p>

        {/* An explicit way out. Browsing needs no account, and the panel should
            say so rather than leaving the close button to imply it. */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              display: 'block', width: '100%', marginTop: 14, padding: '9px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', fontSize: 13,
            }}
          >
            Keep browsing without an account
          </button>
        )}
      </motion.div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', autoComplete, placeholder }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{
        display: 'block', fontSize: 11.5, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6,
        fontFamily: 'var(--font-display)', fontWeight: 600,
      }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 10,
          border: '1px solid rgba(168,85,247,0.28)',
          background: 'rgba(10,6,18,0.6)', color: 'var(--text)',
          fontSize: 14.5, fontFamily: 'var(--font-body)',
        }}
      />
    </label>
  )
}

function SocialButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 9, padding: '11px 14px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'rgba(255,255,255,0.05)',
        color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
      }}
    >
      {children}
      {label}
    </button>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none' }}>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37 41.2 44 36 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  )
}

function FacebookMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  )
}

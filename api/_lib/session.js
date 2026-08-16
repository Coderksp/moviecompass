import { SignJWT, jwtVerify } from 'jose'

// Sessions are signed JWTs carried in a cookie.
//
// The cookie is httpOnly, so page JavaScript cannot read it. That is the whole
// point: a token in localStorage is readable by any script that gets injected,
// and one XSS hole would hand out every session. The trade is that the client
// cannot inspect its own token, which is why /api/auth/me exists.
const ALG = 'HS256'
const COOKIE = 'mc_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET is missing or shorter than 32 characters.')
  }
  return new TextEncoder().encode(s)
}

export async function createToken(user) {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())
}

export async function readToken(req) {
  const raw = parseCookies(req)[COOKIE]
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secret(), { algorithms: [ALG] })
    return { id: payload.sub, username: payload.username }
  } catch {
    return null // expired, tampered with, or signed by a different secret
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie || ''
  const out = {}
  header.split(';').forEach((part) => {
    const i = part.indexOf('=')
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1))
  })
  return out
}

// SameSite=Lax stops the cookie riding along with cross-site POSTs, which is
// what makes CSRF a non-issue without a separate token. Secure is dropped in
// local development because localhost is served over plain HTTP.
export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`
  )
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`
  )
}

// Credentialed requests cannot use a wildcard origin, so local development is
// allowed explicitly rather than by opening this to everyone.
export function applyCors(req, res) {
  const origin = req.headers?.origin
  const allowed = [process.env.PUBLIC_ORIGIN, 'http://localhost:5173'].filter(Boolean)
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export async function requireUser(req, res) {
  const user = await readToken(req)
  if (!user) {
    res.status(401).json({ error: 'Not signed in.' })
    return null
  }
  return user
}

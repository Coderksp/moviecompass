import crypto from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

// Shared plumbing for the OAuth authorization-code flow.
//
// The round trip to a provider and back needs two things remembered in between:
// a random `state` to prove the callback belongs to a request we started, and a
// PKCE verifier. Both live in a short-lived signed cookie rather than server
// storage — serverless functions share no memory, so anything held in a variable
// would be gone by the time the callback lands on a different instance.
const FLOW_COOKIE = 'mc_oauth'
const FLOW_MAX_AGE = 60 * 10 // ten minutes is plenty to sign in and far too
                             // short to be worth stealing

function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short.')
  return new TextEncoder().encode(s)
}

const b64url = (buf) => buf.toString('base64url')

export function newFlow() {
  const verifier = b64url(crypto.randomBytes(32))
  return {
    state: b64url(crypto.randomBytes(24)),
    verifier,
    // S256 rather than the plain method: the verifier itself never travels in
    // the first redirect, so a leaked URL cannot complete the exchange.
    challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
  }
}

export async function setFlowCookie(res, provider, flow) {
  const token = await new SignJWT({ provider, state: flow.state, verifier: flow.verifier })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${FLOW_MAX_AGE}s`)
    .sign(secret())

  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  // SameSite=Lax, not Strict: the provider redirects the browser back to us
  // cross-site, and Strict would withhold the cookie on exactly that request.
  res.setHeader(
    'Set-Cookie',
    `${FLOW_COOKIE}=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${FLOW_MAX_AGE}`
  )
}

export async function readFlowCookie(req, provider) {
  const raw = (req.headers?.cookie || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${FLOW_COOKIE}=`))
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(
      decodeURIComponent(raw.slice(FLOW_COOKIE.length + 1)),
      secret(),
      { algorithms: ['HS256'] }
    )
    return payload.provider === provider ? payload : null
  } catch {
    return null
  }
}

export function clearFlowCookie(res, extra = []) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  res.setHeader('Set-Cookie', [
    ...extra,
    `${FLOW_COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`,
  ])
}

export function origin(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host
  const proto = req.headers?.['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

// Failures send the browser back to the app with a readable reason rather than
// leaving someone staring at raw JSON on a callback URL.
export function failTo(res, base, reason) {
  res.writeHead(302, { Location: `${base}/?auth_error=${encodeURIComponent(reason)}` })
  res.end()
}

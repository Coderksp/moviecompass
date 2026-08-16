import { createRemoteJWKSet, jwtVerify } from 'jose'
import { readFlowCookie, clearFlowCookie, origin, failTo } from '../../_lib/oauth.js'
import { findOrCreateUser } from '../../_lib/identity.js'
import { createToken } from '../../_lib/session.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

// Google's signing keys, fetched once per warm instance and cached by jose.
// Verifying the signature is the whole point: without it, anyone could POST a
// hand-written id_token to this endpoint and become any user.
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export default async function handler(req, res) {
  const base = origin(req)
  const { code, state, error } = req.query || {}

  if (error) return failTo(res, base, 'Google sign-in was cancelled.')
  if (!code || !state) return failTo(res, base, 'Google sign-in returned an incomplete response.')

  try {
    const flow = await readFlowCookie(req, 'google')
    // A callback whose state does not match a flow we started is either stale
    // or forged. Either way it must not produce a session.
    if (!flow || flow.state !== state) {
      return failTo(res, base, 'Sign-in expired or was tampered with. Try again.')
    }

    const body = new URLSearchParams({
      code: String(code),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${base}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    })

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!tokenRes.ok) {
      console.error('google token exchange failed:', await tokenRes.text())
      return failTo(res, base, 'Google would not complete the sign-in.')
    }
    const { id_token: idToken } = await tokenRes.json()
    if (!idToken) return failTo(res, base, 'Google did not return an identity token.')

    // Checks the signature, the issuer, that the token was minted for this
    // client, and that it has not expired.
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: ISSUERS,
      audience: process.env.GOOGLE_CLIENT_ID,
    })

    // An unverified address must not be trusted to match an existing account:
    // anyone able to claim it could take over that account.
    const email = payload.email_verified ? payload.email : null

    const user = await findOrCreateUser({
      provider: 'google',
      providerId: payload.sub,
      email,
      name: payload.name || email,
    })

    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
    const session = await createToken(user)
    clearFlowCookie(res, [
      `mc_session=${encodeURIComponent(session)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
    ])

    res.writeHead(302, { Location: `${base}/` })
    res.end()
  } catch (err) {
    console.error('google callback failed:', err)
    failTo(res, base, 'Could not complete Google sign-in.')
  }
}

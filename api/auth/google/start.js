import { newFlow, setFlowCookie, origin, failTo } from '../../_lib/oauth.js'

// Step one: send the browser to Google with a request it can verify came from
// us. Nothing secret is in this URL — the client secret is only ever used
// server-side, in the token exchange on the callback.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

export default async function handler(req, res) {
  const base = origin(req)
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return failTo(res, base, 'Google sign-in is not configured on the server.')
  }

  try {
    const flow = newFlow()
    await setFlowCookie(res, 'google', flow)

    const url = new URL(AUTH_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', `${base}/api/auth/google/callback`)
    url.searchParams.set('response_type', 'code')
    // openid gets a signed id_token, which carries the account id and email
    // without needing a second call to a userinfo endpoint.
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', flow.state)
    url.searchParams.set('code_challenge', flow.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    // Without this, a returning user is bounced straight through and cannot
    // pick a different account.
    url.searchParams.set('prompt', 'select_account')

    res.writeHead(302, { Location: url.toString() })
    res.end()
  } catch (err) {
    console.error('google start failed:', err)
    failTo(res, base, 'Could not start Google sign-in.')
  }
}

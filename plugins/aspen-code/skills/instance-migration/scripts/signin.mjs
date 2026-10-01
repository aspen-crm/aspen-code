// Sign in to an Aspen instance the way `aspen login` does: the browser, PKCE, and a redirect to
// 127.0.0.1. The token stays in this process's memory and is never written anywhere. close()
// revokes the refresh token; the last access token cannot be revoked and expires within the hour.
//
// The instance's API names its OAuth resource and sign-in server (RFC 9728), and the server names
// its endpoints (RFC 8414). On Aspen the resource is the pod's origin, not the instance URL, and
// the authorize endpoint sits on another host than the token endpoint, so nothing is built by hand.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

export const CLIENT_ID = 'aspen-cli' // the CLI's public client; the only one registered
const TIMEOUT_MS = 5 * 60 * 1000
const STRAY_CAP = 20 // unrelated local requests tolerated while waiting for the callback
const EARLY_MS = 60 * 1000 // refresh this long before the access token expires

export class SignInError extends Error {
  constructor (message) { super(message); this.code = 2 }
}

const b64url = (b) => b.toString('base64url')
const trim = (u) => String(u).replace(/\/+$/, '')

async function getJson (url, what) {
  let res
  try { res = await fetch(url, { headers: { accept: 'application/json' } }) } catch (e) {
    throw new SignInError(`could not reach ${new URL(url).origin} to sign in (${e.cause?.message ?? e.message}); is this machine on the network that reaches the instance (VPN)?`)
  }
  const j = await res.json().catch(() => null)
  if (!res.ok || !j) throw new SignInError(`${new URL(url).origin} did not describe its ${what} (HTTP ${res.status}); is this machine on the network that reaches the instance (VPN)?`)
  return j
}

async function discover (instanceUrl) {
  const origin = new URL(instanceUrl).origin
  const pr = await getJson(`${origin}/.well-known/oauth-protected-resource`, 'sign-in resource')
  const server = pr.authorization_servers?.[0]
  if (!pr.resource || !server) throw new SignInError(`${origin} names no sign-in server`)
  const at = new URL(server)
  const meta = await getJson(`${at.origin}/.well-known/oauth-authorization-server${trim(at.pathname)}`, 'sign-in server')
  if (trim(meta.issuer) !== trim(server)) throw new SignInError(`the sign-in server for ${origin} names another issuer (${meta.issuer})`)
  if (!meta.code_challenge_methods_supported?.includes('S256')) throw new SignInError(`the sign-in server for ${origin} does not support PKCE (S256)`)
  return { resource: pr.resource, issuer: meta.issuer, authorize: meta.authorization_endpoint, token: meta.token_endpoint, revoke: meta.revocation_endpoint }
}

export function openInBrowser (url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]]
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true })
    p.on('error', () => {}) // no opener: the printed URL is the fallback
    p.unref()
  } catch {}
}

// Listen on 127.0.0.1 for the one callback that carries this attempt's state.
async function callback ({ state, issuer, side, timeoutMs }) {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`
  let strays = 0
  let timer
  const stop = () => { clearTimeout(timer); server.close(); server.closeAllConnections?.() }
  const code = new Promise((resolve, reject) => {
    const fail = (message) => { stop(); reject(new SignInError(message)) }
    timer = setTimeout(() => fail(`no sign-in to the ${side} within ${Math.max(1, Math.round(timeoutMs / 60000))} minutes; run the command again`), timeoutMs)
    server.on('request', (req, res) => {
      const page = (status, text) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); res.end(text) }
      const u = new URL(req.url, 'http://127.0.0.1')
      if (req.method !== 'GET' || u.pathname !== '/oauth/callback') {
        page(404, 'Not found.')
        if (++strays > STRAY_CAP) fail(`too many unrelated local requests while waiting for the ${side} sign-in; run the command again`)
        return
      }
      const p = u.searchParams
      if (p.get('state') !== state) { page(400, 'This sign-in was not started by this command, so it was discarded.'); return fail(`the ${side} sign-in came back with the wrong state and was discarded; run the command again`) }
      if (p.get('iss') && trim(p.get('iss')) !== trim(issuer)) { page(400, 'This sign-in came from another server, so it was discarded.'); return fail(`the ${side} sign-in came back from another issuer (${p.get('iss')}) and was discarded; run the command again`) }
      if (p.get('error')) { page(200, 'Sign-in was refused. You can close this tab.'); return fail(`sign-in to the ${side} was refused (${p.get('error')})`) }
      if (!p.get('code')) { page(400, 'The sign-in carried no code.'); return fail(`the ${side} sign-in came back without a code; run the command again`) }
      page(200, 'Signed in. You can close this tab.')
      stop()
      resolve(p.get('code'))
    })
  })
  return { redirectUri, code }
}

async function tokenRequest (endpoint, body, side) {
  let res
  try {
    res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body) })
  } catch (e) { throw new SignInError(`the ${side} sign-in server did not answer (${e.cause?.message ?? e.message})`) }
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.access_token) throw new SignInError(`the ${side} sign-in failed (HTTP ${res.status}${j?.error ? `: ${j.error}` : ''})`)
  return j
}

// Revoke what is still open if the command is interrupted.
const live = new Set()
let hooked = false
function track (session) {
  live.add(session)
  if (hooked) return
  hooked = true
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => { Promise.allSettled([...live].map((s) => s.close())).finally(() => process.exit(code)) })
  }
}

export async function signIn (instanceUrl, { side = 'instance', timeoutMs = TIMEOUT_MS, openBrowser = openInBrowser, log = console.log } = {}) {
  const d = await discover(instanceUrl)
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  const { redirectUri, code: waiting } = await callback({ state, issuer: d.issuer, side, timeoutMs })
  const url = new URL(d.authorize)
  const params = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', resource: d.resource }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  log(`sign in to the ${side} (${instanceUrl}) in the browser tab that opened; if none did, open: ${url}`)
  openBrowser(url.href)
  const code = await waiting

  const secrets = new Set([code])
  let tokens
  let expiresAt
  const keep = (t) => {
    tokens = { ...t, refresh_token: t.refresh_token ?? tokens?.refresh_token }
    for (const s of [tokens.access_token, tokens.refresh_token]) if (s) secrets.add(s)
    expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000
  }
  keep(await tokenRequest(d.token, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID, code_verifier: verifier, resource: d.resource }, side))

  let closed = false
  const session = {
    // A refresh replaces both tokens and retires the previous access token.
    async refreshed () {
      const expired = new SignInError(`the ${side} sign-in expired; run the command again (it resumes)`)
      if (!tokens.refresh_token) throw expired
      try { keep(await tokenRequest(d.token, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, resource: d.resource }, side)) } catch { throw expired }
      return tokens.access_token
    },
    async bearer () { return Date.now() > expiresAt - EARLY_MS ? session.refreshed() : tokens.access_token },
    async close () {
      if (closed) return
      closed = true
      live.delete(session)
      if (!d.revoke || !tokens.refresh_token) return
      try {
        await fetch(d.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: CLIENT_ID }) })
      } catch {}
    },
    secrets: () => [...secrets]
  }
  track(session)
  return session
}

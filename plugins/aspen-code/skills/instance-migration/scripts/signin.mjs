// Sign in to an Aspen instance the way `aspen login` does: the browser, PKCE, and a redirect to
// 127.0.0.1. The token stays in memory and is never written anywhere. Revoking the refresh token
// also revokes the access token issued with it.
//
// session() signs in once per instance for many commands: it hands the sign-in to a background
// process (`node signin.mjs hold`) that keeps it in memory and answers on a socket in a directory
// only this user can open. Later commands take their token from it and open no browser. The
// holder revokes and exits after an hour with no command, or on signOut(). Where no private
// socket can be made (Windows), each command signs in and revokes on exit.
//
// The instance's API names its OAuth resource and sign-in server (RFC 9728), and the server names
// its endpoints (RFC 8414). On Aspen the resource is the instance host's origin, without the
// instance URL's path, and the authorize endpoint sits on the domain host while token and revoke
// sit on the instance host, so nothing is built by hand.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createSocketServer, connect as dial } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CLIENT_ID = 'aspen-cli' // the CLI's public client, registered for a 127.0.0.1 callback on any port
const TIMEOUT_MS = 5 * 60 * 1000
const STRAY_CAP = 20 // unrelated local requests tolerated while waiting for the callback
const EARLY_MS = 60 * 1000 // refresh this long before the access token expires
export const IDLE_MS = 60 * 60 * 1000 // a kept sign-in ends this long after the last command

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

// The tokens of one sign-in: refreshed before they expire, revoked on close.
function tokenSet ({ d, side, tokens: first, expiresAt: at, known = [] }) {
  const secrets = new Set(known)
  let tokens
  let expiresAt
  const keep = (t, when) => {
    tokens = { ...t, refresh_token: t.refresh_token ?? tokens?.refresh_token }
    for (const s of [tokens.access_token, tokens.refresh_token]) if (s) secrets.add(s)
    expiresAt = when ?? Date.now() + (Number(t.expires_in) || 3600) * 1000
  }
  keep(first, at)
  let closed = false
  const set = {
    // A refresh replaces both tokens and retires the previous access token. Asked with the token
    // that was refused (stale), it is skipped when another command already refreshed that one.
    async refreshed (stale) {
      if (stale && stale !== tokens.access_token) return tokens.access_token
      const expired = new SignInError(`the ${side} sign-in expired; run the command again (it resumes)`)
      if (!tokens.refresh_token) throw expired
      try { keep(await tokenRequest(d.token, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, resource: d.resource }, side)) } catch { throw expired }
      return tokens.access_token
    },
    async bearer () { return Date.now() > expiresAt - EARLY_MS ? set.refreshed() : tokens.access_token },
    async close () {
      if (closed) return
      closed = true
      live.delete(set)
      if (!d.revoke || !tokens.refresh_token) return
      try {
        await fetch(d.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: CLIENT_ID }) })
      } catch {}
    },
    // Another process holds it now: this one neither refreshes nor revokes it.
    release () { closed = true; live.delete(set) },
    state: () => ({ d, side, tokens, expiresAt }),
    secrets: () => [...secrets]
  }
  return set
}

// One sign-in in this process, revoked by close() or when the process is interrupted.
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
  const tokens = await tokenRequest(d.token, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID, code_verifier: verifier, resource: d.resource }, side)
  const set = tokenSet({ d, side, tokens, known: [code] })
  track(set)
  return set
}

// ---- the holder: one kept sign-in per instance, in memory, behind a socket only this user can open

// Its socket, or null where none can be private: a directory of this user's, mode 0700, in the
// temp dir, and a path short enough for a Unix socket.
export function socketFor (instanceUrl) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return null
  const uid = process.getuid()
  const dir = join(tmpdir(), `aspen-signin-${uid}`)
  try {
    try { mkdirSync(dir, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') return null }
    const st = lstatSync(dir)
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o077)) return null
  } catch { return null }
  const path = join(dir, `${createHash('sha256').update(trim(instanceUrl)).digest('hex').slice(0, 16)}.sock`)
  return path.length <= 100 ? path : null
}

// One request to a holder, a JSON line each way; null when none answers.
function ask (sock, req, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let buf = ''
    let settled = false
    const c = dial(sock)
    const done = (v) => { if (settled) return; settled = true; c.destroy(); resolve(v) }
    c.setTimeout(timeoutMs, () => done(null))
    c.on('error', () => done(null))
    c.on('end', () => done(null))
    c.on('data', (chunk) => {
      buf += chunk
      const i = buf.indexOf('\n')
      if (i < 0) return
      let v = null
      try { v = JSON.parse(buf.slice(0, i)) } catch {}
      done(v)
    })
    c.end(JSON.stringify(req) + '\n')
  })
}

// A sign-in the holder keeps. close() leaves it to the holder.
function kept (sock, instanceUrl, side, known) {
  const secrets = new Set(known)
  let last = null
  const get = async (req) => {
    const r = await ask(sock, req)
    if (!r?.ok || r.url !== trim(instanceUrl)) throw new SignInError(`the ${side} sign-in ended${r?.error ? ` (${r.error})` : ''}; run the command again (it resumes)`)
    secrets.add(r.token)
    last = r.token
    return r.token
  }
  return {
    bearer: () => get({ op: 'token' }),
    refreshed: () => get({ op: 'refresh', stale: last }),
    close: async () => {},
    secrets: () => [...secrets]
  }
}

// Start a holder for a fresh sign-in; true once it serves it.
function handOff (set, instanceUrl, sock, idleMs) {
  return new Promise((resolve) => {
    let p
    try {
      p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'hold'], { cwd: dirname(sock), detached: true, stdio: ['pipe', 'pipe', 'ignore'] })
    } catch { return resolve(false) }
    let out = ''
    let settled = false
    let timer = null
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      p.stdout.destroy()
      p.stdin.destroy()
      if (!ok) { try { p.kill() } catch {} }
      p.unref()
      resolve(ok)
    }
    timer = setTimeout(() => finish(false), 10000)
    p.on('error', () => finish(false))
    p.on('exit', () => finish(false))
    p.stdin.on('error', () => {})
    p.stdout.on('data', (chunk) => { out += chunk; if (out.includes('ready\n')) finish(true) })
    p.stdin.end(JSON.stringify({ url: trim(instanceUrl), sock, idleMs, ...set.state() }))
  })
}

// A sign-in for many commands: the one kept for this instance, or a new one in the browser that
// is kept from then on. Without a private socket, a sign-in for this process alone.
export async function session (instanceUrl, { side = 'instance', idleMs = IDLE_MS, log = console.log, ...options } = {}) {
  const sock = socketFor(instanceUrl)
  if (sock) {
    const r = await ask(sock, { op: 'token' })
    if (r?.ok && r.url === trim(instanceUrl)) {
      log(`${side}: using the sign-in kept from an earlier command`)
      return kept(sock, instanceUrl, side, [r.token])
    }
  }
  const set = await signIn(instanceUrl, { side, log, ...options })
  if (!sock || !(await handOff(set, instanceUrl, sock, idleMs))) return set
  set.release()
  log(`${side}: signed in; later commands reuse this sign-in until ${Math.round(idleMs / 60000)} minutes pass with none, or signout`)
  return kept(sock, instanceUrl, side, set.secrets())
}

// End the sign-in kept for this instance: the holder revokes it and exits. False when none was kept.
export async function signOut (instanceUrl) {
  const sock = socketFor(instanceUrl)
  return !!(sock && (await ask(sock, { op: 'close' }))?.ok)
}

async function hold () {
  process.stdout.on('error', () => {})
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const { url, sock, idleMs, ...state } = JSON.parse(raw)
  const set = tokenSet(state)
  let timer
  let ending = null
  const server = createSocketServer({ allowHalfOpen: true }) // the reply may follow a refresh
  const quit = () => (ending ??= (async () => {
    clearTimeout(timer)
    server.close()
    try { unlinkSync(sock) } catch {}
    await set.close()
    process.exit(0)
  })())
  const idle = () => { clearTimeout(timer); timer = setTimeout(quit, idleMs) }
  server.on('connection', (c) => {
    idle()
    let buf = ''
    c.setTimeout(30000, () => c.destroy())
    c.on('error', () => {})
    c.on('data', async (chunk) => {
      if (buf.includes('\n')) return
      buf += chunk
      const i = buf.indexOf('\n')
      if (i < 0) return
      const reply = (o) => new Promise((resolve) => c.end(JSON.stringify({ url, ...o }) + '\n', resolve))
      let req
      try { req = JSON.parse(buf.slice(0, i)) } catch { return c.destroy() }
      if (req.op === 'ping') return reply({ ok: true })
      if (req.op === 'close') { await set.close(); await reply({ ok: true }); return quit() }
      try {
        await reply({ ok: true, token: req.op === 'refresh' ? await set.refreshed(req.stale) : await set.bearer() })
      } catch (e) {
        await reply({ ok: false, error: e.message })
        quit()
      }
    })
  })
  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sock, () => { server.off('error', reject); resolve() })
  })
  // A socket left by a holder that died is taken over; one that still answers is left alone, and
  // this sign-in stays with the command that made it.
  try { await listen() } catch (e) {
    if (e.code !== 'EADDRINUSE' || await ask(sock, { op: 'ping' }, 2000)) process.exit(1)
    unlinkSync(sock)
    await listen()
  }
  chmodSync(sock, 0o600)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, quit)
  idle()
  process.stdout.write('ready\n')
}

if (process.argv[2] === 'hold' && process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  hold().catch(() => process.exit(1))
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { context } from '../hooks/session-start.mjs'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.mjs')

// A home directory with whichever of the three facts the test wants.
function machine (t, { cli = false, onPath = false, login = null, instanceDir = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'aspen home '))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  const bin = join(home, '.aspen', 'bin')
  if (cli) { put(join(bin, 'aspen'), '#!/bin/sh\n'); chmodSync(join(bin, 'aspen'), 0o755) }
  if (login) {
    put(join(home, '.config', 'aspen', 'credentials.json'),
      JSON.stringify({ instance: login, token_storage: 'keyring', method: 'o_auth' }))
  }
  let cwd = home
  if (instanceDir) {
    cwd = join(home, 'Aspen', 'acme_dev')
    put(join(cwd, '.aspen', 'config.toml'), `instance = "${instanceDir}"\n`)
    mkdirSync(join(cwd, 'metadata', 'custom'), { recursive: true })
    cwd = join(cwd, 'metadata', 'custom')
  }
  const env = { PATH: onPath ? `/usr/bin:${bin}` : '/usr/bin' }
  return { home, cwd, env }
}

const URL_A = 'https://host.example/acme/dev/'
const URL_B = 'https://host.example/acme/prod/'

test('no CLI: routes to getting-started with the installer', t => {
  const out = context(machine(t))
  assert.match(out, /not installed/)
  assert.match(out, /getting-started/)
  assert.match(out, /installer\.(sh|ps1)/)
})

test('CLI in ~/.aspen/bin but not on PATH: says to use the full path', t => {
  const m = machine(t, { cli: true, login: URL_A })
  const out = context(m)
  assert.match(out, /PATH does not have it/)
  assert.ok(out.includes(join(m.home, '.aspen', 'bin', 'aspen')))
})

test('CLI on PATH, not signed in: prompts the OAuth login and never runs it', t => {
  const out = context(machine(t, { cli: true, onPath: true }))
  assert.match(out, /not signed in/)
  assert.match(out, /aspen login -i/)
  assert.match(out, /user runs it, not you/)
  assert.doesNotMatch(out, /api-key/)
})

test('not signed in, inside an instance directory: names the URL to sign in to', t => {
  const out = context(machine(t, { cli: true, onPath: true, instanceDir: URL_A }))
  assert.match(out, /not signed in/)
  assert.ok(out.includes(URL_A))
})

test('signed in, outside any instance directory: silent', t => {
  assert.equal(context(machine(t, { cli: true, onPath: true, login: URL_A })), '')
})

test('signed in, in a subdirectory of the matching instance directory: routes to using-aspen', t => {
  const out = context(machine(t, { cli: true, onPath: true, login: URL_A.replace(/\/$/, ''), instanceDir: URL_A }))
  assert.match(out, /using-aspen/)
  assert.doesNotMatch(out, /refuse/)
})

test('signed in to a different instance than the directory: warns before any deploy', t => {
  const out = context(machine(t, { cli: true, onPath: true, login: URL_B, instanceDir: URL_A }))
  assert.match(out, /using-aspen/)
  assert.match(out, /will refuse/)
  assert.ok(out.includes(`aspen login -i ${URL_A}`))
})

test('ASPEN_CONFIG_DIR overrides where credentials are read', t => {
  const m = machine(t, { cli: true, onPath: true })
  const dir = join(m.home, 'elsewhere')
  mkdirSync(dir)
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ instance: URL_A }))
  assert.equal(context({ ...m, env: { ...m.env, ASPEN_CONFIG_DIR: dir } }), '')
})

test('an unreadable credentials file reads as not signed in, not a crash', t => {
  const m = machine(t, { cli: true, onPath: true })
  mkdirSync(join(m.home, '.config', 'aspen'), { recursive: true })
  writeFileSync(join(m.home, '.config', 'aspen', 'credentials.json'), '{not json')
  assert.match(context(m), /not signed in/)
})

test('the hook process emits SessionStart JSON and exits 0', t => {
  const m = machine(t)
  const r = spawnSync(process.execPath, [hook], {
    cwd: m.cwd, env: { ...m.env, HOME: m.home, USERPROFILE: m.home }, encoding: 'utf8'
  })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout).hookSpecificOutput
  assert.equal(out.hookEventName, 'SessionStart')
  assert.match(out.additionalContext, /getting-started/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { decide, evaluate, invocations } from '../hooks/guard-instance.mjs'
import { sameInstance } from '../hooks/session-start.mjs'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-instance.mjs')
const A = 'https://host.example/acme/dev/'
const B = 'https://host.example/acme/prod/'

// ~/Aspen/acme_dev (A), ~/Aspen/acme_prod (B), ~/scratch (no instance), and a login.
function machine (t, login = A) {
  const home = mkdtempSync(join(tmpdir(), 'aspen guard '))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
  const dev = join(home, 'Aspen', 'acme_dev'); const prod = join(home, 'Aspen', 'acme_prod')
  put(join(dev, '.aspen', 'config.toml'), `instance = "${A}"\n`)
  mkdirSync(join(dev, 'metadata', 'custom'), { recursive: true })
  put(join(prod, '.aspen', 'config.toml'), `instance = "${B}"\n`)
  mkdirSync(join(home, 'scratch'), { recursive: true })
  if (login) put(join(home, '.config', 'aspen', 'credentials.json'), JSON.stringify({ instance: login }))
  const env = { ASPEN_HOME: join(home, '.aspen') }
  const run = (command, cwd = dev) => decide({ command, cwd, env, home })
  return { home, dev, prod, scratch: join(home, 'scratch'), env, run }
}

test('parses cd chains, env prefixes, --dir and flag values', () => {
  const inv = invocations('cd /x && FOO=1 aspen --agent yes move checkin-prep; aspen compile --dir ../y', '/w', '/h')
  assert.deepEqual(inv.map(i => [i.command, i.sub, i.dir]), [['move', 'checkin-prep', '/x'], ['compile', '', '/y']])
  assert.equal(invocations('aspen move --help', '/w').length, 0)
})

test('in the session\'s instance folder, matching the login: allowed', t => {
  const m = machine(t)
  for (const c of ['aspen move save-package', 'aspen compile', 'aspen doctor', 'aspen status', 'cd metadata/custom && aspen move checkin-prep']) {
    assert.deepEqual(m.run(c), { hard: [], confirm: [] }, c)
  }
})

test('aspen move outside any instance folder is refused, naming the session folder', t => {
  const m = machine(t)
  const r = m.run(`cd "${m.scratch}" && aspen move checkin-deploy`)
  assert.equal(r.hard.length, 1)
  assert.match(r.hard[0], /not running in an instance folder/)
  assert.ok(r.hard[0].includes(`cd ${m.dev}`))
  assert.equal(m.run('aspen move checkin-prep', m.scratch).hard.length, 1)
})

test('a folder for another instance than the login is refused with the sign-in fix', t => {
  const m = machine(t)
  const r = m.run('aspen move save-package', m.prod)
  assert.match(r.hard[0], /signed in to/)
  assert.ok(r.hard[0].includes(`aspen login -i ${B}`))
})

test('leaving the session folder for another instance folder asks, even when the login matches', t => {
  const m = machine(t, B)
  const r = decide({ command: `aspen move save-package --dir "${m.prod}"`, cwd: m.dev, env: m.env, home: m.home })
  // the session folder (A) does not match the login (B) either — but the target (B) does.
  assert.equal(r.hard.length, 0)
  assert.match(r.confirm[0], /different instance folder/)
  const confirmed = decide({ command: `ASPEN_CODE_CONFIRMED=1 aspen move save-package --dir "${m.prod}"`, cwd: m.dev, env: m.env, home: m.home })
  assert.deepEqual(confirmed, { hard: [], confirm: [] })
})

test('aspenup\'s CLI by ~ or $HOME is allowed, wherever the command names it from', t => {
  const m = machine(t)
  for (const bin of ['~/.aspen/bin/aspen', '$HOME/.aspen/bin/aspen', '"${HOME}/.aspen/bin/aspen"']) {
    assert.deepEqual(m.run(`cd "${m.dev}" && ${bin} doctor`), { hard: [], confirm: [] }, bin)
  }
})

test('login runs only in the agent shape and never with an API key; logout asks', t => {
  const m = machine(t)
  assert.match(m.run(`aspen login -i ${A}`).hard[0], /ASPEN_INTERACTIVE=1 aspen login -i <instance URL> --agent no --credential-store keyring/)
  assert.match(m.run(`aspen login -i ${A} --agent no`).hard[0], /refuses OAuth/) // ASPEN_INTERACTIVE missing
  for (const c of [
    `ASPEN_INTERACTIVE=1 aspen login -i ${A} --agent no --credential-store keyring`,
    `ASPEN_INTERACTIVE=true ~/.aspen/bin/aspen --agent=no login -i ${A}`,
    `export ASPEN_INTERACTIVE=1 && aspen login -i ${A} --agent no`,
    `$env:ASPEN_INTERACTIVE='1'; aspen login -i ${A} --agent no; Remove-Item Env:ASPEN_INTERACTIVE`
  ]) assert.deepEqual(m.run(c), { hard: [], confirm: [] }, c)
  for (const key of ['-k secret', '--api-key secret', '--api-key=secret']) {
    assert.match(m.run(`ASPEN_INTERACTIVE=1 aspen login -i ${A} --agent no ${key}`).hard[0], /never signs in with an API key/, key)
  }
  assert.match(m.run('aspen logout').confirm[0], /removes the stored login/)
})

test('aspen init outside ~/Aspen asks; ~/Aspen, a confirmed choice and a refresh pass', t => {
  const m = machine(t)
  const r = m.run('aspen init', m.scratch)
  assert.equal(r.hard.length, 0)
  assert.match(r.confirm[0], /not `.*Aspen`/)
  assert.ok(r.confirm[0].includes(`aspen init --dir ${join(m.home, 'Aspen')}`))
  assert.equal(m.run(`aspen init --dir "${m.scratch}"`, m.dev).confirm.length, 1)
  for (const c of ['aspen init --dir ~/Aspen', `cd "${join(m.home, 'Aspen')}" && aspen init`, 'ASPEN_CODE_CONFIRMED=1 aspen init']) {
    assert.deepEqual(m.run(c, m.scratch), { hard: [], confirm: [] }, c)
  }
  assert.deepEqual(m.run('aspen init'), { hard: [], confirm: [] }) // in an instance folder: a refresh
})

test('host adapters: Claude asks, Codex refuses with the confirm route; unrelated commands pass', t => {
  const m = machine(t, B)
  const cmd = `aspen move save-package --dir "${m.prod}"`
  const env = { ...m.env, HOME: m.home }
  const claude = evaluate({ tool_name: 'Bash', cwd: m.dev, tool_input: { command: cmd } }, env)
  assert.equal(claude.hookSpecificOutput.permissionDecision, 'ask')
  const codex = evaluate({ tool_name: 'exec_command', turn_id: 't', tool_input: { cmd: ['bash', '-lc', cmd], workdir: m.dev } }, env)
  assert.equal(codex.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(codex.hookSpecificOutput.permissionDecisionReason, /ASPEN_CODE_CONFIRMED=1/)
  assert.equal(evaluate({ tool_name: 'Bash', cwd: m.dev, tool_input: { command: 'ls -la' } }, env), null)
  assert.equal(evaluate({ tool_name: 'Write', tool_input: {} }, env), null)
})

test('the hook process fails open on garbage and denies over stdin', t => {
  const m = machine(t)
  const bad = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' })
  assert.equal(bad.status, 0); assert.equal(bad.stdout, '')
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: m.scratch, tool_input: { command: 'aspen move checkin-deploy' } }),
    env: { ...process.env, ...m.env, HOME: m.home, XDG_CONFIG_HOME: '', ASPEN_CONFIG_DIR: '' }, encoding: 'utf8'
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test('a vanity host and the canonical host name the same instance, as the CLI compares them', () => {
  assert.ok(sameInstance('https://acme.example.com/acme.com/dev/', 'https://0000-01-0101-ip.veevaxdev.com/acme.com/dev'))
  assert.ok(!sameInstance('https://host.example/acme.com/dev/', 'https://host.example/acme.com/prod/'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'getting-started', 'scripts', 'install-deps.mjs')

// An instance directory on a machine with no rustup and no Node: nothing the script could install
// without --machine, so these runs never reach the network.
function bare (t) {
  const home = mkdtempSync(join(tmpdir(), 'aspen deps '))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'acme_dev')
  const put = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
  put('.aspen/config.toml', 'instance = "https://host.example/acme/dev/"\n')
  put('rust/rust-toolchain.toml', '[toolchain]\nchannel = "1.98.1"\ntargets = [\n    "wasm32-wasip2"\n]\n')
  put('typescript/package.json', '{"name":"x","private":true}')
  const env = { HOME: home, CARGO_HOME: join(home, '.cargo'), RUSTUP_HOME: join(home, '.rustup'), PATH: '/nonexistent' }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: join(dir, 'rust'), env, encoding: 'utf8' })
  return { dir, run }
}

test('the plan names every missing piece, with its scope, and changes nothing', t => {
  const { dir, run } = bare(t)
  const r = run('--json')
  assert.equal(r.status, 0, r.stderr)
  const { root, steps } = JSON.parse(r.stdout)
  assert.equal(realpathSync(root), realpathSync(dir)) // found from a subdirectory
  const by = Object.fromEntries(steps.map(s => [s.id, s]))
  assert.deepEqual(Object.keys(by), ['rustup', 'rust-toolchain', 'cargo-deps', 'node', 'npm-deps'])
  assert.equal(by.rustup.scope, 'machine'); assert.ok(by.rustup.needed)
  assert.deepEqual(by['rust-toolchain'].run.argv, ['toolchain', 'install', '1.98.1', '--target', 'wasm32-wasip2'])
  assert.deepEqual(by['cargo-deps'].run.argv, ['fetch', '--locked'])
  assert.equal(by.node.scope, 'machine'); assert.match(by.node.why, /\^24\.11\.1/)
  assert.equal(by['npm-deps'].run.argv[0], 'install') // no lockfile yet
})

test('--run without --machine skips machine steps, holds their dependents, and exits 3', t => {
  const { run } = bare(t)
  const r = run('--run', '--json')
  assert.equal(r.status, 3, r.stderr)
  const status = Object.fromEntries(JSON.parse(r.stdout).results.map(x => [x.id, x.status]))
  assert.deepEqual(status, { rustup: 'skipped', 'rust-toolchain': 'waiting', 'cargo-deps': 'waiting', node: 'skipped', 'npm-deps': 'waiting' })
})

test('--public-registry pins npm to registry.npmjs.org; a lockfile switches to npm ci', t => {
  const { dir, run } = bare(t)
  writeFileSync(join(dir, 'typescript', 'package-lock.json'), '{}')
  const npm = JSON.parse(run('--json', '--public-registry').stdout).steps.find(s => s.id === 'npm-deps')
  assert.deepEqual(npm.run.argv, ['ci', '--registry=https://registry.npmjs.org/'])
})

test('outside an instance directory, or with an unknown flag, it refuses (exit 2)', t => {
  const { dir, run } = bare(t)
  const outside = spawnSync(process.execPath, [script], { cwd: dirname(dir), encoding: 'utf8' })
  assert.equal(outside.status, 2)
  assert.match(outside.stderr, /aspen init/)
  assert.equal(run('--yes').status, 2)
})

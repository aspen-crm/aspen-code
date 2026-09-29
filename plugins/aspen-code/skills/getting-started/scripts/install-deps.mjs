#!/usr/bin/env node
// Install what an `aspen init` directory needs to build: the Rust toolchain its crate pins and the
// crate's dependencies, and a Node that satisfies the UI tooling plus the TypeScript project's
// packages. `aspen init` installs none of it; `aspen doctor` only reports it missing.
//
//   node install-deps.mjs [instance-dir]                 print the plan, change nothing
//   node install-deps.mjs [instance-dir] --run           install the project's dependencies
//   node install-deps.mjs [instance-dir] --run --machine also install rustup / Node for this user
//   … --configured-registry  fetch npm packages from npm's configured registry, not registry.npmjs.org
//   … --json              the plan (or the results) as JSON
//
// Two scopes, two consents. "project" steps write only inside the instance directory and the
// user's package caches (a pinned Rust toolchain, cargo's registry, typescript/node_modules).
// The npm packages come from registry.npmjs.org by default: the Aspen packages are public there,
// and a user-level mirror (a corporate CodeArtifact, say) often needs a sign-in the user lacks.
// "machine" steps install a tool for the user (rustup; Node through a version manager or the
// OS package manager) and run only with --machine. Every step is idempotent and skipped when
// already satisfied, so re-running is the way to check.
//
// Exit codes: 0 plan printed, or everything installed; 1 a step failed; 2 bad invocation;
// 3 incomplete — a machine step needs --machine (the user's go-ahead) or a manual install.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const WIN = platform() === 'win32'
const PUBLIC_NPM = 'https://registry.npmjs.org/'
// What @aspen-crm/x-cli 0.1.0 declares in `engines`. Read from the installed package when it is
// there; this is the fallback for a directory whose packages are not installed yet.
const NODE_RANGE_FALLBACK = { node: '^24.11.1', npm: '^11.6.2' }

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const dirArg = args.find((a) => !a.startsWith('--'))
const unknown = args.filter((a) => a.startsWith('--') && !['--run', '--machine', '--configured-registry', '--json'].includes(a))
if (unknown.length) { console.error(`unknown option: ${unknown.join(' ')}`); process.exit(2) }

// The instance directory: the given one, or the nearest with `.aspen/config.toml`.
function instanceRoot (start) {
  let d = resolve(start)
  for (;;) {
    if (existsSync(join(d, '.aspen', 'config.toml'))) return d
    const up = resolve(d, '..')
    if (up === d) return null
    d = up
  }
}
const root = instanceRoot(dirArg ?? process.cwd())
if (!root) { console.error(`not in an instance directory (no .aspen/config.toml at or above ${resolve(dirArg ?? '.')}); run \`aspen init\` first`); process.exit(2) }
const rustDir = join(root, 'rust')
const tsDir = join(root, 'typescript')

const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }
const which = (name) => {
  const exts = WIN ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const e of exts) if (isFile(join(dir, name + e))) return join(dir, name + e)
  }
  return null
}
const cargoBin = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin')
const rustup = () => which('rustup') || (isFile(join(cargoBin, WIN ? 'rustup.exe' : 'rustup')) ? join(cargoBin, WIN ? 'rustup.exe' : 'rustup') : null)
const cargo = () => which('cargo') || (isFile(join(cargoBin, WIN ? 'cargo.exe' : 'cargo')) ? join(cargoBin, WIN ? 'cargo.exe' : 'cargo') : null)
const capture = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', shell: WIN, ...opts })
  return r.status === 0 ? (r.stdout || '').trim() : null
}

// Minimal semver: does `version` satisfy a caret range like ^24.11.1?
const parse = (v) => (String(v).match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number)
function satisfiesCaret (version, range) {
  const v = parse(version); const r = parse(range)
  if (v.length < 3 || r.length < 3) return false
  if (v[0] !== r[0]) return false
  if (v[1] !== r[1]) return v[1] > r[1]
  return v[2] >= r[2]
}

function toolchainPin () {
  const file = join(rustDir, 'rust-toolchain.toml')
  if (!isFile(file)) return null
  const text = readFileSync(file, 'utf8')
  const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(text)?.[1]
  const targets = [...(/^\s*targets\s*=\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
  return channel ? { channel, targets } : null
}

function nodeRange () {
  try {
    const engines = JSON.parse(readFileSync(join(tsDir, 'node_modules', '@aspen-crm', 'x-cli', 'package.json'), 'utf8')).engines
    if (engines?.node) return { node: engines.node, npm: engines.npm ?? NODE_RANGE_FALLBACK.npm }
  } catch {}
  return NODE_RANGE_FALLBACK
}

// How to get a Node in range for this user, best option first.
function nodeInstaller (major) {
  if (process.env.NVM_DIR || existsSync(join(homedir(), '.nvm', 'nvm.sh'))) {
    const nvm = join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'nvm.sh')
    return { how: 'nvm', cmd: 'bash', argv: ['-lc', `. "${nvm}" && nvm install ${major} && nvm alias default ${major}`] }
  }
  if (which('fnm')) return { how: 'fnm', cmd: 'fnm', argv: ['install', String(major)], then: ['default', String(major)] }
  if (WIN && which('winget')) return { how: 'winget', cmd: 'winget', argv: ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements'] }
  if (!WIN && which('brew')) return { how: 'Homebrew', cmd: 'brew', argv: ['install', `node@${major}`], note: `Homebrew installs node@${major} keg-only; put $(brew --prefix node@${major})/bin first on PATH.` }
  return null
}

// Hosts other than registry.npmjs.org that package-lock.json resolves tarballs from.
function lockHosts () {
  try {
    const hosts = new Set([...readFileSync(join(tsDir, 'package-lock.json'), 'utf8').matchAll(/"resolved":\s*"https?:\/\/([^/"]+)/g)].map((m) => m[1]))
    hosts.delete('registry.npmjs.org')
    return [...hosts]
  } catch { return [] }
}

// Why an npm run failed, when the output says, with what to do about it.
function npmFailure (out) {
  if (/E401|ENEEDAUTH|Unable to authenticate|authentication token/i.test(out)) {
    const foreign = lockHosts()
    if (foreign.length) return `npm could not authenticate against ${foreign.join(', ')}, where package-lock.json resolves packages; with the user's go-ahead, delete typescript/package-lock.json and typescript/node_modules and re-run to resolve them from ${PUBLIC_NPM}`
    if (flag('--configured-registry')) return `npm could not authenticate against its configured registry; the Aspen packages are public — re-run without --configured-registry`
  }
  if (!flag('--configured-registry') && /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|E403|CERT|certificate/i.test(out)) {
    return `npm could not reach ${PUBLIC_NPM}; if this network only reaches a mirror, re-run with --configured-registry`
  }
  return null
}

function plan () {
  const steps = []
  const pin = toolchainPin()
  if (existsSync(rustDir) && pin) {
    const ru = rustup()
    steps.push(ru
      ? { id: 'rustup', scope: 'machine', needed: false, why: `rustup found at ${ru}` }
      : {
          id: 'rustup', scope: 'machine', needed: true,
          why: 'rustup is not installed; the rust/ crate cannot build without it',
          run: WIN
            ? { cmd: 'winget', argv: ['install', '--id', 'Rustlang.Rustup', '-e', '--accept-source-agreements', '--accept-package-agreements'] }
            : { cmd: 'sh', argv: ['-c', "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none"] },
          note: WIN
            ? 'Building on Windows also needs the Visual Studio C++ Build Tools for the host-side build scripts.'
            : 'Leaves shell profiles alone; the user adds `. "$HOME/.cargo/env"` to theirs to put cargo on PATH.'
        })
    const installed = ru ? capture(ru, ['toolchain', 'list']) ?? '' : ''
    const haveChannel = installed.split('\n').some((l) => l.startsWith(`${pin.channel}-`) || l.split(' ')[0] === pin.channel)
    const haveTargets = haveChannel && ru
      ? (capture(ru, ['target', 'list', '--installed', '--toolchain', pin.channel]) ?? '').split('\n')
      : []
    const missingTargets = pin.targets.filter((t) => !haveTargets.includes(t))
    steps.push({
      id: 'rust-toolchain', scope: 'project', after: 'rustup', needed: !haveChannel || missingTargets.length > 0,
      why: haveChannel && !missingTargets.length
        ? `Rust ${pin.channel} with ${pin.targets.join(', ')} is installed`
        : `rust/rust-toolchain.toml pins Rust ${pin.channel}${pin.targets.length ? ` with ${pin.targets.join(', ')}` : ''}; ${!haveChannel ? 'that toolchain is not installed' : `missing target ${missingTargets.join(', ')}`}`,
      run: { cmd: 'rustup', argv: ['toolchain', 'install', pin.channel, ...(pin.targets.length ? ['--target', pin.targets.join(',')] : [])], cwd: rustDir }
    })
    steps.push({
      id: 'cargo-deps', scope: 'project', after: 'rustup', needed: true,
      why: 'fetch the crate\'s locked dependencies (aspen-crm and friends from crates.io); a no-op when cached',
      run: { cmd: 'cargo', argv: ['fetch', '--locked'], cwd: rustDir }
    })
  }

  if (existsSync(join(tsDir, 'package.json'))) {
    const range = nodeRange()
    const major = parse(range.node)[0] || 24
    const nodeV = capture('node', ['--version'])
    const npmV = capture('npm', ['--version'])
    const nodeOk = nodeV && satisfiesCaret(nodeV, range.node) && npmV && satisfiesCaret(npmV, range.npm)
    const inst = nodeOk ? null : nodeInstaller(major)
    steps.push(nodeOk
      ? { id: 'node', scope: 'machine', needed: false, why: `Node ${nodeV} and npm ${npmV} satisfy ${range.node} / ${range.npm}` }
      : {
          id: 'node', scope: 'machine', needed: true,
          why: `the UI tooling needs Node ${range.node} and npm ${range.npm}; found ${nodeV ? `Node ${nodeV}, npm ${npmV ?? 'none'}` : 'no Node'}`,
          run: inst ? (inst.then && !WIN ? { cmd: 'sh', argv: ['-c', `${inst.cmd} ${inst.argv.join(' ')} && ${inst.cmd} ${inst.then.join(' ')}`] } : { cmd: inst.cmd, argv: inst.argv }) : undefined,
          note: inst
            ? [`via ${inst.how}`, inst.note].filter(Boolean).join('. ')
            : `no Node version manager or package manager found — install Node ${major} LTS from https://nodejs.org, then re-run`
        })
    const registry = flag('--configured-registry') ? capture('npm', ['config', 'get', 'registry'], { cwd: tsDir }) : PUBLIC_NPM
    const lock = isFile(join(tsDir, 'package-lock.json'))
    const installedDeps = existsSync(join(tsDir, 'node_modules', '@aspen-crm', 'sdk'))
    const foreign = lock ? lockHosts() : []
    const npmArgs = [lock ? 'ci' : 'install', ...(flag('--configured-registry') ? [] : [`--registry=${PUBLIC_NPM}`])]
    steps.push({
      id: 'npm-deps', scope: 'project', after: 'node', needed: !installedDeps,
      why: installedDeps
        ? 'typescript/node_modules has the Aspen SDK'
        : `install typescript/'s packages from ${registry ?? "npm's configured registry"} (${lock ? 'from package-lock.json' : 'no lockfile yet; this writes one — commit it'})${foreign.length ? `; package-lock.json resolves packages through ${foreign.join(', ')}, and npm ci fetches from there whatever the registry` : ''}`,
      run: { cmd: 'npm', argv: npmArgs, cwd: tsDir }
    })
  }
  return steps
}

function execute (steps) {
  const results = []
  const unmet = new Set()
  for (const step of steps) {
    if (!step.needed) { results.push({ id: step.id, status: 'ok', detail: step.why }); continue }
    if (step.after && unmet.has(step.after)) { unmet.add(step.id); results.push({ id: step.id, status: 'waiting', detail: `needs ${step.after} first` }); continue }
    if (step.scope === 'machine' && !flag('--machine')) { unmet.add(step.id); results.push({ id: step.id, status: 'skipped', detail: `${step.why} — machine-wide; re-run with --machine after the user agrees` }); continue }
    if (!step.run) { unmet.add(step.id); results.push({ id: step.id, status: 'manual', detail: step.note }); continue }
    // A tool installed earlier in this run is not on this process's PATH yet.
    const cmd = step.run.cmd === 'rustup' ? (rustup() ?? 'rustup') : step.run.cmd === 'cargo' ? (cargo() ?? 'cargo') : step.run.cmd
    if (!flag('--json')) console.error(`\n▶ ${step.id}: ${[step.run.cmd, ...step.run.argv].join(' ')}${step.run.cwd ? `   (in ${step.run.cwd})` : ''}`)
    // npm's output is captured (then echoed) so an authentication failure can be recognized.
    const capture = flag('--json') || step.id === 'npm-deps'
    const r = spawnSync(cmd, step.run.argv, { cwd: step.run.cwd ?? root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: WIN })
    if (capture && !flag('--json')) process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`)
    const ok = r.status === 0
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`
    results.push({
      id: step.id, status: ok ? 'done' : 'failed',
      detail: ok ? step.why : ((step.id === 'npm-deps' && npmFailure(tail)) || `exit ${r.status ?? r.error?.message}`)
    })
    if (!ok) break
  }
  return results
}

const steps = plan()
if (!flag('--run')) {
  if (flag('--json')) console.log(JSON.stringify({ root, steps }, null, 2))
  else {
    console.log(`Dependencies for ${root}:`)
    for (const s of steps) {
      const mark = !s.needed ? 'ok  ' : s.scope === 'machine' ? 'need (machine)' : 'need'
      console.log(`  [${mark}] ${s.id}: ${s.why}`)
      if (s.needed && s.run) console.log(`         ${[s.run.cmd, ...s.run.argv].join(' ')}${s.run.cwd ? `   (in ${s.run.cwd})` : ''}`)
      if (s.needed && s.note) console.log(`         note: ${s.note}`)
    }
    console.log('\nNothing was changed. --run installs the project steps; add --machine for the machine-wide ones.')
  }
  process.exit(0)
}
const results = execute(steps)
if (flag('--json')) console.log(JSON.stringify({ root, results }, null, 2))
else for (const r of results) console.log(`  [${r.status}] ${r.id}: ${r.detail}`)
process.exit(results.some((r) => r.status === 'failed') ? 1
  : results.some((r) => ['skipped', 'waiting', 'manual'].includes(r.status)) ? 3 : 0)

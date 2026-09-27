#!/usr/bin/env node
// SessionStart: tell the model, before the first prompt, whether this machine can build on Aspen.
//
// Three facts decide the first thing a session should do, and all three are on disk:
//
//   1. Is the aspen CLI installed?        PATH, then aspenup's own proxy dir (~/.aspen/bin).
//   2. Is anyone logged in, and to what?  The `instance` field of aspen's credentials.json.
//                                         The secret itself is in the OS keyring; this file
//                                         only names the instance, and we read nothing else.
//   3. Is the session in an instance      `.aspen/config.toml`, which `aspen init` writes,
//      directory, and for which instance? in the working directory or one above it.
//
// A found CLI is not a current CLI: whenever it is found and the note speaks, it asks for
// `aspenup self update` (the launcher, a no-op when already the promoted release) and, in an
// instance directory, `aspenup update` (the toolchain that instance serves). The hook itself
// stays offline, so it cannot tell whether an update exists -- the commands answer that.
//
// Missing CLI or missing login: say so, and route to `getting-started`, in every session --
// that is the onboarding prompt. Logged in to a different instance than the directory's: say
// so, because every `aspen move` would refuse. In an instance directory: route to `using-aspen`.
// Otherwise: silent, so an unrelated repo never hears about Aspen.
//
// Offline and read-only by design. It never runs the CLI (the aspenup proxy can reach the
// network to resolve a toolchain) and never validates the token -- `aspen doctor` does that,
// and the skills run it. Fails quiet: a crash here must be quieter than the value it adds.

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const isWindows = process.platform === 'win32'
const INSTALL = isWindows
  ? "irm https://static-assets.veevaxdev.com/tooling/latest/cli/installer.ps1 | iex"
  : "curl --proto '=https' --tlsv1.2 -LsSf https://static-assets.veevaxdev.com/tooling/latest/cli/installer.sh | sh"

const nonBlank = (v) => (v && v.trim() ? v : null)
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

// Where the CLI is, or null. aspenup puts its `aspen` proxy in $ASPEN_HOME/bin (default
// ~/.aspen/bin) and adds that to PATH through the shell rc files -- which a host started before
// the install has not re-read, so the proxy dir is checked directly as well.
export function findCli (env = process.env, home = homedir()) {
  const names = isWindows ? ['aspen.exe', 'aspen.cmd', 'aspen'] : ['aspen']
  const onPath = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  const proxies = join(nonBlank(env.ASPEN_HOME) || join(home, '.aspen'), 'bin')
  for (const [i, dir] of [...onPath, proxies].entries()) {
    for (const name of names) {
      const p = join(dir, name)
      if (isFile(p)) return { path: p, onPath: i < onPath.length }
    }
  }
  return null
}

// aspen keeps credentials.json in $ASPEN_CONFIG_DIR, else `aspen` under the platform config dir:
// %APPDATA% on Windows, $XDG_CONFIG_HOME or ~/.config elsewhere (macOS included).
export function credentialsPath (env = process.env, home = homedir()) {
  const configured = nonBlank(env.ASPEN_CONFIG_DIR)
  if (configured) return join(configured, 'credentials.json')
  const base = isWindows
    ? (nonBlank(env.APPDATA) || join(home, 'AppData', 'Roaming'))
    : (nonBlank(env.XDG_CONFIG_HOME) || join(home, '.config'))
  return join(base, 'aspen', 'credentials.json')
}

// The instance the CLI is logged in to, or null. One instance at a time: a new login replaces it.
export function loggedInInstance (path) {
  try {
    const instance = JSON.parse(readFileSync(path, 'utf8')).instance
    return typeof instance === 'string' && instance ? instance : null
  } catch { return null }
}

// The nearest directory at or above `cwd` holding `.aspen/config.toml`, and the instance it names.
export function instanceDir (cwd) {
  let dir = cwd
  for (;;) {
    const config = join(dir, '.aspen', 'config.toml')
    if (isFile(config)) {
      const m = /^\s*instance\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))
      return { dir, instance: m ? m[1] : null }
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

// A Builder-era folder at or above `cwd`: `metacode/` and its own CLI at `.aspen/bin/aspen`, no
// `.aspen/config.toml`. The shell's `aspen` there may be that older CLI, and the layout is not the
// one this plugin authors.
export function builderFolder (cwd) {
  let dir = cwd
  for (;;) {
    // `metacode/` is what makes it a Builder folder: ~/.aspen/bin/aspen is aspenup's own proxy.
    const cli = ['aspen', 'aspen.exe'].some((n) => isFile(join(dir, '.aspen', 'bin', n)))
    if (cli && isDir(join(dir, 'metacode')) && !isFile(join(dir, '.aspen', 'config.toml'))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

// Instance URLs compare without a trailing slash; the CLI normalizes to one, a human rarely types it.
const sameInstance = (a, b) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

export function context ({ cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  const cli = findCli(env, home)
  if (!cli) {
    return [
      'The Aspen CLI is not installed on this machine, so no Aspen work can happen yet.',
      'At the first opportunity, tell the user and offer to set it up: invoke the `getting-started` skill.',
      `The installer (${isWindows ? 'PowerShell' : 'macOS/Linux'}): \`${INSTALL}\``
    ].join('\n')
  }

  const lines = []
  if (!cli.onPath) {
    lines.push(`The Aspen CLI is installed at \`${cli.path}\` but this session's PATH does not have it yet. Run it by that full path until the user restarts the terminal/host.`)
  }

  const aspenup = join(dirname(cli.path), isWindows ? 'aspenup.exe' : 'aspenup')
  const update = (inInstance) => inInstance
    ? `Before the first Aspen command this session, bring the CLI up to date: \`${aspenup} self update\` (the launcher; a no-op when current), then \`${aspenup} update\` here (installs the aspen toolchain this instance serves). Ask first; say what changed.`
    : `Before the first Aspen command this session, bring the CLI up to date: \`${aspenup} self update\` (a no-op when already current). Ask first; say what changed.`

  const instance = loggedInInstance(credentialsPath(env, home))
  const here = instanceDir(cwd)
  if (!instance) {
    lines.push(
      'The Aspen CLI is installed but not signed in to any instance.',
      'At the first opportunity, prompt the user to sign in with OAuth: invoke the `getting-started` skill.',
      'The login opens a browser and needs a real terminal, so the user runs it, not you: `aspen login -i <instance URL>`.'
    )
    if (here?.instance) lines.push(`This directory belongs to \`${here.instance}\` — that is the URL to sign in to.`)
    lines.push(update(false))
    return lines.join('\n')
  }

  if (!here) {
    const builder = builderFolder(cwd)
    if (builder) {
      lines.push(
        `\`${builder}\` is a Builder-era folder (\`metacode/\` layout, its own older CLI at \`.aspen/bin/aspen\`), not an instance directory \`aspen init\` created. This plugin does not work in it, and a bare \`aspen\` here may run the old CLI.`,
        'Before any Aspen work, tell the user and ask which instance they mean; `getting-started` §3 creates its directory with `aspen init` elsewhere.'
      )
    }
    return lines.join('\n')
  }

  lines.push(`You are in the Aspen instance directory \`${here.dir}\`. For any change to this instance, invoke the \`using-aspen\` skill first.`)
  lines.push(update(true))
  if (here.instance && !sameInstance(here.instance, instance)) {
    lines.push(
      `The CLI is signed in to \`${instance}\`, but this directory belongs to \`${here.instance}\`, so every \`aspen move\` here will refuse.`,
      `Tell the user before any deploy: signing in again replaces the current login — \`aspen login -i ${here.instance}\`, run by them in a terminal.`
    )
  }
  return lines.join('\n')
}

function main () {
  let text = ''
  try { text = context() } catch { text = '' }
  if (text) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text }
    }))
  }
  process.exit(0)
}

// Compare through realpath: argv[1] is the raw invoked path, import.meta.url is resolved, and a
// plain string compare is false on Windows, on paths with spaces and through symlinks.
function invokedDirectly () {
  const argv = process.argv[1]
  if (!argv) return false
  if (import.meta.url === pathToFileURL(argv).href) return true
  try { return import.meta.url === pathToFileURL(realpathSync(argv)).href } catch { return false }
}

if (invokedDirectly()) main()

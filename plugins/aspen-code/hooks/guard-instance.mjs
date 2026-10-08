#!/usr/bin/env node
// PreToolUse (Claude Code `Bash`, Codex `exec_command`): every `aspen` command runs as the right
// binary, in the right folder, against the right instance.
//
// The CLI already refuses a folder whose `.aspen/config.toml` names another instance than the
// login. What it lets through, and this closes:
//
//   1. The wrong binary. A Builder-era folder carries its own CLI at `.aspen/bin/aspen`, and a
//      shell function (or PATH) can run that instead of aspenup's proxy. Agent shells load the
//      user's profile, so a bare `aspen` may not be the aspen this plugin is written for.
//   2. `aspen move` outside any instance folder. Nothing is checked then: it acts on whichever
//      instance is logged in. A deploy from the wrong directory reaches the wrong instance.
//   3. Leaving the session's folder. The session belongs to the instance folder its working
//      directory sits in; a `cd` into, or `--dir` at, another instance folder is a different
//      instance's work, even when the login happens to match it.
//   4. A folder that does not match the login. The CLI refuses too, but this names the fix:
//      the user signs in again (the model never runs `aspen login`).
//
// 1, 2 and 4 are refused outright. 3 (and `aspen logout`) asks: Claude Code prompts; Codex, whose
// hooks cannot prompt, refuses with a note to ask the user and re-run with ASPEN_CODE_CONFIRMED=1.
//
// Stateless, offline and read-only: it reads `.aspen/config.toml` files and the `instance` field
// of credentials.json, nothing else. It understands `cd X && …` chains and `--dir`, not every
// shell construct — it is a guardrail, not a sandbox. Any error fails open (exit 0, no output).

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { credentialsPath, instanceDir, loggedInInstance } from './session-start.mjs'

const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }
const same = (a, b) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()
const HELP = new Set(['--help', '-h', 'help', '--version', '-V'])
// Flags whose next word is their value, not a subcommand.
const VALUED = new Set(['--dir', '--agent', '--import-mode', '--config-vars-file', '--file', '--platform-dir',
  '--custom-dir', '-i', '--instance', '-k', '--api-key', '--credential-store'])

// A shell command as a list of segments, each a list of words, in execution order. Quotes are
// honored for grouping; operators split segments. Enough for the commands an agent writes.
export function segments (command) {
  const text = String(command ?? '').replace(/\\\r?\n/g, ' ')
  const out = []; let words = []; let word = ''; let quote = null; let has = false
  const endWord = () => { if (has) words.push(word); word = ''; has = false }
  const endSeg = () => { endWord(); if (words.length) out.push(words); words = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === quote) quote = null; else word += c; continue }
    if (c === '"' || c === "'") { quote = c; has = true; continue }
    if (/\s/.test(c)) { if (c === '\n') endSeg(); else endWord(); continue }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { endSeg(); continue }
    word += c; has = true
  }
  endSeg()
  return out
}

// `~`, `$HOME` and `${HOME}` as the shell would expand them at the start of a word.
const expand = (p, home) => {
  const x = p.replace(/^\$(HOME\b|\{HOME\})/, '~')
  return x === '~' ? home : /^~[\\/]/.test(x) ? join(home, x.slice(2)) : x
}
const at = (base, p, home) => { const x = expand(p, home); return isAbsolute(x) ? x : resolve(base, x) }

// Each aspen invocation in the command: which binary word, the subcommand, and the folder it
// works on (the running `cd`, or `--dir`).
export function invocations (command, cwd, home = homedir()) {
  const found = []
  let here = cwd
  for (const words of segments(command)) {
    let i = 0
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++ // FOO=bar aspen …
    const confirmed = words.slice(0, i).includes('ASPEN_CODE_CONFIRMED=1')
    const head = words[i]
    if (!head) continue
    if (head === 'cd' || head === 'pushd') { here = at(here, words[i + 1] ?? home, home); continue }
    const name = basename(head).toLowerCase()
    if (name !== 'aspen' && name !== 'aspen.exe') continue
    const args = words.slice(i + 1)
    if (args.some((a) => HELP.has(a))) continue
    const positional = []
    for (let k = 0; k < args.length; k++) {
      if (VALUED.has(args[k])) { k++; continue }
      if (!args[k].startsWith('-')) positional.push(args[k])
    }
    let dir = here
    const d = args.findIndex((a) => a === '--dir' || a.startsWith('--dir='))
    if (d >= 0) {
      const value = args[d].includes('=') ? args[d].split('=').slice(1).join('=') : args[d + 1]
      if (value) dir = at(here, value, home)
    }
    // A path to the binary resolves where the command runs, after any `cd`.
    const path = /[\\/]/.test(head) ? at(here, head, home) : null
    found.push({ binary: head, path, command: positional[0] ?? '', sub: positional[1] ?? '', dir, confirmed })
  }
  return found
}

// A Builder-era CLI inside the folder or above it, which a shell function would prefer.
function folderLocalCli (dir) {
  let d = dir
  for (;;) {
    for (const n of ['aspen', 'aspen.exe']) if (existsSync(join(d, '.aspen', 'bin', n))) return join(d, '.aspen', 'bin', n)
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
}

export function decide ({ command, cwd, env = process.env, home = homedir() }) {
  const aspenHome = env.ASPEN_HOME?.trim() || join(home, '.aspen')
  const proxy = join(aspenHome, 'bin', process.platform === 'win32' ? 'aspen.exe' : 'aspen')
  const session = instanceDir(cwd)
  const login = loggedInInstance(credentialsPath(env, home))
  const hard = []; const confirm = []

  for (const inv of invocations(command, cwd, home)) {
    const target = instanceDir(inv.dir)
    const verb = [inv.command, inv.command === 'move' ? inv.sub : ''].filter(Boolean).join(' ')

    // 1. The binary.
    const explicit = inv.path !== null
    if (explicit && real(inv.path) !== real(proxy) && /[\\/]\.aspen[\\/]bin[\\/]aspen(\.exe)?$/i.test(inv.path) && !real(inv.path).startsWith(real(aspenHome))) {
      hard.push(`\`${inv.binary}\` is a folder-local, Builder-era CLI, not the aspenup-managed aspen this plugin drives. Run \`${proxy} ${verb}\` instead.`)
      continue
    }
    const local = !explicit && folderLocalCli(inv.dir)
    if (local && real(local) !== real(proxy)) {
      hard.push(`\`${dirname(dirname(dirname(local)))}\` carries a Builder-era CLI at \`${local}\`, and the shell may run it for a bare \`aspen\`. Run aspenup's by its full path: \`${proxy} ${verb}\`.`)
      continue
    }

    if (inv.command === 'login') {
      hard.push('`aspen login` is the user\'s to run, in their own terminal (OAuth in a browser; the CLI refuses it under an agent). Hand them the command — `getting-started` §2.')
      continue
    }
    if (inv.command === 'logout' && !inv.confirmed) {
      confirm.push(`\`aspen logout\` removes the stored login for \`${login ?? 'the current instance'}\`; the user has to sign in again afterwards. Only with their go-ahead.`)
      continue
    }

    const deploys = inv.command === 'move'
    const bound = deploys || inv.command === 'status' || inv.command === 'init'

    // 2. A deploy verb outside every instance folder.
    if (deploys && !target) {
      hard.push(`\`aspen ${verb}\` is not running in an instance folder (\`${inv.dir}\`), so nothing checks which instance it reaches: it would act on whatever is logged in${login ? ` (\`${login}\`)` : ''}. Run it from the instance folder${session ? ` — \`cd ${session.dir} && …\`` : ''}.`)
      continue
    }

    // 4. The folder names another instance than the login.
    if (bound && target?.instance && login && !same(target.instance, login)) {
      hard.push(`\`${target.dir}\` belongs to \`${target.instance}\`, but the CLI is signed in to \`${login}\`, so \`aspen ${verb}\` would be refused or reach the wrong instance. Ask the user to sign in to this folder's instance in their own terminal: \`aspen login -i ${target.instance}\` (it replaces the current login).`)
      continue
    }

    // 3. Leaving the session's instance folder.
    if (bound && !inv.confirmed && session && target && real(target.dir) !== real(session.dir)) {
      confirm.push(`This session works in \`${session.dir}\` (\`${session.instance}\`), but \`aspen ${verb}\` targets \`${target.dir}\` (\`${target.instance}\`) — a different instance folder. Run it only if the user asked for that folder.`)
    }
  }
  return { hard: [...new Set(hard)], confirm: [...new Set(confirm)] }
}

// The host's shape: Claude Code sends `Bash` with `command`; Codex sends `exec_command` with `cmd`
// (a string, or an argv whose last element is the script) and may carry a `workdir`.
export function evaluate (payload, env = process.env) {
  const input = payload?.tool_input ?? {}
  if (payload?.tool_name !== 'Bash' && payload?.tool_name !== 'exec_command') return null
  const raw = input.command ?? input.cmd
  const command = Array.isArray(raw) ? raw[raw.length - 1] : raw
  if (!command || !/aspen/i.test(String(command))) return null
  const cwd = input.workdir || payload.cwd || process.cwd()
  const { hard, confirm } = decide({ command, cwd, env, home: env.HOME || env.USERPROFILE || homedir() })
  const codex = Boolean(env.PLUGIN_ROOT || payload.turn_id || payload.tool_name === 'exec_command')
  const out = (fields) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } })
  if (hard.length) return out({ permissionDecision: 'deny', permissionDecisionReason: hard.join('\n\n') })
  if (!confirm.length) return null
  const reason = confirm.join('\n\n')
  // Codex cannot prompt from a hook, so its "ask" is a deny that tells the model to ask the user.
  return codex
    ? out({ permissionDecision: 'deny', permissionDecisionReason: `${reason}\n\nAsk the user first; if they confirm, say so and re-run the same command with ASPEN_CODE_CONFIRMED=1 in front of it.` })
    : out({ permissionDecision: 'ask', permissionDecisionReason: reason })
}

function invokedDirectly () {
  const argv = process.argv[1]
  if (!argv) return false
  if (import.meta.url === pathToFileURL(argv).href) return true
  try { return import.meta.url === pathToFileURL(realpathSync(argv)).href } catch { return false }
}

if (invokedDirectly()) {
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const output = evaluate(payload)
    if (output) process.stdout.write(JSON.stringify(output))
  } catch { /* fail open: a guard that crashes must not take the session with it */ }
  process.exit(0)
}

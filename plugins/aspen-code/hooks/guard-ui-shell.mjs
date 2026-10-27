#!/usr/bin/env node
// PostToolUse (Claude Code `Bash`, Codex `exec_command`): custom UI that a shell command wrote.
//
// guard-ui checks a file as Write, Edit or apply_patch writes it. A script that writes the file —
// a heredoc, `python - <<'PY'`, `sed -i`, a generator — goes around it, and Codex writes most files
// that way. So after a shell command run in an instance directory, or one that names a
// `typescript/` path, this checks each UI source file under that instance's `typescript/` changed
// in the last few minutes, with guard-ui-tokens.mjs's rules. The write has already happened, so
// the findings come back as context for the model to fix rather than as a denial.
//
// Offline and read-only: it reads the tool input, modification times, the changed files and the
// installed SDK's token snapshot. Any error fails open (exit 0, no output).

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { segments } from './guard-instance.mjs'
import { decide } from './guard-ui-tokens.mjs'
import { instanceDir } from './session-start.mjs'

const RECENT_MS = 5 * 60 * 1000
const MAX_FILES = 200
const MAX_REPORTED = 3
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'generated'])
const SOURCE = /\.(ts|tsx|js|jsx|mjs|css|scss)$/

// Claude Code sends `command`; Codex sends `cmd`, a string or an argv whose last element is the script.
const commandOf = (input) => {
  const raw = input?.command ?? input?.cmd
  return String((Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? '')
}

// The instance directories a command can have written into: the one it ran in, each it `cd`s
// into, and each an absolute path before a `typescript` segment names.
export function roots (command, cwd, home = homedir()) {
  const found = new Set()
  const add = (dir) => { const hit = dir ? instanceDir(dir) : null; if (hit) found.add(hit.dir) }
  const at = (p) => {
    const x = p.replace(/^\$(HOME\b|\{HOME\})/, '~')
    const expanded = x === '~' ? home : /^~[\\/]/.test(x) ? join(home, x.slice(2)) : x
    return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
  }
  add(cwd)
  for (const words of segments(command)) {
    const i = words.findIndex((w) => w === 'cd' || w === 'pushd')
    if (i >= 0 && words[i + 1]) add(at(words[i + 1]))
  }
  for (const [, quoted, bare] of command.matchAll(/(?:['"]([^'"\n]*?)|((?:[A-Za-z]:)?[\\/][^\s'"`;|&()]*?))[\\/]typescript(?=[\\/'"\s]|$)/g)) {
    const prefix = quoted ?? bare
    if (prefix && isAbsolute(prefix)) add(prefix)
  }
  return [...found]
}

// UI source files under `dir/typescript` modified at or after `since`, newest first.
export function changedSources (dir, since) {
  const out = []
  const walk = (d) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      if (SKIP.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (SOURCE.test(e.name)) {
        try { const m = statSync(p).mtimeMs; if (m >= since) out.push({ path: p, m }) } catch {}
      }
    }
  }
  walk(join(dir, 'typescript'))
  return out.sort((a, b) => b.m - a.m).map((f) => f.path)
}

export function evaluate (payload, { now = Date.now(), home = homedir() } = {}) {
  if (payload?.tool_name !== 'Bash' && payload?.tool_name !== 'exec_command') return null
  const input = payload.tool_input ?? {}
  const command = commandOf(input)
  const cwd = input.workdir || payload.cwd || process.cwd()
  const dirs = roots(command, cwd, home)
  if (!dirs.length) return null

  const findings = []
  for (const dir of dirs) {
    for (const path of changedSources(dir, now - RECENT_MS)) {
      let source
      try { source = readFileSync(path, 'utf8') } catch { continue }
      const reason = decide(path, source)
      if (reason) findings.push({ file: relative(dir, path), dir, reason })
    }
  }
  if (!findings.length) return null

  const shown = findings.slice(0, MAX_REPORTED)
  const rest = findings.length - shown.length
  const text = [
    'A shell command just left custom UI that the UI guard refuses when it is written with ' +
    'Write, Edit or apply_patch. A script write goes around that check, so it runs now instead. ' +
    'Fix these before going on, and edit files in `typescript/` with apply_patch or the editor ' +
    'tools from here.',
    ...shown.map((f) => `\`${f.file}\` (in \`${f.dir}\`):\n${f.reason}`),
    ...(rest ? [`${rest} more file(s) also fail: run the \`custom-ui\` skill's \`scripts/lint-ui-tokens.mjs typescript/src\` for the full list.`] : [])
  ].join('\n\n')
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }
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
    const output = evaluate(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
    if (output) process.stdout.write(JSON.stringify(output))
  } catch { /* fail open: a guard that crashes must not take the session with it */ }
  process.exit(0)
}

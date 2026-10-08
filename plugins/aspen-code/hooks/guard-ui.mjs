#!/usr/bin/env node
// PreToolUse (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch`): custom UI in an
// instance directory's `typescript/`, checked as it is written.
//
//   guard-ui-tokens.mjs         denies a hardcoded value where the design system publishes a
//                               token, an `--ap-*` name the installed SDK does not define, a
//                               table/button/select/textarea rebuilt from semantic tokens alone,
//                               a native select/datalist/date-time input, and a glyph icon.
//   guard-custom-ui-surface.mjs asks once when a write first declares a page, layout section or
//                               custom-page tab, the moment changing tier is still cheap.
//
// Claude Code prompts on an ask; Codex, whose hooks cannot prompt, gets it as context. A Codex
// patch is previewed (patch-input.mjs) so each file is judged as it will read afterwards.
//
// Offline and read-only: it reads the tool input, the files being changed, and the installed
// SDK's token snapshot under node_modules. Any error fails open (exit 0, no output).

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { decide as surface } from './guard-custom-ui-surface.mjs'
import { contentOf, decide as styling, isWholeFile } from './guard-ui-tokens.mjs'
import { filePath, patchFiles, readText } from './patch-input.mjs'

const out = (fields) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } })
const TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'apply_patch'])

export function evaluate (payload, env = process.env) {
  if (!TOOLS.has(payload?.tool_name)) return null
  const codex = Boolean(env.PLUGIN_ROOT || payload.turn_id || payload.tool_name === 'apply_patch')
  const input = payload.tool_input ?? {}
  const cwd = payload.cwd || process.cwd()
  const files = payload.tool_name === 'apply_patch'
    ? patchFiles(input.command, cwd)
    : input.file_path ? [{ path: filePath(input.file_path, cwd), input }] : []

  const hard = []
  const advisory = []
  for (const change of files) {
    if (change.deleted) continue
    const toolInput = change.input ?? { content: change.content }
    const reason = styling(change.path, contentOf(toolInput), undefined, isWholeFile(toolInput))
    if (reason) hard.push(reason)
    // A patch's "before" is the file as the patch found it, which may be an earlier hunk's output.
    const read = change.input ? readText : (path) => (path === change.path ? change.before : readText(path))
    const ask = surface(change.path, toolInput, read)
    if (ask) advisory.push(ask)
  }
  if (hard.length) return out({ permissionDecision: 'deny', permissionDecisionReason: [...new Set(hard)].join('\n\n') })
  if (!advisory.length) return null
  const reason = [...new Set(advisory)].join('\n\n')
  return codex ? out({ additionalContext: reason }) : out({ permissionDecision: 'ask', permissionDecisionReason: reason })
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

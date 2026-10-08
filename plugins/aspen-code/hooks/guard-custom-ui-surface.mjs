#!/usr/bin/env node
// PreToolUse guard for a NEW custom UI surface. Runs through guard-ui.mjs, on Claude Code's
// Write/Edit/MultiEdit and Codex's apply_patch.
//
// The failure: a feature gets built entirely in a TypeScript page over a model that does not
// hold it. A budget page computed contracted/consumed/remaining/margin in the browser, in 396
// lines, on an instance whose object model has none of those fields. The screen looked right,
// so review passed -- and the number could not be listed, filtered, sorted, reported on, read
// by a trigger, alerted on, or seen by the MCP. A second surface needing the same
// number reimplements it. On a platform where nothing deletes, that is permanent.
//
// Unlike the token guard, this cannot be decided from the diff. Whether a page is the right
// tier depends on what the model already holds, which is a judgement, not a pattern. So this
// hook ASKS -- it is a backstop under the `model-first` skill, which carries the actual
// decision in its placement table. Asking at the moment the surface is declared is the last
// point where moving a tier is still cheap.
//
// It fires ONCE per surface, on the write that first declares it: a new route or layout
// section in `typescript/aspen.client.json`, a `custom_page` tab, a `custom_code` layout section. Every
// later edit to that surface is silent, because the decision has already been made and a
// guard that re-asks is a guard people switch off.

import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// ---- which files declare a surface --------------------------------------------------

// The instance directory's layout (its AGENTS.md, written by `aspen init`): the UI project is
// `typescript/`; a `custom_page` tab lives in the top-level `tab_p/`; layouts sit under their
// object, in `object_p/layout_p/`.
const UI_DESCRIPTOR = /(^|[/\\])typescript[/\\]aspen\.client\.json$/
const TAB = /(^|[/\\])metadata[/\\]custom[/\\]tab_p[/\\][^/\\]+\.json$/
const LAYOUT = /(^|[/\\])metadata[/\\]custom[/\\]object_p[/\\]layout_p[/\\][^/\\]+\.json$/

export const watched = (path) =>
  UI_DESCRIPTOR.test(path) || TAB.test(path) || LAYOUT.test(path)

// ---- what counts as a surface -------------------------------------------------------

// A retired component is not a surface. `"active": false` is how this platform removes
// things -- the real instance this was built from carries a `custom_page` tab sitting at
// active:false, and asking about it would be asking about a decision already reversed.
const live = (entry) => entry?.active !== false

// Returns the surfaces a file declares, as stable one-line descriptors. Comparing two of
// these sets is the whole detection: what is in `after` and not in `before` is new.
export function surfacesIn (path, source) {
  let doc
  try { doc = JSON.parse(source) } catch { return null }
  if (!doc || typeof doc !== 'object') return null
  const found = new Set()

  if (UI_DESCRIPTOR.test(path)) {
    // A route's `name` is optional (aspen init's own `/` route has none), so an unnamed one is
    // known by its path.
    for (const route of doc.routing?.routes ?? []) {
      if (!route || !live(route)) continue
      if (route.name) found.add(`route \`${route.name}\` (${route.path ?? 'no path'})`)
      else if (route.path) found.add(`route \`${route.path}\``)
    }
    for (const section of doc.layout?.sections ?? []) {
      if (section?.name && live(section)) {
        const on = section['allowed-objects']?.join(', ')
        found.add(`layout section \`${section.name}\`${on ? ` on ${on}` : ''}`)
      }
    }
  }

  if (TAB.test(path) && doc['tab-type'] === 'custom_page' && live(doc)) {
    found.add(`custom-page tab \`${doc.name ?? '?'}\` -> \`${doc['page-ui-code'] ?? '?'}\``)
  }

  if (LAYOUT.test(path)) {
    for (const section of doc.sections ?? []) {
      if (section?.['section-type'] === 'custom_code' && live(section)) {
        found.add(`\`custom_code\` section \`${section.name ?? '?'}\` on layout \`${doc.name ?? '?'}\``)
      }
    }
  }

  return found
}

// ---- reconstructing what the file will say ------------------------------------------

// A Write hands over the finished file. An Edit hands over a fragment, which is not JSON and
// cannot be parsed -- so replay the edit against the copy on disk and parse the result. That
// is exact, where a textual scan of the fragment would both miss surfaces (a route added as
// part of a larger block) and invent them (the word `custom_page` in a comment).
//
// Null means "cannot be sure": no file on disk to patch, an `old_string` that does not match,
// an unreadable file. A guard that is unsure stays quiet.
export function afterText (path, toolInput, read = readOnDisk) {
  if (typeof toolInput?.content === 'string') return toolInput.content

  const edits = Array.isArray(toolInput?.edits)
    ? toolInput.edits
    : (typeof toolInput?.new_string === 'string' ? [toolInput] : [])
  if (!edits.length) return null

  let text = read(path)
  if (text === null) return null

  for (const edit of edits) {
    const from = typeof edit?.old_string === 'string' ? edit.old_string : null
    const to = typeof edit?.new_string === 'string' ? edit.new_string : null
    if (from === null || to === null) return null
    if (from === '') { text = to; continue }
    if (edit.replace_all) {
      if (!text.includes(from)) return null
      text = text.split(from).join(to)
      continue
    }
    const at = text.indexOf(from)
    if (at === -1) return null
    text = text.slice(0, at) + to + text.slice(at + from.length)
  }
  return text
}

function readOnDisk (path) {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

// ---- the decision -------------------------------------------------------------------

export function decide (filePath, toolInput, read = readOnDisk) {
  const path = String(filePath ?? '')
  if (!watched(path)) return null

  const after = afterText(path, toolInput, read)
  if (after === null) return null
  const now = surfacesIn(path, after)
  if (!now || now.size === 0) return null

  // Absent from disk entirely -> a brand new file, so every surface in it is new.
  const previous = read(path)
  const before = previous === null ? new Set() : (surfacesIn(path, previous) ?? new Set())

  const added = [...now].filter((surface) => !before.has(surface))
  if (!added.length) return null

  return [
    'This declares a custom UI surface. On Aspen the page is the LAST tier: a surface built ' +
    'over fields the model does not hold has nothing behind it — the values it shows cannot be ' +
    'listed, filtered, sorted, reported on, read by a trigger, or seen by the MCP, and ' +
    'the next surface that needs them reimplements them. Nothing on this platform deletes, so ' +
    'this is the last cheap moment to change tier.',
    'New here:\n' + added.map((surface) => `  - ${surface}`).join('\n'),
    'Before this lands, say which object and fields it reads, and why a `layout_p`, ' +
    '`list_view_p` or `tab_p` cannot carry it. A derived number belongs in a stored field ' +
    'maintained by a trigger on its inputs; a set of states belongs in a `lifecycle_p`; a rule ' +
    'about what may be saved belongs in a before-trigger with `error::bail!`, because the page ' +
    'is bypassed by the data API, the MCP and every bulk load.',
    'The `model-first` skill has the placement table to fill in. If the model is already there ' +
    'and this genuinely renders what no layout can — an editable grid, a chart, a timeline, a ' +
    'multi-object workspace — that is a real answer: say so and carry on.'
  ].join('\n\n')
}

export const ask = (reason) => JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: reason
  }
})

async function readStdin () {
  if (process.stdin.isTTY) return {}
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}

// "Am I being run, or imported?" -- Node percent-encodes a module's own URL and resolves it
// through symlinks; argv[1] is the raw path it was invoked with. Comparing the two as strings
// holds only for an unremarkable POSIX path -- it is false for every Windows path, any path
// with a space, and any symlinked dir -- and a false here is a silent no-op, exit 0 and no
// output, which the host cannot tell apart from "allowed".
function invokedDirectly () {
  const argv = process.argv[1]
  if (!argv) return false
  if (import.meta.url === pathToFileURL(argv).href) return true
  try { return import.meta.url === pathToFileURL(realpathSync(argv)).href } catch { return false }
}

if (invokedDirectly()) {
  try {
    const payload = await readStdin()
    const input = payload?.tool_input
    const reason = decide(input?.file_path, input)
    if (reason) process.stdout.write(ask(reason))
  } catch { /* a guard that crashes must not take the session with it */ }
  process.exit(0)
}

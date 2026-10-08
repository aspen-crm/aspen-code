#!/usr/bin/env node
// The same checks the plugin's guard-ui-tokens.mjs hook runs on a write, over a whole tree.
//
// The hook only binds a Claude Code session with this plugin loaded. Custom UI also gets
// written by hand, in another editor, by a teammate who has never installed it -- and the
// failures it catches are silent, so nothing downstream notices. This is the copy that
// runs in CI and covers everyone.
//
//   node <this skill>/scripts/lint-ui-tokens.mjs typescript/src [--json]
//
// Exits 1 when anything is flagged, 0 when the tree is clean.
//
// Token names are checked against the snapshot of the `@aspen-crm/sdk` installed nearest
// each file, as the build (`aspen compile --typescript`) does; a file with no installed SDK, or one without a
// snapshot, gets the hardcode and component checks only.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

import {
  tokenNamesFor,
  findHardcodedValues,
  findUnknownTokens,
  findComponentMismatches
} from '../../../hooks/guard-ui-tokens.mjs'

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.scss'])
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'generated'])

function * walk (dir) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    let stats
    try { stats = statSync(path) } catch { continue }
    if (stats.isDirectory()) yield * walk(path)
    else if (EXTENSIONS.has(extname(entry))) yield path
  }
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const root = args.find((arg) => !arg.startsWith('--')) ?? '.'

const results = []
let unchecked = 0

for (const path of walk(root)) {
  const source = readFileSync(path, 'utf8')
  const known = tokenNamesFor(path)
  if (!known) unchecked++
  const unknown = findUnknownTokens(source, known)
  const hardcoded = findHardcodedValues(source)
  const mismatched = findComponentMismatches(source)
  if (!unknown.length && !hardcoded.length && !mismatched.length) continue
  results.push({ file: relative(root, path), unknown, hardcoded, mismatched })
}

if (asJson) {
  console.log(JSON.stringify({ filesWithoutSdkSnapshot: unchecked, results }, null, 2))
} else if (!results.length) {
  console.log('ui-tokens: clean.')
} else {
  for (const { file, unknown, hardcoded, mismatched } of results) {
    console.log(`\n${file}`)
    for (const { line, name, reserved, nearest } of unknown) {
      console.log(reserved
        ? `  ${line}: \`${name}\` uses the \`--ap-\` prefix reserved for Aspen`
        : `  ${line}: \`${name}\` is not a Public token in the installed SDK` +
          (nearest ? ` — did you mean \`${nearest}\`?` : ''))
    }
    for (const { line, property, value, family } of hardcoded) {
      console.log(`  ${line}: \`${property}: ${value}\` → use \`${family}\``)
    }
    for (const { component, prefixes } of mismatched) {
      console.log(
        `  rebuilds a \`${component}\` from the semantic layer; no ` +
        prefixes.map((prefix) => `\`${prefix}*\``).join(' or ') + ' token referenced'
      )
    }
  }
  const counted = results.reduce(
    (sum, r) => sum + r.unknown.length + r.hardcoded.length + r.mismatched.length, 0)
  console.log(
    `\n${counted} finding(s) in ${results.length} file(s). Token names come from the ` +
    'installed SDK (`typescript/node_modules/@aspen-crm/sdk/dist/tokens/`). For a value the system ' +
    'has no token for, add ' +
    '`aspen-token-exempt: <reason>` in a comment on that line or the line above, or ' +
    '`aspen-component-exempt: <reason>` anywhere in the file for a component finding.'
  )
}

if (unchecked && !asJson) {
  console.log(`\nui-tokens: ${unchecked} file(s) had no installed @aspen-crm/sdk with a token ` +
    'snapshot; token names were not checked in them.')
}

process.exit(results.length ? 1 : 0)

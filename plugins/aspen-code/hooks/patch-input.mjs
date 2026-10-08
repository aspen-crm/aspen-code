// Preview a Codex apply_patch for the UI guards: what each file will say. Never writes files.
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, basename, resolve, join } from 'node:path'

export const readText = path => { try { return readFileSync(path, 'utf8') } catch { return null } }
export function filePath(path, cwd) {
  const absolute = resolve(cwd, path)
  try { return realpathSync(absolute) } catch {}
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(filePath(parent, cwd), basename(absolute))
}
// A file the UI guards judge: the instance's UI project or its custom metadata. A patch that
// cannot be previewed for one of these is refused; for any other file it is left to the tool.
const inAspen = path => /(^|[/\\])(typescript|metadata[/\\]custom)([/\\]|$)/.test(path)
const normalizeLine = line => line.trim().replace(/[\u2018-\u201b]/g, "'").replace(/[\u201c-\u201f]/g, '"').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/g, ' ')
function locate(lines, needle, from, eof = false) {
  if (!needle.length) return from
  for (const normalize of [s => s, s => s.trimEnd(), s => s.trim(), normalizeLine]) {
    for (let i = eof ? Math.max(from, lines.length - needle.length) : from; i <= lines.length - needle.length; i++) {
      if (needle.every((line, j) => normalize(lines[i + j]) === normalize(line))) return i
    }
  }
  throw new Error('patch context does not match the file; re-read it and use current context')
}
function updatedText(before, body) {
  if (before === null) throw new Error('cannot read the file to inspect its patch')
  const lines = before.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const replacements = []
  let cursor = 0, i = 0
  while (i < body.length) {
    const header = body[i]
    if (header === '@@' || header.startsWith('@@ ')) {
      if (header.length > 3) cursor = locate(lines, [header.slice(3)], cursor) + 1
      i++
    }
    const old = [], next = []
    let eof = false
    while (i < body.length && !body[i].startsWith('@@')) {
      const line = body[i++]
      if (line === '*** End of File') { eof = true; break }
      if (line.startsWith(' ')) { old.push(line.slice(1)); next.push(line.slice(1)) }
      else if (line.startsWith('-')) old.push(line.slice(1))
      else if (line.startsWith('+')) next.push(line.slice(1))
      else if (line === '') { old.push(''); next.push('') }
      else throw new Error('unsupported patch line; use apply_patch context and +/- lines')
    }
    if (!old.length && !next.length) throw new Error('empty patch hunk')
    // Match each hunk against the original, like native apply_patch. Insert-only
    // hunks append; they do not advance the search cursor for later hunks.
    if (!old.length) {
      replacements.push([lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, next])
      continue
    }
    let at
    try { at = locate(lines, old, cursor, eof) }
    catch (error) {
      if (old.at(-1) !== '') throw error
      old.pop()
      if (next.at(-1) === '') next.pop()
      at = locate(lines, old, cursor, eof)
    }
    replacements.push([at, old.length, next])
    cursor = at + old.length
  }
  for (const [at, count, next] of replacements.sort((a, b) => a[0] - b[0]).reverse()) lines.splice(at, count, ...next)
  if (lines.at(-1) !== '') lines.push('')
  return lines.join('\n')
}
export function patchFiles(command, cwd, read = readText) {
  if (typeof command !== 'string') throw new Error('missing apply_patch command')
  const lines = command.trim().replace(/\r\n/g, '\n').split('\n')
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') throw new Error('expected an apply_patch document')
  const changes = [], virtual = new Map()
  const current = path => virtual.has(path) ? virtual.get(path) : read(path)
  let i = 0
  while (i < lines.length) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i++])
    if (!header) throw new Error('expected an Add, Update or Delete File header')
    const [, kind, raw] = header
    const source = filePath(raw, cwd)
    let target = source
    if (kind === 'Update' && lines[i]?.startsWith('*** Move to: ')) target = filePath(lines[i++].slice(13), cwd)
    const body = []
    while (i < lines.length && !/^\*\*\* (Add|Update|Delete) File: /.test(lines[i])) body.push(lines[i++])
    const before = current(source)
    let after = null
    try {
      if (kind === 'Add') {
        if (body.some(l => !l.startsWith('+'))) throw new Error('an added file must contain + lines')
        after = body.map(l => l.slice(1)).join('\n') + '\n'
      } else if (kind === 'Update') after = updatedText(before, body)
      else if (body.length) throw new Error('a Delete File header cannot contain a hunk')
    } catch (error) {
      if (inAspen(source) || inAspen(target)) throw new Error(`${raw}: ${error.message}`)
      // The native patch tool validates unrelated files; Aspen has no policy for them.
    }
    changes.push({ source, path: target, before: target === source ? before : current(target), content: after, deleted: kind === 'Delete' })
    if (source !== target || kind === 'Delete') virtual.set(source, null)
    if (kind !== 'Delete') virtual.set(target, after)
  }
  return changes
}

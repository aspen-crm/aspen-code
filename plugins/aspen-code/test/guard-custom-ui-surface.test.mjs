import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decide, surfacesIn, afterText, watched } from '../hooks/guard-custom-ui-surface.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'hooks', 'guard-custom-ui-surface.mjs')

const CLIENT = '/i/typescript/aspen.client.json'
const TAB = '/i/metadata/custom/tab_p/budget_c.json'
const LAYOUT = '/i/metadata/custom/object_p/layout_p/engagement_c.layout_c.json'

// A reader stub stands in for the copy on disk, so the tests say exactly what was there
// before. `null` is "no such file", which is what a brand new component looks like.
const disk = (text) => () => text

const client = (routes = [], sections = []) =>
  JSON.stringify({ routing: { 'base-url-path-part': 'services', routes }, layout: { sections } })

const asks = (path, input, read) => decide(path, input, read) !== null

// ---- which files are even looked at ------------------------------------------------

test('only the three descriptor kinds are watched', () => {
  assert.ok(watched(CLIENT))
  assert.ok(watched(TAB))
  assert.ok(watched(LAYOUT))
  for (const path of [
    '/i/metadata/custom/object_p/engagement_c.json',
    '/i/metadata/custom/object_p/list_view_p/engagement_c.list_view_c.json',
    '/i/metadata/custom/object_p/tab_p/engagement_c.json',
    '/i/metadata/platform/tab_p/home_p.json',
    '/i/typescript/src/pages/budget.ts',
    '/i/package.json'
  ]) assert.equal(watched(path), false, path)
})

test('a file outside an instance directory is never judged', () => {
  const input = { content: client([{ name: 'budget_page_c', path: '/budget' }]) }
  assert.equal(decide('/somewhere/aspen.client.json', input, disk(null)), null)
})

// ---- a new surface asks --------------------------------------------------------------

test('a new route in aspen.client.json asks, and names it', () => {
  const input = { content: client([{ name: 'budget_page_c', path: '/budget' }]) }
  const reason = decide(CLIENT, input, disk(null))
  assert.ok(reason)
  assert.match(reason, /budget_page_c/)
  assert.match(reason, /model-first/)
})

test('a new route with no name asks, and is known by its path', () => {
  // aspen init's own `/` route carries no name; a route only needs one when a tab opens it.
  const before = client([{ path: '/', module: 'src/home.ts', export: 'home' }])
  const after = client([
    { path: '/', module: 'src/home.ts', export: 'home' },
    { path: '/plan', module: 'src/plan.tsx', export: 'plan' }
  ])
  const reason = decide(CLIENT, { content: after }, disk(before))
  assert.match(reason, /route `\/plan`/)
  assert.doesNotMatch(reason, /route `\/`/)
})

test('a new layout section in aspen.client.json asks, and names its object', () => {
  const input = {
    content: client([], [{ name: 'budget_c', 'allowed-objects': ['engagement_c'] }])
  }
  const reason = decide(CLIENT, input, disk(null))
  assert.match(reason, /budget_c/)
  assert.match(reason, /engagement_c/)
})

test('a custom_page tab asks', () => {
  const input = {
    content: JSON.stringify({
      ctype: 'tab_p', name: 'budget_c', 'tab-type': 'custom_page',
      'page-ui-code': 'ui_main_c.budget_page_c'
    })
  }
  assert.ok(asks(TAB, input, disk(null)))
})

test('a custom_code layout section asks', () => {
  const input = {
    content: JSON.stringify({
      ctype: 'layout_p', name: 'engagement_c.layout_c',
      sections: [
        { name: 'detail_c', 'section-type': 'fields' },
        { name: 'budget_c', 'section-type': 'custom_code', 'section-ui-code': 'ui_main_c.budget_c' }
      ]
    })
  }
  const reason = decide(LAYOUT, input, disk(null))
  assert.match(reason, /budget_c/)
})

// ---- what must stay silent -----------------------------------------------------------

test('an ordinary object_type tab is silent', () => {
  const input = {
    content: JSON.stringify({
      ctype: 'tab_p', name: 'engagement_c.tab_c', 'tab-type': 'object_type',
      'default-list-view': 'engagement_c.list_view_c'
    })
  }
  assert.equal(decide(TAB, input, disk(null)), null)
})

test('a layout of ordinary sections is silent', () => {
  const input = {
    content: JSON.stringify({
      ctype: 'layout_p', name: 'engagement_c.layout_c',
      sections: [{ name: 'detail_c', 'section-type': 'fields' },
        { name: 'tasks_c', 'section-type': 'related_object' }]
    })
  }
  assert.equal(decide(LAYOUT, input, disk(null)), null)
})

test('a retired custom_page tab is silent — active:false is how this platform removes things', () => {
  // A real instance carries exactly this: a custom-page tab left at active:false. Asking
  // about it would be asking about a decision already reversed.
  const input = {
    content: JSON.stringify({
      ctype: 'tab_p', name: 'budget_c.tab_c', 'tab-type': 'custom_page', active: false
    })
  }
  assert.equal(decide(TAB, input, disk(null)), null)
})

test('a retired route and a retired custom_code section are silent too', () => {
  const routeInput = { content: client([{ name: 'old_page_c', path: '/old', active: false }]) }
  assert.equal(decide(CLIENT, routeInput, disk(null)), null)
  const layoutInput = {
    content: JSON.stringify({
      ctype: 'layout_p', name: 'engagement_c.layout_c',
      sections: [{ name: 'budget_c', 'section-type': 'custom_code', active: false }]
    })
  }
  assert.equal(decide(LAYOUT, layoutInput, disk(null)), null)
})

test('rewriting a descriptor whose surfaces are unchanged is silent', () => {
  // The decision was made when the route was declared. A guard that re-asks on every later
  // edit is a guard people switch off.
  const before = client([{ name: 'budget_page_c', path: '/budget' }])
  const after = client([{ name: 'budget_page_c', path: '/budget', module: 'src/pages/budget.ts' }])
  assert.equal(decide(CLIENT, { content: after }, disk(before)), null)
})

test('a second route added beside an existing one asks about only the new one', () => {
  const before = client([{ name: 'budget_page_c', path: '/budget' }])
  const after = client([
    { name: 'budget_page_c', path: '/budget' },
    { name: 'territory_align_page_c', path: '/territory-align' }
  ])
  const reason = decide(CLIENT, { content: after }, disk(before))
  assert.match(reason, /territory_align_page_c/)
  assert.doesNotMatch(reason, /budget_page_c/)
})

// ---- Edit, whose payload is a fragment ------------------------------------------------

test('an Edit that adds a route asks, by replaying it against the file on disk', () => {
  const before = client([{ name: 'budget_page_c', path: '/budget' }])
  const input = {
    old_string: '"routes":[{"name":"budget_page_c","path":"/budget"}]',
    new_string: '"routes":[{"name":"budget_page_c","path":"/budget"},{"name":"plan_page_c","path":"/plan"}]'
  }
  const reason = decide(CLIENT, input, disk(before))
  assert.match(reason, /plan_page_c/)
})

test('an Edit whose old_string is not on disk is silent, not a guess', () => {
  const input = { old_string: 'nowhere in the file', new_string: '"name":"plan_page_c"' }
  assert.equal(decide(CLIENT, input, disk(client())), null)
})

test('an Edit against a file that does not exist is silent', () => {
  assert.equal(decide(CLIENT, { old_string: 'a', new_string: 'b' }, disk(null)), null)
})

test('afterText replays a MultiEdit in order', () => {
  const text = afterText(CLIENT, {
    edits: [
      { old_string: 'ONE', new_string: 'TWO' },
      { old_string: 'TWO', new_string: 'THREE' }
    ]
  }, disk('ONE'))
  assert.equal(text, 'THREE')
})

// ---- malformed input must never crash --------------------------------------------------

test('malformed JSON is silent rather than a crash', () => {
  assert.equal(decide(CLIENT, { content: '{ "routing": ' }, disk(null)), null)
  assert.equal(surfacesIn(CLIENT, 'not json at all'), null)
})

test('a descriptor that parses to a non-object is silent', () => {
  for (const content of ['null', '"a string"', '42', '[]']) {
    assert.equal(decide(CLIENT, { content }, disk(null)), null, content)
  }
})

test('malformed JSON already on disk still lets a new surface be caught', () => {
  // The previous copy cannot be parsed, so nothing is known to be old; the guard falls back
  // to treating every surface in the new text as new rather than going quiet.
  const input = { content: client([{ name: 'budget_page_c', path: '/budget' }]) }
  assert.ok(asks(CLIENT, input, disk('{ broken')))
})

test('an empty tool input is silent', () => {
  assert.equal(decide(CLIENT, {}, disk(null)), null)
  assert.equal(decide(CLIENT, undefined, disk(null)), null)
  assert.equal(decide(undefined, { content: '{}' }, disk(null)), null)
})

// ---- run as the host runs it -------------------------------------------------------------

test('the hook reads a real file from disk and asks on the new surface only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspen-surface-'))
  try {
    const uiDir = join(dir, 'typescript')
    mkdirSync(uiDir, { recursive: true })
    const path = join(uiDir, 'aspen.client.json')
    writeFileSync(path, client([{ name: 'budget_page_c', path: '/budget' }]))

    const run = (content) => {
      const stdout = execFileSync('node', [SCRIPT], {
        input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path, content } }),
        encoding: 'utf8'
      })
      return stdout ? JSON.parse(stdout) : null
    }

    assert.equal(run(client([{ name: 'budget_page_c', path: '/budget' }])), null)

    const added = run(client([
      { name: 'budget_page_c', path: '/budget' },
      { name: 'plan_page_c', path: '/plan' }
    ]))
    assert.equal(added.hookSpecificOutput.permissionDecision, 'ask')
    assert.match(added.hookSpecificOutput.permissionDecisionReason, /plan_page_c/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('it asks and never denies, so it cannot wedge a session', () => {
  const input = { content: client([{ name: 'budget_page_c', path: '/budget' }]) }
  const stdout = execFileSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_input: { file_path: CLIENT, ...input } }),
    encoding: 'utf8'
  })
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'ask')
})

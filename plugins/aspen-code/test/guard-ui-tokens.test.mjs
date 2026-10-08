import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decide,
  findSdkDirectory,
  loadSdkTokenNames,
  findHardcodedValues,
  findUnknownTokens,
  stripVarCalls,
  contentOf
} from '../hooks/guard-ui-tokens.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'hooks', 'guard-ui-tokens.mjs')

// A UI project with an installed SDK whose snapshot is shaped like the real one: `:host`
// rules, a dark override, a media query, and component tokens aliasing semantic ones.
const SNAPSHOT = `:host {
  --ap-sem-color-text-primary: #11171d;
  --ap-sem-color-text-secondary: #3b424a;
  --ap-sem-color-border-subtle: #e1e3e6;
  --ap-sem-color-border-default: #cbced2;
  --ap-sem-color-surface-hover: #eef0f3;
  --ap-sem-color-brand-primary: #e3722d;
  --ap-sem-spacing-inner-xs: 8px;
  --ap-sem-spacing-inner-sm: 12px;
  --ap-sem-spacing-inner-md: 16px;
  --ap-sem-border-width-default: 1px;
  --ap-comp-button-radius: var(--ap-sem-radius-md);
  --ap-comp-cell-bg-default: var(--ap-sem-color-surface-default);
}
:host([data-theme='dark']) { --ap-sem-color-text-primary: #fff; }
@media (max-width: 767px) { :host { --ap-sem-spacing-inner-md: 12px; } }
`

function makeProject ({ manifest = { tokenStyleSheetFilePath: 'tokens.css' }, snapshot = SNAPSHOT } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aspen-ui-'))
  const ui = join(root, 'typescript')
  const sdk = join(ui, 'node_modules', '@aspen-crm', 'sdk')
  mkdirSync(join(sdk, 'dist'), { recursive: true })
  mkdirSync(join(ui, 'src', 'pages'), { recursive: true })
  writeFileSync(join(sdk, 'package.json'), '{"name":"@aspen-crm/sdk","version":"0.2.0"}')
  writeFileSync(join(sdk, 'dist', 'manifest.json'), JSON.stringify(manifest))
  if (snapshot) writeFileSync(join(sdk, 'dist', 'tokens.css'), snapshot)
  return { sdk, page: join(ui, 'src', 'pages', 'plan.ts') }
}

const PROJECT = makeProject()
const KNOWN = loadSdkTokenNames(PROJECT.sdk)
const UI = '/Users/x/Aspen/acme_dev/typescript/src/pages/plan.ts'

const css = (body) => `export const STYLE = \`\n${body}\n\``
const flagged = (body) => findHardcodedValues(css(body))

// ---- the inventory the guard checks against ----------------------------------------

test("names come from the installed SDK's snapshot", () => {
  assert.equal(findSdkDirectory(PROJECT.page), PROJECT.sdk)
  assert.ok(KNOWN.has('--ap-sem-color-text-primary'))
  assert.ok(KNOWN.has('--ap-comp-button-radius'))
  // A name only referenced in a value is not one the snapshot defines.
  assert.ok(!KNOWN.has('--ap-sem-radius-md'))
})

test('an SDK without a snapshot, or no SDK at all, is no authority', () => {
  // The skill no longer carries a list of its own to fall back on: one that disagrees with
  // the installed SDK would deny names the build accepts.
  assert.equal(loadSdkTokenNames(makeProject({ manifest: {} }).sdk), null)
  assert.equal(loadSdkTokenNames(makeProject({ snapshot: null }).sdk), null)
  assert.equal(findSdkDirectory(UI), null)
  assert.deepEqual(findUnknownTokens('color: var(--ap-sem-color-text-primry);', null), [])
})

// ---- unknown token names -----------------------------------------------------------

test('a misspelled token is caught and the nearest real name handed back', () => {
  const found = findUnknownTokens('color: var(--ap-sem-color-text-primry);', KNOWN)
  assert.equal(found.length, 1)
  assert.equal(found[0].name, '--ap-sem-color-text-primry')
  assert.equal(found[0].nearest, '--ap-sem-color-text-primary')
})

test('a real token passes, with or without a fallback', () => {
  const source = 'a { color: var(--ap-sem-color-text-primary); }\n' +
    'b { gap: var(--ap-sem-spacing-inner-xs, 8px); }'
  assert.deepEqual(findUnknownTokens(source, KNOWN), [])
})

test('a name too far from anything real reports no suggestion rather than a wrong one', () => {
  const [found] = findUnknownTokens('color: var(--ap-sem-totally-made-up-thing);', KNOWN)
  assert.equal(found.nearest, null)
})

test('any other --ap-* name is reserved, referenced or declared', () => {
  // The build's second rule: only `--ap-sem-*` and `--ap-comp-*` belong to the Guest.
  const found = findUnknownTokens(
    'a { --ap-int-gap: 4px; color: var(--ap-prim-gray-900); }\n' +
    "const s = { '--ap-row-h': '38px' }",
    KNOWN
  )
  assert.deepEqual(found.map(({ name, reserved }) => [name, reserved]), [
    ['--ap-int-gap', true],
    ['--ap-prim-gray-900', true],
    ['--ap-row-h', true]
  ])
})

test("the Guest's own custom properties are not checked", () => {
  assert.deepEqual(findUnknownTokens('a { --ps-row-h: 38px; height: var(--ps-row-h); }', KNOWN), [])
})

test('a JS token string is checked, which the build does not do', () => {
  const found = findUnknownTokens("el.style.color = 'var(--ap-sem-color-text-primry)'", KNOWN)
  assert.equal(found[0]?.nearest, '--ap-sem-color-text-primary')
})

// ---- hardcoded values, by property -------------------------------------------------

test('colors, spacing, radius, type and shadow are each caught on their own property', () => {
  const cases = [
    ['color: #11171d;', '--ap-sem-color-*'],
    ['background: rgb(255,255,255);', '--ap-sem-color-*'],
    ['border: 1px solid #d7dee2;', '--ap-sem-color-*'],
    ['padding: 16px;', '--ap-sem-spacing-inner-*'],
    ['margin-top: 24px;', '--ap-sem-spacing-inner-*'],
    ['gap: 8px;', '--ap-sem-spacing-inner-*'],
    ['border-radius: 8px;', '--ap-sem-radius-*'],
    ['font-size: 14px;', '--ap-sem-font-size-*'],
    ['line-height: 22px;', '--ap-sem-line-height-*'],
    ['font-weight: 600;', '--ap-sem-font-weight-*'],
    ['font-family: system-ui, sans-serif;', '--ap-sem-font-family-body'],
    ['box-shadow: 0 1px 2px rgba(17,23,29,.06);', '--ap-sem-elevation-*']
  ]
  for (const [declaration, family] of cases) {
    const [finding] = flagged(`.x { ${declaration} }`)
    assert.ok(finding, `${declaration} should be flagged`)
    assert.ok(finding.family.startsWith(family), `${declaration} → ${finding.family}`)
  }
})

// ---- what must NOT be flagged ------------------------------------------------------
//
// Every case below came out of real pages on veeva.com_niraj. A guard that fires on
// these is one a builder turns off, and then it protects nothing.

test('a var() fallback is not a hardcode', () => {
  // The token in front of it is what applies; older pages wrote the light value this way.
  assert.deepEqual(flagged('.x { color: var(--ap-sem-color-text-primary, #11171d); }'), [])
  assert.deepEqual(flagged('.x { padding: var(--ap-sem-spacing-inner-md, 16px); }'), [])
})

test('a multi-value fallback with nested parens is stripped whole', () => {
  const shadow = '.x { box-shadow: var(--ap-sem-elevation-low, 0 1px 2px rgba(17, 23, 29, 0.06)); }'
  assert.deepEqual(flagged(shadow), [])
  assert.ok(!stripVarCalls(shadow).includes('rgba'))
})

test('a dimension the system publishes no token for is left alone', () => {
  // There is a spacing scale and a type scale; there is no page-dimension scale. `240px`
  // is a deviation as padding and is simply the right answer as a min-width.
  assert.deepEqual(flagged('.x { width: 240px; min-height: 38px; background-size: 16px 16px; }'), [])
  assert.deepEqual(flagged('.x { top: -3px; flex-basis: 120px; max-width: 620px; }'), [])
})

test("an author's own custom property is a definition, not a styled declaration", () => {
  assert.deepEqual(flagged('.x { --ps-row-h: 38px; --ps-frame-max: 620px; }'), [])
})

test('a declaration composing off a variable keeps its offset', () => {
  // `calc(var(--ps-row-h) - 1px)` derives a line-height from the grid's row height and
  // `calc(var(--ap-comp-table-search-padding) + 20px)` leaves room for an icon. No token
  // expresses either, and the value is already named once.
  assert.deepEqual(flagged('.x { line-height: calc(var(--ps-row-h, 38px) - 1px); }'), [])
  assert.deepEqual(
    flagged('.x { padding: 0 var(--ap-comp-table-search-padding, 12px) 0 calc(var(--ap-comp-table-search-padding, 12px) + 20px); }'),
    []
  )
})

test('a monospace stack is left alone, because no mono token exists to point at', () => {
  assert.deepEqual(flagged('.x { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }'), [])
})

test('a value inside a block comment is prose, not code', () => {
  const source = css('/* measured on this instance: 400 14px/22px */\n.x { color: var(--ap-sem-color-text-primary); }')
  assert.deepEqual(findHardcodedValues(source), [])
})

test('zero needs no unit and no token', () => {
  assert.deepEqual(flagged('.x { padding: 0; margin: 0 auto; }'), [])
})

// ---- the escape hatch ---------------------------------------------------------------

test('an exemption comment stands the rule down for that line and the one under it', () => {
  assert.deepEqual(flagged('.x { padding: 3px; /* aspen-token-exempt: optical fix under the icon */ }'), [])
  assert.deepEqual(
    flagged('/* aspen-token-exempt: a 2px swatch; radius-xs would round it to a pill */\n.x { border-radius: 1px; }'),
    []
  )
})

test('an exemption on an unrelated line does not cover the next one', () => {
  const source = css(
    '.a { padding: 4px; /* aspen-token-exempt: reason */ }\n' +
    '.b { }\n' +
    '.c { padding: 5px; }'
  )
  const found = findHardcodedValues(source)
  assert.equal(found.length, 1)
  assert.equal(found[0].value, '5px')
})

// ---- scope ---------------------------------------------------------------------------

test("only custom UI source in an instance directory's typescript/ is scanned", () => {
  const bad = css('.x { color: #11171d; }')
  assert.ok(decide(UI, bad, KNOWN))
  assert.ok(decide('C:\\Users\\x\\Aspen\\acme_dev\\typescript\\src\\panel.css', bad, KNOWN))
  assert.equal(decide('/Users/x/Aspen/acme_dev/metadata/custom/object_p/org_c.json', bad, KNOWN), null)
  assert.equal(decide('/Users/x/Aspen/acme_dev/rust/src/lib.rs', bad, KNOWN), null)
  assert.equal(decide('/Users/x/Aspen/acme_dev/typescript/node_modules/lib/index.js', bad, KNOWN), null)
  assert.equal(decide('/Users/x/Aspen/acme_dev/typescript/dist/bundle.js', bad, KNOWN), null)
  assert.equal(decide('/Users/x/notes/scratch.ts', bad, KNOWN), null)
})

test('clean custom UI passes', () => {
  const good = css('.x {\n  color: var(--ap-sem-color-text-primary, #11171d);\n  padding: var(--ap-sem-spacing-inner-md, 16px);\n  width: 240px;\n}')
  assert.equal(decide(UI, good, KNOWN), null)
})

// ---- the message -----------------------------------------------------------------------

test('the message names the line, the property and the token family to use', () => {
  const reason = decide(UI, css('.x { padding: 16px; }'), KNOWN)
  assert.match(reason, /padding: 16px/)
  assert.match(reason, /--ap-sem-spacing-inner-\*/)
  assert.match(reason, /aspen-token-exempt/)
  assert.match(reason, /ui-design-tokens\.md/)
})

test('the message points at the typed token modules for JS and inline styles', () => {
  const reason = decide(UI, css('.x { color: #11171d; }'), KNOWN)
  assert.match(reason, /@aspen-crm\/sdk\/tokens\/sem/)
})

// ---- the tool payloads it runs on ---------------------------------------------------

test('content comes off Write, Edit and MultiEdit payloads alike', () => {
  assert.equal(contentOf({ content: 'a' }), 'a')
  assert.equal(contentOf({ new_string: 'b' }), 'b')
  assert.equal(contentOf({ edits: [{ new_string: 'c' }, { new_string: 'd' }] }), 'c\nd')
  assert.equal(contentOf(undefined), '')
})

test('an Edit is judged on what it is adding', () => {
  // Only the replacement is in the payload, so that is what gets scanned -- a hardcode
  // arriving this turn is caught even though the rest of the file is clean.
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: UI, old_string: 'x', new_string: '.y { color: #d7dee2; }' }
  }
  const stdout = execFileSync('node', [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' })
  const decision = JSON.parse(stdout)
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /--ap-sem-color-\*/)
})

test('a clean write produces no output at all, so the tool proceeds', () => {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: UI, content: css('.x { color: var(--ap-sem-color-text-primary); }') }
  }
  const stdout = execFileSync('node', [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' })
  assert.equal(stdout, '')
})

test('a write under a UI project is checked against its installed SDK', () => {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: PROJECT.page, content: css('.x { color: var(--ap-sem-color-text-primry); }') }
  }
  const stdout = execFileSync('node', [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' })
  const decision = JSON.parse(stdout)
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /did you mean `--ap-sem-color-text-primary`/)
})

test('a malformed payload is allowed through rather than wedging the session', () => {
  const stdout = execFileSync('node', [SCRIPT], { input: 'not json', encoding: 'utf8' })
  assert.equal(stdout, '')
})

// ---- rebuilding a component Aspen already publishes --------------------------------

import { findComponentMismatches } from '../hooks/guard-ui-tokens.mjs'

// The regression. This is the CSS a session actually shipped into a record section on
// veeva.com_niraj: a real `<table>` whose cell padding, border and header type were all
// re-derived from the semantic layer while `--ap-comp-cell-content-padding-x`,
// `-border-bottom-color` and the 65 `--ap-comp-table-*` names sat unused. Every token
// real, nothing hardcoded -- so the other two checks passed it, and it still renders as a
// near-miss beside Aspen's own list views.
const REBUILT_TABLE = css(`
.ec-table { width: 100%; border-collapse: collapse; }
.ec-table th, .ec-table td {
    text-align: left; vertical-align: top; white-space: nowrap;
    padding: var(--ap-sem-spacing-inner-xs, 8px) var(--ap-sem-spacing-inner-sm, 12px);
    border-bottom: var(--ap-sem-border-width-default, 1px) solid var(--ap-sem-color-border-subtle, #e1e3e6);
}
.ec-table th {
    color: var(--ap-sem-color-text-secondary, #3b424a);
    border-bottom-color: var(--ap-sem-color-border-default, #cbced2);
}
.ec-table tbody tr:hover { background: var(--ap-sem-color-surface-hover, #eef0f3); }
`)

test('a table rebuilt from the semantic layer is caught', () => {
  const [finding] = findComponentMismatches(REBUILT_TABLE)
  assert.ok(finding, 'the rebuilt table should be flagged')
  assert.equal(finding.component, 'table')
  assert.deepEqual(finding.prefixes, ['--ap-comp-table-', '--ap-comp-cell-'])
})

test('the message names the component and where to find its tokens', () => {
  const reason = decide(UI, REBUILT_TABLE, KNOWN)
  assert.match(reason, /renders a `table`/)
  assert.match(reason, /--ap-comp-cell-/)
  assert.match(reason, /dist\/tokens\/comp\/cell\.d\.ts/)
  assert.match(reason, /aspen-component-exempt/)
})

test('button, select and textarea are covered too', () => {
  for (const [element, prefix] of [['button', '--ap-comp-button-'], ['select', '--ap-comp-select-'], ['textarea', '--ap-comp-textarea-']]) {
    const source = css(`${element} { color: var(--ap-sem-color-text-primary); }`)
    const [finding] = findComponentMismatches(source)
    assert.ok(finding, `a styled ${element} should be flagged`)
    assert.ok(finding.prefixes.includes(prefix))
  }
})

// ---- what the component check must NOT flag ----------------------------------------
//
// These three shapes are all present in the hand-tuned stylesheets on veeva.com_niraj,
// and an earlier cut of this check flagged every one of them.

test('a file that reaches for the component tokens anywhere is on the system', () => {
  // The grid paints cells from `--ap-comp-cell-*` under a class, then accents one `th`
  // with a semantic brand colour for today's column. That sibling rule is not a rebuild.
  const source = css(`
.ps-cell {
    background: var(--ap-comp-cell-bg-default, #fff);
    border-bottom: var(--ap-comp-cell-border-bottom-width, 1px) solid var(--ap-comp-cell-border-bottom-color, #e1e3e6);
}
.ps-table thead th.is-today { box-shadow: inset 2px 0 0 var(--ap-sem-color-brand-primary, #e3722d); }
`)
  assert.deepEqual(findComponentMismatches(source), [])
})

test('markup with no stylesheet is not a styling decision', () => {
  // A DOM helper calls `el('button')` and holds no CSS; the styles live an import away.
  const source = "export const button = (label) => el('button', 'ps-btn', label)\n"
  assert.deepEqual(findComponentMismatches(source), [])
})

test('a rule that touches no token has nothing to prefer', () => {
  assert.deepEqual(findComponentMismatches(css('td { vertical-align: top; white-space: nowrap; }')), [])
})

test('a class that merely contains an element name is not that element', () => {
  // `.ec-table` is a class. Only a bare `table` in the selector counts.
  const source = css('.ec-table { gap: var(--ap-sem-spacing-inner-md); }')
  assert.deepEqual(findComponentMismatches(source), [])
})

test('an exemption anywhere in the file stands the component rule down', () => {
  const source = '/* aspen-component-exempt: a layout grid, not a data table */\n' + REBUILT_TABLE
  assert.deepEqual(findComponentMismatches(source), [])
})

// ---- scope -------------------------------------------------------------------------

test("an Edit's fragment is not judged on the component rule", () => {
  // Only a Write hands over the finished file. A fragment adding three `<td>`s carries
  // none of the file's CSS, so judging one would flag every edit to a correct table.
  assert.equal(decide(UI, REBUILT_TABLE, KNOWN, false), null)
  assert.ok(decide(UI, REBUILT_TABLE, KNOWN, true))
})

test('a hardcode in an Edit fragment is still caught', () => {
  // The other two checks are line-scoped and stay on for a fragment.
  assert.ok(decide(UI, css('.x { padding: 16px; }'), KNOWN, false))
})

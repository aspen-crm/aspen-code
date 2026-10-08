#!/usr/bin/env node
// PreToolUse guard for custom UI styling in an instance directory's `typescript/`. Runs through
// guard-ui.mjs, on Claude Code's Write/Edit/MultiEdit and Codex's apply_patch.
//
// A hardcoded `#11171d` looks correct, because the author is on the light theme. It renders
// black-on-black the first time someone opens the page in dark mode, and nothing tightens on
// a phone. No build step catches that, so this one does.
//
// Token NAMES are the build's job on SDKs that ship a token snapshot: each such
// `@aspen-crm/sdk` version carries its Public tokens, and the build (`aspen compile
// --typescript`, which runs the project's `x-cli build code`) fails a stylesheet that names an
// `--ap-*` property the installed snapshot does not define. This guard checks names against that same snapshot --
// read from the project's own `node_modules`, never from a copy here that can disagree with
// it -- for two things the build cannot do: answer at write time, and see JS and inline
// styles, which the build does not scan. With no installed SDK, or one with no snapshot,
// there is nothing authoritative to check against and the name check stands down.
//
// It denies rather than asks: a typo is never intended, and a hardcode has a documented escape
// hatch, so there is nothing for a human to weigh in on
// in the moment. The escape hatch is the point of the design -- see EXEMPT below. Real
// pages do need a value the system has no token for, and a rule with no way to say so
// gets switched off. This one makes deviation cost one comment and leave a reason behind.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SDK_PACKAGE = join('node_modules', '@aspen-crm', 'sdk')

// The installed SDK nearest the file, the way Node would resolve it from there. A file not
// yet under a UI project with `node_modules` has none.
export function findSdkDirectory (filePath) {
  let dir = dirname(resolve(String(filePath ?? '')))
  for (;;) {
    const candidate = join(dir, SDK_PACKAGE)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// The same lookup x-cli does: `dist/manifest.json` names the snapshot, and an SDK version
// that names none predates snapshots. Returns null when there is no snapshot to read, so
// callers can tell "no authority" apart from "an empty inventory".
export function loadSdkTokenNames (sdkDirectory) {
  if (!sdkDirectory) return null
  try {
    const manifest = JSON.parse(readFileSync(join(sdkDirectory, 'dist', 'manifest.json'), 'utf8'))
    if (!manifest.tokenStyleSheetFilePath) return null
    const css = readFileSync(join(sdkDirectory, 'dist', manifest.tokenStyleSheetFilePath), 'utf8')
    const names = new Set()
    for (const match of css.matchAll(/(--ap-[\w-]+)\s*:/g)) names.add(match[1])
    return names.size ? names : null
  } catch {
    return null
  }
}

const cache = new Map()

export function tokenNamesFor (filePath) {
  const sdk = findSdkDirectory(filePath)
  if (!cache.has(sdk)) cache.set(sdk, loadSdkTokenNames(sdk))
  return cache.get(sdk)
}

// ---- what this guard looks at ------------------------------------------------------

// An instance directory's UI project is `typescript/` (what `aspen init` creates). Installed
// packages and build output under it are not the author's code.
const UI_SOURCE = /(^|[/\\])typescript[/\\](?!(.*[/\\])?(node_modules|dist)[/\\]).*\.(ts|tsx|js|jsx|mjs|css|scss)$/

// One comment anywhere on the offending line, or on the line above it, stands the rule
// down for that line. `aspen-token-exempt: the grid's header matches the product, which
// paints 400 where the label token says 500` is the shape -- a reason, in the file, next
// to the value it explains.
const EXEMPT = /aspen-token-exempt/

// ---- stripping what must not be scanned --------------------------------------------

// Replace a span with spaces so every column index downstream still lines up with the
// original text -- the line numbers in the message have to point at the real line.
const blank = (text, start, end) =>
  text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, ' ') + text.slice(end)

// Block comments only. A `//` is left alone on purpose: inside the CSS template literals
// these files are built from, `//` is not a comment at all, and stripping it would eat
// the rest of a real declaration.
export function stripBlockComments (source) {
  let out = source
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    out = blank(out, match.index, match.index + match[0].length)
  }
  return out
}

// A `var()` fallback is not a hardcode -- the token in front of it is what applies.
// Fallbacks nest and carry commas and parens of their own (`var(--ap-sem-elevation-low, 0 1px 2px rgba(17,23,29,.06))`),
// so this counts parens instead of trying to match them with a regex.
export function stripVarCalls (source) {
  let out = source
  for (let i = 0; i < out.length; i++) {
    if (!out.startsWith('var(', i)) continue
    let depth = 0
    let end = i
    for (let j = i + 3; j < out.length; j++) {
      if (out[j] === '(') depth++
      else if (out[j] === ')') {
        depth--
        if (depth === 0) { end = j + 1; break }
      }
    }
    if (end > i) {
      out = blank(out, i, end)
      i = end - 1
    }
  }
  return out
}

// ---- the rules ---------------------------------------------------------------------

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
const PX_LITERAL = /(?<![\w-])\d+(\.\d+)?px\b/

// Keyed by the CSS property, because the literal alone says nothing. `240px` is a
// deviation as `padding` and is perfectly correct as `min-width`: the system publishes a
// spacing scale and does not publish page dimensions. Scoping by property is what keeps
// this from crying wolf on the grid's `--ps-row-h: 38px` and getting itself disabled.
const RULES = [
  {
    properties: /^(color|background-color|background|border(-(top|right|bottom|left))?-color|outline-color|text-decoration-color|caret-color|fill|stroke|border(-(top|right|bottom|left))?|outline)$/,
    literal: COLOR_LITERAL,
    family: '--ap-sem-color-*',
    note: 'light and dark both come free from a color token; a hex is only ever correct in one of them'
  },
  {
    properties: /^box-shadow$/,
    literal: COLOR_LITERAL,
    family: '--ap-sem-elevation-*',
    note: 'shadows are deliberately heavier in dark mode'
  },
  {
    properties: /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/,
    literal: PX_LITERAL,
    family: '--ap-sem-spacing-inner-* (inside a component) or --ap-sem-spacing-layout-* (between blocks)',
    note: 'spacing tokens tighten on their own at tablet and phone widths'
  },
  {
    properties: /^border(-(top|bottom)-(left|right))?-radius$/,
    literal: PX_LITERAL,
    family: '--ap-sem-radius-*',
    note: null
  },
  {
    properties: /^border(-(top|right|bottom|left))?-width$/,
    literal: PX_LITERAL,
    family: '--ap-sem-border-width-*',
    note: null
  },
  {
    properties: /^font-size$/,
    literal: PX_LITERAL,
    family: '--ap-sem-font-size-*',
    note: 'display and heading sizes shrink on phones on their own'
  },
  {
    properties: /^line-height$/,
    literal: PX_LITERAL,
    family: '--ap-sem-line-height-*',
    note: 'pair it with the font-size token of the same role'
  },
  {
    properties: /^font-weight$/,
    literal: /^\s*(\d{3}|bold|bolder)\s*$/,
    family: '--ap-sem-font-weight-*',
    note: null
  },
  {
    // A monospace stack is deliberately not matched. The system publishes one family
    // token and it is Geist -- there is no mono token to point at, so flagging an id or
    // a code block's `ui-monospace` would be telling the author to make it unreadable.
    properties: /^(font-family|font)$/,
    literal: /system-ui|-apple-system|sans-serif|(?<!ui-)\bserif|Helvetica|Arial|Geist/i,
    skip: /\bmonospace\b/i,
    family: '--ap-sem-font-family-body',
    note: 'one family token covers every role'
  }
]

// A declaration, not an assignment: `padding: 16px` in a style string or a style object.
// The property side allows a leading quote so `{ 'font-size': '14px' }` is seen too.
const DECLARATION = /(^|[;{'"`\s])([a-zA-Z-]+)\s*:\s*([^;{}\n]*)/g

export function findHardcodedValues (source) {
  const scannable = stripVarCalls(stripBlockComments(source))
  const lines = scannable.split('\n')
  const originalLines = source.split('\n')
  const findings = []

  lines.forEach((line, index) => {
    const exempt = EXEMPT.test(originalLines[index] ?? '') ||
      EXEMPT.test(originalLines[index - 1] ?? '')
    if (exempt) return

    for (const match of line.matchAll(DECLARATION)) {
      const property = match[2].toLowerCase()
      const value = match[3]
      // A custom property is the author's own variable (`--ps-row-h`), not a styled
      // declaration -- its whole purpose is to name a local value once.
      if (property.startsWith('--')) continue

      // `blank()` preserves every column, so the same span of the original line is this
      // declaration with its `var()` calls still in it. A declaration that reads any
      // variable is composing, not hardcoding: `calc(var(--ap-comp-table-search-padding)
      // + 20px)` leaves room for an icon, and `calc(var(--ps-row-h) - 1px)` derives a
      // line-height from the grid's own row height -- a token could not express either.
      // Author-local variables count for the same reason platform ones do: the value is
      // named once and the literal is the offset from it. Flagging these is how a guard
      // teaches people to route around it.
      const original = (originalLines[index] ?? '').slice(match.index, match.index + match[0].length)
      if (original.includes('var(')) continue

      for (const rule of RULES) {
        if (!rule.properties.test(property)) continue
        if (rule.skip?.test(value)) continue
        if (!rule.literal.test(value)) continue
        findings.push({
          line: index + 1,
          property,
          value: value.trim(),
          family: rule.family,
          note: rule.note
        })
        break
      }
    }
  })

  return findings
}

// ---- rebuilding a component Aspen already publishes ---------------------------------
//
// The third failure, and the one the first two are blind to. A page can name only real
// tokens, hardcode nothing, pass every check here -- and still look wrong, because it
// built a `<table>` out of the semantic layer while `--ap-comp-table-*` and
// `--ap-comp-cell-*` sat there publishing the exact cell padding, hover and border it
// re-derived by hand. It renders next to Aspen's own list views, where a near-miss reads
// as a bug rather than a style.
//
// Keyed on the CSS RULE, not the file. The first attempt asked "does this file render a
// table and reference no table tokens", which is the wrong question in any codebase that
// separates markup from styles -- and this one does. It flagged the DOM helper that calls
// `el('button')` and holds no CSS, a types module, and the grid whose table tokens live
// one import away in `lib/styles.ts`; 14 findings, and it still missed the table that
// prompted it. A rule that styles `th`/`td` is where the decision actually gets made, and
// it is in one place by construction.
//
// Small on purpose: only components whose selector is an HTML element. Tag, card, banner
// and modal are divs -- nothing to key on, and guessing costs more than it catches.
const COMPONENT_RULES = [
  { component: 'table', prefixes: ['--ap-comp-table-', '--ap-comp-cell-'], elements: ['table', 'thead', 'tbody', 'tr', 'td', 'th'] },
  { component: 'button', prefixes: ['--ap-comp-button-'], elements: ['button'] },
  { component: 'select', prefixes: ['--ap-comp-select-'], elements: ['select'] },
  { component: 'textarea', prefixes: ['--ap-comp-textarea-'], elements: ['textarea'] }
]

// One marker for the whole file: the finding is about how a component is styled, and
// pinning it to a line inside a multi-line rule would be arbitrary.
const COMPONENT_EXEMPT = /aspen-component-exempt/

// `selector { declarations }`, over the CSS that lives in template literals here. Nested
// at-rules are not unpacked -- a media query's inner rules read as their own blocks,
// which is all this needs.
const CSS_RULE = /([^{}@;]+)\{([^{}]*)\}/g

// A bare element in a selector, so `.ec-table th` counts as a `th` and `.ec-table` does
// not count as a `table`.
const stylesElement = (selector, element) =>
  new RegExp(`(^|[\\s>+~,])${element}([\\s>+~,:\\[.]|$)`, 'i').test(selector)

export function findComponentMismatches (source) {
  if (COMPONENT_EXEMPT.test(source)) return []
  const scannable = stripBlockComments(source)
  const findings = []

  // Two questions, deliberately at different scopes. Does the file STYLE this component's
  // elements -- a CSS rule, not just markup, which is what keeps the DOM helper that calls
  // `el('button')` out of it. And does the file reach for the component's tokens ANYWHERE.
  //
  // The second is file-wide because a real stylesheet spreads one component over many
  // rules: the grid paints its cells from `--ap-comp-cell-*` under `.ps-cell`, and one
  // sibling rule accents a `th` with `--ap-sem-color-brand-primary` for today's column.
  // Demanding a component token in every rule that names a `th` flagged all three of the
  // hand-tuned stylesheets it was built to approve of.
  for (const rule of COMPONENT_RULES) {
    if (rule.prefixes.some((prefix) => scannable.includes(prefix))) continue

    for (const match of scannable.matchAll(CSS_RULE)) {
      const [, selector, declarations] = match
      // Only a rule that reaches for the design system at all. `td { vertical-align: top }`
      // is layout plumbing and has no token to prefer.
      if (!declarations.includes('--ap-sem-')) continue
      if (!rule.elements.some((element) => stylesElement(selector, element))) continue

      findings.push({
        component: rule.component,
        prefixes: rule.prefixes,
        line: scannable.slice(0, match.index).split('\n').length,
        selector: selector.trim().replace(/\s+/g, ' ').slice(0, 60)
      })
      break
    }
  }

  return findings
}

// ---- native controls the browser draws ---------------------------------------------
//
// The fourth failure, and the one that makes a page read as generic at a glance. A `<select>`,
// a `<datalist>` and a date or time `<input>` look fine closed and open a menu or calendar the
// browser paints, which no stylesheet reaches -- a styled `<select>` passes every token check
// here and still opens the operating system's list. Aspen builds each of them itself;
// `controls.md` in the custom-ui skill has the anatomy to build from.
//
// Matched only where a page actually creates one: lowercase JSX or HTML (`<Select>` is a
// component), a `createElement`/`h`/`el` call, or an input whose `type` is set to a date or time
// kind. Comments are prose, and a field descriptor's `{ type: 'date' }` is data, not markup.
const DATE_TYPES = '(date|time|datetime-local|month|week)'
const CREATES = String.raw`(?:createElement|\bh|\bel|\bjsxs?)\(\s*`
const NATIVE_CONTROLS = [
  {
    control: '<select>',
    instead: 'the Select in `controls.md`',
    patterns: [/<select\b/, new RegExp(`${CREATES}['"]select['"]`)]
  },
  {
    control: '<datalist>',
    instead: 'the Lookup in `controls.md`',
    patterns: [/<datalist\b/, new RegExp(`${CREATES}['"]datalist['"]`)]
  },
  {
    control: 'a date or time `<input>`',
    instead: 'the Date picker in `controls.md`',
    patterns: [
      new RegExp(`<input\\b[^>]*\\btype\\s*=\\s*\\{?\\s*['"]${DATE_TYPES}['"]`),
      new RegExp(`\\.type\\s*=\\s*['"]${DATE_TYPES}['"]`),
      new RegExp(`setAttribute\\(\\s*['"]type['"]\\s*,\\s*['"]${DATE_TYPES}['"]`),
      new RegExp(`${CREATES}['"]input['"]\\s*,\\s*\\{[^}]*\\btype\\s*:\\s*['"]${DATE_TYPES}['"]`)
    ]
  }
]

// `//` comments too, here: this check reads markup and calls, not CSS, so a `//` that opens a
// comment is one. Only a `//` after whitespace counts, which leaves `https://` in a string alone.
const stripLineComments = (source) =>
  source.split('\n').map((line) => line.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n')

export function findNativeControls (source) {
  if (COMPONENT_EXEMPT.test(source)) return []
  const scannable = stripLineComments(stripBlockComments(source))
  const findings = []
  for (const rule of NATIVE_CONTROLS) {
    for (const pattern of rule.patterns) {
      const match = new RegExp(pattern.source, 'g').exec(scannable)
      if (!match) continue
      findings.push({
        control: rule.control,
        instead: rule.instead,
        line: scannable.slice(0, match.index).split('\n').length
      })
      break
    }
  }
  return findings
}

// ---- a text glyph or emoji standing in for an icon -----------------------------------
//
// The other half of a generic-looking control: the chevron typed as `▾`, the calendar as 📅, the
// month arrows as `‹ ›`, the clear button as `×`. Each renders in whatever font the browser picks
// (an emoji in full colour), at a size and colour the design system cannot reach. Aspen draws
// them as SVG; `aspen-icons.ts` in the custom-ui skill has its glyphs.
//
// A finding is a string literal or a JSX text node that is NOTHING but such glyphs (escapes
// included), so prose like "Loading…" or "2 × 3" is left alone.
const GLYPH = /^(?:[\u25B2-\u25C3\u2039\u203A\u00AB\u00BB\u27E8\u27E9\u00D7\u2715-\u2717\u2713\u2714\u2630\u22EE\u22EF\u2026\u2304\u2303\u2315\u2190-\u2193\u21E0-\u21E3]|\p{Extended_Pictographic})$/u
const unescape = (text) => text
  .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
const onlyGlyphs = (raw) => {
  const chars = [...unescape(raw).replace(/[\s\uFE0F\u200D]/g, '')]
  return chars.length > 0 && chars.length <= 3 && chars.every((ch) => GLYPH.test(ch))
}

export function findGlyphIcons (source) {
  const scannable = stripLineComments(stripBlockComments(source))
  const original = source.split('\n')
  const findings = []
  const seen = new Set()
  const report = (index, glyph) => {
    const line = scannable.slice(0, index).split('\n').length
    if (EXEMPT.test(original[line - 1] ?? '') || EXEMPT.test(original[line - 2] ?? '')) return
    if (seen.has(`${line}:${glyph}`)) return
    seen.add(`${line}:${glyph}`)
    findings.push({ line, glyph: unescape(glyph).trim() })
  }
  for (const match of scannable.matchAll(/(['"`])([^'"`\n]{1,24})\1/g)) {
    if (onlyGlyphs(match[2])) report(match.index, match[2])
  }
  for (const match of scannable.matchAll(/>([^<>{}\n]{1,8})</g)) {
    if (onlyGlyphs(match[1])) report(match.index, match[1])
  }
  return findings
}

// The two rules the build applies, so the answer here matches the build's: under the
// reserved `--ap-` prefix only `--ap-sem-*` and `--ap-comp-*` are Guest-usable, and only the
// names the installed snapshot defines. Declarations count as well as references -- the
// build rejects a Guest declaring `--ap-sem-foo: 1px` too. `known` is null when there is no
// snapshot to check against, and then nothing is reported.
const RESERVED_NAME = /var\(\s*(--ap-[\w-]*)|(?:^|[;{'"`\s])(--ap-[\w-]*)['"]?\s*:/g
const PUBLIC_NAME = /^--ap-(sem|comp)-/

export function findUnknownTokens (source, known) {
  if (!known) return []
  const findings = []
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(RESERVED_NAME)) {
      const name = match[1] ?? match[2]
      if (known.has(name)) continue
      if (!PUBLIC_NAME.test(name)) {
        findings.push({ line: index + 1, name, reserved: true, nearest: null })
        continue
      }
      findings.push({ line: index + 1, name, reserved: false, nearest: nearestName(name, known) })
    }
  })
  return findings
}

// A typo is nearly always one edit away from a real name, and handing the name back is
// the difference between a one-turn fix and a grep through a 2000-line inventory.
export function nearestName (name, known) {
  let best = null
  let bestScore = Infinity
  for (const candidate of known) {
    if (Math.abs(candidate.length - name.length) > 3) continue
    const score = distance(name, candidate, bestScore)
    if (score < bestScore) { bestScore = score; best = candidate }
  }
  return bestScore <= 3 ? best : null
}

function distance (a, b, ceiling) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > ceiling) return Infinity
    previous = current
  }
  return previous[b.length]
}

// ---- the decision -------------------------------------------------------------------

// `whole` says the content is an entire file rather than an Edit's replacement string.
// The component check needs that distinction and the other two do not: it asks whether a
// file styles its table anywhere, and a fragment that adds three `<td>`s carries none of
// the file's CSS, so judging one would flag every edit to a table that is already right.
export function decide (filePath, content, known, whole = true) {
  const path = String(filePath ?? '')
  if (!UI_SOURCE.test(path)) return null
  const source = String(content ?? '')
  if (!source) return null
  if (known === undefined) known = tokenNamesFor(path)

  const unknown = findUnknownTokens(source, known)
  const hardcoded = findHardcodedValues(source)
  const mismatched = whole ? findComponentMismatches(source) : []
  const native = findNativeControls(source)
  const glyphs = findGlyphIcons(source)
  if (!unknown.length && !hardcoded.length && !mismatched.length && !native.length && !glyphs.length) return null

  const parts = []

  if (unknown.length) {
    parts.push(
      'These `--ap-*` names are not Public tokens in the installed `@aspen-crm/sdk`. In a ' +
      'stylesheet the build (`aspen compile --typescript`) fails on them; in JS or an inline ' +
      'style nothing does, and the declaration is silently dropped:\n' +
      unknown.map(({ line, name, reserved, nearest }) =>
        `  line ${line}: \`${name}\`` +
        (reserved
          ? ' — the `--ap-` prefix is reserved for Aspen; only `--ap-sem-*` and `--ap-comp-*` are public. Name your own properties without it.'
          : nearest ? ` — did you mean \`${nearest}\`?` : '')
      ).join('\n')
    )
  }

  if (hardcoded.length) {
    parts.push(
      'These are hardcoded where the design system publishes a token. Custom UI renders in ' +
      'a shadow root on the platform document, so every `--ap-*` token resolves — including ' +
      'its dark value and its responsive steps, which a literal cannot follow:\n' +
      hardcoded.map(({ line, property, value, family, note }) =>
        `  line ${line}: \`${property}: ${value}\` → use \`${family}\`` + (note ? ` (${note})` : '')
      ).join('\n')
    )
  }

  if (mismatched.length) {
    parts.push(
      'This file rebuilds a component Aspen already publishes, out of the semantic layer, ' +
      'and never touches that component\'s own tokens. It renders beside Aspen\'s real ones, ' +
      'where a near-miss reads as a bug — the component tokens already carry the padding, ' +
      'hover, border and frame values being re-derived here:\n' +
      mismatched.map(({ component, prefixes }) =>
        `  renders a \`${component}\` but references no ${prefixes.map((p) => `\`${p}*\``).join(' or ')} token` +
        ` — see ${prefixes.map((p) => `\`dist/tokens/comp/${p.slice('--ap-comp-'.length, -1)}.d.ts\``).join(' and ')} in the installed SDK`
      ).join('\n') +
      '\n\nStart from the component\'s tokens for the parts it publishes, and compose from ' +
      '`--ap-sem-*` only for what it does not (a magnitude bar in a cell, say). If this is ' +
      'deliberately not that component — a layout table, a control that has to look ' +
      'different — put `aspen-component-exempt: <reason>` in a comment anywhere in the file.'
    )
  }

  if (native.length) {
    parts.push(
      'These are native controls whose menu or calendar the browser draws. No stylesheet reaches ' +
      'it, so the opened control is the operating system\'s, not Aspen\'s, however the closed ' +
      'one is styled:\n' +
      native.map(({ line, control, instead }) => `  line ${line}: ${control} → build ${instead}`).join('\n') +
      '\n\nBuild it from the custom-ui skill\'s `controls.md` (anatomy, tokens per part, keyboard), ' +
      'with its icons from `aspen-icons.ts` — never a text glyph or emoji. If a native control is ' +
      'deliberate (a hidden form field, say), put `aspen-component-exempt: <reason>` in a comment ' +
      'anywhere in the file.'
    )
  }

  if (glyphs.length) {
    parts.push(
      'These are text glyphs or emoji standing in for icons. They render in whatever font the ' +
      'browser picks, at a size and colour no token reaches; Aspen draws every one as an SVG:\n' +
      glyphs.map(({ line, glyph }) => `  line ${line}: \`${glyph}\``).join('\n') +
      '\n\nUse the platform glyph from the custom-ui skill\'s `aspen-icons.ts` (ChevronDown, Check, ' +
      'Close, Search, CalendarToday, ArrowLeft, ArrowRight, Spinner), sized by the part\'s icon-size ' +
      'token. If the character is genuinely text, put `aspen-token-exempt: <reason>` in a comment ' +
      'on that line or the line above.'
    )
  }

  parts.push(
    'Token names come from the installed SDK: its typed modules under ' +
    '`typescript/node_modules/@aspen-crm/sdk/dist/tokens/` (`comp/<family>.d.ts` per component), ' +
    'with the `custom-ui` skill\'s `ui-design-tokens.md` and `ui-component-tokens.md` for which ' +
    'token or component family fits. In JS and ' +
    'inline styles, import them from `@aspen-crm/sdk/tokens/sem` or `/comp` instead of ' +
    'writing the string. If a value genuinely has no token, keep it and put ' +
    '`aspen-token-exempt: <reason>` in a comment on that line or the line above.'
  )

  return parts.join('\n\n')
}

export const deny = (reason) => JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
})

// Only a Write hands over the finished file. An Edit's `new_string` is a fragment, so the
// file-level component check has to sit out -- see `whole` on decide().
export const isWholeFile = (toolInput) => typeof toolInput?.content === 'string'

// Write carries the whole file; Edit carries only the replacement, which is the right
// thing to scan -- it is what this turn is adding.
export function contentOf (toolInput) {
  if (!toolInput) return ''
  if (typeof toolInput.content === 'string') return toolInput.content
  if (typeof toolInput.new_string === 'string') return toolInput.new_string
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits.map((edit) => edit?.new_string ?? '').join('\n')
  }
  return ''
}

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
    const filePath = input?.file_path && resolve(payload?.cwd || process.cwd(), input.file_path)
    const reason = decide(filePath, contentOf(input), undefined, isWholeFile(input))
    if (reason) process.stdout.write(deny(reason))
  } catch { /* a guard that crashes must not take the session with it */ }
  process.exit(0)
}

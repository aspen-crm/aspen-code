# Harvesting the design-system vocabulary

Three small tools that turn a running Aspen instance into build-time validation for custom UI.

They exist because **two failure modes in custom UI are completely silent**: a Tailwind class
the platform's build never generated matches no rule, and a mistyped `--ap-*` token resolves
to the empty string so `var()` falls back. TypeScript validates neither. No unit test can see
either — jsdom has no platform CSS. The page renders, and it is wrong.

Nothing here contains platform source. Each instance harvests its own vocabulary from the
instance its operator is already authenticated to see.

## Use

**1. Collect** — open a signed-in page of the instance and evaluate `collect.js` in it
(DevTools console, or have the agent evaluate it). It returns a JSON object; save it.

Run it on several pages and keep all the files. A page can only report what it renders, so one
page is always partial. Good pages to sweep: a record-create page, a populated list view, a
record detail page, and a page with a menu open.

```js
// in the console, then right-click the result → "Copy object", or:
const blob = new Blob([JSON.stringify($_)], { type: 'application/json' });
const a = Object.assign(document.createElement('a'),
    { href: URL.createObjectURL(blob), download: 'capture.json' });
a.click();
```

**2. Generate** — merge the captures into one versioned module in the instance:

```sh
node write.mjs --release 26.4.1-build10569 --out typescript/src/generated capture*.json
```

`--release` is the release the instance serves, which `aspenup update` prints. It is not the
SDK version. The output is stamped with it, so regenerating after an upgrade produces a diff
that is the platform's change log.

**3. Check** — fail the build on a name the instance does not define:

```sh
node check.mjs --generated typescript/src/generated/design-system.ts typescript/src
```

Wire it into `package.json` beside `typecheck`:

```json
"scripts": { "check:ds": "node .../check.mjs --generated src/generated/design-system.ts src" }
```

## What each tool collects

| | |
|---|---|
| `classes` | every class name the instance's stylesheet defines a rule for |
| `tokens` | every `--ap-*` custom property and its computed value |
| `recipes` | the class string of each component the harvested pages rendered |
| `icons` | path data from rendered SVGs |

`collect.js` deliberately does **not** copy the stylesheet. The class *names* are what
validation needs, they are far smaller, and they are derived data rather than a copy.

## Limits worth knowing before you trust the output

**`recipes` are observations, not the source recipes.** The design system's `cva()` configs are
never sent to the browser. What you get is the class string of a component *as rendered on the
pages you harvested*, which is evidence, not a catalogue. A component can render differently in
a different context, and components the instance never renders do not appear at all.

**An empty instance renders empty states.** A list view with no records still renders one
`<td>` — `p-inner-xl text-center text-body-large text-tertiary`. Harvest that as a table cell
and you get a reference that is wrong *and* passes. Check the classes of anything you harvest.

**`icons` are not named.** The platform does not put an icon's name in the DOM, so entries are
keyed by a hash of the path and carry whatever `aria-label` or nearby text was available.
Rename them as you identify them. Reproducing the real path still matters: an emoji or a `▾`
substitute ignores `currentColor` and renders in whatever font the browser picked.

## How `check.mjs` stays quiet enough to leave on

Scanning every string literal for class-shaped words produces hundreds of false positives —
prose in comments, import specifiers, SVG path data, test fixtures. The filters, each added
after seeing real output:

- comments are stripped; `import`/`export … from` lines are skipped
- literals that look like SVG path data are skipped (numerically dense, or carrying path
  commands)
- `*.test.*` / `*.spec.*` files are skipped
- **every** word in a literal must be class-shaped, or the literal is not a class list
- the literal must contain **at least one class the instance defines** — a string of
  class-looking words with no anchor in the stylesheet is almost never a class list
- classes the project defines in its own adopted CSS count as defined
- a `--ap-…-` reference ending in a hyphen is prose naming a family, not a reference

Use `--ignore <name>` for anything left over.

The tradeoff: a `className` holding exactly one invented class, with nothing else in the
string, is missed. Single-word classes are also the ones the build is most likely to have
generated.

## Why a static check when there is also a runtime one

They catch different things, and the gap is structural. A runtime check can only see what is
in the DOM at the moment it runs, inside the subtree it is given — so it cannot see a closed
modal's width classes, a branch that did not render, or markup outside the scanned element.

Run against a real instance for the first time, this check found five classes that did not
exist, in code that already passed a runtime audit, a type-check and 142 tests. Two of them had
been shipped in a deployed page for its entire history: a Save button whose disabled styling
used `disabled:bg-surface-disabled` and `disabled:text-disabled-on-color`, neither of which the
platform generates, so the button never changed appearance when disabled.

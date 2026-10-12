---
name: custom-ui
description: Use when writing or restyling a TypeScript page or layout section in an Aspen instance directory's typescript/ — a definePage or defineLayoutSection, a route or section in aspen.client.json, or any control, table, form, panel or style in one. Covers where the code goes, how it reaches records and navigation, the design-token and component rules a page must meet, the build and lint checks, and how to verify the rendered UI. Run model-first before the first file; the page is the last tier.
---

# Custom UI in `typescript/`

A page or layout section is the **last** tier: `model-first` decides whether one should exist,
over fields the model already holds. This skill is how to build it once it should. A hook asks
the first time a write declares a new surface (a route, a layout section, a `custom_page` tab);
that is the backstop, not the decision.

## Before the first file: check the SDK

On 26.4.1, `aspen init` pins `@aspen-crm/sdk` and `@aspen-crm/x-cli` 0.1.0. They were built for
the previous release and carry no token snapshot; the SDK for 26.4.1 is 0.2.0, and it is not
published. The platform refuses to render a page whose SDK has no snapshot (the page fails with
"SDK is no longer supported. Please upgrade the SDK and redeploy").

So read `typescript/node_modules/@aspen-crm/sdk/dist/manifest.json` first. With no
`tokenStyleSheetFilePath` in it, tell the human the page will not render on this instance until an
SDK with a snapshot is published and pinned, before building anything. Never change the pins
yourself (`aspen doctor` expects the version this CLI scaffolds), and never point them at an
x-platform checkout. Token names, the typed token modules and the build's token check below all
need SDK and x-cli 0.2.0.

## 1. Where it goes

- An entry module under `typescript/src/` exports `definePage(({ element }) => …)` or
  `defineLayoutSection(({ element, … }) => …)` from `@aspen-crm/sdk`, returning `{ unmount }`. The
  SDK hands you one bare `element`: plain DOM, or a framework root you mount yourself
  (`createRoot(element)`). Follow the instance directory's `AGENTS.md` for layout.
- Declare it in `typescript/aspen.client.json`: a page under `routing.routes` (`path`, `module`,
  `export`, and a `name` if a tab will open it), a layout section under `layout.sections` (`name`,
  `allowed-objects`, `allowed-modes` — at least one of `create`, `edit`, `view` — `module`,
  `export`; the build rejects a section without `allowed-modes`). Keep the scaffolded `/` route:
  x-cli fails a configuration that declares no route.
- Styles go in a stylesheet the entry module imports (`import './plan.css'`): x-cli bundles it
  with the entry, and the platform links it inside the page's shadow root. x-cli's tsconfig sets
  `noUncheckedSideEffectImports` and x-cli 0.1.0 ships no CSS declaration, so add
  `typescript/src/css.d.ts` holding `declare module '*.css';` or the editor and `tsc` flag the
  import. The build itself bundles with esbuild and does not type-check.
- A `custom_page` tab names its page `ui_main_c.<route name>` — see `metadata`'s
  `metadata-shapes.md`. A custom (`_c`) codefile serves at
  `/ui/c/<base-url-path-part>/<route path>`; `/ui/a/` is app scope, not yours.

## 2. What the page can reach

- Its JavaScript runs in a **hidden guest iframe** (its own `window`, not a security boundary) and
  renders into a shadow root on the platform document.
- Navigate through `@aspen-crm/sdk/navigation`: `navigation.createHref(descriptor)` for an
  `href`, and on click `if (shouldInterceptLinkClick(event)) { event.preventDefault();
  navigation.navigate(descriptor) }`, so a modified or middle click still opens a new tab. Never
  hand-build platform URLs.
- `navigate` to `/objects/:objectName/:recordId` needs `config.tabName`, or the platform errors
  "No active tab found".
- Records come from the instance's query endpoints through `@aspen-crm/sdk/request`. The AQL rules
  are in `server-code`'s `query-notes.md`: every query needs a `LIMIT`; a JSON query takes `LIMIT`
  ≤ 1000 and `OFFSET` ≤ 10000, and a larger value is rejected, not capped. Page
  deterministically, and use `LONGTEXT()` for long text.
- **Picklist values stay technical; visible text uses the item's metadata label.** Keep names such
  as `usd_p` in writes, query predicates, comparisons and option values. Options, cells, badges and
  read-only text show the item's `label` from the field's picklist metadata (`option.value =
  item.name; option.textContent = item.label`). Read it from `POST /describe/picklist_p`; there
  is no `/metadata/<ctype>` route, and its 404 leaves every label unresolved. Never derive a label by stripping `_p`/`_c`,
  replacing underscores or changing case, and never keep a parallel label table. Keep labels for
  retired items still on records; if a label cannot be resolved, show the value and say the label
  is unavailable rather than guessing.
- **Currency formatting is its own boundary.** `ccode_p.currency_code_p` returns a picklist name
  (`usd_p`), which `Intl.NumberFormat` rejects. The platform's `currency_code_p` labels are ISO
  codes (`usd_p` → `USD`): resolve that label and validate it for the formatter. Never rewrite the
  stored value or silently format an unresolved currency as USD.

## 3. Style it to the design system

**Read [ui-design-tokens.md](ui-design-tokens.md) before creating or restyling any page or layout
section.** It holds the required control choices, the token rules (names, build check, hooks,
exemptions, older SDKs), typography, and the rendered-UI checks. To choose a control's
`--ap-comp-*` family, use [ui-component-tokens.md](ui-component-tokens.md).

**A select, a lookup or a date field: build it from [controls.md](controls.md)** — the platform's
anatomy for each, part by part, with the token for every part and the keyboard it answers to —
and copy [aspen-icons.ts](aspen-icons.ts) into `typescript/src/` for its chevron, check, clear,
search, calendar and month arrows. Never a native `<select>`, `<datalist>` or date/time `<input>`
(the browser draws their menus and calendars), and never a text glyph or emoji for an icon.

A hook enforces the token rules as you write: it denies a hardcoded colour, spacing, radius,
border width, type value or shadow where a token exists, an `--ap-*` name the installed SDK does
not define (only when it ships a token snapshot; 0.1.0 does not), a table, button, select or
textarea styled from the semantic layer alone, and a native
`<select>`, `<datalist>` or date/time `<input>`. Each has a documented escape hatch
(`aspen-token-exempt:` / `aspen-component-exempt:` with a reason).

## 4. Build and check

```sh
aspen compile --typescript                                   # runs the project's x-cli build code (esbuild; no type check)
node <this skill>/scripts/lint-ui-tokens.mjs typescript/src   # the hook's checks over the whole tree, incl. JS and inline styles
```

With SDK and x-cli 0.2.0, the build also fails a stylesheet naming an `--ap-*` token the snapshot
does not define (see [Build check](ui-design-tokens.md#build-check)); the 0.1.0 pair checks no
token names. Type errors show only in the editor or `tsc`. The lint script
exits 1 on any finding; wire it into CI so pages written outside this plugin are held to the same
rules. Then deploy through `build-and-deploy`.

## 5. Verify the rendered UI

- **The codefile's record id rotates every check-in, and the serving URL embeds it under a
  one-year immutable cache.** An old URL serves the old bundle forever, which looks exactly like a
  deploy that did nothing. Reload the browser before concluding the page did not ship.
- **Build and token checks are not visual verification.** Follow
  [ui-design-tokens.md](ui-design-tokens.md#verify-the-rendered-ui), and report build/token
  checks, visual comparison and interaction checks separately.

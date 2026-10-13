---
name: custom-ui
description: Use when writing or restyling a TypeScript page or layout section in an Aspen instance directory's typescript/ — a definePage or defineLayoutSection, a route or section in aspen.client.json, or any control, table, form, panel or style in one. Run model-first before the first file.
---

# Custom UI in `typescript/`

A page or layout section is the last tier, built over fields the model already holds;
`model-first` decides whether one should exist. A hook asks the first time a write declares a new
surface (a route, a layout section, a `custom_page` tab).

## Before the first file: check the SDK

`aspen init` 26.4.1 pins npm's `@aspen-crm/sdk` and `@aspen-crm/x-cli` 0.1.0, and a 26.4.1
instance refuses to render a page built on them ("SDK is no longer supported"). The platform loads
the SDK from the CDN at runtime, but the release it loads is the one x-cli records from the
installed package, and npm's 0.1.0 records the previous release, whose SDK has no token stylesheet.
The 26.4.1 packages (0.2.0) are on the instance environment's static-assets CDN. If
`typescript/node_modules/@aspen-crm/sdk/dist/manifest.json` has no `tokenStyleSheetFilePath`, pin
them, then tell the human you did:

1. `<cdn>` is the `cdn:` line of `aspenup show`. `curl -s <cdn>/sdk/platform/26.4.1/latest` names
   the current build as `pversion_bugfix` (e.g. `26.4.1.20`); any 26.4.1 build records `26.4.1`.
2. In `typescript/package.json`:
   ```json
   "dependencies":    { "@aspen-crm/sdk":   "<cdn>/npm/platform/sdk/26.4.1/<pversion_bugfix>/aspen-crm-sdk-0.2.0.tgz" },
   "devDependencies": { "@aspen-crm/x-cli": "<cdn>/npm/platform/x-cli/26.4.1/<pversion_bugfix>/aspen-crm-x-cli-0.2.0.tgz" }
   ```
3. `cd typescript && npm install` (it rewrites `package-lock.json`; suggest committing both), and
   check the manifest now has `tokenStyleSheetFilePath`.

`aspen doctor` then reports `typescript.sdk-pins` as a `problem`, because it reads any URL as a
range. That is expected; its fix would restore 0.1.0, so don't apply it. Token names, the typed
token modules and the build's token check below all need the 0.2.0 pair.

## 1. Where it goes

- An entry module under `typescript/src/` exports `definePage(({ element }) => …)` or
  `defineLayoutSection(({ element, … }) => …)` from `@aspen-crm/sdk`, returning `{ unmount }`. The
  SDK hands you one bare `element`: plain DOM, or a framework root you mount
  (`createRoot(element)`). The instance directory's `AGENTS.md` has the layout.
- Declare it in `typescript/aspen.client.json`: a page under `routing.routes` (`path`, `module`,
  `export`, and a `name` if a tab will open it); a layout section under `layout.sections` (`name`,
  `allowed-objects`, `allowed-modes` — at least one of `create`, `edit`, `view`, or the build
  rejects it — `module`, `export`). Keep the scaffolded `/` route: x-cli fails a configuration with
  no route.
- Styles go in a stylesheet the entry imports (`import './plan.css'`); x-cli bundles it and the
  platform links it inside the page's shadow root. x-cli's tsconfig sets
  `noUncheckedSideEffectImports` and x-cli 0.1.0 ships no CSS declaration, so add
  `typescript/src/css.d.ts` holding `declare module '*.css';`. The build bundles with esbuild and
  does not type-check.
- A `custom_page` tab names its page `ui_main_c.<route name>` (`metadata`'s `metadata-shapes.md`).
  A custom (`_c`) codefile serves at `/ui/c/<base-url-path-part>/<route path>`; `/ui/a/` is app
  scope, not yours.

## 2. What the page can reach

- Its JavaScript runs in a hidden guest iframe (its own `window`, not a security boundary) and
  renders into a shadow root on the platform document.
- Navigate with `@aspen-crm/sdk/navigation`: `navigation.createHref(descriptor)` for an `href`,
  and on click `if (shouldInterceptLinkClick(event)) { event.preventDefault();
  navigation.navigate(descriptor) }`, so a modified or middle click still opens a new tab. Never
  hand-build platform URLs. `navigate` to `/objects/:objectName/:recordId` needs
  `config.tabName`, or the platform errors "No active tab found".
- Records come from the instance's query endpoints through `@aspen-crm/sdk/request`, under the AQL
  rules in `server-code`'s `query-notes.md`: every query needs a `LIMIT`; a JSON query takes
  `LIMIT` ≤ 1000 and `OFFSET` ≤ 10000 (larger is rejected, not capped). Page deterministically,
  and use `LONGTEXT()` for long text.
- **Picklist values stay technical; visible text is the item's metadata label.** Keep names such
  as `usd_p` in writes, predicates, comparisons and option values; options, cells, badges and
  read-only text show the item's `label` (`option.value = item.name; option.textContent =
  item.label`), read from `POST /describe/picklist_p` (there is no `/metadata/<ctype>` route).
  Never derive a label from the name or keep a parallel label table. Keep labels for retired items
  still on records; if one can't be resolved, show the value and say the label is unavailable.
- **Currency:** `ccode_p.currency_code_p` returns a picklist name (`usd_p`), which
  `Intl.NumberFormat` rejects. Its label is the ISO code (`usd_p` → `USD`): resolve and validate
  that for the formatter. Never rewrite the stored value or silently format an unresolved currency
  as USD.

## 3. Style it to the design system

**Read [ui-design-tokens.md](ui-design-tokens.md) before creating or restyling a page or layout
section**: the required control choices, the token rules, typography and the rendered-UI checks.
[ui-component-tokens.md](ui-component-tokens.md) picks a control's `--ap-comp-*` family.

A select, lookup or date field follows [controls.md](controls.md) — what the tokens don't give:
which state shows which signal, how popovers position and close, and the keyboard — with the icons
in [aspen-icons.ts](aspen-icons.ts) copied into `typescript/src/`. Never a native `<select>`, `<datalist>` or date/time `<input>`, and never a
text glyph or emoji for an icon.

A hook checks every write in `typescript/` against these rules. Its denial names the rule and the
escape hatch (`aspen-token-exempt:` / `aspen-component-exempt:` with a reason); follow it.

## 4. Build and check

```sh
aspen compile --typescript                                   # the project's x-cli build (esbuild; no type check)
node <this skill>/scripts/lint-ui-tokens.mjs typescript/src   # the hook's checks over the whole tree, incl. JS and inline styles
```

With SDK and x-cli 0.2.0 the build also fails a stylesheet naming an `--ap-*` token the snapshot
doesn't define ([Build check](ui-design-tokens.md#build-check)). Type errors show only in the
editor or `tsc`. The lint script exits 1 on any finding; suggest wiring it into CI. Then deploy
with `build-and-deploy`.

## 5. Verify the rendered UI

- The codefile's record id rotates every check-in, and the serving URL embeds it under a one-year
  immutable cache: an old URL serves the old bundle forever. Reload before concluding the page
  didn't ship.
- Build and token checks are not visual verification. Follow
  [ui-design-tokens.md](ui-design-tokens.md#verify-the-rendered-ui), and report build/token checks,
  visual comparison and interaction checks separately.

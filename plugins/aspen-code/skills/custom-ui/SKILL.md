---
name: custom-ui
description: Use when writing or restyling a TypeScript page or layout section in an Aspen instance directory's typescript/ — a definePage or defineLayoutSection, a route or section in aspen.client.json, or any control, table, form, panel or style in one. Covers where the code goes, how it reaches records and navigation, the design-token and component rules a page must meet, the build and lint checks, and how to verify the rendered UI. Run model-first before the first file; the page is the last tier.
---

# Custom UI in `typescript/`

A page or layout section is the **last** tier: `model-first` decides whether one should exist,
over fields the model already holds. This skill is how to build it once it should. A hook asks
the first time a write declares a new surface (a route, a layout section, a `custom_page` tab);
that is the backstop, not the decision.

## 1. Where it goes

- An entry module under `typescript/src/` exports `definePage(({ element }) => …)` or
  `defineLayoutSection(({ element, … }) => …)` from `@aspen-crm/sdk`, returning `{ unmount }`. The
  SDK hands you one bare `element`: plain DOM, or a framework root you mount yourself
  (`createRoot(element)`). Follow the instance directory's `AGENTS.md` for layout.
- Declare it in `typescript/aspen.client.json`: a page under `routing.routes` (`path`, `module`,
  `export`, and a `name` if a tab will open it), a layout section under `layout.sections` (`name`,
  `allowed-objects`, `module`, `export`).
- A `custom_page` tab names its page `ui_main_c.<route name>` — see `metadata`'s
  `metadata-shapes.md`. A custom (`_c`) codefile serves at
  `/ui/c/<base-url-path-part>/<route path>`; `/ui/a/` is app scope, not yours.

## 2. What the page can reach

- It runs in a **sandboxed guest iframe**, rendering into a shadow root on the platform document.
  Build URLs and navigate through `window.top`, and intercept your own link clicks
  (`preventDefault` + `stopPropagation`): the guest runtime mis-resolves even an absolute `href`
  against the guest route.
- `@aspen-crm/sdk/navigation`'s `navigate` to `/objects/:objectName/:recordId` needs
  `config.tabName`, or the platform errors "No active tab found".
- Records come from the instance's query endpoints through `@aspen-crm/sdk/request`. The AQL rules
  are in `server-code`'s `query-notes.md`: 100 rows per query, deterministic paging, `LONGTEXT()`
  for long text.
- **Picklist values stay technical; visible text uses the item's metadata label.** Keep names such
  as `usd_p` in writes, query predicates, comparisons and option values. Options, cells, badges and
  read-only text show the item's `label` from the field's picklist metadata (`option.value =
  item.name; option.textContent = item.label`). Never derive a label by stripping `_p`/`_c`,
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

A hook enforces the token rules as you write: it denies a hardcoded colour, spacing, radius,
border width, type value or shadow where a token exists, an `--ap-*` name the installed SDK does
not define, and a table, button, select or textarea styled from the semantic layer alone. Each has
a documented escape hatch (`aspen-token-exempt:` / `aspen-component-exempt:` with a reason).

## 4. Build and check

```sh
aspen compile --typescript                                   # runs the project's x-cli build code
node <this skill>/scripts/lint-ui-tokens.mjs typescript/src   # the hook's checks over the whole tree, incl. JS and inline styles
```

With an SDK that ships a token snapshot, the build also fails a stylesheet naming an `--ap-*` token
the snapshot does not define (see [Build check](ui-design-tokens.md#build-check)). The lint script
exits 1 on any finding; wire it into CI so pages written outside this plugin are held to the same
rules. Then deploy through `build-and-deploy`.

## 5. Verify the rendered UI

- **The codefile's record id rotates every check-in, and the serving URL embeds it under a
  one-year immutable cache.** An old URL serves the old bundle forever, which looks exactly like a
  deploy that did nothing. Reload the browser before concluding the page did not ship.
- **Build and token checks are not visual verification.** Follow
  [ui-design-tokens.md](ui-design-tokens.md#verify-the-rendered-ui), and report build/token
  checks, visual comparison and interaction checks separately.

# Custom UI: design tokens and components

Read the requirements below whenever creating or restyling a TypeScript page or layout section — a
`definePage`/`defineLayoutSection` in the instance directory's `typescript/`. The loop around it
(author, `aspen compile --typescript`, deploy, verify) is in this skill's `SKILL.md`.

## Required component decisions

Token usage alone is not component correctness. Match the native control's structure, type
scale, spacing, states and interaction. These requirements apply to edits as well as new pages.

Before markup, inspect the project's shared controls and identify each needed Aspen counterpart.
For a select, lookup or date control, build it from [controls.md](controls.md), with the icons in
[aspen-icons.ts](aspen-icons.ts); a hook denies the native `<select>`, `<datalist>` and date or time
`<input>` that would stand in for one.
For a new or changed control, inspect a native example in the running instance when available,
including its open/edit state. Then pick its token family from `ui-component-tokens.md` and read that family's `.d.ts`.
Keep a short implementation note of the counterpart and shared helper chosen; no new approval
step or user-facing design document is required.

| Meaning | Required control and token families |
| --- | --- |
| Record reference, including an account/engagement/product selector | Lookup/typeahead (`--ap-comp-typeahead-*`), preserving record id separately from display text. Search, select, show the selected record, and clear when optional. An ordinary `<select>`, a `<datalist>` or a free-text id input is not a lookup. Anatomy: [controls.md](controls.md#lookup--a-record-reference). |
| Picklist or fixed choice | Select (`--ap-comp-select-*`, options `--ap-comp-menubase-*`), including the opened menu, selected/hover/focus states and keyboard operation. Picklist option text comes from metadata labels; values remain technical names. **Never a native `<select>`**: its menu is drawn by the browser and no stylesheet reaches it. Anatomy: [controls.md](controls.md#select--a-picklist-or-fixed-choice). |
| Date | Date picker (`--ap-comp-datepicker-*`, popover `--ap-comp-datemenu-*`, grid `--ap-comp-calendar-*` and `--ap-comp-datecell-*`): segmented `mm / dd / yyyy` entry plus a calendar trigger. **Never `<input type="date">`**: the browser draws its calendar. Anatomy: [controls.md](controls.md#date--a-date-field). |
| Date range, date and time, time | `--ap-comp-daterange-*`, `--ap-comp-datetimepicker-*`, `--ap-comp-timepicker-*`, built the same way. Never `<input type="datetime-local" \| "time" \| "month" \| "week">`. |
| Text / numeric value                                               | `--ap-comp-textinput-*` / `--ap-comp-numberinput-*`, respectively, including labels and error states. Numeric fields retain numeric input semantics. Do not apply select styles to these fields.                                                                              |
| Record navigation                                                  | Link (`--ap-comp-link-*`) plus the verified SDK/instance navigation helper. Preserve instance and tab context; exercise the destination.                                                                                                                                      |
| Table with actions above it                                        | Table/cell tokens plus `--ap-comp-cardheader-*` for a card header. Button padding does not provide the header's outer spacing.                                                                                                                                                |
| Side panel / modal                                                 | Match the chosen surface's header, body and footer using its component tokens. Use the user's requested interaction; do not substitute a modal for a requested side panel.                                                                                                    |

Reuse or correct one shared implementation for each repeated control in the project. Put
record navigation and field styling there instead of making page-specific copies. A shared
helper is not automatically correct: validate it against the native example before reusing it.
The SDK availability rules below determine whether that implementation imports a supported
platform component or uses local markup. Do not invent imports or reach into platform internals.

## Typography and composition requirements

- Set the subtree's box sizing and public body font family explicitly. Browser controls do not
  reliably inherit the surrounding typography; apply each control's typography to the actual
  input/button/menu text as well as its wrapper. Use component typography tokens with `font`,
  not `font-size`, and check later shorthand or global rules do not reset the family or size.
- Keep label, value, table-cell and heading typography distinct. Do not flatten them with a
  blanket `font: inherit` or one font-size override. Check the computed family, size, weight and
  line height against native controls; a token appearing in source is not evidence it took effect.
- Preserve the component's field height, inner padding and surrounding spacing. In particular,
  a card header uses `--ap-comp-cardheader-padding` on all sides; zeroing its bottom padding makes
  action buttons touch the table. If a compact variant is needed, verify that variant instead
  of inventing smaller type or spacing to make the form fit.
- Follow the native surface's action placement and any explicit user preference. For a table
  card, keep its title and actions in one header, with the action group on the right. Keep help
  text only where it resolves a user decision or constraint; omit implementation explanations
  and repeated descriptions of what a label already says.
- User-requested deviations take precedence. Record deliberate differences narrowly; an
  exemption comment or successful lint run does not establish visual parity.

## Verify the rendered UI

After deploying and reloading, compare the changed UI with native Aspen controls in the same
instance, theme and viewport. Use browser screenshots plus computed-style measurements where
available. Verify the following for the affected controls, not every unrelated page:

- Typography, field heights, label gaps, table cells and action-header outer spacing match.
  Inspect a rendered control, not just its parent container.
- Open picklists and lookup results. Exercise keyboard selection, focus, dismissal, optional
  clearing, and relevant loading/empty/error states. A screenshot of a closed menu is insufficient.
- Follow changed record links and check panel open/close, focus entry and return. Use authorized
  fixtures for write interactions; visual verification does not authorize new customer data.
- Check changed styling in light and dark themes and at a narrow viewport. When a shared helper
  or stylesheet changes, inspect each affected surface type, including pages and record sections.

Report build/token checks, visual comparison and interaction checks separately. If browser
access or a native reference is unavailable, complete what can be checked and name the remaining
gap. Do not report "matches Aspen" based on token lint, a successful deploy, or backend tests.

## What a page gets, and what it doesn't

- `definePage`/`defineLayoutSection` (from `@aspen-crm/sdk`) hand you one bare `element` and take
  back `{ unmount }`. Plain DOM, or a framework root you mount yourself — the SDK's own docstring
  shows `createRoot(element)`. The public export surface is those two functions,
  `@aspen-crm/sdk/navigation`, `@aspen-crm/sdk/request`, and (on SDK versions `>=0.2.0`) — the typed
  token modules `@aspen-crm/sdk/tokens/*` (see
  [Typed token modules](#typed-token-modules)). Check `exports` in the installed SDK's
  `package.json` rather than assuming.
  - If the project is on a version of the SDK prior to 0.2.0, it will need to be upgraded in order to
    function on the latest release of Aspen. Inform the user to update their CLI and SDK versions.
- **Those inspected SDK versions expose no component library to import.** Component token
  families (`--ap-comp-button-*`, etc.) are token namespaces, not component modules. Check the installed SDK's public
  exports once when starting UI work, and again after an SDK upgrade. Prefer supported platform
  components when available. Otherwise use shared local controls that satisfy the requirements
  above; default styling from a third-party library is not Aspen styling. Describe local controls
  accurately as local implementations, not native platform components.
- **The installed SDK defines which token names exist.** Each `@aspen-crm/sdk` version ships a
  snapshot of its Public tokens (`dist/tokens.css`, named by `tokenStyleSheetFilePath` in
  `dist/manifest.json`) and typed modules generated from it (`dist/tokens/sem/*.d.ts`,
  `dist/tokens/comp/*.d.ts`). The platform renders the page with that snapshot, so a name is real
  when the installed SDK defines it — not when this file lists it. The build enforces this for
  stylesheets; see [Build check](#build-check).
- **Eleven per-role font-family tokens exist and are internal**: `--ap-sem-font-family-body-bold`,
  `-body-large`, `-body-small`, `-caption`, `-display`, `-footnote`, `-heading-1`, `-heading-2`,
  `-heading-3`, `-heading-4`, `-label`. They resolve, and component typography tokens alias them,
  but never reference them directly. `--ap-sem-font-family-body` is the one public
  family token, and it covers every role.
- **There is no monospace token.** The system publishes one family and it is Geist. A code block
  or an id column takes its own `ui-monospace, SFMono-Regular, Menlo, monospace` stack; that is
  the one font-family hardcode the guard does not flag.
- A customer page that hardcodes `#d7dee2` borders and `system-ui` fonts is the pattern this
  replaces, not one to copy — it renders wrong in dark mode and doesn't tighten on a phone.

The sections below say how to use the tokens and how to choose one. The names themselves are in the
installed SDK.

---

## How to use these tokens

Aspen exposes its design system to your custom UI as **CSS custom properties** (CSS variables).
You reference them with `var(...)` in your own stylesheets.

```css
.my-card {
  background-color: var(--ap-sem-color-surface-raised);
  color: var(--ap-sem-color-text-primary);
  border: var(--ap-sem-border-width-default) solid
    var(--ap-sem-color-border-default);
  border-radius: var(--ap-sem-radius-md);
  padding: var(--ap-sem-spacing-inner-md);
  box-shadow: var(--ap-sem-elevation-low);
}

.my-card__title {
  font-size: var(--ap-sem-font-size-heading-3);
  line-height: var(--ap-sem-line-height-heading-3);
  font-weight: var(--ap-sem-font-weight-heading-3);
  font-family: var(--ap-sem-font-family-body);
}
```

Rules that matter:

- **The SDK supplies them.** The page's installed `@aspen-crm/sdk` version carries the token
  snapshot, and the platform injects it into the shadow root the page renders in. CSS references
  them with `var(...)` and imports nothing; JS imports the typed modules below. Upgrading the SDK
  is what picks up new or changed tokens.
- **Never hardcode a hex color, size, or shadow.** Use the token. This is enforced: a hardcode on a property the system publishes
  a token for — color, spacing, radius, border width, the type scale, elevation — is denied by a
  hook when you write it, and by `scripts/lint-ui-tokens.mjs` beside this file (run it in CI). What the system publishes no
  token for is **not** covered and needs no ceremony: page dimensions (`width`, `height`,
  `min-width`), grid tracks, `background-size`, positional offsets, and any `calc()` composed off
  a variable. For the rare governed value that still has no right token, keep it and write
  `aspen-token-exempt: <reason>` in a comment on that line or the line above.
- **Light/dark is automatic.** Every color token carries a light and a dark value; the right one
  applies based on the user's theme. Use the token and both themes look correct for free.
- **Spacing and typography are responsive.** Several spacing and type tokens shrink automatically
  at tablet (viewport < 1024px) and phone (< 768px) widths. Use the token instead of a fixed px
  value and your layout tightens up on small screens on its own.
- **Only `var(--ap-*)` reaches your code.** Aspen's own utility classes (for example a Tailwind
  `p-4`) and its component CSS classes are NOT available inside your custom UI. Style your own
  markup with these tokens.
  - Why the tokens get through when the classes do not: custom UI renders in a **shadow root on
    the platform document**, and the platform injects the SDK's token snapshot into it, while its
    own stylesheets stay outside the tree. (Only the JavaScript is iframe-isolated.)
    Your code is isolated from the platform's own CSS and variables (**including resets**), so the
    guest starts at `box-sizing: content-box`; see
    [Typography and composition requirements](#typography-and-composition-requirements).
- **Names are validated at build time; see [Build check](#build-check).** So do not write the
  light value as a fallback (`var(--ap-sem-color-text-primary, #11171d)`) in new code: it only
  ever guarded against typos the build could not see, and it now sees them in CSS, while JS uses
  the typed modules. Existing fallbacks are harmless and need not be removed.
- **Older SDK without a snapshot?** If `node_modules/@aspen-crm/sdk/dist/manifest.json` has no
  `tokenStyleSheetFilePath`, none of the validation below applies: the page inherits the host's
  current tokens, a misspelled name silently does nothing, and there are no token modules or
  `.d.ts` files to read names from. For a select, lookup, date field or button, copy the names in
  [controls.md](controls.md) — each one is checked against the platform's own token list. For
  anything else, read names off a native element in the running instance
  (computed styles in browser devtools), copy them exactly, and keep the light-value fallback. A newer `x-cli` fails the
  build against such an SDK; tell the human the SDK needs upgrading rather than upgrading it
  yourself. (`typescript/package.json` pins `@aspen-crm/sdk` and `@aspen-crm/x-cli` to the
  release the instance serves; the instance directory's `AGENTS.md` says to raise them together.)
- **Rebuilding an Aspen component? Take its tokens. Building something new? Compose from the
  semantic layer.** The semantic tokens are the design vocabulary and cover most of a page, so
  they are the right default for anything Aspen does not already publish — a magnitude bar in a
  cell, a Gantt strip, a chart legend.
  - But a `<table>` in a record section renders inches from Aspen's own list views, and there
    "close enough" reads as a bug, not a style. `--ap-comp-cell-content-padding-x/y`,
    `--ap-comp-cell-border-bottom-color`, `--ap-comp-cell-bg-hover` and the 65
    `--ap-comp-table-*` names already hold those values. Re-deriving them from
    `--ap-sem-spacing-inner-*` and `--ap-sem-color-border-subtle` lands near them and not on
    them, and nothing fails to tell you.
  - This is not the pixel-perfect edge case it was once described as. Whenever you are rebuilding
    something the platform ships, matching it exactly IS the requirement, and the component's
    tokens are the short way there — fewer decisions, not more.
  - A guard denies a stylesheet that styles a `table`, `button`, `select` or `textarea` from the
    semantic layer alone. Mixing is expected and fine: paint the cells from the cell tokens, then
    accent one header with `--ap-sem-color-brand-primary` if that is what the design wants. If
    you are deliberately not building that component — a layout table, a control that has to look
    different — put `aspen-component-exempt: <reason>` in a comment anywhere in the file.

### Build check

`aspen compile --typescript` runs the project's own `x-cli build code` (as `npm run build` in
`typescript/` does). It checks every stylesheet the page imports against the installed SDK's
snapshot, and fails naming the file and line when a stylesheet:

- references or declares a `--ap-sem-*` or `--ap-comp-*` name the snapshot does not define. The
  error suggests the closest defined name — use it.
- uses any other `--ap-*` name. The `--ap-` prefix is reserved for Aspen; name your own custom
  properties without it.

It also fails when `@aspen-crm/sdk` is not installed, or when the installed version has no token
snapshot.

It does **not** check:

- your own custom properties (anything outside `--ap-`, such as `--ps-row-h`);
- stylesheets under `node_modules`;
- token references in JavaScript or inline styles — use the typed modules for those.

The hook and `scripts/lint-ui-tokens.mjs` check names against the same installed snapshot,
including in JS and inline styles, and stand down when there is no SDK with a snapshot to read.

### Typed token modules

`@aspen-crm/sdk/tokens/sem` and `@aspen-crm/sdk/tokens/comp` export one namespace per token group.
Each token is the `var(...)` string for its custom property, typed as that literal, so a name the
SDK does not define — or one a later SDK renames or removes — is a TypeScript error.

```tsx
import * as sem from "@aspen-crm/sdk/tokens/sem";
import * as button from "@aspen-crm/sdk/tokens/comp/button";

el.style.color = sem.color.textPrimary; // 'var(--ap-sem-color-text-primary)'
<div style={{ gap: button.gap, borderRadius: button.radius }} />;
```

- **Key rule:** drop `--ap-`, the layer and the group; camel-case the rest.
  `--ap-sem-color-brand-primary` is `sem.color.brandPrimary`; `--ap-comp-cell-bg-hover` is
  `comp.cell.bgHover`. Hovering a token in the editor shows its custom property and its values per
  theme and breakpoint.
- **Prefer group imports** (`@aspen-crm/sdk/tokens/sem/color`, `/tokens/comp/button`). The token
  modules are bundled into the page, and a layer import keeps every token of each group it
  touches; a group import keeps only the tokens used.
- In a stylesheet, keep writing `var(--ap-…)`; the build check covers it.

---

## Semantic tokens (`--ap-sem-*`)

Names and values are in the installed SDK, one file per group:

```sh
ls  typescript/node_modules/@aspen-crm/sdk/dist/tokens/sem/
cat typescript/node_modules/@aspen-crm/sdk/dist/tokens/sem/color.d.ts
```

Each token's JSDoc gives its custom property and its value per theme and breakpoint. The groups
are the first word after `--ap-sem-`, so a two-word family is split across a group and its keys:

| File             | Holds                                                                                 | Import key example    |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------- |
| `color.d.ts`     | text, background, surface, border, icon, brand, interactive, link and feedback colors | `color.textPrimary`   |
| `font.d.ts`      | `font-family`, `font-size` and `font-weight` per text role                            | `font.sizeBody`       |
| `line.d.ts`      | `line-height` per text role                                                           | `line.heightBody`     |
| `spacing.d.ts`   | inner, layout, gutter and page-margin spacing                                         | `spacing.innerMd`     |
| `radius.d.ts`    | corner radius scale                                                                   | `radius.md`           |
| `border.d.ts`    | border widths                                                                         | `border.widthDefault` |
| `icon.d.ts`      | icon sizes                                                                            | `icon.sizeSm`         |
| `elevation.d.ts` | `box-shadow` levels and the focus ring                                                | `elevation.low`       |

Choosing within a group — what the names alone do not tell you:

- **Color: pick by role, not by the color it happens to be.** `background-*` is the page canvas;
  `surface-*` is what a card or panel sits on; `text-*`, `border-*` and `icon-*` each have their own
  scale. `danger` (text/border/icon/interactive) is intent — a destructive action about to happen.
  `feedback-error` is outcome — something already went wrong. Each feedback state (error, info,
  success, warning) has a main color, a `-subtle` background, and a `-text` color for text on it.
- **Typography: set size, line height and weight of the same role together** (`font-size-label`,
  `line-height-label`, `font-weight-label`). Roles run display, heading-1…4, body-large, body,
  body-bold, body-small, label, caption, footnote. Display and headings shrink on phones.
  `--ap-sem-font-family-body` is the one family token and covers every role; see the internal
  per-role families above.
- **Spacing: `inner-*` for padding and gaps inside a component, `layout-*` between larger blocks.**
  Both tighten at tablet (< 1024px) and phone (< 768px) widths.
- **Elevation: `low` for resting cards, `medium` for raised surfaces and dropdowns, `high` for
  popovers and menus, `overlay` for modals; `focus` is the focus ring, on `:focus-visible`.**
  Shadows are heavier in dark mode on their own.

---

## Component tokens (`--ap-comp-*`)

Every Aspen component publishes its own tokens, each aliasing a semantic token, so a component
token follows the same theme and responsive steps as the semantic token behind it. When to use
them over `--ap-sem-*`: the "Rebuilding an Aspen component?" rule under
[How to use these tokens](#how-to-use-these-tokens). Which family fits which control, the naming
pattern, and where the names are: [ui-component-tokens.md](ui-component-tokens.md).

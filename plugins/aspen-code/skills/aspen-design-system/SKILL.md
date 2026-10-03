---
name: aspen-design-system
description: Use when building or styling custom UI in an Aspen instance directory's typescript/ — any page, layout section, button, form control, dropdown, date field, dialog, card or list. Makes custom UI look and behave like the platform's own, and covers the shadow-root and cross-realm traps that make correct-looking code silently do nothing.
---

# Building custom UI on the Aspen design system

Everything here was measured on a running instance. Where a claim could not be verified it
says so. Nothing below requires access to the `x-platform` repository.

Read this **before** writing a line of UI. The failures it describes do not produce errors:
they produce a page that renders, passes its tests, type-checks, deploys — and is wrong.

## The two facts that explain almost everything

**1. There are no platform components to import.** The design system ships to custom UI as
**CSS only**. Verified exhaustively:

| Possible source | Reality |
|---|---|
| `@aspen-crm/sdk` exports | `definePage`, `defineLayoutSection`, `navigation`, `request`, types — no UI |
| `@aspen-crm/*` packages | only `sdk` and `x-cli` |
| Web components | none registered; no custom elements in the DOM |
| Guest runtime (`__xGuestRuntime`) | `location`, `navigation`, `request`, `type` — no UI |

The platform's own 76 exports (Button, Combobox, DateField, SegmentedButtons, Checkbox,
SidePanel, Table…) live in a private workspace package that is never published. You can match
their **appearance** exactly, but every **behaviour** — open/close, arrow keys, typeahead,
focus return, date arithmetic — is yours to write.

**[`components.md`](components.md) beside this file accounts for all 76**, with each one's root
classes and every variant, taken verbatim from the design system's source. Look the component up
there before writing any CSS: copying its class string is both faster and more accurate than
reproducing it from tokens.

**2. Custom UI runs inside an open shadow root, in a different JavaScript realm.** The host
page's stylesheet does not cross into it, and anything realm-sensitive misbehaves silently.

## Cross-realm: seven ways this bites

All seven were hit on one project. Every one passed unit tests and type-checking first.

| What looks right | What actually happens | Do this instead |
|---|---|---|
| `root instanceof ShadowRoot` | **false** across realms, for a real shadow root | duck-type: `'adoptedStyleSheets' in root` |
| `trigger instanceof HTMLElement` | **false** for a real element | duck-type: `typeof el?.focus === 'function'` |
| `document.styleSheets` | the **guest frame's** — it is empty | `element.ownerDocument.styleSheets` |
| `document.addEventListener('keydown')` | guest document never sees the page's events | `element.ownerDocument.addEventListener` |
| `document.activeElement` | wrong realm, and blind to shadow content | `node.getRootNode().activeElement` |
| `new CSSStyleSheet()` then adopt | `NotAllowedError: Sharing constructed stylesheets…` | `ownerDocument.defaultView.CSSStyleSheet` |
| React rendering `<style>{css}</style>` | element exists, **`.sheet` is null**, no rule applies | adopt a constructed sheet (below) |

**Rule of thumb:** inside custom UI, never touch the bare globals `document` or `window`, and
never use `instanceof` on anything from the DOM. Reach the real document through an element
you already hold.

### Event retargeting, the eighth trap

A listener on the host document sees `event.target` **retargeted to the shadow host**, never
the element inside. So an outside-click handler using `contains(event.target)` thinks every
click is outside, closes the popover on `mousedown`, and the option's `click` never fires —
mouse selection becomes impossible while keyboard still works.

```ts
const onPointerDown = (event: MouseEvent) => {
    const path = event.composedPath();          // sees through the shadow boundary
    if (trigger && path.includes(trigger)) return;
    if (popover && path.includes(popover)) return;
    close();
};
```

### `position: fixed` is not fixed to the viewport

It resolves against the nearest ancestor with a `transform`, `filter` or `will-change`, and
the platform's layout has such ancestors above the shadow host. Anything overlay-like mounted
inside the shadow tree is positioned against that ancestor and clipped by its overflow.

For a full-screen overlay, create the element on the **host document** and append it to
`document.body`, with **all styles inline** — the adopted stylesheet does not reach outside
the shadow root.

## Step 1: adopt the platform stylesheet

Without this, every platform class on your markup renders unstyled, with no error. Verified:
`p-inner-sm` computes to `0px` inside the shadow root and `12px` in the light DOM.

```ts
/** Make the platform's own utility classes work inside our shadow root. */
export function adoptPlatformStyles(element: HTMLElement): boolean {
    try {
        const root = element.getRootNode() as ShadowRoot;
        if (!root || !('adoptedStyleSheets' in root)) return false;   // duck-type, not instanceof

        const doc = element.ownerDocument;                            // NOT the global `document`
        const css = Array.from(doc.styleSheets)
            .flatMap((sheet) => {
                try { return Array.from(sheet.cssRules); } catch { return []; }  // cross-origin throws
            })
            .map((rule) => rule.cssText)
            .join('\n');

        if (!css.includes('bg-interactive')) return false;   // find it by CONTENT, never filename

        const Sheet = doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet;   // owning realm's ctor
        const sheet = new Sheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return true;
    } catch {
        return false;      // styling degrades; the page must still render
    }
}
```

Call it from the entry point before rendering:

```tsx
export const myPage = definePage(({ element }) => {
    adoptPlatformStyles(element);
    const root = createRoot(element);
    root.render(<MyPage />);
    return { unmount: () => root.unmount() };
});
```

Two details that are load-bearing:

- **Find the sheet by content** (`bg-interactive`), never by filename — the bundle is
  content-hashed (`index-<hash>.css`) and the hash changes every release.
- **Wrap it in try/catch.** A failure should degrade styling, not blank the page.

It costs no network request: the sheet (~300KB) is already parsed by the host.

## Step 2: set the root font

Tailwind's preflight puts the page font on `html`. A shadow root has no `html`, so nothing
inherits a font and every surface falls back to the user agent default — Times. `font-sans`
does not help: the platform's build does not generate that utility (verified — it computes to
Times). The **token** does cross the boundary, so set it once on your root:

```ts
export const rootStyle: CSSProperties = {
    fontFamily: 'var(--ap-sem-font-family-body)',
};
```

Anything portalled **outside** your root (a popover, a dialog) is a *sibling*, not a
descendant, and inherits nothing — give it `rootStyle` too, or it renders in Times while the
rest of the page is correct.

## Step 3: build from the platform's own classes

The design system is Tailwind with a semantic Aspen theme. These recipes were copied verbatim
from the platform's rendered components — prefer them over inventing combinations.

### Primary button

```
group/button inline-flex h-12 shrink-0 items-center justify-center gap-inner-xs rounded-md
border text-body-bold whitespace-nowrap no-underline transition-colors select-none
[&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:focus-ring min-w-25
border-transparent bg-interactive px-inner-md text-on-interactive hover:bg-interactive-hover
data-disabled:bg-surface-disabled data-disabled:text-disabled-on-color
```

### Secondary button

```
group/button inline-flex h-12 shrink-0 items-center justify-center gap-inner-xs rounded-md
border text-body-bold whitespace-nowrap no-underline transition-colors select-none
focus-visible:focus-ring min-w-25 border-default bg-surface-default px-inner-md
text-interactive hover:border-interactive-hover hover:bg-surface-hover
data-disabled:border-disabled data-disabled:bg-surface-default data-disabled:text-disabled
```

### Segmented control

Container, then one pill per segment:

```
container: relative inline-flex items-center rounded-full border border-default
           bg-surface-default p-inner-2xs
segment:   relative flex cursor-pointer items-center justify-center gap-inner-xs rounded-full
           px-inner-md py-inner-xs text-body-bold outline-hidden transition-colors duration-200
selected:  bg-interactive text-on-interactive
otherwise: text-primary hover:bg-surface-hover
```

The real component animates a filled pill between segments; at rest it is identical to
colouring the selected segment.

### Field shell — every input, select and date field shares this

The `data-slot` attributes are **load-bearing**: the `field-hover:` / `field-focus:` /
`field-invalid:` variants key off them, so without them none of the state styling fires.

```html
<div role="group" data-slot="field" class="group/field flex w-full flex-col gap-inner-2xs">
  <label data-slot="field-label"
         class="flex items-center gap-inner-xs text-body-small text-primary select-none w-fit
                group-data-disabled/field:text-disabled">
  <div role="group" data-slot="input-group"
       class="group/input-group flex min-w-0 cursor-text items-center gap-inner-xs rounded-md
              border border-default bg-surface-default text-primary transition-colors
              not-field-disabled:not-field-readonly:field-hover:bg-surface-hover
              field-focus:focus-ring
              not-field-disabled:not-field-readonly:field-invalid:text-danger
              field-disabled:cursor-not-allowed field-disabled:border-disabled
              field-disabled:bg-surface-disabled field-disabled:text-disabled
              h-12 px-inner-sm relative overflow-hidden w-full">
```

### Dropdown popover and options

```
popover: z-50 flex max-h-72 origin-(--trigger-anchor-point) flex-col overflow-hidden
         rounded-md border border-subtle bg-surface-default p-inner-2xs shadow-low
listbox: -m-0.5 min-h-0 overflow-y-auto outline-hidden
option:  group/combobox-item relative flex w-full cursor-pointer items-center gap-inner-xs
         rounded-sm p-inner-sm scroll-my-0.5 text-body outline-hidden select-none text-primary
         data-hovered:bg-surface-hover data-focus-visible:z-10 data-focus-visible:focus-ring
         data-disabled:pointer-events-none data-disabled:text-disabled
```

### Table

```
table: w-full table-fixed border-separate border-spacing-0 text-body-small
th:    group/table-header h-10 border-b border-subtle bg-surface-secondary text-body-small
       text-secondary uppercase text-start
```

### The semantic scale

| Purpose | Classes |
|---|---|
| Surfaces | `bg-surface-default` `bg-surface-secondary` `bg-surface-hover` `bg-surface-selected` `bg-surface-disabled` |
| Accent | `bg-interactive` `hover:bg-interactive-hover` `text-on-interactive` `text-interactive` |
| Text | `text-primary` `text-secondary` `text-disabled` `text-disabled-on-color` |
| Type | `text-heading-1` `-2` `-3` `-4` · `text-body-large` `text-body` `text-body-bold` `text-body-small` · `text-label` `text-caption`. Bare `text-heading` and `text-title` do **not** exist — use a numbered heading |
| Borders | `border-default` `border-subtle` `border-disabled` |
| Radius | `rounded-sm` `rounded-md` `rounded-full` |
| Spacing | `gap-inner-xs` `px-inner-sm` `px-inner-md` `py-inner-2xs` `p-inner-sm` |
| Focus | `focus-visible:focus-ring` — never hand-roll a focus ring |
| Heights | `h-12` controls, `h-10` table header |

**`data-*` variants vs pseudo-classes.** The platform drives its own components from
`data-hovered:` / `data-disabled:` / `data-selected:` because they are React Aria. On your
native elements those never fire — use `hover:`, `focus-visible:`, `disabled:`. Both are in
the sheet. Putting a `data-`-keyed class on a native `<button>` makes a control that looks
right and is visually inert in every state but default.

## Step 4: when there is no class — use tokens

Some families have no Tailwind recipe (banner, tag, checkbox). Reference the `--ap-comp-*`
tokens; they **do** cross the shadow boundary.

**Read the names off the live page. Do not infer them.** The families do not share a shape,
and guessing wastes hours: a wrong name resolves to the empty string, `var()` falls back
silently, the TypeScript build never validates token names, and nothing fails.

```js
// In DevTools on a platform page: list a family's real members
Array.from(document.styleSheets)
    .flatMap((s) => { try { return Array.from(s.cssRules); } catch { return []; } })
    .flatMap((r) => Array.from(r.style ?? []))
    .filter((n) => n.startsWith('--ap-comp-checkbox'))
    .map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n)]);
```

Naming is `--ap-comp-<component>-<variant?>-<part>-<state?>` with the **variant before the
part** — `--ap-comp-button-primary-bg-default`, never `-bg-primary-default`. States are
`default`, `hover`, `focus`, `disabled` (plus `invalid`/`readonly` on inputs). **There is no
`pressed` state anywhere.**

Families genuinely differ, which is why guessing fails:

| Family | Shape |
|---|---|
| `card` | only `border-color`, `border-width`, `radius` — no bg, padding or title |
| `badge` | `default-bg-default`, `default-text-color`, `default-padding-x`, `default-radius` |
| `banner` | `error-bg`, `error-body-color`, `padding`, `radius`, `typography-body`/`-title` |
| `tag` | `danger-subtle-bg`, `danger-subtle-text`, `padding-x`, `padding-y`, `radius` |
| `checkbox` | `box-size`, `unselected-bg-default`, `unselected-border-default`, `selected-bg-default`, `glyph-color-default` |
| `modal` | only `bg`, `radius`, `shadow`, `width-small|medium|large` |
| segmented control | the family is **`segmentbase`**, not `segmentedbuttons`; `radius` is `999px` |
| page margin | `--ap-sem-spacing-page-margin-vertical` / `-horizontal`, not `-block`/`-inline` |

To ship CSS of your own into the shadow root, adopt it — a `<style>` element React renders
never activates (its `.sheet` is null):

```ts
export function adoptCss(element: HTMLElement, css: string, marker: string): boolean {
    try {
        const root = element.getRootNode() as ShadowRoot;
        if (!root || !('adoptedStyleSheets' in root)) return false;
        const already = root.adoptedStyleSheets.some((s) => {
            try { return s.cssRules[0]?.cssText.includes(marker); } catch { return false; }
        });
        if (already) return true;
        const doc = element.ownerDocument;
        const Sheet = doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet;
        const sheet = new Sheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return true;
    } catch { return false; }
}
```

## Step 5: behaviour is yours — do not reach for React Aria

**React Aria does not work in this shadow root.** The installed version has no shadow-DOM
support, so `onPress` never fires and every control built on it is dead — while native
controls in the same tree work fine. The platform uses React Aria successfully because its
own UI is in the host document, not a guest shadow root.

So: native elements plus handlers you write. A real `<button>` gets keyboard and assistive
technology for free; a styled `<div>` gets neither.

When reproducing a control, implement the full keyboard contract — for a listbox: Up/Down
move, Enter/Space select, Escape closes **and returns focus to the trigger**, Home/End jump,
typing jumps to a matching option. For a dialog: focus the first field on open, trap Tab,
close on Escape, restore focus on close.

## Step 3b: icons are part of the component, and classes will not tell you

A class recipe is only the box. The **glyph inside it** is the other half of nearly every
control on this platform — the calendar in a date field, the chevron in a select, the arrows in
a calendar header, the icon in a banner, the close in a dialog header, the plus in a card
header. `@core/icons` is platform-internal and customer code cannot import it, so the tempting
shortcut is an emoji or a text character: `🗓`, `▾`, `‹`, `+`, `×`.

**Every one of those is wrong, and nothing catches it.** The class check passes, the computed
font-size passes, the token audit passes — and the control renders a multicolour emoji in
whatever font the browser picked. An emoji also ignores `currentColor`, so it cannot take the
control's own `text-primary` or `text-interactive`.

Reproduce the icon the same way you reproduce a component. The platform's `Icon` renders an
inline `<svg fill="currentColor" width="1em" height="1em">` on a `0 -960 960 960` viewBox,
sized by a class, with one `<path>`. Write one `glyph()` helper and a module of named paths.

| Icon sizes (they track `--ap-sem-icon-size-*`) | |
|---|---|
| `sm` | `size-4` |
| `md` | `size-6` — **what nearly every control uses**, including every flat `IconButton` |
| `lg` | `size-8` — calendar header nav |

Two rules that are easy to miss:

- **A composing component often overrides the atom it is built from.** The shared `Popover` is
  `w-72`, sized for a menu; `DatePicker` overrides it with `w-auto max-h-none!` because a month
  grid is wider than a menu. Copy the generic recipe alone and the calendar's last column is
  clipped. Before copying an atom, check whether the component that uses it adds anything.
- **Defaults are part of the component.** `SidePanel` and `Modal` default to
  `closeButton: true`, so their header carries a flat `IconButton` with a 24px `Close`. Leave it
  out and the panel is missing a control the platform always shows.

## Verifying — the part that actually matters

The build does not type-check, Tailwind class names are never validated, and token names are
never validated. **Unit tests cannot see any of this.** On one project, 97 passing tests and a
clean type-check sat on top of a board whose primary button did nothing.

After deploying, in DevTools on your page:

```js
// 1. Every token the page references that does not exist
const used = new Set(
    Array.from(document.querySelectorAll('*'))
        .flatMap((el) => el.shadowRoot ? Array.from(el.shadowRoot.styleSheets) : [])
        .flatMap((s) => { try { return Array.from(s.cssRules); } catch { return []; } })
        .flatMap((r) => (r.cssText ?? '').match(/--ap-(?:comp|sem)-[a-z0-9-]+/g) ?? []),
);
const root = getComputedStyle(document.documentElement);
[...used].map((n) => [n, root.getPropertyValue(n)]).filter(([, v]) => v.trim() === '');
// expect []
```

Then, by hand: **click every control with a real mouse** (a programmatic `.click()` hides the
retargeting bug), tab through with the keyboard, switch the OS to dark mode, and narrow below
768px.

**Diff against the platform's own rendered controls, not against the source.** Open a stock
record-create page (`/ui/objects/<object>/create`) — it has a text input, a textarea, a select,
a lookup, a date field, a field label and the primary/secondary buttons, all rendered by the
real components. Read their computed styles, then read yours, and compare the two tables in one
pass. This is the only check that catches a wrong glyph, a missing default control, an atom
whose composing override you skipped, or a size that is one step off; auditing your class
strings against a catalogue cannot, because the catalogue is the thing you copied from.

```js
const g = (e, p) => e && Object.fromEntries(
    p.map((k) => [k, getComputedStyle(e)[k]]));
// run the same `g(...)` over the platform's control and over yours, and diff
```

**One caveat on animation.** A browser tab that is not rendering never advances
`document.timeline` and never fires `requestAnimationFrame`, so animations cannot be verified
through automation at all — `currentTime` stays frozen at 0. Assert what the code asks the
browser for (stub `Element.prototype.animate` and check the keyframes), then have a human look
at it. Do not iterate on an animation you cannot see.

## Red flags — stop

| Thought | Reality |
|---|---|
| "I'll import the platform's Button" | Not importable. Nothing is. Reproduce it. |
| "`<select>` is fine for a dropdown" | Its popup is OS-drawn; no CSS reaches it. The platform builds a combobox. |
| "`<input type="date">` will do" | Same. The platform builds a segmented date input plus a calendar. |
| "The build passed, so the classes are right" | Nothing validates class or token names. Only DevTools does. |
| "I'll guess the token name from the pattern" | Families differ. A wrong name fails silently. Read it off the page. |
| "`instanceof` is fine here" | Different realm. It is false for real objects. |
| "I'll listen on `document`" | That is the guest frame. It never sees the event. |
| "I'll render a `<style>` tag" | It never activates. Adopt a constructed sheet. |
| "Tests pass, so the UI works" | Tests cannot see styling, realms, or retargeting. Drive the real page. |
| "`.click()` worked, so the mouse works" | Synthetic clicks skip the retargeting bug a real mouse hits. |
| "No icon is importable, so an emoji will do" | An emoji is a different font in a colour you do not control. Reproduce the path. |
| "The classes match the catalogue, so it's on-system" | The catalogue is classes only. Glyphs, defaults and composing overrides are not in it. |
| "I copied the atom's recipe" | Check what composes it: `DatePicker` overrides `Popover`'s width, and skipping that clips the calendar. |

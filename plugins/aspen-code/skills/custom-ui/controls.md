# Select, lookup and date controls: behavior beyond the tokens

The component tokens give these controls their look: every size, colour, radius, shadow and type
value is in the family's `typescript/node_modules/@aspen-crm/sdk/dist/tokens/comp/<family>.d.ts`.
They do not say how the platform's controls behave: which state shows which signal, how popovers
position and close, and what the keyboard does. To match the platform UI, meet the requirements
below on top of the tokens. Each section names the token families for its control.

## Guiding principles

These principles apply to all components.

- Icons come from [aspen-icons.ts](aspen-icons.ts) beside this file — copy it into
  `typescript/src/`. **Never a text glyph or emoji** (`▾ ▼ ‹ › × ✕ ✓ 📅`); a hook denies those too.
- The platform typically follows component conventions set by React Aria. Defer
  to the behaviors of those components when otherwise ambiguous.
- `brand` colors should not be used for interactive elements, only for accents. Prefer `interactive`
  colors for interactive elements when possible.

## Every field

- Every field is the same height as a text input, with its label above and help or error text
  below.
- The field surface shows its focus ring only on keyboard focus, and never uses the browser outline.
- A button inside a field (calendar, Clear, a chevron) is a small square icon button that keeps its
  own hover and focus and never shrinks out of the surface.

## Every popover control

- **Portal and position.** Render the popover inside your page's root (the shadow root the page
  renders in), `position: fixed` from the trigger's `getBoundingClientRect()`: below it, aligned
  to its start edge. Flip it above when there is no room below, keep it inside the viewport (shift
  it, don't clip it), and re-measure on scroll and resize.
  - Exception: never flip datepicker menus. Datepickers are allowed to extend past the bottom of the
    page as long as the user is able to scroll down to see it. Since rapidly clicking an arrow is a
    common activity on datepicker menus, they must never flip unpredictably.
- **Close it** on a selection, on Escape, and on a press outside. Listen for `pointerdown` on
  `element.ownerDocument` (the global `document` is the guest iframe's and never sees the page's
  events) and test `event.composedPath()`, since `event.target` is retargeted to the shadow host.
- **Focus returns to the trigger** after a selection or Escape. A press outside closes without
  moving focus. Tab closes and carries on from the trigger.
- **Choose on click**, not `mousedown`.

### Option states in a menu

A menu row has three independent states, and each has its own signal:

- **Hover** (the pointer is over the row): the row's hover background. Nothing else.
- **Keyboard focus** (the row the arrow keys are on): the row's focus ring. The ring appears only
  after the user presses an arrow key; opening the menu with the pointer, or pressing Enter or
  Space on the trigger, shows no ring until an arrow key is pressed. Pointer movement does not
  move keyboard focus.
- **Selected** (the current value): a `Check` icon at the row's end. No background.

A row can be all three at once, and then shows all three signals. Never use the focus ring for
hover, and never use a background for keyboard focus or selection.

## Select — a picklist or fixed choice

Families `select` (the field and menu) and `menubase` (the rows).

- A `<button aria-haspopup="listbox" aria-expanded aria-controls>` showing the chosen label or a
  placeholder, with a trailing `ChevronDown`.
- A popover the trigger's width, holding `<ul role="listbox">` of `<li role="option"
aria-selected>` rows.
- The value stays the item's technical name; the text is its metadata label (`SKILL.md` §2).
- Keyboard: on the trigger, Enter, Space, ArrowDown or ArrowUp opens. In the list, ArrowUp and
  ArrowDown move, Home and End jump, typing jumps to the next matching label, Enter or Space
  selects and closes, Escape closes.

## Lookup — a record reference

Family `typeahead`; the selected-row check is `menubase`'s.

- A field surface (`role="group"`) holding a leading `Search` icon, an
  `<input role="combobox" aria-autocomplete="list" aria-expanded aria-controls
aria-activedescendant>` with no border or background of its own, and a Clear button (`Close`
  icon) only while a record is chosen.
- A popover the surface's width with a listbox of option rows, plus a "Loading" row with a
  spinner while a query runs and a "No results" row when it returns nothing.
- Focus stays in the input. ArrowUp and ArrowDown move the highlight through
  `aria-activedescendant`, Enter commits it, Escape closes. Typing narrows a local list or sends a
  debounced query.
- Keep the record id separate from the display text and clear both together. Leaving the field
  puts the chosen record's name back.

## Date — a date field

Families `datepicker` (the field), `datemenu` (the popover), `calendar` (the month) and
`datecell` (a day). The field takes the text input's height.

- A field surface (`role="group"`, labelled by the label) holding month, day and year segments in
  the locale's order, each a `role="spinbutton"` with a placeholder (`mm`, `dd`, `yyyy`) until
  filled, separated by literal `/`, and a trailing calendar button (`CalendarToday`).
- A focused segment is highlighted as a filled chip. Typing digits fills it and moves to the next;
  ArrowUp and ArrowDown step it; Backspace clears it.
- The popover holds a header (previous and next month buttons around the month and year) and a
  `role="grid"` month with narrow weekday names and one button per day. Days outside the month
  keep their cell with the content hidden.
- Day buttons follow the menu states above for hover and keyboard focus; the selected day uses the
  day cell's selected fill.
- Opening focuses the selected day, else today. Arrows move by day and week, PageUp and PageDown
  by month, Home and End to the week's ends, Enter or Space selects and closes. Store ISO
  `yyyy-mm-dd`; display in the locale's order.

## Button — the actions beside these controls

Family `button`, in its primary, secondary, flat and danger variants. The guard requires these
over the semantic layer for any `<button>` styled here.

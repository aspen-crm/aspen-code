# Select, lookup and date controls

These are the controls custom UI gets visibly wrong, because the browser offers a shortcut that
looks fine while closed: **`<select>`, `<datalist>` and `<input type="date">` (`time`,
`datetime-local`, `month`, `week`) open a menu or calendar the browser draws.** No stylesheet
reaches it, so the opened control is the operating system's, not Aspen's. A hook denies them in
`typescript/`.

Build them from the anatomy below. It is the platform's own design system, part by part: the
element and role each part is, **the exact `--ap-comp-*` names that style it** (every state the
family publishes; a family that publishes no token for something says so and names the one to
use), its icon, and its keyboard contract. Use these names as written — on an SDK with a token
snapshot their values are in `typescript/node_modules/@aspen-crm/sdk/dist/tokens/comp/<family>.d.ts`,
and the build rejects a name the snapshot lacks.

Icons come from [aspen-icons.ts](aspen-icons.ts) beside this file — copy it into
`typescript/src/`. **Never a text glyph or emoji** (`▾ ▼ ‹ › × ✕ ✓ 📅`); a hook denies those too.

## Every field

- **One height for every field: 48px.** Select and lookup publish `--ap-comp-select-field-height`
  and `--ap-comp-typeahead-field-height`; the date families publish none, so a date field takes
  `--ap-comp-textinput-field-height`.
- **Label above, then the field, then help or error text**, separated by the family's stack gap:
  `--ap-comp-select-stack-gap`, `--ap-comp-typeahead-gap`, `--ap-comp-datepicker-gap`,
  `--ap-comp-daterange-gap`, `--ap-comp-datetimepicker-gap`, `--ap-comp-timepicker-gap`.
- **Focus** shows as the family's `-field-shadow-focus` ring on the field surface, never the
  browser outline. A family that publishes no focus border or focus background has none.
- **Hover** (`-field-bg-hover`) applies while the pointer is over the surface, focused or not —
  except over a button inside it, which shows its own hover instead of the surface's.
- **A button inside a field** (calendar, Clear, a chevron toggle) is a 32px square with
  `border-radius: --ap-sem-radius-md`, background `--ap-sem-color-surface-hover` on hover,
  `box-shadow: --ap-sem-elevation-focus` on keyboard focus, and `flex-shrink: 0` so it never
  leaves the surface. No family publishes tokens for it.

## Every popover control

- **Portal and position.** Render the popover inside your page's root (the shadow root the page
  renders in), with `position: fixed` from the trigger's `getBoundingClientRect()`: below it,
  aligned to its start edge, `4px` away. Flip it above when there is no room below, and **keep it
  12px inside the viewport's left and right edges** (shift it, don't clip it). Re-measure on
  scroll and resize.
- **Close it** on a selection, on Escape, and on a press outside. Listen for `pointerdown` on
  `element.ownerDocument` (the global `document` is the guest iframe's and never sees the page's
  events) and test `event.composedPath().includes(trigger | popover)` — `event.target` is
  retargeted to the shadow host, so `contains(event.target)` calls every press outside. Do not
  close on a blur timer.
- **Focus returns to the trigger** after a selection or Escape. A press outside closes without
  moving focus, which goes where the user pressed. Tab closes, puts focus back on the trigger and
  lets the Tab carry on from there — the popover sits at the end of the root, so a Tab left alone
  would leave the page's tab order.
- **Choose on click**, not `mousedown`, so a press that drags off an option cancels.

## Select — a picklist or fixed choice

Family `select`; its menu rows are the `menubase` family.

```
div .field                         gap: --ap-comp-select-stack-gap
  label                            font: --ap-comp-select-label-typography
                                   color: --ap-comp-select-label-color-default | --ap-comp-select-label-color-disabled
    span "*" (required)            color: --ap-comp-select-required-asterisk-color
  button  aria-haspopup="listbox" aria-expanded aria-controls
                                   height: --ap-comp-select-field-height
                                   padding-inline: --ap-comp-select-field-padding
                                   gap: --ap-comp-select-field-icon-gap
                                   border-radius: --ap-comp-select-radius
                                   border: --ap-comp-select-border-width-default solid, color:
                                     --ap-comp-select-field-border-color-default | -hover | -active (open) | -filled (has a value)
                                     | -error | -disabled
                                   background: --ap-comp-select-field-bg-default | -hover | -focus | -active (open)
                                     | -filled | -error | -disabled
                                   box-shadow (keyboard focus): --ap-comp-select-field-shadow-focus
                                   font: --ap-comp-select-field-typography
    span  the label, or the placeholder
                                   color: --ap-comp-select-field-text-color-hasvalue | -novalue (placeholder)
                                     | -error | -disabled
    svg   ChevronDown              size: --ap-comp-select-chevron-icon-size
                                   color: --ap-comp-select-chevron-icon-color | --ap-comp-select-chevron-icon-color-disabled
  div   help text                  font: --ap-comp-select-helper-typography
                                   color: --ap-comp-select-helper-color-default | --ap-comp-select-helper-color-disabled
  div   error text (invalid)       color: --ap-comp-select-error-message-color
popover                            width: the trigger's
                                   border-radius: --ap-comp-select-menu-radius
                                   padding: --ap-comp-select-menu-padding
                                   box-shadow: --ap-comp-select-menu-elevation
                                   background: --ap-comp-menubase-bg-default
                                   border: --ap-sem-border-width-default solid --ap-sem-color-border-subtle
  ul  role="listbox"
    li  role="option" aria-selected
                                   padding: --ap-comp-menubase-padding
                                   gap: --ap-comp-menubase-gap
                                   border-radius: --ap-comp-menubase-radius
                                   background: --ap-comp-menubase-bg-default | --ap-comp-menubase-bg-hover (pointer)
                                     | --ap-comp-menubase-bg-focus (keyboard focus — the default surface, not grey)
                                   box-shadow (keyboard focus): --ap-comp-menubase-shadow-focus — a keyboard
                                     highlight is this ring, not a hover background
                                   font: --ap-comp-menubase-label-typography
                                   color: --ap-comp-menubase-label-color-default | --ap-comp-menubase-label-color-disabled
      span  the item's label
      svg   Check — the selected option only
                                   size: --ap-comp-menubase-selectedcheck-size
                                   color: --ap-comp-menubase-selectedcheck-color
```

The selected option is marked by its `Check`, not a background. The value stays the item's
technical name; the text is its metadata label (`SKILL.md` §2).

Keyboard: on the trigger, Enter, Space, ArrowDown or ArrowUp opens and moves focus into the list
(one option at a time is focusable), onto the selected option, else the first. In the list, ArrowUp/ArrowDown move, Home/End jump, typing jumps to the
next option whose label starts with what was typed, Enter or Space selects and closes, Escape
closes.

## Lookup — a record reference

Family `typeahead`.

```
label                              font: --ap-comp-typeahead-label-typography
                                   color: --ap-comp-typeahead-label-color-default | --ap-comp-typeahead-label-color-disabled
div  role="group" — the field surface (stack gap above: --ap-comp-typeahead-gap)
                                   height: --ap-comp-typeahead-field-height
                                   padding-inline: --ap-comp-typeahead-field-padding
                                   gap: --ap-comp-typeahead-field-gap
                                   border-radius: --ap-comp-typeahead-field-radius
                                   border: --ap-comp-typeahead-field-border-width solid, color:
                                     --ap-comp-typeahead-field-border-color-default | -error | -disabled   (no hover/focus colour)
                                   background: --ap-comp-typeahead-field-bg-default | -hover | -focus (the input
                                     has focus) | -disabled
                                   box-shadow (the input has keyboard focus): --ap-comp-typeahead-field-shadow-focus
  svg     Search — leading, when options exist only after typing
                                   size: --ap-comp-typeahead-searchicon-size
                                   color: --ap-comp-typeahead-searchicon-color-default | --ap-comp-typeahead-searchicon-color-disabled
  input   role="combobox" aria-autocomplete="list" aria-expanded aria-controls aria-activedescendant
          (no border, no background, no outline; the surface carries them)
                                   font: --ap-comp-typeahead-inputtext-typography
                                   color: --ap-comp-typeahead-inputtext-color-placeholder (::placeholder)
                                     | -typing (focused, while typing) | -filled (a record is chosen, blurred)
                                     | -active (a record is chosen, focused) | -error (invalid)
  button  aria-label="Clear", svg Close — only while a record is chosen (not for typed text alone),
          and never when disabled or read-only
                                   size: --ap-comp-typeahead-clearicon-size
                                   color: --ap-comp-typeahead-clearicon-color-default | --ap-comp-typeahead-clearicon-color-disabled
  button  toggle, svg ChevronDown — a local list only; a search-driven lookup has none
div  help or error text            font: --ap-comp-typeahead-helptext-typography
                                   color: --ap-comp-typeahead-helptext-color-default | --ap-comp-typeahead-helptext-color-error
popover                            width: the field surface's, anchored to the surface
                                   background: --ap-comp-typeahead-menu-bg
                                   padding: --ap-comp-typeahead-menu-padding
                                   gap: --ap-comp-typeahead-menu-gap
                                   border-radius: --ap-comp-typeahead-menu-radius
                                   box-shadow: --ap-comp-typeahead-menu-shadow
  ul  role="listbox"
    li  role="option" aria-selected
                                   padding: --ap-comp-typeahead-option-padding
                                   border-radius: --ap-comp-typeahead-option-radius
                                   background: --ap-comp-typeahead-option-bg
                                   color: --ap-comp-typeahead-option-text-color
                                   font: --ap-comp-typeahead-option-typography
                                   highlighted: box-shadow --ap-comp-typeahead-option-shadow-highlighted
      span  display text
      svg   Check — the selected record
                                   size: --ap-comp-menubase-selectedcheck-size
                                   color: --ap-comp-menubase-selectedcheck-color
    li  status row while loading   svg Spinner (rotating) + "Loading"
    li  status row when empty      "No results"
```

Focus stays in the input; ArrowUp/ArrowDown move the highlight (`aria-activedescendant`), Enter
commits it, Escape closes. Typing narrows a local list or sends a query (debounced). Keep the
record id separate from the display text, and clear both together. Typing over a chosen record
keeps it chosen until another is picked or Clear is pressed; leaving the field puts its name
back.

## Date — a date field

Families `datepicker` (the field), `datemenu` (the popover), `calendar` (the month) and
`datecell` (a day).

```
label  (the group takes aria-labelledby=its id; a press on it focuses the first segment)
                                   font: --ap-comp-datepicker-label-typography
                                   color: --ap-comp-datepicker-label-color-default | --ap-comp-datepicker-label-color-disabled
div  role="group" — the field surface (stack gap above: --ap-comp-datepicker-gap)
                                   height: --ap-comp-textinput-field-height   (no datepicker height token)
                                   padding-inline: --ap-comp-datepicker-field-padding
                                   gap: --ap-comp-datepicker-field-gap
                                   border-radius: --ap-comp-datepicker-field-radius
                                   border: --ap-comp-datepicker-field-border-width solid, color:
                                     --ap-comp-datepicker-field-border-color-default | -error | -disabled   (no hover/focus colour)
                                   background: --ap-comp-datepicker-field-bg-default | -hover | -error | -disabled
                                   box-shadow (a segment has focus): --ap-comp-datepicker-field-shadow-focus
  div  the segments, in the locale's order (en-US: month / day / year)
                                   font: --ap-comp-datepicker-inputtext-typography; font-variant-numeric: tabular-nums
    span  role="spinbutton" tabindex="0" aria-label="month" aria-valuenow/-min/-max   "mm" until filled
    span  "/"   (a literal: no padding)
    span  role="spinbutton" … "day"                                                    "dd"
    span  "/"
    span  role="spinbutton" … "year"                                                   "yyyy"
          each segment: padding-inline --ap-sem-spacing-inner-2xs; border-radius --ap-sem-radius-xs
          color: --ap-comp-datepicker-inputtext-color-placeholder (unfilled) | -filled | -error | -disabled
          focused: background --ap-sem-color-interactive-default, color --ap-sem-color-text-on-interactive
          a literal ("/"): always -inputtext-color-filled (-disabled when disabled), never the placeholder colour
  button  aria-label="Calendar", svg CalendarToday — pushed to the end; toggles the popover; absent when read-only
                                   size: --ap-comp-datepicker-calicon-size
                                   color: --ap-comp-datepicker-calicon-color | --ap-comp-datepicker-calicon-color-disabled
div  help text                     font: --ap-comp-datepicker-helptext-typography
                                   color: --ap-comp-datepicker-helptext-color-default | --ap-comp-datepicker-helptext-color-disabled
div  error text                    font: --ap-comp-datepicker-errormsg-typography; color: --ap-comp-datepicker-errormsg-color
popover — not modal; sized to its content
                                   background: --ap-comp-datemenu-bg
                                   padding: --ap-comp-datemenu-padding
                                   gap: --ap-comp-datemenu-gap
                                   border-radius: --ap-comp-datemenu-radius
                                   box-shadow: --ap-comp-datemenu-shadow
  div  the calendar                gap: --ap-comp-calendar-gap
    header                         gap: --ap-comp-calendar-header-gap; padding-inline: --ap-comp-calendar-header-padding-x
      button  aria-label="Previous", svg ArrowLeft      size: --ap-comp-calendar-navicon-size
      h3      "October 2026" (long month + year)        font: --ap-comp-calendar-monthlabel-typography
                                                        color: --ap-comp-calendar-monthlabel-color
      button  aria-label="Next", svg ArrowRight
    table  role="grid"             border-collapse: separate; border-spacing: --ap-comp-calendar-grid-gap;
                                   margin: calc(-1 * var(--ap-comp-calendar-grid-gap)) — border-spacing also draws the
                                     gutter round the table's outside; this cancels it so the grid sits on the padding
      thead  weekday names, narrow, in the locale's order (en-US: S M T W T F S, Sunday first)
                                   size: --ap-comp-calendar-weekday-size; padding: --ap-comp-calendar-weekday-padding
                                   font: --ap-comp-calendar-weekday-typography; color: --ap-comp-calendar-weekday-color
      td > button  one per day     size: --ap-comp-datecell-size; padding: --ap-comp-datecell-padding
                                   border-radius: --ap-comp-datecell-radius; font: --ap-comp-datecell-typography
                                   default: --ap-comp-datecell-default-bg / --ap-comp-datecell-default-text
                                   hover: --ap-comp-datecell-hover-bg / --ap-comp-datecell-hover-text
                                   keyboard focus: --ap-comp-datecell-focus-bg / -focus-text / -focus-shadow
                                   selected: --ap-comp-datecell-selected-default-bg / -selected-default-text,
                                     -selected-hover-bg / -text, -selected-focus-bg / -text,
                                     -selected-disabled-bg / -text
                                   disabled: --ap-comp-datecell-disabled-text
                                   outside the month: the cell is kept, its content hidden
```

Segments: typing digits fills the focused segment and moves to the next; ArrowUp/ArrowDown step
it; Backspace clears it. Opening the calendar focuses the selected day (else today). In the
grid, arrows move by day and week, PageUp/PageDown by month, Home/End to the week's ends, Enter
or Space selects and closes. Store ISO `yyyy-mm-dd`; display in the locale's order.

**Date range** (family `daterange`): one surface holding one row — the start segments, an
`aria-hidden` `-` separator (padding-inline `--ap-sem-spacing-inner-2xs`, the filled text
colour), the end segments — and then one calendar trigger. The two halves read as one value:
**no gap between them and the separator**; `--ap-comp-daterange-field-gap` is only between that
row and the trigger. Two dates need about 304px including padding and trigger, so give a range
that much (span two columns of a three-column form) rather than squeezing it. Every field,
label, segment-text, help, error and icon part takes the `--ap-comp-daterange-*` name with the
same suffix as the date field's (`-field-bg-hover`, `-inputtext-color-filled`, `-calicon-size`,
…). The popover and calendar are the date field's (`datemenu`, `calendar`, `datecell`), except
the cells: the first day pressed sets the start and the second the end, in order. Both endpoints
take `--ap-comp-daterange-cell-endpoint-bg` / `-cell-endpoint-text`
(`--ap-comp-datecell-selected-hover-bg` when hovered) and the days between take
`--ap-comp-daterange-cell-inrange-bg` / `-cell-inrange-text`. While the end is being chosen,
the span previews from the start to the hovered day in those same tokens.

**Date and time** (family `datetimepicker`): the date segments, then `,` and the time segments
(hour `––` : minute `––`, then the AM/PM segment in en-US), one calendar trigger; the popover
(`--ap-comp-datetimepicker-menu-bg`, `-menu-padding`, `-menu-gap`, `-menu-radius`,
`-menu-shadow`) adds a time field and a flat "Done" button below the calendar. **Time alone**
(family `timepicker`): the time segments only, with `––` placeholders, no popover.

## Button — the actions beside these controls

Family `button`; the guard requires these over the semantic layer for any `<button>` styled here.

```
button                             padding: --ap-comp-button-padding-y --ap-comp-button-padding-x
                                   (flat: padding-inline --ap-comp-button-flat-padding-x)
                                   min-width: --ap-comp-button-min-width; gap: --ap-comp-button-gap
                                   border-radius: --ap-comp-button-radius; font: --ap-comp-button-typography
  primary                          background: --ap-comp-button-primary-bg-default | -hover | -focus | -disabled
                                   color: --ap-comp-button-primary-text-default | -hover | -focus | -disabled
                                   keyboard focus: --ap-comp-button-primary-shadow-focus
  secondary                        background: --ap-comp-button-secondary-bg-default | -hover | -focus | -disabled
                                   color: --ap-comp-button-secondary-text-default | -hover | -focus | -disabled
                                   border: --ap-comp-button-secondary-border-width-default (-hover, -disabled) solid
                                     --ap-comp-button-secondary-border-color-default | -hover | -disabled
                                   keyboard focus: --ap-comp-button-secondary-shadow-focus
  flat                             background: --ap-comp-button-flat-bg-default | -hover | -focus | -disabled
                                   color: --ap-comp-button-flat-text-default | -hover | -focus | -disabled
                                   keyboard focus: --ap-comp-button-flat-shadow-focus
  danger                           --ap-comp-button-primary-danger-, -secondary-danger-, -flat-danger- + the
                                     base variant's suffixes (secondary-danger has the border ones too)
  svg icon in a button             size: --ap-comp-button-icon-size
                                   color: --ap-comp-button-icon-color-primary (-disabled) on primary;
                                     --ap-comp-button-icon-color-secondary-flat (-disabled) on secondary and flat
```

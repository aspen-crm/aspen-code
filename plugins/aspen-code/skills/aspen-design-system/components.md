# Every component in the Aspen design system

All 76 package exports — 71 components plus 5 non-component entries — with the class strings
taken verbatim from the design system's own source. Nothing here needs access to that
repository.

**None of these can be imported** — they are a private workspace package. This file exists so
you reproduce one faithfully instead of inventing it. Read `SKILL.md` first: it covers the
shadow-root and cross-realm traps that make a correct-looking reproduction silently do nothing,
and the stylesheet adoption without which none of these classes resolve at all.

Reading an entry:

- The first block is the component's **root classes** — always applied.
- **variant** blocks go on top of the root for that variant. Copy both.
- *Composes other components* means it has no styling of its own; build it by assembling the
  pieces it names rather than styling it directly.
- `data-*` variants (`data-disabled:`, `data-hovered:`, `data-selected:`) are React Aria's and
  **never fire on native elements** — swap them for `disabled:`, `hover:`, and your own
  selected class. Both forms exist in the stylesheet.
- Class strings wrap on spaces only, so any line copies as-is.

## Actions

### Button

```
group/button inline-flex h-12 shrink-0 items-center justify-center gap-inner-xs rounded-md
border text-body-bold whitespace-nowrap no-underline transition-colors select-none
[&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:focus-ring
```

**variant** — primary, primary-danger, secondary, secondary-danger, flat, flat-danger

`primary`
```
min-w-25 border-transparent bg-interactive px-inner-md text-on-interactive
hover:bg-interactive-hover data-disabled:bg-surface-disabled
data-disabled:text-disabled-on-color
```

`primary-danger`
```
min-w-25 border-transparent bg-interactive-danger px-inner-md text-on-interactive
hover:bg-interactive-danger-hover data-disabled:bg-surface-disabled
data-disabled:text-disabled-on-color
```

`secondary`
```
min-w-25 border-default bg-surface-default px-inner-md text-interactive
hover:border-interactive-hover hover:bg-surface-hover data-disabled:border-disabled
data-disabled:bg-surface-default data-disabled:text-disabled
```

`secondary-danger`
```
min-w-25 border-default bg-surface-default px-inner-md text-interactive-danger
hover:border-interactive-danger-hover hover:bg-surface-hover data-disabled:border-disabled
data-disabled:bg-surface-default data-disabled:text-disabled
```

`flat`
```
border-transparent bg-transparent text-interactive hover:bg-surface-hover
data-disabled:bg-transparent data-disabled:text-disabled
```

`flat-danger`
```
border-transparent bg-transparent text-interactive-danger hover:bg-surface-hover
data-disabled:bg-transparent data-disabled:text-disabled
```

### SplitButton

Row of segments that read as one filled control: a labelled action, and any of a menu trigger,
a second action, or a dismiss beside it. `variant` paints every segment, so they cannot drift
apart.

```
inline-flex shrink-0 items-center justify-center gap-inner-xs px-inner-xs py-inner-2xs
text-body-bold whitespace-nowrap no-underline transition-colors select-none
[&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:focus-ring
data-disabled:pointer-events-none data-disabled:cursor-default
data-disabled:bg-surface-disabled data-disabled:text-disabled
```

**variant** — default, external

`default`
```
bg-interactive-secondary text-interactive
```

`external`
```
bg-interactive-external text-warning
```

**interactive** — true, false

`true`
```
not-data-disabled:cursor-pointer
```

`false`
```
cursor-default
```

### ButtonGroup

Groups related buttons into a visually connected row or column.

**orientation** — horizontal, vertical

`horizontal`
```
**:data-slot:rounded-r-none
[&_[data-slot]:not([data-slot=button-group-separator])+[data-slot]:not([data-slot=button-group-separator])]:-ml-0.5
[&_[data-slot]~[data-slot]]:rounded-l-none
```

`vertical`
```
flex-col **:data-slot:rounded-b-none
[&_[data-slot]:not([data-slot=button-group-separator])+[data-slot]:not([data-slot=button-group-separator])]:-mt-0.5
[&_[data-slot]~[data-slot]]:rounded-t-none
```

### IconButton

Icon-only button. `aria-label` is required to name the control for assistive tech.

```
group/icon-button inline-flex shrink-0 items-center justify-center rounded-md border
transition-colors select-none [&_svg]:pointer-events-none [&_svg]:shrink-0
focus-visible:focus-ring aria-disabled:cursor-not-allowed
```

**variant** — primary, primary-danger, secondary, secondary-danger, flat, flat-danger

`primary`
```
size-12 border-transparent bg-interactive p-inner-sm text-on-interactive
not-aria-disabled:hover:bg-interactive-hover aria-disabled:bg-surface-disabled
aria-disabled:text-disabled-on-color
```

`primary-danger`
```
size-12 border-transparent bg-interactive-danger p-inner-sm text-on-interactive
not-aria-disabled:hover:bg-interactive-danger-hover aria-disabled:bg-surface-disabled
aria-disabled:text-disabled-on-color
```

`secondary`
```
size-12 border-default bg-surface-default p-inner-sm text-interactive
not-aria-disabled:hover:border-interactive-hover not-aria-disabled:hover:bg-surface-hover
aria-disabled:border-disabled aria-disabled:bg-surface-default aria-disabled:text-disabled
```

`secondary-danger`
```
size-12 border-default bg-surface-default p-inner-sm text-interactive-danger
not-aria-disabled:hover:border-interactive-danger-hover
not-aria-disabled:hover:bg-surface-hover aria-disabled:border-disabled
aria-disabled:bg-surface-default aria-disabled:text-disabled
```

`flat`
```
size-6 border-transparent bg-transparent text-interactive
not-aria-disabled:hover:bg-surface-hover aria-disabled:bg-transparent
aria-disabled:text-disabled
```

`flat-danger`
```
size-6 border-transparent bg-transparent text-interactive-danger
not-aria-disabled:hover:bg-surface-hover aria-disabled:bg-transparent
aria-disabled:text-disabled
```

### LinkButton

Navigation rendered as a `Button`. Carries all the same props and variants as a normal button,
but uses semantic navigation.

```
group/button inline-flex h-12 shrink-0 items-center justify-center gap-inner-xs rounded-md
border text-body-bold whitespace-nowrap no-underline transition-colors select-none
[&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:focus-ring
```

**variant** — primary, primary-danger, secondary, secondary-danger, flat, flat-danger

`primary`
```
min-w-25 border-transparent bg-interactive px-inner-md text-on-interactive
hover:bg-interactive-hover data-disabled:bg-surface-disabled
data-disabled:text-disabled-on-color
```

`primary-danger`
```
min-w-25 border-transparent bg-interactive-danger px-inner-md text-on-interactive
hover:bg-interactive-danger-hover data-disabled:bg-surface-disabled
data-disabled:text-disabled-on-color
```

`secondary`
```
min-w-25 border-default bg-surface-default px-inner-md text-interactive
hover:border-interactive-hover hover:bg-surface-hover data-disabled:border-disabled
data-disabled:bg-surface-default data-disabled:text-disabled
```

`secondary-danger`
```
min-w-25 border-default bg-surface-default px-inner-md text-interactive-danger
hover:border-interactive-danger-hover hover:bg-surface-hover data-disabled:border-disabled
data-disabled:bg-surface-default data-disabled:text-disabled
```

`flat`
```
border-transparent bg-transparent text-interactive hover:bg-surface-hover
data-disabled:bg-transparent data-disabled:text-disabled
```

`flat-danger`
```
border-transparent bg-transparent text-interactive-danger hover:bg-surface-hover
data-disabled:bg-transparent data-disabled:text-disabled
```

### Link

```
rounded-sm no-underline transition-colors focus-visible:focus-ring
data-disabled:text-link-disabled
```

**destination** — external, internal

`external`
```
text-link hover:text-link-hover
```

`internal`
```
text-interactive hover:text-interactive-hover
```

### Menu

Marker slot for the trigger element. Its child is what the user presses to open the menu.

```
group/dropdown-menu-content z-50 max-h-122 origin-(--trigger-anchor-point) overflow-x-hidden
overflow-y-auto rounded-md border border-subtle bg-surface-default text-primary shadow-low
p-inner-2xs duration-100 data-entering:animate-in data-entering:fade-in-0
data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0
data-exiting:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2
data-[placement=top]:slide-in-from-bottom-2 data-[placement=left]:slide-in-from-right-2
data-[placement=right]:slide-in-from-left-2 data-exiting:overflow-hidden
```

### OverflowMenu

```
group/overflow-menu-trigger inline-flex shrink-0 items-center justify-center rounded-md
text-primary cursor-pointer transition-colors select-none [&_svg]:pointer-events-none
[&_svg]:shrink-0 hover:bg-surface-hover focus-visible:focus-ring
data-disabled:cursor-not-allowed data-disabled:text-disabled
```

**size** — md, sm

`md`
```
size-12 p-inner-sm
```

`sm`
```
size-6
```

**variant** — default, flat

`default`
```
border border-default bg-surface-default aria-expanded:bg-surface-selected
data-disabled:border-disabled data-disabled:hover:bg-surface-default
```

`flat`
```
border-2 border-transparent aria-expanded:bg-surface-selected data-disabled:bg-transparent
data-disabled:hover:bg-transparent
```

## Form shell

### Form

Form — layout root for a form. Renders the `<form>` element and stacks its fields in a flex
column. Consumer wires `onSubmit` (typically to a state-lib's

```
flex items-center gap-inner-md
```

**layout** — trailing, split

`trailing`
```
justify-end
```

`split`
```
justify-between
```

**divider** — true

`true`
```
border-t border-subtle
```

**surface** — page, dialog, panel, inline

`page`
```
bg-surface-default px-inner-md py-inner-xl
```

`dialog`
```
px-inner-md py-inner-xl
```

`panel`
```
p-inner-md
```

`inline`
```
mt-inner-xs pt-inner-md
```

### Field

Id of the node `Field.Description` renders for a control. Wire it onto a custom control's
`aria-describedby` when composing `Field` with a control that does not read `useFieldContext`.

```
flex w-full flex-col gap-inner-2xs
```

### FieldSet

FieldSet — a form row for a group of related controls (checkbox group, radio group), named
structurally by its `<legend>`. Publishes group id, description id, error id, and invalid /
required state to its children exactly as `Field` does, so `FieldSet.Description` and
`FieldSet.Error` connect to the

```
flex w-full flex-col gap-inner-2xs
```

## Text inputs

### Input
Every bordered field starts from the shared field surface below, then adds its own geometry
and typography. The `field-*` variants are the platform's own: `field-focus` matches
`:focus-visible`, so it fires on a plain `<input>`; `field-invalid` and `field-disabled` match
`[data-invalid]` and `[data-disabled]`, so a native control must set those **attributes** —
`aria-invalid` alone paints nothing. `field-hover` matches `[data-hovered]`, which React Aria
sets and a native control does not.

Field surface:
```
rounded-md border border-default bg-surface-default text-primary transition-colors
not-field-disabled:not-field-readonly:field-hover:bg-surface-hover
field-focus:focus-ring
not-field-disabled:not-field-readonly:field-invalid:text-danger
not-field-focus:not-field-disabled:not-field-readonly:field-invalid:border-danger
not-field-disabled:field-readonly:bg-surface-disabled
not-field-focus:not-field-disabled:field-readonly:border-disabled
field-disabled:cursor-not-allowed field-disabled:border-disabled
field-disabled:bg-surface-disabled field-disabled:text-disabled
```

Input adds:
Input — bare single-line text control per Aspen's component token spec.

```
block h-12 w-full min-w-0 px-inner-sm
text-body placeholder-placeholder
```

### TextField

TextField — a single-line text control composed of `Field` + `Input` + label / description /
error slots. The default form-input primitive: reach for it whenever the input has a label
above (or beside) it and optional supporting text.

*Composes other components; no classes of its own.*

### TextArea
Multi-line text input. Starts from the same field surface as `Input` (see that entry), then
adds its own geometry. **resize** — `none` (`resize-none`, default) or `vertical` (`resize-y`).

Textarea adds:
```
flex min-h-32 w-full p-inner-sm
text-body placeholder:text-placeholder
```

**resize** — none, vertical

`none`
```
resize-none
```

`vertical`
```
resize-y
```

### TextAreaField

TextAreaField — a multi-line text control composed of `Field` + `TextArea` + label /
description / error slots. The prose counterpart to `TextField`: reach for it whenever a
multi-line value has a label above (or beside) it and optional supporting text.

*Composes other components; no classes of its own.*

### NumberInput

NumberInput — bare numeric control per Aspen's component token spec.

```
size-6 justify-center text-primary
```

### NumberField

NumberField — a numeric control composed of `Field` + `NumberInput` + label / description /
error slots.

*Composes other components; no classes of its own.*

### PasswordInput

PasswordInput — bare masked text control per Aspen's component token spec.

*Composes other components; no classes of its own.*

### PasswordField

PasswordField — a masked single-line control composed of `Field` + `PasswordInput` +

*Composes other components; no classes of its own.*

### PhoneInput

PhoneInput — bare phone control.

*Composes other components; no classes of its own.*

### PhoneField

PhoneField — a phone control composed of `Field` + `PhoneInput` + label / description /

*Composes other components; no classes of its own.*

### Search

Search input per the Aspen component-token spec.

```
group/combobox flex flex-col
```

**seamless** — false, true

`false`
```
w-full gap-inner-2xs
```

`true`
```
w-auto
```

## Choice inputs

### Select

Select — single-choice control: a trigger showing the current value, and a popover list of
options.

```
absolute top-1/2 right-11 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-sm
text-primary transition-colors data-focus-visible:focus-ring data-hovered:bg-surface-hover
```

### SelectField

SelectField — a single-choice control composed of `Field` + `Select` + label / description /
error slots. The default way to collect one value from a fixed list.

*Composes other components; no classes of its own.*

### Combobox

Combobox — a text input over a known option list: typing narrows the list, and committing an

```
group/combobox flex flex-col
```

**seamless** — false, true

`false`
```
w-full gap-inner-2xs
```

`true`
```
w-auto
```

### ComboboxField

ComboboxField — a `Combobox` composed with `Field` plus label / description / error slots. The
default way to collect one value from a known list too long to browse.

*Composes other components; no classes of its own.*

### RemoteCombobox

RemoteCombobox — a text input over options that only exist once there is a query. The caller
owns fetching: it watches `onQueryChange`, sets `loading` while the request is in flight, and
passes the results as `items`. Nothing is filtered locally.

```
group/combobox flex flex-col
```

**seamless** — false, true

`false`
```
w-full gap-inner-2xs
```

`true`
```
w-auto
```

### RemoteComboboxField

RemoteComboboxField — a `RemoteCombobox` composed with `Field` plus label / description /
error slots. The default way to collect one value from a list the caller fetches per query.

*Composes other components; no classes of its own.*

### Checkbox

Two-state selection with inline label. Read-only keeps the label legible while

```
inline-flex
```

### CheckboxGroup

Multi-selection group of related checkboxes. When wrapped by `<FieldSet>`, takes its
accessible name from the `<legend>` and reads the group's `id`, `invalid`, `required`, and

```
flex gap-inner-md data-[orientation=vertical]:flex-col data-[orientation=horizontal]:flex-row
data-[orientation=horizontal]:flex-wrap data-disabled:cursor-not-allowed
```

### CheckboxGroupField

CheckboxGroupField — a multi-selection group composed of `FieldSet` + `CheckboxGroup` + legend
/ description / error slots. Reach for it whenever the group has a label above it and optional
supporting text.

*Composes other components; no classes of its own.*

### Radio

```
flex flex-col gap-inner-md t overflow.
```

### RadioGroup

Single-selection group of related radios. When wrapped by `<FieldSet>`, takes its accessible
name from the `<legend>` and reads the group's `id`, `invalid`, `required`, and describedby

```
flex flex-col gap-inner-md t overflow.
```

### RadioGroupField

RadioGroupField — a single-selection group composed of `FieldSet` + `RadioGroup` + legend /
description / error slots. Reach for it whenever the group has a label above it and optional
supporting text.

*Composes other components; no classes of its own.*

### Switch

Two-state on/off toggle whose change takes effect immediately (settings, feature flags).
Prefer `Checkbox` when the value participates in a form submit instead — `Switch` has no
invalid, read-only, or required state.

```
group/switch-field inline-grid grid-cols-[auto_1fr] items-center
```

### SegmentedButtons

Single-select control presenting its options as a row of pills, exactly one filled. Selection
cannot be emptied by pressing the selected segment, so a chosen option is replaced rather than
cleared.

```
group/segmented-buttons relative inline-flex items-center rounded-full border border-default
bg-surface-default p-inner-2xs data-disabled:border-disabled
```

### TagPicker

```
group/input-group flex min-h-12 w-full min-w-0 cursor-pointer flex-wrap items-center
gap-inner-xs px-inner-sm py-inner-2xs
```

### TagGroup

```
inline-flex min-w-0 cursor-default items-center gap-inner-xs px-inner-xs py-inner-2xs
text-label whitespace-nowrap select-none [&_svg]:pointer-events-none [&_svg]:shrink-0
[&_svg]:text-secondary data-focus-visible:focus-ring
data-href:not-data-disabled:cursor-pointer data-pressable:not-data-disabled:cursor-pointer
data-selection-mode:not-data-disabled:cursor-pointer data-href:transition-colors
data-pressable:transition-colors data-selection-mode:transition-colors
data-disabled:cursor-not-allowed data-disabled:opacity-50 data-selected:border-strong
rounded-full
```

**variant** — default, success, info, warning, danger

`default`
```
bg-surface-pressed text-secondary
```

`success`
```
bg-success-subtle text-success
```

`info`
```
bg-info-subtle text-info
```

`warning`
```
bg-warning-subtle text-warning
```

`danger`
```
bg-danger-subtle text-danger
```

### FileUpload

Single-file control: one trigger that opens the file picker, showing either the placeholder or
the held file beside a control that clears it. Picking while a file is held replaces it.

```
flex h-12 w-full min-w-0 items-center rounded-md border text-body
has-[[data-file-upload-trigger]:focus-visible]:border-transparent
has-[[data-file-upload-trigger]:focus-visible]:focus-ring
```

**state** — disabled, readOnly

`disabled`
```
cursor-not-allowed border-disabled bg-surface-disabled
```

`readOnly`
```
border-disabled bg-surface-disabled
```

## Dates & times

### DateInput

DateInput — bare date control: one editable segment per date part plus a trigger that opens

```
flex w-full flex-col
```

### DateField

DateField — a date control composed of `Field` + `DateInput` + label / description / error
slots. The default date primitive: reach for it whenever the input has a label above (or
beside) it and optional supporting text.

*Composes other components; no classes of its own.*

### DateRangeInput

DateRangeInput — bare date-span control: a start and an end date on one field surface, each
with one editable segment per date part, plus a trigger that opens a month calendar. Picking a
day sets the start, and the next picks the end. Read-only hides the trigger, since the
calendar is the only thing

```
flex w-full flex-col
```

### DateRangeField

DateRangeField — a date-span control composed of `Field` + `DateRangeInput` + label /
description / error slots. The default date-range primitive: reach for it whenever the input
has a label above (or beside) it and optional supporting text.

*Composes other components; no classes of its own.*

### DateTimeInput

DateTimeInput — bare date-and-time control: one editable segment per date and time part, plus
a trigger opening a month calendar over a time field. Read-only hides the trigger, since the
calendar is the only thing it opens.

```
flex w-full flex-col
```

### DateTimeField

DateTimeField — a date-and-time control composed of `Field` + `DateTimeInput` + label /
description / error slots. The default date-time primitive: reach for it whenever the input
has a label above (or beside) it and optional supporting text.

*Composes other components; no classes of its own.*

### TimeInput

TimeInput — bare time control: one editable segment per time part, accepting typing and arrow-
key stepping.

```
flex w-full flex-col
```

### TimeField

TimeField — a time control composed of `Field` + `TimeInput` + label / description / error
slots. The default time primitive: reach for it whenever the input has a label above (or
beside) it and optional supporting text.

*Composes other components; no classes of its own.*

## Containers & overlays

### Card
Container that groups related content and actions into a single bordered unit.

Header: `flex h-16 items-center gap-inner-md rounded-t-md px-inner-md border-b border-b-subtle
bg-surface-default`. Title: `text-heading-4 text-primary`. Description: `text-body text-secondary`.
End slot: `flex shrink-0 items-center gap-inner-md`.
Content has no classes of its own; **gutter** `true` adds `p-inner-md`, and the default `false`
lets a list's rows reach the card's edges.

Frame:
Container that groups related content and actions into a single bordered unit. Two variants: -
Static — bordered surface with an optional header row. Omit `title` to render body-only.

```
group/card flex flex-col rounded-md border border-subtle bg-surface-default
data-disabled:pointer-events-none
```

**gutter** — true

`true`
```
p-inner-md
```

### Modal
Centred dialog. Its contents are `Dialog`'s parts, which `SidePanel` shares:

Header: `flex items-center gap-inner-xs px-inner-md py-inner-xl`, plus `border-b border-subtle`
when `divider`.
Title: `min-w-0 flex-1 truncate text-heading-3 text-primary`.
Body: `flex min-h-0 flex-1 flex-col gap-inner-md overflow-y-auto p-inner-md text-body`.
Footer (`ActionFooter`): `flex items-center gap-inner-md`, `justify-end` (trailing) or
`justify-between` (split), `border-t border-subtle` when `divider`, and a surface variant —
`p-inner-md` (panel), `px-inner-md py-inner-xl` (dialog).

Dialog root:
```
flex min-h-0 flex-1 flex-col
```

**layout** — trailing, split

`trailing`
```
justify-end
```

`split`
```
justify-between
```

**divider** — true

`true`
```
border-t border-subtle
```

**surface** — page, dialog, panel, inline

`page`
```
bg-surface-default px-inner-md py-inner-xl
```

`dialog`
```
px-inner-md py-inner-xl
```

`panel`
```
p-inner-md
```

`inline`
```
mt-inner-xs pt-inner-md
```

### SidePanel
Full-height panel anchored to the trailing edge of the viewport. The panel is
`overflow-hidden`; `DialogBody` inside it owns the scroll.

Overlay:
```
fixed inset-0 z-50 flex justify-end bg-fill-overlay/40
duration-300 data-entering:animate-in data-entering:fade-in-0
data-exiting:animate-out data-exiting:fade-out-0
```

**size** — sm (`w-120 max-w-full`), md (`w-135 max-w-full`, default), lg (`w-160 max-w-full`)

Panel:
SidePanel — declarative full-height panel anchored to the trailing edge of the viewport.

```
relative flex h-full flex-col
border-l border-subtle bg-surface-default text-primary shadow-medium
overflow-hidden
duration-300 data-entering:animate-in data-entering:slide-in-from-right
data-exiting:animate-out data-exiting:slide-out-to-right
```

**layout** — trailing, split

`trailing`
```
justify-end
```

`split`
```
justify-between
```

**divider** — true

`true`
```
border-t border-subtle
```

**surface** — page, dialog, panel, inline

`page`
```
bg-surface-default px-inner-md py-inner-xl
```

`dialog`
```
px-inner-md py-inner-xl
```

`panel`
```
p-inner-md
```

`inline`
```
mt-inner-xs pt-inner-md
```

### Popover

Marker slot for the trigger element. Its child is what the user presses to open the popover.

```
group/popover z-50 flex w-72 origin-(--trigger-anchor-point) flex-col gap-inner-sm rounded-md
border border-subtle bg-surface-default text-body text-primary shadow-low p-inner-md
outline-hidden duration-100 data-entering:animate-in data-entering:fade-in-0
data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0
data-exiting:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2
data-[placement=left]:slide-in-from-right-2 data-[placement=right]:slide-in-from-left-2
data-[placement=top]:slide-in-from-bottom-2
```

### Tooltip

Contextual popover triggered by hover or focus. Closes when the pointer or focus leaves the
trigger — not suitable for content the reader interacts with.

```
flex flex-col items-start justify-center gap-inner-xs rounded-md p-inner-md bg-surface-inverse
text-inverse origin-(--trigger-anchor-point) data-entering:animate-in data-entering:fade-in-0
data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0
data-exiting:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2
data-[placement=top]:slide-in-from-bottom-2 data-[placement=left]:slide-in-from-right-2
data-[placement=right]:slide-in-from-left-2 duration-100
```

### Separator

Visual and semantic divider between two blocks of content.

```
block shrink-0 border-0 border-subtle aria-[orientation=vertical]:h-full
aria-[orientation=vertical]:w-0 aria-[orientation=vertical]:border-l [:is(hr)]:h-0
[:is(hr)]:w-full [:is(hr)]:border-t
```

### Layout

*Composes other components; no classes of its own.*

## Navigation

### NavBar

A navigation link within a NavBar. Marks itself current via `current`, matching the caller's
active route. Navigation matches `Link`: client-side under a `RouterProvider`, an ordinary
anchor without one. Must be rendered inside a NavBar.

```
group/dropdown-menu-content z-50 max-h-122 origin-(--trigger-anchor-point) overflow-x-hidden
overflow-y-auto rounded-md border border-subtle bg-surface-default text-primary shadow-low
p-inner-2xs duration-100 data-entering:animate-in data-entering:fade-in-0
data-entering:zoom-in-95 data-exiting:animate-out data-exiting:fade-out-0
data-exiting:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2
data-[placement=top]:slide-in-from-bottom-2 data-[placement=left]:slide-in-from-right-2
data-[placement=right]:slide-in-from-left-2 data-exiting:overflow-hidden
```

### Breadcrumb

Trail of ancestor pages leading to the current one. Compound API: `Breadcrumb`

```
flex flex-wrap items-center gap-1.5 text-body wrap-break-word
```

### Tabs

Panel-switching navigation.

*Composes other components; no classes of its own.*

### Pagination

Records-count pagination. Renders a left-aligned `X-Y of Z` summary and right-aligned first,
previous, numbered, next, and last controls.

```
group/pagination-page inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-sm
border px-inner-sm py-inner-2xs text-body transition-colors select-none
focus-visible:focus-ring
```

**isActive** — true, false

`true`
```
border-transparent bg-interactive text-on-interactive
```

`false`
```
border-subtle bg-surface-default text-primary hover:bg-surface-hover
data-disabled:border-disabled data-disabled:bg-surface-disabled data-disabled:text-disabled
```

### CursorPagination

Pagination for sources without a known total row count. Renders only the previous and next
controls, right-aligned.

```
inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-subtle
bg-surface-default p-inner-2xs text-primary transition-colors select-none
hover:bg-surface-hover data-disabled:border-disabled data-disabled:bg-surface-disabled
data-disabled:text-disabled focus-visible:focus-ring
```

### RouterProvider

Bridges React Aria's `RouterProvider` to the host application's router.

*Composes other components; no classes of its own.*

## Data display

### Table

Tabular data, composed from parts mirroring the HTML elements they render:

```
line-clamp-2
```

**constrained** — true

`true`
```
min-w-0
```

### List
Rows of records. Each row is a `<div>` inside an `<li>`, so the last-child rule can close the
run; a wrapper element between `<ul>` and `<li>` breaks it.

**selected** — `false` is `bg-surface-default`; **interactive** `true` adds
`has-[[data-list-item-target][data-focus-visible]]:focus-ring` and, unselected,
`has-[[data-list-item-target][data-hovered]]:bg-surface-hover`.

Target (the padded content area): `flex min-w-0 flex-1 items-center gap-inner-xs py-inner-sm
ps-inner-md outline-hidden`, plus `pe-inner-md` unless a trailing slot is present.
Trailing slot: `flex shrink-0 items-center pe-inner-md`.

Row:
Rows grouped so assistive technology announces the list and its item count. Each direct child
becomes one list item, so pass rows and nothing else.

```
flex w-full items-center gap-inner-xs border-b text-start
[li:last-child>&]:border-b-0
not-has-[[data-list-item-target][data-focus-visible]]:border-subtle
```

**interactive** — true

`true`
```
has-[[data-list-item-target][data-focus-visible]]:focus-ring
```

**selected** — false, true

`false`
```
bg-surface-default
```

`true`
```
bg-surface-selected
```

### Timeline

Vertical feed of dated entries strung along a continuous rail. Each `Timeline.Group` is a node
that expands to reveal whatever the feature hangs off it, typically a `List`. The final node

```
absolute start-0 flex w-8 justify-center
```

**segment** — heading, panel, toMarker

`heading`
```
inset-y-0 group-first/timeline-node:top-1/2
```

`panel`
```
inset-y-0
```

`toMarker`
```
top-0 h-1/2 group-first/timeline-node:hidden
```

### Badge

Numeric counter or presence indicator. Two variants:

```
inline-flex items-center justify-center rounded-full
```

**shape** — dot, number

`dot`
```
size-2
```

`number`
```
px-inner-xs text-label text-inverse
```

**variant** — danger, default, info, success, warning

`danger`
```
bg-danger
```

`default`
```
bg-interactive
```

`info`
```
bg-info
```

`success`
```
bg-success
```

`warning`
```
bg-warning
```

### Banner
Persistent inline notification. `warning` and `error` render as `role="alert"`, the rest as
`role="status"`. Root, then its three parts: an icon slot, a text block, and the body.

**variant** — warning, info, success, error, highlight (default: info)

`error`
```
border-danger bg-danger-subtle
```

`warning`
```
border-warning bg-warning-subtle
```

Icon slot: `flex h-6 shrink-0 items-center justify-center` plus `text-danger` / `text-warning` /
`text-info` / `text-success` / `text-interactive`.
Text block: `flex flex-1 flex-col gap-inner-xs`. Title: `text-body-bold` + the variant colour.
Body: `text-body text-primary`.

Root:
Persistent inline notification. Warning and error variants render as `role="alert"`, others as
`role="status"`.

```
flex items-center gap-inner-md rounded-md border p-inner-md text-body
```

**variant** — warning, info, success, error, highlight

`warning`
```
border-warning bg-warning-subtle
```

`info`
```
border-info bg-info-subtle
```

`success`
```
border-success bg-success-subtle
```

`error`
```
border-danger bg-danger-subtle
```

`highlight`
```
border-interactive bg-interactive-subtle
```

### Loader

Indeterminate loading spinner, exposed as a live region so assistive technology announces it.

*Composes other components; no classes of its own.*

### Icon

Renders an `@core/icons` token as an inline SVG painted in `currentColor`, so a `text-*`
utility on any ancestor colors it.

*Composes other components; no classes of its own.*

### Logo

The Aspen brand lockup: the leaf mark beside the "Aspen" wordmark.

```
flex shrink-0 items-end
```

**size** — sm, md, lg

`sm`
```
gap-inner-xs
```

`md`
```
gap-inner-sm
```

`lg`
```
gap-inner-md
```

### RecencyDot

```
inline-flex h-[13px] w-[3px] flex-col-reverse items-center gap-[2px] overflow-hidden
```

### Relationship

Displays a contact's relationship strength alongside how recently they were last touched. The

```
inline-flex items-end gap-[3px]
```

### RelationshipStrength

*Composes other components; no classes of its own.*

## The five non-component exports

Listed so the account is complete; none is reachable from custom UI either.

| Export | What it is | Your equivalent |
|---|---|---|
| `theme.css` | the compiled token + utility stylesheet | you get it by adopting the host stylesheet (`SKILL.md`, step 1) |
| `initializeThemeMode` | sets `data-theme` on `<html>` for light/dark | nothing to do — the host set it, and the tokens you inherit follow it |
| `i18n` / `i18n/en` | the design system's own string catalogue | supply your own strings; nothing in your UI reads these |
| `routerConfig` | typed route table for `RouterProvider` | use `@aspen-crm/sdk/navigation`, the supported surface |

## Which entry is the root, and which is a part

Many of these components are compound — a frame plus a header, a title, a body, a footer. An
entry's first code block is meant to be the **root**, with the parts named under it. These
entries were read back against the design system's source and are confirmed: Banner, Card,
Input, List, Modal, SidePanel, TextArea, Badge, SegmentedButtons, Button, Popover, Pagination,
CursorPagination, Separator.

The rest were extracted mechanically, and for a compound component the extractor sometimes
captured a **part** rather than the frame. If an entry's classes do not look like the outer
container of the thing you are building (no `border`, no `bg-surface-*`, no layout), treat it
as a part, and build the frame from a confirmed entry of the same family above.

### Entries confirmed wrong

Found by building all 71 and rendering them against the running platform. Each of these is a
part, not the frame — the frame to use is given:

| Entry | What the recipe actually is | Build the frame as |
|---|---|---|
| `Form` | the **ActionFooter** (`flex items-center gap-inner-md`, layout / divider / surface) | a `<form>` stacking fields in a column; the footer recipe is a real `ActionFooter` |
| `NumberInput` | one **stepper button** (`size-6 justify-center text-primary`) | `InputGroup` + input + two steppers |
| `Search` | the **combobox field wrapper** (`group/combobox flex flex-col`) | `InputGroup` + magnifier + input + clear |
| `Select` | the **clear button** (`absolute top-1/2 right-11 … size-6`) | `InputGroup` as the trigger, plus the popover/listbox/option recipes |
| `Table` | the **cell text clamp** (`line-clamp-2`) | `w-full table-fixed border-separate border-spacing-0 text-body-small`, `th` `h-10 … uppercase` |
| `NavBar` | the **dropdown menu content** it can open | a `h-16` row: `border-b border-subtle bg-surface-default px-inner-md` |
| `Timeline` | the **rail segment** (`absolute start-0 flex w-8 justify-center`) | an `<ol>` of nodes, each with rail, marker and content |
| `Radio` / `RadioGroup` | a **truncated extraction** — the literal text `flex flex-col gap-inner-md t overflow.` | no usable recipe; radio has no Tailwind recipe at all (see tokens below) |

## `Input` is an `InputGroup` around a bare control

Caught by diffing against `/ui/objects/account_p/create`. The entry above has `Input` adding
`block h-12 w-full min-w-0 px-inner-sm` to the field surface — the border on the `<input>`.
**The platform does not render it that way.** Its `<input>` is 24px tall with no border, no
background and no padding:

```html
<div data-slot="input-group" class="group/input-group flex min-w-0 cursor-text items-center
     gap-inner-xs rounded-md border border-default bg-surface-default …">   <!-- the surface -->
  <input data-slot="field-control" class="min-w-0 flex-1 bg-transparent text-body
         placeholder:text-placeholder disabled:cursor-not-allowed
         disabled:placeholder:text-disabled">
</div>
```

`TextArea`, by contrast, really does carry the surface itself — so the two cannot be assumed
to follow the same shape, and each has to be checked.

Note also `placeholder:text-placeholder` (not `placeholder-placeholder`), and that
`disabled:cursor-not-allowed` and `disabled:placeholder:text-disabled` **are** generated even
though `disabled:text-disabled` is not. Probe each one.

## A date field's trigger is not an `IconButton`

On `/ui/objects/opportunity_p/create` the control that opens the calendar is:

```
inline-flex size-8 shrink-0 items-center justify-center rounded-md text-primary
transition-colors data-hovered:bg-surface-hover data-focus-visible:focus-ring
group-data-disabled/input-group:text-disabled ms-auto
```

`size-8` with a `size-6` glyph, pushed over with `ms-auto`, and taking its disabled state from
the enclosing input group rather than its own attribute — not the flat `IconButton` (`size-6`)
it resembles. The surrounding slots are `date-picker` → `date-field-surface` (which still
carries the `group/input-group` class) → `date-segments`.

Each segment must be a **direct child** of the segments row. Wrapping one makes the wrapper the
flex item and leaves the segment inline, computing `height: auto` instead of 24px.

## Set `line-height` on the root, not just the font

`SKILL.md` step 2 says to set the root font because preflight puts it on `html`, which a shadow
root does not have. **`line-height` has exactly the same problem and is far easier to miss**,
because the page still looks plausible without it.

```ts
export const rootStyle: CSSProperties = {
    fontFamily: 'var(--ap-sem-font-family-body)',
    lineHeight: 'var(--ap-sem-line-height-body)',   // 24px — preflight puts this on html too
};
```

Without it, every container that has no `text-*` class of its own — an `InputGroup`, a
date-field surface, an icon trigger — inherits `normal` and comes out a different height from
the platform's. Controls carrying their own `text-body` are unaffected, which is what makes it
hard to spot: most of the page is right.

## Token families read off the live page

Verified by rendering every component and reporting each `--ap-*` that resolved to the empty
string. All three of these would have been guessed wrong, and a wrong name fails **silently**:
`var()` falls back and nothing errors.

| What you want | The family is **not** | It is |
|---|---|---|
| a radio's ring and dot | `--ap-comp-radio-*` (that is only label / description / caption text) | **`--ap-comp-radiobase-*`** — `size`, `ring-color-{default,hover,disabled}`, `selected-ring-color-*`, `selected-dot-color-*`, `shadow-focus` |
| a switch's track and thumb | the checkbox's `unselected-*` / `selected-*` shape | **`--ap-comp-switch-*`**, split by on/off **and** track/thumb: `off-track-bg-{default,focus,disabled}`, `on-track-bg-*`, `off-thumb-bg-*`, `on-thumb-bg-*`, `track-{width,padding,radius}`, `thumb-{size,radius}`, `shadow-focus` |
| a corner radius | `--ap-sem-border-radius-*` | **`--ap-sem-radius-*`** — `none` `xs` `sm` `md` `lg` `xl` `full` |

The same `*base` split that catches radio catches the segmented control (`segmentbase`). When
a component has a text half and a control half, the control is usually `<name>base`.

## Classes the platform's build never generated

Only utilities Tailwind already emitted for the platform's own UI exist in the adopted sheet.
These all look completely ordinary, resolve to nothing, and produce no error — the component
simply renders unstyled. Every one below was caught by rendering the gallery and diffing used
classes against defined ones:

```
grid-cols-7   xl:grid-cols-2   border-b-2   w-px      ps-10        mb-1
min-w-24      left-1/2         -translate-x-1/2       bottom-full  top-inner-sm
mr-inner-sm   bg-subtle        disabled:text-disabled has-[:disabled]:text-disabled
```

Arbitrary variants you invent (`[&[data-shown]]:flex`) are never generated either. Write these
as real CSS in a sheet you adopt, not as classes.

**Probe before relying on one**, the same way you probe a token:

```js
const defined = new Set();
const walk = (rules) => { for (const r of rules) {
    if (r.selectorText) for (const m of r.selectorText.matchAll(/\.((?:[\w-]|\\.)+)/g))
        defined.add(m[1].replace(/\\(.)/g, '$1'));
    if (r.cssRules) walk(r.cssRules);
} };
for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
defined.has('grid-cols-7');   // false
```

Note `group/<name>` markers legitimately have no rule of their own — exclude them.

## Make the platform's own `data-disabled:` rules fire on a native element

Nearly every recipe here keys its disabled styling off `data-disabled` or `aria-disabled`,
attributes React Aria sets and a native element never does. The obvious move is to swap them
for `disabled:` — but `disabled:text-disabled` is **not generated** (above), so that silently
produces nothing.

Set the attribute yourself instead, and keep the platform's recipe verbatim:

```tsx
<button data-disabled={disabled || undefined} disabled={disabled} className={buttonClass(variant)}>
```

The design system's own rule then paints a native control, so what renders is the real styling
rather than a lookalike.

## Overlays portalled into the shadow root need an explicit anchor

A popover portalled into the shadow root has no useful containing block. `position: absolute`
with no coordinates drops it at its static position at the **end of the shadow tree** —
thousands of pixels from its trigger — while still reporting itself open, `aria-expanded` and
all. It reads exactly like a popover that failed to open.

Measure the trigger when it opens and place the popover with `position: fixed`:

```ts
const box = trigger.getBoundingClientRect();
setRect({ top: box.bottom, left: box.left, width: box.width });
// style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
```

## Forcing `:hover` and `:focus-visible` from markup

To show a state without the pointer — a gallery, a visual diff — read the platform's own rules
out of the adopted sheet and re-emit them against an attribute selector. Two hazards, both
silent:

- Tailwind escapes the colon **inside** the class name, so `[&:hover]:bg-x` compiles to
  `.\[\&\:hover\]\:bg-x:hover` — the characters `:hover` appear twice and only the last is
  the pseudo-class. Match with a negative lookbehind: `/(?<!\\):hover\b/g`.
- `:focus` is a prefix of `:focus-visible` and `\b` matches before the hyphen, so a `:focus`
  pass running first yields `[data-force-focus]-visible`. Rewrite `:focus-visible` first.

Recurse into `@media (hover: hover)`, which wraps most hover utilities. **Validate the rewrite
once against a real mouse** — force the state, read computed styles, hover the same control for
real, and compare — or every state the page shows is unproven.

## What this catalogue cannot give you

Every entry above is **appearance**. Behaviour is not in these class strings, and it is the
larger half of most of these components: a combobox's keyboard model, a date field's segment
arithmetic and calendar, a modal's focus trap, a table's sort and selection.

Reproduce behaviour with native elements and your own handlers. Do not reach for React Aria —
the platform uses it, but it has no shadow-DOM support in the version shipped here, so
`onPress` never fires and its controls are inert inside custom UI. `SKILL.md` covers this.
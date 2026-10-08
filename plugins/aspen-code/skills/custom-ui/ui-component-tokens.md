# Aspen components and their token families (`--ap-comp-*`)

Companion to `ui-design-tokens.md`, which carries the rules. This file helps you **choose** the
component whose tokens to use. It does not list token names.

## Where the names are

The installed SDK has one typed module per component, generated from its token snapshot:

```sh
ls  typescript/node_modules/@aspen-crm/sdk/dist/tokens/comp/            # one file per family
cat typescript/node_modules/@aspen-crm/sdk/dist/tokens/comp/select.d.ts
```

Each export's JSDoc gives its custom property (`--ap-comp-select-…`) and its value under each
theme and breakpoint, so you can see which semantic token it aliases. The same file is what
`import * as select from '@aspen-crm/sdk/tokens/comp/select'` resolves to. Read only the families
you picked; never guess a name.

Pattern: `--ap-comp-<family>-<part>[-<variant>][-<state>]`. The family is the file name. Some
components are split across several families: a part family (`cardheader`, `menubase`) belongs
with its parent and is styled together with it.

## Choosing a family

Choose by what the control **does**, not what it looks like. A field's meaning decides its control
(see the table in `ui-design-tokens.md`); this table names the token families for that control.

### Form controls

| Family                             | Use for                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `textinput`                        | Single-line text field: label, input, helper and error text.                                                |
| `textarea`                         | Multi-line text.                                                                                            |
| `numberinput`                      | Numeric and currency values. Keeps numeric input semantics; do not reuse `textinput` or `select` styles.    |
| `passwordinput`                    | Masked secret entry.                                                                                        |
| `phoneinput`                       | Phone number.                                                                                               |
| `select`                           | One choice from a fixed list, such as a picklist. Includes the opened menu.                                 |
| `multiselect`                      | Several choices from a fixed list.                                                                          |
| `typeahead`                        | Pick **one record** by searching: a lookup. Not `select`, even for a short list of records.                 |
| `typeaheadmulti`                   | Pick several records by searching; selections show as chips.                                                |
| `contacttypeahead`                 | Pick contacts as recipients, shown as `contactpill`s while typing.                                          |
| `checkbox`, `checkboxgroup`        | Independent yes/no options; the group lays out several with a label.                                        |
| `radio`, `radiobase`, `radiogroup` | One choice from a few options all visible at once. `radiobase` is the ring and dot.                         |
| `switch`                           | An on/off setting that applies immediately. Use a checkbox for a form value submitted later.                |
| `search`                           | Free-text search box filtering a list or page. Not a record lookup.                                         |
| `dateinput`                        | Typed date field.                                                                                           |
| `datepicker`                       | Date field with a calendar popover: `datemenu` is the popover, `calendar` the month grid, `datecell` a day. |
| `daterange`                        | Start and end dates; uses the same `calendar`/`datecell` parts, including range highlighting.               |
| `datetimepicker`                   | Date plus time in one field.                                                                                |
| `timepicker`                       | Time of day.                                                                                                |
| `fileupload`                       | Drop zone and picker for attaching files.                                                                   |
| `document`                         | One attached file: name, size, remove icon.                                                                 |

### Actions

| Family                            | Use for                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `button`                          | Any action button, including its flat and danger variants and icons.                                                      |
| `segmentedbuttons`, `segmentbase` | A small set of mutually exclusive views or modes in one strip, such as a list/board toggle. `segmentbase` is one segment. |
| `overflowmenu`                    | The "…" trigger that opens a menu of secondary actions.                                                                   |
| `link`                            | Inline text links and record navigation.                                                                                  |

### Containers and data display

| Family                                                       | Use for                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `card`, `cardheader`, `cardfooter`                           | A raised section. `cardheader` holds the title and its actions, with its own outer padding.      |
| `table`, `cell`                                              | Data tables like Aspen's list views: header, rows, hover, borders. `cell` is a cell's content.   |
| `filtermini`                                                 | The compact filter popover attached to a table.                                                  |
| `listitem`                                                   | A row in a non-tabular list, inline or stacked with a description.                               |
| `metadata`, `metadatagroup`                                  | Read-only label/value pairs, such as record fields on a detail view; the group lays out several. |
| `accordion`                                                  | Collapsible sections with label and description.                                                 |
| `timeline`, `timelinebase`, `timelinearrow`, `timelinelabel` | A chronological activity feed: entries, their expand arrow, and their label and caption.         |
| `stepper`                                                    | Progress through ordered steps or stages, with complete, active and upcoming states.             |

### Status and feedback

| Family                                                   | Use for                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `badge`                                                  | A small count or dot on another element.                                           |
| `tag`                                                    | A labeled chip for a status or category, optionally dismissible.                   |
| `banner`                                                 | An inline message across a page or section: info, success, warning or error.       |
| `tooltip`                                                | Short hover or focus help.                                                         |
| `relbar`, `relminicard`                                  | Relationship-strength bar and the hover card it opens.                             |
| `followbar`, `followminicard`                            | Follow/own toggle with its star, and the hover card listing followers.             |
| `contactpill`, `basenomenu`, `basewithmenu`, `baseclose` | A contact shown as a pill, internal or external: plain, with a menu, or removable. |
| `avatar`                                                 | A user's avatar and its account menu.                                              |
| `icon`                                                   | Icon size and color outside another component.                                     |

### Navigation

| Family                                     | Use for                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `navbar`                                   | The top application bar. Custom pages render inside it and should not rebuild it. |
| `sidenav`, `sidenavitem`, `groupbase`      | Side navigation, its items, and collapsible item groups.                          |
| `tabs`                                     | Switching between sibling views of one subject.                                   |
| `breadcrumb`                               | Path back to parent pages.                                                        |
| `pagination`                               | Numbered pages when the total is known.                                           |
| `cursorpagination`, `cursorpaginationbase` | Previous/next only, for cursor-paged results without a total.                     |

### Overlays

| Family                                | Use for                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `modal`, `modalheader`, `modalfooter` | A blocking dialog. Do not substitute one for a requested side panel.             |
| `sidepanel`, `sidepanelfooter`        | A panel sliding in beside the page, keeping context visible.                     |
| `menu`, `menubase`                    | A dropdown menu surface and its items, including destructive and disabled items. |

Nothing here fits? Compose from `--ap-sem-*`. Something fits but you are deliberately not
building it? See the exemption in `ui-design-tokens.md`'s "Rebuilding an Aspen component?" rule.

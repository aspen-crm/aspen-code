# Metadata shapes with no compiled example

The loop's first step — find a component in `metadata/active/` or `metadata/platform/` and copy
it — fails for the shapes below: no platform component uses them, so there is nothing to copy. Each was reverse-engineered
against a real instance (platform 26.3.3) and passed checkin. Read this only when step 1 turns up
nothing, or when a `list_view_p` or `tab_p` behaves unlike its JSON suggests.

## Tabs

- `tab-type` is `object_type` (a record list, filed under `object_p/tab_p/`) or `custom_page`
  (filed under the top-level `tab_p/`). A custom-page tab names its page as
  `"page-ui-code": "ui_main_c.<route name>"` — the UI codefile (the CLI always deploys
  `typescript/` as `ui_main_c`), a dot, the route's `name` from `typescript/aspen.client.json`.
- A tab surfaces **only** its `default-list-view`. There is no view picker in 26.3.3, so a second
  `list_view_p` pointing at the same tab is unreachable — don't author one expecting the user to
  find it.

## List views

- A list view **always renders its object's `display-field` first**, as the record-linking
  column, whether or not you declare it. On a join object (`contact_rel_p`) that field is the
  uniqueness key — raw UUIDs lead the table, and no column order you author changes that.
- `query-filter` is a `WHERE` fragment. It takes `CURRENT_USER()` and dot-walked predicates
  (`employee_p.user_p = CURRENT_USER()`); the AQL rules in `query-notes.md` apply to it.
- **Columns can dot-walk, but never as a dotted `field` string** — `"field": "product_p.sku_p"`
  parses as a literal field name and fails "unresolved reference". The shape is three-part:
  `field` is the lookup hop on the base object, `expression` is the dotted path, `relationships`
  names the target object and field:

  ```json
  {
    "name": "sku_c",
    "column-type": "relationship",
    "field": "product_p",
    "expression": "product_p.sku_p",
    "relationships": [{ "object": "product_p", "field": "sku_p" }]
  }
  ```

  `column-type` is one of `field` (the default — a plain column, `field` alone), `relationship`
  (the three-part shape above), or `expression`.

## Reading the instance before you author

- `aspen init` fetches `metadata/platform/` and `metadata/active/` from the instance, and they are
  what `aspen compile --metadata` validates against. If either is stale — someone else deployed
  since — run `aspen init` again from **inside** the instance directory: it re-fetches both and
  never overwrites your files. Your overlays of platform components land in the **custom** tier;
  verify one in `active/` after a deploy, not in `platform/`, which keeps the stock values.
- **Undocumented enum values** (a `tab-type`, a `column-type`): compile a bogus value with
  `aspen compile --metadata` and read the error, which usually lists the accepted ones. That
  proves what the validator accepts, not that the server honors it at runtime.

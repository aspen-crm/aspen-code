# Metadata behavior the docs do not cover

The attribute reference for list views and tabs is in the Aspen docs (`aspen-docs` MCP →
`platform/component-types/list-view`, `…/tab`). This file holds only what was observed on a real
instance (platform 26.3.3) and is not in them. Read it when a `list_view_p` or `tab_p` behaves
unlike its JSON suggests.

## Tabs

- A `custom_page` tab that passed check-in named its page as
  `"page-ui-code": "ui_main_c.<route name>"` — the UI codefile (the CLI always deploys
  `typescript/` as `ui_main_c`), a dot, the route's `name` from `typescript/aspen.client.json`.
  **The docs show a URL template instead;** if one form is rejected, try the other and record which
  passed as a lesson (see `diagnose`).
- A tab surfaces **only** its `default-list-view`. There is no view picker, so a second
  `list_view_p` pointing at the same tab is unreachable.

## List views

- A list view **always renders its object's `display-field` first**, as the record-linking
  column, whether or not you declare it. On a join object (`contact_rel_p`) that field is the
  uniqueness key — raw UUIDs lead the table, and no column order changes that.
- `query-filter` takes `CURRENT_USER()` and dot-walked predicates
  (`employee_p.user_p = CURRENT_USER()`); the AQL rules in `../server-code/query-notes.md` apply.
- A dotted `"field": "product_p.sku_p"` parses as a literal field name and fails "unresolved
  reference". Dot-walking is a `relationship` column (`field` = the lookup hop, `expression` =
  the path, `relationships` = target object and field) — the docs have the shape.

## Reading the instance before you author

- `aspen init` fetches `metadata/platform/` and `metadata/active/`, and `aspen compile --metadata`
  validates against them. If they are stale — someone else deployed since — run `aspen init` again
  from **inside** the instance directory: it re-fetches both and never overwrites your files.
  Verify a platform overlay in `active/` after a deploy, not in `platform/`, which keeps the stock
  values.
- **Undocumented enum values:** compile a bogus value with `aspen compile --metadata` and read the
  error, which usually lists the accepted ones. That proves what the validator accepts, not that
  the server honors it at runtime.

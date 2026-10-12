# Metadata behavior the docs do not cover

The attribute reference for list views and tabs is in the Aspen docs (`aspen-docs` MCP →
`platform/component-types/list-view`, `…/tab`). This file holds only what is not in them, checked
against platform 26.4.1 unless marked as observed on a live instance. Read it when a `list_view_p`
or `tab_p` behaves unlike its JSON suggests.

## Tabs

- A `custom_page` tab names its page as `"page-ui-code": "ui_main_c.<route name>"` — the UI
  codefile (the CLI always deploys `typescript/` as `ui_main_c`), a dot, the route's `name` from
  `typescript/aspen.client.json`. **Only this form resolves.** The URL template the docs show
  compiles (the validator checks only that it is a string), but the tab routes to page-not-found.
- A `custom_page` tab's own name takes no dot (`budget_page_c`); an object tab's does
  (`<object>.<segment>`).
- A tab opens on its `default-list-view`. Other active `list_view_p` on the same object and tab
  appear only in the Saved Views panel (and at `?view=<list view name>`).

## List views

- A list view renders its object's `display-field` first, as the record-linking column; on a live
  instance it appeared whether or not it was declared. On a join object (`contact_rel_p`) that
  field is the uniqueness key — raw ids lead the table, and no column order changes that.
- `query-filter` takes `CURRENT_USER()` and dot-walked predicates (on `team_role_p`:
  `team_p.user_p = CURRENT_USER()`); the AQL rules in `../server-code/query-notes.md` apply.
- A dotted `"field": "product_p.sku_p"` failed "unresolved reference" on a live instance: a
  `field` column names one field. Dot-walking is a `relationship` column that carries **only**
  `expression` (the path, `product_p.sku_p`). `field` and `relationships` are derived from it at
  check-in, and authoring either fails "must not be specified; it is derived from 'expression'".
  This is the same for a layout section's columns.
- A hop through a polyid names the target object with `->`:
  `customer_p->account_p.industry_c`.
- A list view's `sort` names a **column** by its `name`, not the field the column shows.

## Reading the instance before you author

- `aspen init` fetches `metadata/platform/` and `metadata/active/`, and `aspen compile --metadata`
  validates against them. If they are stale — someone else deployed since — run `aspen init` again
  from **inside** the instance directory: it re-fetches both and never overwrites your files.
  Verify a platform overlay in `active/` after a deploy, not in `platform/`, which keeps the stock
  values.
- **Undocumented enum values:** compile a bogus value with `aspen compile --metadata` and read the
  error, which usually lists the accepted ones. That proves what the validator accepts, not that
  the server honors it at runtime.

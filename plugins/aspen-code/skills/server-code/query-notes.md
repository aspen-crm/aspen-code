# Query notes — what the AQL docs do not say

The AQL reference (clauses, `LIMIT`/`OFFSET`, functions, joins, `ROWCOUNT`) is in the Aspen docs:
ask `aspen-docs` ("AQL LIMIT", "AQL joins", "row count"), and the Query Service page for the Rust
API. This file is only what those pages leave out, checked against the 26.4.1 query engine unless
marked *observed on a live instance*. It applies to trigger queries
(`context.services().query()`) and list-view `query-filter`s alike.

## Before writing a query

- **Resolve every field against metadata.** Display fields differ by object: `user_p` has
  `username_p`, not `name_p`. Select `posted_by_c.username_p AS posted_by_name_c`, never a guessed
  `name_p`. Use API names, not labels or object-type aliases.
- **Never interpolate request-supplied text into a statement.** Build it from `Uuid`s and
  constants. (The docs' Query Service example formats an email into the string — don't copy that
  for user input.)

## Traps

- **`LIMIT` is required and at most 1000; `OFFSET` at most 10000.** A larger value is rejected,
  not capped. Page with `LIMIT n OFFSET m` and a deterministic `ORDER BY` (add `id_p` to break
  ties); `SKIP` does not exist. Anything that totals or filters a full result must consume every
  page, and past 10000 rows it needs a narrower `WHERE`, not a bigger offset.
- **`ORDER BY` only takes sortable fields** (indexed or unique; describe marks them `sortable`).
- **A long text field (`text`/`long`) comes back cut at 255 characters**, silently, when selected
  plainly. Select `LONGTEXT(notes_c) AS notes_c` for the full value; the alias is required, and
  it works through a dot-walk (`LONGTEXT(owner_c.bio_p) AS bio_c`). `LONGTEXT` on any other field
  is rejected.
- **Checkbox, number, percentage and currency literals are unquoted** (`is_active_c = true`);
  ids, text, picklists and dates are quoted.
- `IN ('id1','id2',…)` works; chunk a long computed id set (the patterns use 100).
- **`CURRENT_USER()` compares only against a user-reference field, with `=` or `!=`**: an `id`
  lookup/parent to `user_p`, or a polyid that allows `user_p` — `owner_p` on `case_p`, `lead_p`,
  `opportunity_p`, `task_p`; `team_p.user_p`. On `account_p` and `contact_p`, `owner_p` is a
  team, so compare `owner_p.user_p = CURRENT_USER()`. `WHERE id_p = CURRENT_USER()` on `user_p`
  is rejected.
- **`LIKE` supports only a trailing wildcard.** `LIKE 'Bio%'` works; `'%Bio%'` and a non-trailing
  `_` are rejected. Escape `%`/`_` in user-supplied prefixes as `\%`/`\_`.
- **Null tests are `IS NULL` / `IS NOT NULL`.** `signed_date_c != null` is not AQL. Text stores
  an empty value as NULL, so `= ''` never matches.
- Record writes from a trigger take at most 500 records per request; more is a whole-batch
  failure.

## Dot-walking

- Two hops work in `SELECT` and `ORDER BY` (`contact_p.primary_account_p.name_p`)
  *(observed on a live instance)*.
- **Many-to-one only**, through a lookup or parent field. A parent cannot reach its children —
  query the child (join) object and dot-walk up.
- **A polymorphic (polyid) field needs its target named with `->`** before a dot-walk; the error
  lists the allowed targets.
- **Result keys are the leaf field name only**, so `contact_p.name_p` and
  `contact_p.primary_account_p.name_p` collide ("Output field names in query must be unique").
  Alias with `AS`.

## Picklists

Picklist values in queries, comparisons and writes are the item's technical `name`
(`closed_won_p`), never its label, and they must match the metadata byte for byte. In a `WHERE`,
AQL rejects a value that is not an item of the field's picklist at query time. A value a trigger
*writes* is not checked until the save.

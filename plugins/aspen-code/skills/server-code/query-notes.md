# Query notes — what the AQL docs do not say

The AQL reference (clauses, `LIMIT`/`OFFSET`, functions, joins, `ROWCOUNT`) is in the Aspen docs:
ask `aspen-docs` ("AQL LIMIT", "AQL joins", "row count"), and the Query Service page for the Rust
API. This file is only what real sessions hit that those pages leave out (observed on platform
26.3.3). It applies to trigger queries (`context.services().query()`) and list-view
`query-filter`s alike.

## Before writing a query

- **Resolve every field against metadata.** Display fields differ by object: `user_p` has
  `username_p`, not `name_p`. Select `posted_by_c.username_p AS posted_by_name_c`, never a guessed
  `name_p`. Use API names, not labels or object-type aliases.
- **Never interpolate request-supplied text into a statement.** Build it from `Uuid`s and
  constants. (The docs' Query Service example formats an email into the string — don't copy that
  for user input.)

## Traps

- **One line.** A newline truncates the query after line 1 — the rest is silently dropped, and
  the error is about the fragment that survived.
- **A query returns at most 100 rows, whatever the `LIMIT`.** Page with `LIMIT n OFFSET m` and a
  deterministic `ORDER BY` (add `id_p` to break ties); `SKIP` does not exist. Anything that
  totals or filters a full result must consume every page.
- **A long text field (`text`/`long`) comes back cut at 255 characters**, silently, when selected
  plainly. Select `LONGTEXT(notes_c) AS notes_c` for the full value; the alias is required, and
  it works through a dot-walk (`LONGTEXT(owner_c.bio_p) AS bio_c`). `LONGTEXT` on any other field
  is rejected.
- **Checkbox and number literals are unquoted** (`is_active_c = true`); ids and text are quoted.
- `IN ('id1','id2',…)` works; chunk a computed id set at 100.
- **`CURRENT_USER()` compares only against a user-reference field** (`owner_p`,
  `employee_p.user_p`). `WHERE id_p = CURRENT_USER()` on `user_p` is rejected.
- **`LIKE` supports only a trailing wildcard.** `LIKE 'Bio%'` works; `'%Bio%'` and a non-trailing
  `_` are rejected. Escape `%`/`_` in user-supplied prefixes.
- **Null predicates can produce a misleading error.** `signed_date_c != null` once failed with
  "SELECT queries require a LIMIT clause" although `LIMIT` was present. Isolate the predicate
  before believing the parser; validate any replacement on the instance.
- Record writes take at most 100 records per request.

## Dot-walking

- Two hops work in `SELECT` and `ORDER BY` (`contact_p.primary_account_p.name_p`).
- **Many-to-one only**, through a lookup. A parent cannot reach its children — query the child
  (join) object and dot-walk up.
- **Result keys are the leaf field name only**, so `contact_p.name_p` and
  `contact_p.primary_account_p.name_p` collide ("Output field names in query must be unique").
  Alias with `AS`.

## Picklists

Picklist values in queries, comparisons and writes are the item's technical `name`
(`closed_won_c`), never its label, and they must match the metadata byte for byte — nothing checks
a mismatch at compile time.

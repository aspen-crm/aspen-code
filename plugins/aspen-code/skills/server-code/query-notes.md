# Query notes (AQL and the data API)

Read this before writing a query — from a page (`@aspen-crm/sdk/request` against the instance's
data endpoints) or from a trigger (`context.services().query()`, see `rust-trigger-notes.md`).
Both speak the same AQL. The platform behavior below was observed on a real instance (platform
26.3.3); unresolved syntax is called out explicitly. UI guidance preserves the distinction
between stored values and their display labels.

## Resolve the schema first

Check the source object's fields and every lookup target using Describe or the resolved local
metadata before constructing a query. Display fields differ by object: `user_p` has `username_p`,
not `name_p`. For a lookup to `user_p`, select `posted_by_c.username_p AS posted_by_name_c`, not
`posted_by_c.name_p`. Use the schema's actual field names, not labels or object-type aliases.

## Syntax and limits

- **One line.** A newline truncates the query after line 1 — the rest is silently dropped, and
  any error is about the fragment that survived.
- **`LIMIT` is mandatory** and maxes at **1000** (`LIMIT 2000` → `MAX_VALUE_FAILURE`). A query
  returns at most **100 rows** regardless. A fetch-everything design therefore has a hard
  ceiling; never use one for anything that grows.
- **`LIMIT n OFFSET m`** pages. `SKIP` does not exist ("Unexpected content after query").
  Use a deterministic `ORDER BY`, adding `id_p` to break ties. Totals and client-side filters
  over a complete result set must consume every page, not just the first 100 rows.
- Checkbox and number values in `WHERE` are unquoted (`is_active_c = true`); ids and text are
  quoted.
- `IN ('id1','id2',...)` works. Chunk a computed id set at 100 and fire the chunks in parallel
  (`Promise.all`), never a serial `for await` loop.
- `WHERE` takes `OR`, parentheses and dot-walked predicates together:
  `employee_p.user_p = CURRENT_USER() AND (follows_p = true OR contact_p.owner_p = CURRENT_USER())`.
- **`CURRENT_USER()` only compares against a user-reference field**, such as `owner_p` or
  `employee_p.user_p`. `SELECT id_p FROM user_p WHERE id_p = CURRENT_USER() LIMIT 1` is rejected:
  "CURRENT_USER may only be used with a user-reference field." Prefer the reference predicate
  when filtering records for the current user. Do not copy a developer's username into production
  code as a workaround. The function is absent from the `ac` validator binary's `strings` output;
  that says nothing about the server.
- **`LIKE` supports only a trailing wildcard.** `LIKE 'Bio%'` works; `LIKE '%Bio%'` and a
  non-trailing `_` are rejected. Escape literal `%` and `_` in user-supplied prefixes with a
  backslash before appending `%`. A substring search cannot be expressed with this operator.
- Batch writes take at most 100 records per request.

### Null predicates and misleading errors

Do not assume SQL syntax is accepted by AQL. In the services finance session, a query containing
`signed_date_c != null` failed with "SELECT queries require a LIMIT clause" even though the paging
helper appended `LIMIT`. Removing that predicate, selecting `signed_date_c`, and filtering the
paged results in JavaScript succeeded. This establishes a workaround, not the supported syntax
for all null comparisons; `IS NOT NULL` was not verified in that session.

Inspect the final query sent by the helper and isolate the failing predicate before following a
parser error literally. Validate any replacement predicate on the target instance. If filtering
client-side, keep the other server-side scope filters and fetch all pages needed by the result;
do not silently filter just one page or use partial results for totals.

## Picklist values and UI labels

A picklist item has a technical `name` and a display `label`. The technical name is the stored
and API value: `usd_p` is valid Aspen data. Use it in writes, query predicates, comparisons and
form option values. Every visible picklist value — options, selected text, cells, badges and
read-only details — must use the matching item's **label from metadata**.

Resolve the field's picklist component from its schema, then load that picklist's items through
Describe or the app's existing metadata helper. The component name need not equal the field name.
Cache by picklist component and map `item.name` to `item.label`; keep both values separate:

```ts
// item comes from the field's picklist metadata.
option.value = item.name;       // submitted technical value, e.g. usd_p
option.textContent = item.label; // visible label, e.g. USD
```

Never manufacture labels by removing `_p`/`_c`, replacing underscores, title-casing, uppercasing,
or maintaining a parallel hardcoded label table. Preserve labels for retired items still present
on records even when those items are excluded from new selections. If metadata is unavailable or
an item cannot be resolved, preserve the underlying value and show an explicit unavailable-label
state; do not substitute a guessed label or silently select another value.

**Currency formatting is a separate boundary.** A currency field's code lookup points to a
`currency_p` record; `ccode_p.currency_code_p` returns a picklist technical name such as `usd_p`.
`Intl.NumberFormat` requires an ISO currency code and rejects `usd_p`. The platform
`currency_code_p` picklist labels are ISO codes (`usd_p` has label `USD`): resolve that metadata
label and validate it for the formatter. If another source uses descriptive labels, obtain an
explicit ISO mapping for that source instead. Never rewrite the Aspen value, infer a generic
label from its suffix, or silently format an unresolved currency as USD.

## Dot-walking

- Works to **two hops** in `SELECT` (`contact_p.primary_account_p.name_p` returns the account's
  name, not its id) and in `ORDER BY` — which is what makes `OFFSET` paging stable.
- **Many-to-one only**, through a lookup field. A parent cannot reach its children: `contact_p`
  has no path to `contact_rel_p` ("Invalid field 'contact_rel_p' in object 'contact_p'"), because
  one contact has many relationship rows. Query the child (join) object and dot-walk up instead.
- **Response keys are the leaf field name only**, so `contact_p.name_p` and
  `contact_p.primary_account_p.name_p` collide. Alias with `AS`. Without it the query fails
  cleanly ("Output field names in query must be unique") rather than losing data.

## Counting

- **`/data/count` is a separate endpoint with its own verb, `ROWCOUNT`** — not `SELECT COUNT()`.
  `ROWCOUNT FROM contact_p WHERE owner_p = CURRENT_USER()` returns
  `{"count":18,"has_more_rows":false}` at flat cost for any table size. `/data/query` rejects
  `ROWCOUNT` and `/data/count` rejects `SELECT`; the error names both ("Query must start with
  'SELECT' or 'ROWCOUNT'").
- Native list views get their "of 151" this way. They do not fetch all rows to count, and neither
  should a custom page.

## Cost model

**Per-request overhead dominates; row count barely matters.** One `/data/query` costs about the
same whether it returns 25 rows or 500. Optimise by cutting round trips and running the ones you
keep in parallel — never by trimming columns or rows. A native list-view tab spends most of its
cold-load calls on `describe/*` metadata (cached after the first load); a custom page skips those,
so it starts ahead and loses only by making more data round trips than it needs.

The shape that wins, for a paged table:

1. On load, in parallel: the `ROWCOUNT`(s) the header needs, and one
   `SELECT … LIMIT <page> OFFSET 0`.
2. On a page turn: one `SELECT … LIMIT <page> OFFSET <n>`, nothing else.

A few calls on load, one per page, flat at any table size.

## Pattern: "records related to me"

Query the **join object** — it holds both the link and the join's own fields — filter it on the
current user, dot-walk the parent's detail off its lookup, count with `ROWCOUNT`, page with
`LIMIT/OFFSET`. Going the other way, from the parent down to its joins, is impossible (see
dot-walking). The shape, shown wrapped but sent as one line:

```
SELECT contact_p.name_p AS contact_name, contact_p.primary_account_p.name_p AS account_name
FROM contact_rel_p WHERE employee_p.user_p = CURRENT_USER()
ORDER BY contact_p.name_p LIMIT 25 OFFSET 0
```

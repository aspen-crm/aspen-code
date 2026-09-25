# Rust trigger notes

Read this only when you're actually authoring a Rust trigger, and after `trigger-patterns.rs`
beside it — that file is six handlers that fired on a real instance (and build unchanged against
the crate `aspen init` scaffolds), and copying the nearest one is faster than learning the rules
first. This file is the rules those patterns obey, for when none of them is your case. The
`aspen_crm` crate's own docs.rs coverage is thin; every fact below was hit in a live session, not
inferred.

## One crate, at `rust/`, and the CLI names the codefile

`aspen init` scaffolds the instance's one server crate in `rust/`, named after the instance
(`acme_dev_c`). **Leave the name alone.** The crate name is only how `aspen move save-package`
finds the built `.wasm`; it always deploys that component as the codefile `server_main_c`, the
only server codefile name the platform loads. (Older projects had to name the crate directory
`server_main_c` by hand, and a crate under any other name compiled, checked in, and never fired.
The CLI now does it for you — which is why nothing should be renamed.)

The trigger's identity — the `"name"` in `aspen.server.json`'s `record-triggers` entry, which
`entrypoints!` turns into the trait your `impl` block implements — is a separate string and can be
anything valid. Add every trigger and web API to this one crate: one `aspen.server.json`, one
`src/lib.rs` with `entrypoints!`, a module per handler.

## Before the first compile

The scaffold already did the two things that used to cost hours; keep them:

1. **`rust/rust-toolchain.toml` pins the channel and the `wasm32-wasip2` target.** Don't delete
   or loosen it. On any other channel the crate compiles and links, then fails componentization:
   ```
   error: failed to parse core wasm for componentization
     0: decoding custom section component-type:wit-bindgen:0.58.0:aspen-entrypoints:...
     1: invalid leading byte (0x63) for component defined type
   ```
   It names wit-bindgen, so it reads as a dependency problem. It is not — it is the toolchain's
   `wasm-component-ld` disagreeing with what `aspen-crm`'s macro emits. Check the pin first.
2. **`rust/Cargo.lock` is committed, and `aspen compile --rust` builds `--locked`.** Adding a
   dependency (the patterns use `jiff = "0.2"`) means updating the lock once:
   `cd rust && cargo update -p <crate>` (or `cargo generate-lockfile`), then commit it.
3. **`aspen-crm` is pinned exactly** (`"=0.1.0"`) and must match the release the instance serves,
   together with the two TypeScript packages. Raise all three together when the instance moves —
   never just one. `aspen doctor` checks it (`rust.sdk-pin`).

Per machine: rustup, and `rustup target add wasm32-wasip2` (doctor: `toolchain.wasm-target`).

**Unit tests:** `rust/.cargo/config.toml` sets the wasm target and a runner (`aspen test
rust-runner`), so `cargo test` in `rust/` runs the tests as wasm through the CLI. Keep business
logic in plain functions so it can be tested without a record context.

## Registration: `aspen.server.json`

```json
{ "record-triggers": [ { "name": "<trigger>_c", "object": "<object>", "events": ["after_update"] } ] }
```

`events` takes exactly these six strings: `before_insert`, `after_insert`, `before_update`,
`after_update`, `before_delete`, `after_delete`. Each maps to a context type of the same name
(`AfterUpdateContext`) and a method of the same name on the trait `entrypoints!` generates from
`name`. Neither `object` nor `events` is checked against metadata at compile time.

## When the notes don't cover it: read the crate source, not docs.rs

After the first build the crate is on disk, and grepping it is the one reliable way to confirm a
type, variant or method name:

```
ls -d ~/.cargo/registry/src/*/aspen-crm-*/src/
```

`record/types.rs` has the `RecordFieldValue` enum (every variant), `record/trigger/*.rs` has
each context type and what its records expose (`get`/`set` on before-* records, `get` on
after-* records, `id()` only on delete records), `services/` has the query and record builders.
`aspen-crm-macros` is a dead end for a componentization error — that comes from the toolchain,
see above, not from what `entrypoints!` generates.

## Inserting a record

```rust
let input = RecordInput::builder()
    .field("subject_p", RecordFieldValue::Text("...".to_string()))
    .field("owner_p", RecordFieldValue::PolyidParent(owner_id))
    .field("owneron_p", RecordFieldValue::PicklistObjectRef("user_p".to_string()))
    .build()?;
let request = InsertRequest::builder("task_p").record(input).build()?;
let result = context.services().record().execute_insert(request)?;
```

The object name (`"task_p"`) is the `InsertRequest` builder's argument, not a field on
`RecordInput`. `execute_insert` is a method on `RecordService` (`context.services().record()`),
not on the request builder — an easy pair to get backwards, and the compiler catches it, but only
after you've written the wrong version first.

`task_p.owner_p` is `PolyidParent` here, not `IdLookup`, because that's what its own field
metadata says (`type: polyid`, `subtype: parent`); `owneron_p` is `owner_p`'s discriminator
companion and has to be set alongside it — see "Field types: which `RecordFieldValue` variant to
write" below for both the variant table and why the discriminator is never optional, even here
where `owner_p` only ever points at `user_p`. Bind `execute_insert`'s return value and check it —
see "Debugging a trigger" below for why a bare `execute_insert(request)?;` hides exactly the errors
you need to see while getting this shape right the first time.

## Reading fields in a trigger

`AfterUpdateContext`'s batch holds only the fields that *changed* in this update — checking
`record.get("field_c")` for a value already means the transition happened; there's no need to
compare old vs. new yourself. But that also means untouched fields aren't in the batch at all —
read anything else about the record (its name, an unrelated field) with a separate query.

**`id_p` is the one exception.** It never "changes", but `record.get("id_p")` still returns
`FieldState::Value(RecordFieldValue::Id(id))` on every record in the batch. Confirmed from the
platform's `record-trigger` WIT interface: `before-delete-record`/`after-delete-record` get a
dedicated `id()` accessor, but the insert/update record types
(`immutable-object-record`/`mutable-object-record`) do not — `get("id_p")` is the *only* way those
triggers can identify which record they're looking at, so the platform has to populate it
regardless of the changed-only rule. If a match on it ever falls through to your catch-all arm,
look elsewhere first (field name typo, wrong variant) — it almost never means the id is missing.

Use the id to read anything else about the record with a separate query. **`SELECT` requires a
`LIMIT`** — a query without one is rejected at query time; adding `LIMIT 1` (nothing else changed)
turned a real query from failing to working. The rest of the AQL rules — one line only, `LIMIT` at
most 1000, two-hop dot-walking, `AS` when two leaf names collide — are in `query-notes.md` beside
this file; it is the same query language a page sends, so they apply here too:

```rust
let id = /* from record.get("id_p") */;
let query = context.services().query()
    .query(format!("SELECT name_c, account_c FROM org_c WHERE id_p = '{id}' LIMIT 1"))
    .build()?;
let rows = context.services().query().execute(query)?;
```

A query row's cells are `Option<ValidFieldValue>` — a different type from a batch record's
`FieldState`, with its own match shape:

```rust
match row.get(0) {
    Some(Some(ValidFieldValue::RecordFieldValue(RecordFieldValue::Text(name)))) => name.clone(),
    _ => /* absent, null, or a type you didn't expect for this column */,
}
```

A *lookup* column doesn't reliably come back as one single `RecordFieldValue` variant — match more
than one with an or-pattern rather than picking one and hoping:

```rust
match row.get(1) {
    Some(Some(ValidFieldValue::RecordFieldValue(
        RecordFieldValue::Id(id) | RecordFieldValue::IdLookup(id),
    ))) => id,
    other => /* absent, null, or still something else — widen the pattern if you hit this */,
}
```

This is what actually fixed a real trigger's queries: matching only `RecordFieldValue::Id` left
every row unmatched, falling through to the catch-all silently, on every run. It is not necessarily
the same variant you'd use to *write* that field (see "Field types" below) — reading and writing a
lookup/polyid field are different code paths with independently-confirmed shapes.

## Field types: which `RecordFieldValue` variant to write

The variant is `<Type><Subtype>`, matching the field's *own* metadata `type`/`subtype` exactly —
not something to infer from the field's name or from how many `allowed-objects` a polyid has.
Check the field's `type`/`subtype` (its metadata JSON, or the compiled one) before writing it:

| `type` / `subtype` | variant |
|---|---|
| `id` / `lookup` | `RecordFieldValue::IdLookup` |
| `id` / `parent` | `RecordFieldValue::IdParent` |
| `polyid` / `lookup` | `RecordFieldValue::PolyidLookup` |
| `polyid` / `parent` | `RecordFieldValue::PolyidParent` |
| `picklist` / `object_ref` | `RecordFieldValue::PicklistObjectRef` |

The last row is a polyid's **discriminator** field (`owneron_p` for `owner_p`, `whaton_p` for
`what_p`) — shaped like a plain picklist (one `String`), but its own distinct variant, not
`RecordFieldValue::Picklist`. Writing it as `Picklist` compiles clean (both variants wrap a
`String`) and only fails at `execute_insert`, inside `result.failures()` — invisible unless you
check that explicitly (see "Debugging a trigger" below).

**Confirmed the hard way, not from the docs:** `task_p.owner_p` and `task_p.what_p` are both
`polyid`/`parent` fields — `owner_p` restricted to one object (`user_p`) via `allowed-objects`,
`what_p` open to several. A trigger that wrote both with `RecordFieldValue::IdLookup` — reasoning
"it only points at one kind of object, so it's basically a lookup" — compiled clean, checked in
clean, and inserted nothing: no task record, no error surfaced where the human was looking, just a
trigger that appeared to do nothing. Restricting a polyid to one `allowed-objects` entry doesn't
turn it into an `id`/`lookup` field; it's still `type: polyid`, and still needs `PolyidLookup` or
`PolyidParent` — never `IdLookup`, which is only correct for a field whose own `type` is `id`, e.g.
`account_p.owner_p`.

**Every polyid's discriminator field has to be set, not just an "open" one.** `task_p.owner_p` is
restricted to a single `allowed-objects` entry (`user_p`) — that did *not* exempt it from needing
`owneron_p` set alongside it; the insert failed validation (`result.failures()`) the same way an
open polyid missing its discriminator would. `allowed-objects` restricting a polyid to one entry is
a validation/display convenience on the platform side, not a signal that the discriminator becomes
optional or gets inferred:

```rust
.field("owner_p", RecordFieldValue::PolyidParent(owner_id))
.field("owneron_p", RecordFieldValue::PicklistObjectRef("user_p".to_string()))
.field("what_p", RecordFieldValue::PolyidParent(org_id))
.field("whaton_p", RecordFieldValue::PicklistObjectRef("org_c".to_string()))
```

This is all about *writing* a field on a `RecordInput`. Reading one back — from a batch record or
a query row — is a different code path with its own variant; don't assume it round-trips the same
way (see "Reading fields in a trigger" above).

## Date arithmetic for a `date` field

`RecordFieldValue::Date` wraps a `jiff::civil::Date` — a calendar date, not `jiff::Timestamp` (an
instant) or `jiff::Zoned` (an instant with a time zone attached). Getting "N days from now" needs
converting to the right type *before* adding the calendar span, not after:

```rust
use jiff::{Span, Timestamp};

let due_date = Timestamp::now()
    .in_tz("UTC")                                            // -> Result<Zoned, Error>
    .map(|z| z.date().saturating_add(Span::new().days(7)))    // Zoned -> Date, then add on the Date
    .unwrap_or_else(|_| jiff::civil::Date::new(2000, 1, 1).unwrap());
```

`Timestamp::now() + Span::new().days(7)` **compiles clean and fails at runtime, not compile time**:
*"adding span to timestamp failed: operation can only be performed with units of hours or smaller,
but found non-zero 'day' units"*. A `Timestamp` is a point on a fixed timeline with no calendar
attached to it, so a calendar-unit `Span` (`.days()`, `.months()`, …) is a well-typed operation on
it that only jiff's own runtime check rejects — the type system doesn't catch it, so this one only
shows up once the trigger actually fires, as an `after trigger error` on the save, not as a compile
error. Convert to a `Date` first (`.in_tz(<zone>)`, a `&str` — not a `TimeZone` value — returning
`Result<Zoned, Error>`, then `.date()`), and add the calendar span to *that*.

## Smaller confirmed facts

Each of these cost a live debugging round; none is in the crate docs.

- **`after_delete` exposes only `id()`, and the row is already gone** — nothing else about the
  record can be read from inside it. If the handler needs the record's fields, use `before_delete`
  and query the row there.
- **Picklist items are parent-scoped.** An item defined under one object is rejected when written
  on another — `decision_maker`/`influencer` exist on opportunity only, `champion`/`detractor` on
  account only. Checkin doesn't catch it; the end user's save does, as an error on *their* write
  when the trigger fires. Check the item's parent in its picklist JSON before writing it.
- **A trigger whose write lands back on its own object needs a write-only-on-change guard**, or
  it re-fires itself (an `org_health_c` handler that writes `org_c` is the shape to watch for).
  Compare before writing.
- `runtime_context().current_user_id()` is the acting user — for an owner field, or to skip
  system-initiated writes.
- Names and constructors that are easy to get wrong: `RecordFieldValue::Datetime` (lowercase
  `t`); `Decimal::new(n, scale)` for a comparison against a `number`/`currency` value;
  `Timestamp::now()` for a datetime value — not `civil::DateTime::new`, whose seven scalar
  arguments are easy to misorder and buy nothing.

## Debugging a trigger that "isn't firing"

A trigger that appears to do nothing after a checkin is not necessarily running at all, and if it
is, it's almost always still running — either a `match` arm didn't hit the case you expected (and a
catch-all silently swallowed which case it actually was), or a write it issued was rejected
somewhere you weren't looking. Work through these, **in this order**, before re-reading the
`aspen_crm` API from memory — they're ordered by how much they cost to check, and the cheapest one
turned out to be the actual answer once, after everything downstream of it looked fine:

1. **Was the code in the package at all?** `aspen move save-package` bundles the crate only if
   it is already built, and otherwise just warns ("run `aspen compile --rust` first") and ships
   the metadata without it — the instance keeps the old code. Always `aspen compile` right
   before `save-package`, and read its output for that warning. `aspen status` shows the
   checked-in code.
2. **Confirm it deployed, not just compiled.** `checkin-prep` succeeding doesn't mean
   `checkin-deploy` ran. A checkin stuck partway through looks identical, from the outside, to a
   trigger that's live and has a logic bug.
3. **Confirm the registration matches exactly.** `object` and `events` in `aspen.server.json` are
   plain strings the platform doesn't validate against object/picklist metadata at compile time —
   a typo'd object name or event compiles clean and simply never runs.
4. **Picklist item names are exact strings, not a compiler-checked enum.** `"cancelled_c"` in Rust
   has to match the picklist item's `name` in its metadata JSON byte-for-byte; nothing catches a
   mismatch except comparing the two files.
5. **A `SELECT` without `LIMIT` fails at query time.** If a trigger reaches a query and stops, this
   is the first thing to check — see "Reading fields in a trigger" above.
6. **If the trigger inserts or updates a record, capture the `Result` and check `.failures()` —
   `?` alone silently drops row-level rejections.** `execute_insert`/`execute_update` return
   `Result<BatchProcessed, BatchFailure>`: the `Err` side is a whole-batch failure (a malformed
   request) and is all a bare `execute_insert(request)?;` — return value unused — can ever surface.
   A single row that fails validation (wrong `RecordFieldValue` variant for the field's own
   `type`/`subtype`, see the table above; a missing required field; anything else the platform
   rejects) comes back inside `Ok(BatchProcessed)`, in `.failures()` — `?` never sees it, and
   discarding the return value throws it away. Bind the result, check `.failures()`, and turn any
   into a hard error rather than a log call — see the next point for why that distinction matters:
   ```rust
   let result = context.services().record().execute_insert(request)?;
   if !result.failures().is_empty() {
       let msgs: Vec<String> = result
           .failures()
           .iter()
           .flat_map(|f| {
               f.field_errors()
                   .iter()
                   .map(|e| format!("{}: {}", e.field_name(), e.message()))
                   .chain(f.record_errors().iter().map(|e| e.message().to_string()))
           })
           .collect();
       error::bail!("insert failed: {}", msgs.join("; "));
   }
   ```
   This is exactly what surfaced the two field-shape errors above (`whaton_p`'s variant, `owner_p`'s
   missing discriminator) as readable messages instead of a trigger that just never inserted
   anything.
7. **There is no confirmed way to read `aspen_crm::warn!`/`info!` output.** This instance has no
   logs UI reachable from the CLI or the devtools API (both were tried and found nothing). What
   *is* confirmed visible: a **hard error** — an `Err` returned from the entrypoint, e.g. via
   `error::bail!` — surfaces at the point of the save that fired the trigger, in the UI, as an
   error on that save. A `warn!`/`info!` call inside a `_ => continue` catch-all is invisible; the
   same catch-all turned into `error::bail!("unexpected subscription_status_c: {other:?}")`
   temporarily is not:
   ```rust
   let status = match record.get("subscription_status_c")? {
       FieldState::Value(RecordFieldValue::Picklist(s)) => s,
       other => error::bail!("unexpected subscription_status_c: {other:?}"),
   };
   ```
   Redeploy, fire the event once, read the error the save shows, then put the real `continue`-based
   handling back — a trigger that hard-errors on every unexpected shape is a debugging aid, not
   something to ship, since it would block the save entirely instead of skipping the field. Do this
   for query-row matches too, not just batch-field matches — same risk, same fix, and it's what
   distinguished "the trigger errored" (a query needing `LIMIT`) from "the trigger silently
   continued" (a match on the wrong variant) in a real session, without which both looked identical
   from the outside: no task, no visible difference.

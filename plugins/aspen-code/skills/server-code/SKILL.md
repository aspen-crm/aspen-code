---
name: server-code
description: Use to add or change server-side logic on an Aspen instance — a Rust record trigger (before/after insert, update, delete) that derives a stored value, validates a save or cascades a change, or a Rust web API endpoint, in the instance directory's rust/ crate.
---

# Server code

Server code is Rust compiled to a `wasm32-wasip2` component, in the instance directory's one crate
at `rust/`. It runs however a record is written — form, data API, bulk load, runtime MCP — which is
why a rule belongs here and not in a page. `model-first` decides whether it belongs here at all.
Not routed here from `using-aspen`? Read its "Where the docs are wrong" table first: the docs'
`aspen move --rust --dev` doesn't work with the `rust/` crate `aspen init` creates.

## 0. Orient

- **The reference is the Aspen SDK docs** (`aspen-docs`): *Project Configuration*
  (`aspen.server.json`, `entrypoints!`), *Record Triggers* (events, contexts, `FieldState`, field
  and record errors, update deltas), *Web API*, and the *Record*, *Query*, *Log*, *HTTP* and
  *Runtime Context* services. Read the page for what you use.
- **Add to the crate `aspen init` scaffolded** (`rust/aspen.server.json`, `rust/src/lib.rs`,
  `rust/Cargo.toml`). Never create a second crate or rename it: the CLI deploys it as
  `server_main_c` whatever it is called.
- **Read the object you trigger on** for exact field names and each field's `type`/`subtype`
  (`metadata/compiled/object_p/<object>.json` after `aspen compile --metadata`, or `active/` /
  `platform/`). The `RecordFieldValue` variant follows the field's metadata.
- **Start from [trigger-patterns.rs](trigger-patterns.rs):** eight handlers and their shared
  helpers, checked against the SDK source and the platform objects. Validation that rejects rows
  and commits the rest is pattern 7; validate, then create another record once the save commits
  (all four insert/update events) is pattern 8. It builds against the scaffolded crate
  with `jiff = "0.2"` added and its registration in `aspen.server.json`. Copy the helpers and the
  closest handler. Whole triggers in a working model, with the fields they read, are in the
  sample instances: [samples.md](../using-aspen/samples.md).
- **[rust-trigger-notes.md](rust-trigger-notes.md)** has what the docs leave out: the toolchain pin
  and lockfile, the variant per field type (polyids and their discriminators), `.failures()` on
  writes, date arithmetic, which platform objects allow triggers, and the checklist for a trigger
  that "isn't firing".
- **Querying?** [query-notes.md](query-notes.md) first: `LIMIT` at most 1000, `OFFSET` at most
  10000, `CURRENT_USER()` and `LIKE` limits. Never interpolate request-supplied text into a
  statement.
- The `aspen-crm` crate source is the final word on types; after the first build it is at
  `~/.cargo/registry/src/*/aspen-crm-*/src/`. Keep the release `aspen init` pinned; don't patch
  the crate or swap its dependency for another source.

## 1. Ask the developer how it fails — before writing the trigger

How each failure reaches the user in the UI and the API caller is the developer's decision, not a
default `bail!`. Read [error-handling.md](error-handling.md) first: it has what each option
produces, including that the error `code` never reaches an API caller.

List every failure the trigger can detect (each rule, each write or query it makes), then ask —
with the host's question tool if it has one (Claude Code: AskUserQuestion; Codex:
request_user_input), otherwise in chat —
and wait:

1. **Presentation**, per condition: a *field error* (on that field; the API item carries the field
   name), a *record error* (the form's banner; no field), or *abort the write* (`Err`: an error
   modal, the whole batch rolls back, the text arrives as `before trigger error '…'`).
2. **Batch behavior:** reject only the offending records and commit the rest, or fail the whole
   batch if any is bad (a 500-row import either way).
3. **The message:** the exact words the user reads, shown verbatim. An integration that needs a
   stable identifier agrees one in the message text, or gets a Web API endpoint instead.
4. **Its own failures:** if the trigger's writes fail or a query errors — fail the save, reject
   that record, or skip and continue.

Fold the answers into the error table (format in `error-handling.md`) and show it before writing
code. Skip the questions for a trigger that never rejects and makes no writes or queries (e.g. a
default), or when the developer already said how — then state the choice in one line.

For a **Web API**, ask the same about its responses: the HTTP status and `ErrorResponse` type per
failure, and whether a partial failure is a warning or a failure (`standard` and `batch`
interfaces; the *Web API* docs page).

## 2. Rules the docs do not state

- `events` are checked at compile time (`entrypoints!` rejects an unknown event); `object` is not
  checked against metadata, so a typo compiles, deploys and never runs. Neither does a trigger on a
  platform (`_p`) object outside the allow-list in `rust-trigger-notes.md`.
- **On `before_update` / `after_update` the batch holds the fields the caller sent**, possibly
  unchanged, plus `id_p`. A field's presence doesn't prove it changed: read the stored row by
  `id_p` (in a before-trigger it is still the old one).
- **Never write to the records the trigger is running on**; the platform refuses the nested write
  and the whole save fails. Derive a value on the record itself in `before_insert`/`before_update`
  with `record.set`.
- **Reject and set in a before-trigger; create follow-on records in an after-trigger.** The after
  batch holds only the rows that passed (a rejected row is not in it), and a `before_insert`
  record has no `id_p` yet for a new record to point at. A field the before half sets reads back
  in the after batch: that stamp is the handshake (pattern 8).
- **Batch the work:** collect across the batch, then at most one insert and one update per object.
- **A trigger that writes other records of its own object needs a write-only-on-change guard**, or
  it re-fires on them.
- Only a rejection reaches the user or caller (step 1). Log lines aren't readable from the CLI.

## 3. Build

```sh
aspen compile --rust        # cargo build --release --locked for wasm32-wasip2
cd rust && cargo test       # unit tests run as wasm through the CLI's runner
```

A new dependency needs a lockfile update first (`--locked`): `cd rust && cargo update -p <crate>`.
A componentization error naming wit-bindgen is the toolchain pin, not a dependency (the notes).

## 4. Deploy and prove it

Deploy with `build-and-deploy` (the check-in chain, never `--dev`). Done means a record written
through a real path shows the behavior: the derived field set, or the save rejected where the
error table says, with its message and the API response the developer expects. Then summarize
what the rule does, the message it rejects with, and the edge cases it skips (e.g. an empty
optional field).

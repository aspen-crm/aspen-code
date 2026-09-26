---
name: server-code
description: Use to add or change server-side logic on an Aspen instance — a Rust record trigger (before/after insert, update, delete) that derives a stored value, validates a save, or cascades a change, or a Rust web API endpoint. Lives in the instance directory's rust/ crate, declared in aspen.server.json, compiled to wasm; never a field in the object JSON.
---

# Server code

Server code is **Rust compiled to a `wasm32-wasip2` component**, in the instance directory's one
crate at `rust/`. It runs however a record is written — form, data API, bulk load, runtime MCP —
which is why a rule belongs here and not in a page. `model-first` decides whether it belongs here
at all.

## 0. Orient — before writing a line

- **The reference is the Aspen SDK docs** — ask `aspen-docs`: *Project Configuration*
  (`aspen.server.json`, `entrypoints!`), *Record Triggers* (events, contexts, `FieldState`, field
  and record errors, update deltas), *Web API*, and the *Record*, *Query*, *Log*, *HTTP* and
  *Runtime Context* services. Read the page for what you are about to use.
- **Read the crate `aspen init` scaffolded** (`rust/aspen.server.json`, `rust/src/lib.rs`,
  `rust/Cargo.toml`) and add to it. Never create a second crate or rename this one — the CLI
  deploys it as `server_main_c` whatever it is called.
- **Read the object you are triggering** for exact field names and each field's `type`/`subtype`
  (`metadata/compiled/object_p/<object>.json` after `aspen compile --metadata`, or `active/` /
  `platform/`). The `RecordFieldValue` variant you read or write follows the field's metadata, not
  what you would guess.
- **Start from `trigger-patterns.rs`** beside this file: six handlers that fired on a real
  instance, plus the helpers they share. It builds unchanged against the scaffolded crate (with
  `jiff = "0.2"` added). Copy the helpers and the one handler closest to yours.
- **Read `rust-trigger-notes.md`** for what the docs leave out: the toolchain pin and lockfile, the
  variant per field type (polyids and their discriminators), `.failures()` on writes, date
  arithmetic, and the ordered checklist for a trigger that "isn't firing".
- **Querying?** `query-notes.md` first — one line only, at most 100 rows back, `CURRENT_USER()`
  and `LIKE` limits. Never interpolate request-supplied text into a statement.
- The `aspen-crm` crate source is the final word on types: after the first build it is at
  `~/.cargo/registry/src/*/aspen-crm-*/src/`.

## 1. Rules the docs do not state

- `object` and `events` in `aspen.server.json` are not checked against metadata — a typo compiles,
  deploys, and never runs.
- **On `before_update` / `after_update` the batch holds only changed fields.** Read anything else
  with a query on `id_p` (which `record.get("id_p")` always returns).
- **Batch your work:** collect across the whole batch, then at most one insert and one update per
  object. N records is one round trip, not N.
- **A trigger that writes back to its own object needs a write-only-on-change guard**, or it
  re-fires itself.
- To show the user a message, reject from a before-trigger (a field or record error, or `Err`).
  That is the only output you can confirm; log lines are not readable from the CLI.

## 2. Build

```sh
aspen compile --rust        # cargo build --release --locked for wasm32-wasip2
cd rust && cargo test       # unit tests run as wasm through the CLI's runner
```

A new dependency needs a lockfile update first (`--locked`): `cd rust && cargo update -p <crate>`.
A componentization error naming wit-bindgen is the toolchain pin, not a dependency — see the notes.

## 3. Deploy and prove it

Hand off to `build-and-deploy`. A trigger is done when a record written through a real path shows
the behavior — the derived field set, the save rejected with your message — not when it compiles.

## Definition of done

Field names and types read from metadata · declared for the right object and events · `aspen
compile` clean · deployed · proven with a record round-trip. Then summarize what the rule does,
the message it rejects with, and the edge cases it skips (e.g. an empty optional field).

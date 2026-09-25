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

- **Read the crate `aspen init` scaffolded:** `rust/aspen.server.json`, `rust/src/lib.rs`,
  `rust/Cargo.toml`. Add to it; never create a second crate, and never rename it — the CLI
  deploys it as `server_main_c` whatever it is called (`rust-trigger-notes.md` says why).
- **Read the object you are triggering** for exact field names and types:
  `metadata/compiled/object_p/<object>.json` after `aspen compile --metadata`, or
  `metadata/platform/` / `metadata/active/`. The variant you match on depends on the field's
  `type`/`subtype`, not on what you would guess.
- **Start from `trigger-patterns.rs`** beside this file — six handlers that fired on a real
  instance, plus the helper block they share. It builds unchanged against the scaffolded crate
  (with `jiff = "0.2"` added). Copy the helpers and the one handler closest to yours.
- **Read `rust-trigger-notes.md`** when no pattern covers your case: the `RecordFieldValue`
  variant per field type, the changed-fields-only update batch, inserting and updating records,
  and the ordered checklist for a trigger that "isn't firing".
- **Querying** from a trigger (`context.services().query()`): read `query-notes.md` first —
  `LIMIT` is mandatory, one line only, and `name_p` is not a universal display field.
- The `aspen-crm` crate source is the truth for types and methods; after the first build it is at
  `~/.cargo/registry/src/*/aspen-crm-*/src/`. Grep it rather than docs.rs.

## 1. Declare — `rust/aspen.server.json`

```json
{
  "record-triggers": [
    { "name": "renewal_guard_c", "object": "renewal_c", "events": ["before_insert", "before_update"] }
  ],
  "web-apis": [
    { "name": "hello_c", "methods": ["GET"], "path": "/hello", "interface": "simple" }
  ]
}
```

Keep the scaffold's `hello_c` web API or remove it deliberately — it is a working example of the
second entry kind. Events are exactly `before_insert | after_insert | before_update |
after_update | before_delete | after_delete`. `entrypoints!` generates one trait named **exactly**
the entry's `name`, with one method per event (or HTTP method). Neither `object` nor `events` is
checked against metadata at compile time — a typo compiles and never runs.

## 2. Implement

```rust
impl renewal_guard_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        for record in context.batch().iter() { /* validate or set fields */ }
        Ok(())
    }
}
```

- `record.get(field)?` → `FieldState::Value(..) | Null | Absent`. **On `before_update` the batch
  carries only changed fields**: `Absent` means "not in this write — read the stored value",
  `Null` means "cleared".
- Reject a save with `error::bail!("…")` from a before-trigger (or a field error on the record) —
  it surfaces to the user at the save and rejects the write. That is also the only confirmed way to
  see a message from a trigger; `info!`/`warn!` output has no confirmed reader.
- Batch your work: collect across the whole batch, then at most one insert and one update per
  object — N records is one round trip, not N.
- Build query statements from `Uuid`s and constants only — never interpolate request text.

## 3. Build

```sh
aspen compile --rust        # cargo build --release --locked for wasm32-wasip2
cd rust && cargo test       # unit tests run as wasm through the CLI's runner
```

A new dependency needs a lockfile update first (`--locked`): `cd rust && cargo update -p <crate>`.
A componentization error naming wit-bindgen is the toolchain pin, not a dependency — see the notes.

## 4. Deploy and prove it

Hand off to `build-and-deploy`. A trigger is done when a record written through a real path shows
the behavior — the derived field set, the save rejected with your message — not when it compiles.

## Definition of done

Field names read from metadata · declared for the right object and events · `aspen compile`
clean · deployed · proven with a record round-trip. Then summarize what the rule does, the message
it rejects with, and the edge cases it skips (e.g. an empty optional field).

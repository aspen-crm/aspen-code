---
name: diagnose
description: Use when an Aspen compile, check-in, or the instance behaves unexpectedly — a compile that fails on components you did not touch, a failed checkin-prep, a phase that seems to name nothing, a CLI/instance version mismatch, a login or reachability error, a trigger that does not fire.
---

# Diagnose

Reproduce and find the cause before any fix, routing on what the CLI actually printed.

## The loop

1. **Reproduce.** Re-run the failing command and capture all of it:
   `aspen <command> > /tmp/aspen.out 2>&1`. A truncated terminal view shows the cascade and hides
   the cause.
2. **Gather.** `aspen doctor` (every readiness check) and `aspen status` (check-in state, pending
   package, code override, checked-in code) answer most "why" questions.
3. **Localize.** Drop the cascade and read what is left:
   ```sh
   grep -vE 'skipped due to other errors|another component failed validation' /tmp/aspen.out
   ```
   One bad component fails the whole batch and every other reports it was skipped. Fix every cause
   the filtered output names before re-running — each check-in round trip costs the shared
   instance.
4. **Smallest change, re-run,** confirm the error is gone.
5. **Record the lesson** if it was non-obvious (below).

## Known shapes

| Symptom | Cause | Fix |
|---|---|---|
| `aspen compile --metadata` fails on components you never touched: "supplied active metadata failed validation; pending components were not validated" | Version skew: the CLI's validator is another release than the instance, so its own `active/` fails | `aspen doctor` → `instance.cli-matches-instance`; `aspenup update` installs the toolchain the instance serves. If aspenup says nothing is published for that release, tell the human; don't work around it |
| Doctor: `configuration.record-matches-login`; `move`/`status` refuse | Signed in to another instance (one login at a time) | Tell the user it replaces the current login, then `getting-started` step 2 with this directory's URL |
| `aspen login`: "Interactive login is not supported" | Run under an agent without the overrides | The `getting-started` step 2 shape. Never `--api-key` |
| A custom page: "Version … of the "sdk" SDK is no longer supported. Please upgrade the SDK and redeploy." | Built against the `@aspen-crm/sdk` 0.1.0 `aspen init` pins (`using-aspen` known issues) | Tell the human it needs SDK 0.2.0 published; don't change the pins |
| Check-in refuses the server component: "query-service@0.1.0 … no matching implementation in the linker" | crates.io `aspen-crm` 0.1.0 predates the 26.4.1 host (`using-aspen` known issues) | Tell the human it needs a matching `aspen-crm` release; don't patch the crate |
| "Operation Save is not allowed" on `save-package` | A previous package is still in flight | `aspen status`, then `build-and-deploy` step 4 — with go-ahead |
| `save-package` warns to "run `aspen compile --rust`/`--typescript` first" | That code wasn't built, so it was left out | Compile, then save again |
| Rust: componentization error naming wit-bindgen, "invalid leading byte" | The `rust/rust-toolchain.toml` pin is missing or changed | Restore it (`server-code`'s `rust-trigger-notes.md`) |
| Rust: `--locked` failure after adding a dependency | `Cargo.lock` not updated | `cd rust && cargo update -p <crate>`, commit the lock |
| A trigger that "does nothing" | Usually running, with a `match` arm swallowing the case | `rust-trigger-notes.md` → "Debugging a trigger", in order |
| Instance unreachable, 404 from `status` | Wrong URL, instance down, or network | `aspen doctor` → `instance.reachable`; confirm the URL with the human |

## Don't

- Re-run a check-in "to see if it passes" — the last one may still be applying. `aspen status`
  first.
- Clear or halt the shared check-in as generic recovery; it wipes other builders' work.
- Edit `metadata/active/` or `platform/` to make a compile pass; they are replaced on the next
  fetch.

## Lessons

After resolving a non-obvious failure, add one line — `symptom → root cause → fix` — to a
`## Lessons` section in the instance directory's `CLAUDE.md`, below its `@./AGENTS.md` import
(`aspen init` never overwrites it). It is committed, so every teammate's agent inherits it.
Deduplicate first and keep it under ~15 lines, pruning the least useful. A lesson true of the
platform also belongs in this plugin: tell the human to raise it on `aspen-crm/aspen-code`.

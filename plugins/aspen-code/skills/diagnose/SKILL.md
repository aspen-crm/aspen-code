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
   node "<this skill's dir>/scripts/causes.mjs" /tmp/aspen.out
   ```
   One bad component fails the whole batch and every other reports it was skipped. Under an agent
   the CLI prints all of it as one JSON `detail` string, so `grep -v` on it drops the causes too;
   the script reads either shape. Fix every cause it names before re-running — each check-in round
   trip costs the shared instance.
   **Before you call a cause a platform limit,** vary one thing and compile again — a label-only
   overlay against a `fields` change, say. It takes seconds, and a wrong call ships a permanent
   workaround.
4. **Smallest change, re-run,** confirm the error is gone.
5. **Record the lesson** if it was non-obvious (below).

## Known shapes

| Symptom | Cause | Fix |
|---|---|---|
| `aspen compile --metadata` fails on components you never touched: "supplied active metadata failed validation; pending components were not validated" | Version skew: the CLI's validator is another release than the instance, so its own `active/` fails | `aspen doctor` → `instance.cli-matches-instance`; `aspenup update` installs the toolchain the instance serves. If aspenup says nothing is published for that release, tell the human; don't work around it |
| Doctor: `configuration.record-matches-login`; `move`/`status` refuse | Signed in to another instance (one login at a time) | Tell the user it replaces the current login, then `getting-started` step 2 with this directory's URL |
| `aspen login`: "Interactive login is not supported" | Run under an agent without the overrides | The `getting-started` step 2 shape. Never `--api-key` |
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

After resolving a non-obvious failure, add one line — `symptom → root cause → fix` — to
`LESSONS.md` in the instance directory, never to `AGENTS.md` or `CLAUDE.md`:

1. No `LESSONS.md` yet: create it with a `# Lessons` heading, and append one line to the end of
   `AGENTS.md`: `Lessons from earlier sessions on this instance are in LESSONS.md; read it
   before building.` (`aspen init` never overwrites either file.)
2. A `## Lessons` section in `CLAUDE.md` from an older session: move its lines into `LESSONS.md`
   and delete the section, leaving `CLAUDE.md` as its `@./AGENTS.md` import. Codex doesn't read
   `CLAUDE.md`.

It is committed, so every teammate's agent, on either host, inherits it. Deduplicate first and
keep it under ~15 lines, pruning the least useful; name the CLI build a lesson was observed on. A
lesson true of the platform also belongs in this plugin: tell the human to raise it on
`aspen-crm/aspen-code`.

---
name: diagnose
description: Use when an Aspen compile, check-in, or the instance behaves unexpectedly — a compile that fails on components you did not touch, a failed checkin-prep, a phase that seems to name nothing, a CLI/instance version mismatch, a login or reachability error, a trigger that does not fire. Reproduce and find the root cause before any fix.
---

# Diagnose

No fix without a reproduction and a cause. Route on what the CLI actually printed — never on a
remembered or invented error.

## The loop

1. **Reproduce.** Re-run the failing command and capture all of it to a file:
   `aspen <command> > /tmp/aspen.out 2>&1`. Don't read a long failure in the terminal — a
   truncated view shows the cascade and hides the cause.
2. **Gather.** `aspen doctor` (every readiness check, JSON under an agent) and `aspen status`
   (check-in state, pending package, code override, checked-in code). Both are cheap and answer
   most "why" questions before you theorize.
3. **Localize.** Drop the cascade and read what is left:
   ```sh
   grep -vE 'skipped due to other errors|another component failed validation' /tmp/aspen.out
   ```
   One bad component fails the whole batch; every other one reports it was skipped. Fix **every**
   cause the filtered output names before re-running — each check-in round trip costs the shared
   instance.
4. **Smallest change, re-run,** confirm the error is gone.
5. **Record the lesson** if it was non-obvious (below).

## Known shapes

| Symptom | Cause | Fix |
|---|---|---|
| `aspen compile --metadata` fails on components you never touched, with "supplied active metadata failed validation; pending components were not validated" | Version skew: the CLI's validator is a different release from the instance, so the instance's own `active/` components fail it | `aspen doctor` → `instance.cli-matches-instance`. Run the CLI through aspenup, which installs the toolchain the instance serves (`aspenup update`). If aspenup warns that nothing is published for that release, the CLI cannot match the instance — tell the human; don't work around it |
| Doctor: `configuration.record-matches-login` problem; `move`/`status` refuse | Signed in to another instance (one login at a time) | The user runs `aspen login -i <this directory's instance>` — `getting-started` §2 |
| The guard refuses "`aspen move …` is not running in an instance folder" | The command's directory has no `.aspen/config.toml`, so it would act on whatever instance is logged in | Run it from the instance directory (`cd <dir> && …`) or pass `--dir` |
| The guard asks "targets … a different instance folder" | The command left the session's instance directory | Only proceed if the user asked for that folder; in Codex, after they confirm, prefix `ASPEN_CODE_CONFIRMED=1` |
| `aspen login` says "Interactive login is not supported" | It was run by an agent, or with no terminal | By design. The user runs it in their own terminal |
| "Operation Save is not allowed" on `save-package` | A previous package is still in flight | `aspen status`, then the recovery order in `build-and-deploy` §4 — with go-ahead |
| `save-package` warns to "run `aspen compile --rust`/`--typescript` first" | That code was not built, so it was left out | Compile, then save again |
| Rust: componentization error naming wit-bindgen, "invalid leading byte" | The `rust/rust-toolchain.toml` pin is missing or changed | Restore it — `rust-trigger-notes.md` |
| Rust: `--locked` failure after adding a dependency | `Cargo.lock` not updated | `cd rust && cargo update -p <crate>`, commit the lock |
| A trigger that "does nothing" | Usually still running, with a `match` arm swallowing the case | `rust-trigger-notes.md` → "Debugging a trigger", in order |
| Instance unreachable, 404 from `status` | Wrong URL, instance down, or network | `aspen doctor` → `instance.reachable`; confirm the URL with the human |

## Anti-patterns

- Guessing a fix before reproducing.
- **Re-running a check-in to "see if it passes"** — the last one may still be applying. `aspen
  status` first.
- Clearing or halting the shared check-in as generic recovery — it wipes other builders' work.
- Inventing a cause for a failure that seems to name none: filter the cascade and read again.
- Editing `metadata/active/` or `platform/` to make a compile pass — they are replaced on the next
  fetch and prove nothing.

## Lessons (kept small)

After resolving a **non-obvious** failure, add **one terse line** to a `## Lessons` section in
the instance directory's `CLAUDE.md` (below its `@./AGENTS.md` import; `aspen init` never
overwrites it): `symptom → root cause → fix`. It is committed, so every teammate's agent inherits
it and a wrong one dies in review.

- Deduplicate first. Hard cap ~15 lines; prune the least useful at the cap.
- Never per-user memory — the committed file is the point.
- A lesson true of the **platform**, not just this instance, also belongs in this plugin: tell the
  human to raise it on `aspen-crm/aspen-code`.

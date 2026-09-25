---
name: build-and-deploy
description: Use when compiling an Aspen instance directory and deploying it — aspen compile, then (with the human's go-ahead) aspen move save-package and the ordered checkin-prep, checkin-index, checkin-deploy chain, reading aspen status, recovering a stuck package, and proving the change with a record round-trip. "Deployed" is never "done" without the round-trip.
---

# Build and deploy

Run everything from the instance directory. `aspen move --help` is the authority on the verbs;
this is the order and the judgment around them.

## 1. Compile — always, right before deploying

```sh
aspen compile                 # metadata, then Rust, then TypeScript; stops at the first failure
aspen compile --metadata      # metadata only (offline validator → metadata/compiled/)
aspen compile --rust          # the rust/ crate only
```

A tier with no project reports "holds no <tier> project" — compile the tiers you changed instead.
Read metadata failures as `metadata` step 3 says: drop the cascade lines, fix the causes.

**Why right before:** `save-package` bundles the Rust and TypeScript builds **only if they are
already built**. If they are not, it warns and ships the metadata without them, and the instance
keeps its old code — a deploy that looks fine and changed nothing.

## 2. Pre-flight

- `aspen doctor` — no `problem`; in particular `instance.cli-matches-instance`,
  `configuration.record-matches-login` and `instance.no-package-in-flight` are `ok`.
- `aspen status` — no check-in already in flight (someone else's, possibly). If one is, **wait and
  tell the human**; do not clear it.
- For a set of related changes, `metadata-reviewer` on the diff first.
- **Config vars:** if `./config_vars.json` exists, `save-package` uploads it after the save, and an
  upload **clears every var the file does not list**. Confirm the file is complete, or that it
  should not be there.
- **Ask the human.** Deploying changes a shared instance, and what it creates is permanent.
  Say what is going: the components, and whether code is included.

## 3. The check-in chain — ordered, each phase mandatory

```sh
aspen move save-package        # zips metadata/custom + the built rust/ and typescript/ output
aspen move checkin-prep        # the instance's full validation
aspen move checkin-index       # index creation the package needs
aspen move checkin-deploy      # makes it live
```

- `save-package` packages the instance directory it runs in: only `metadata/custom/` from
  metadata, the crate as `server_main_c`, the UI bundle as `ui_main_c`. It refuses an empty
  package ("would deploy nothing").
- `checkin-prep --deploy-when-ready` releases the package automatically when prep finishes; use
  it only when the human wants the whole chain in one go.
- Capture each phase to a file and filter it, as `diagnose` shows — a failure's causes sit inside
  dozens of cascade lines.
- A transient error on `save-package` often clears on one retry of the same command. **A
  check-in phase is not retried blindly** — read `aspen status` first; a poll timeout is a timeout
  on waiting, not a failure, and the job may still be applying.
- Metadata is live on the next request after `checkin-deploy`; no restart.

## 4. Recovery — shared state, ask first

A failed prep leaves a package in flight that blocks the next `save-package` ("Operation Save is
not allowed"). These verbs reach work **every builder on the instance** has staged, so get
explicit go-ahead for the exact verb, and say its scope:

1. `aspen move clear-package` — drops the pending package from the dev set. Usually enough.
2. Only if the instance says to ("invoke the checkin-clear action"): `aspen move checkin-clear` —
   halts the active check-in and erases the dev and dev-checkin sets.

`aspen move clear-dev` removes a development code override (`aspen move --dev`) and reverts to the
checked-in code. **Don't use `aspen move --dev` yet:** in 26.4.1 it looks for code in `server/`
and `ui/`, not the `rust/` and `typescript/` that `aspen init` creates, so it likely fails in an
`aspen init` directory. Deploy code through the check-in chain until that is fixed.

## 5. Prove it — the round-trip

A green `checkin-deploy` proves the package was accepted, not that it works.

1. `aspen status` — the check-in completed and the code you expect is checked in.
2. **Exercise it through a real write path.** Confirm the values with the human, then create or
   update a record: with the user in the Aspen UI, or through the Aspen Runtime MCP
   (`aspen-cowork`) if it is connected. Read it back.
3. Assert the behavior: the derived field holds the right value; the invalid save is **rejected
   with your message** (that rejection is the proof a validation fired); the new layout, list view
   and tab are reachable from the nav.
4. Only now say "deployed and verified". If you could not exercise it, say what is unverified.

Records created to test are permanent — prefer one clearly-named record, and say so.

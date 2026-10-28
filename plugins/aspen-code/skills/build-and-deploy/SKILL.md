---
name: build-and-deploy
description: Use when compiling and deploying an Aspen instance directory — aspen compile, then aspen move save-package and the checkin-prep, checkin-index, checkin-deploy chain, reading aspen status, recovering a stuck package, and proving the change with a record round-trip.
---

# Build and deploy

Run everything from the instance directory. `aspen move --help` is the authority on the verbs;
this is the order and the judgment around them.

## 1. Compile — right before deploying

```sh
aspen compile                 # metadata, then Rust, then TypeScript; stops at the first failure
aspen compile --metadata      # metadata only (offline validator → metadata/compiled/)
aspen compile --rust          # the rust/ crate only
```

A tier with no project reports "holds no <tier> project"; compile the tiers you changed instead.
Read metadata failures as `metadata` step 3 says.

`save-package` bundles the Rust and TypeScript builds **only if they are already built**;
otherwise it warns and ships the metadata alone, and the instance keeps its old code — a deploy
that looks fine and changed nothing.

## 2. Pre-flight

- `aspen doctor` — no `problem`; in particular `instance.cli-matches-instance`,
  `configuration.record-matches-login` and `instance.no-package-in-flight` are `ok`.
- `aspen status` — no check-in in flight (possibly someone else's). If one is, wait and tell the
  human; don't clear it.
- A set of related changes: `metadata-reviewer` on the diff first.
- **Config vars:** if `./config_vars.json` exists, `save-package` uploads it after the save, and
  the upload clears every var the file doesn't list. Confirm it is complete, or shouldn't be there.
- **Required:** ask the human, naming the instance (`.aspen/config.toml`), the components going
  out and whether code is included, and wait for a yes. It changes a shared instance, and the
  components it creates can't be deleted yet. A user who already said to deploy this change has
  given it; a different package needs its own.

## 3. The check-in chain — ordered, each phase mandatory

```sh
aspen move save-package        # metadata/custom + the built rust/ and typescript/ output
aspen move checkin-prep        # pre-release: the instance's full validation
aspen move checkin-index       # the indexes the package needs
aspen move checkin-deploy      # release: makes it live
```

What each phase does is in the *Aspen CLI Developer Guide* (`aspen-docs`).

- `checkin-prep --deploy-when-ready` runs the rest automatically; use it only when the human wants
  the whole chain in one go.
- Capture each phase to a file and filter the cascade as `diagnose` step 3 shows.
- A transient `save-package` error often clears on one retry. Don't retry a check-in phase blindly:
  read `aspen status` first; a poll timeout is a timeout on waiting, not a failure.
- Metadata is live on the next request after `checkin-deploy`.

## 4. Recovery — ask first

A failed prep leaves a package in flight that blocks the next `save-package` ("Operation Save is
not allowed"). These verbs reach work every builder on the instance has staged. **Required:** get
the go-ahead for the exact verb, saying its scope:

1. `aspen move clear-package` — drops the pending package from the dev set. Usually enough.
2. Only when the instance says to ("invoke the checkin-clear action"): `aspen move checkin-clear` —
   halts the active check-in and erases the dev and dev-checkin sets.

Don't use the development override (`aspen move --rust --dev`; see `using-aspen` → where the docs are wrong).
`aspen move clear-dev` removes one if it exists.

## 5. Prove it — the round-trip

A green `checkin-deploy` proves the package was accepted, not that it works.

1. `aspen status` — the check-in completed and the expected code is checked in.
2. Exercise it through a real write path: confirm the values with the human, then create or update
   one clearly-named record with them in the Aspen UI, and read it back.
3. Assert the behavior: the derived field holds the right value; the invalid save is rejected with
   your message; the new layout, list view and tab are reachable from the nav.
4. Size the proof to the change. A label: compile and look at it. A rule or derived value: one
   valid and one rejected write, read back. A multi-record action: also an interrupted run and
   its retry. A custom page or route override: start at the native entry point (the list, the +,
   the record) and finish the user's task.
5. Report four lists: implemented, verified (and how), partial, unverified. Say "deployed and
   verified" only when the last two are empty, and name sample records and test-only checks as
   such.

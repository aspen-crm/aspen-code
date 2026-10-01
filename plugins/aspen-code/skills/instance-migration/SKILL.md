---
name: instance-migration
description: Use when moving records from one Aspen instance to another — migrating, copying, seeding or consolidating data from a source instance into the target instance, mapping source objects, fields and picklist values onto the target's, or loading thousands of records through the REST API. Aspen to Aspen only.
---

# Instance migration

Copy records from a **source** Aspen instance into the **target** instance whose directory you
are in. `scripts/migrate.mjs` beside this file does the mechanics: describe, page, batch, remap
ids, resume. You and the user decide the mapping. Everything written to the target is
permanent: nothing on Aspen deletes.

```sh
M="<this skill's dir>/scripts/migrate.mjs"
node "$M" --help
```

The script uses the REST API; the CLI has no data commands. There is no upsert, and `id_p`
cannot be set, so every target record gets a new id. The workspace's id map connects the two
and makes a re-run skip what is already loaded.

## Sign-in

Each command that reaches an instance opens a browser tab, the user signs in, and the token
lives only in the script's memory until the command ends. Nothing is stored; you never see a
token.

- Run those commands in the background: each waits for the user.
- The machine must reach both instances (VPN), and the browser must run on this machine.
- Never ask for an API key or a token. Don't run `aspen login` for a migration.

## The flow

From the target instance directory, with `aspen doctor` clean. `W` is
`data/migrations/<source-name>`.

| # | Command | Signs in to | Writes |
|---|---|---|---|
| 1 | `init W --source <url> --target <url>` | nothing | `mapping.json`, `.gitignore` |
| 2 | `describe W` | both | `schema/` |
| 3 | `draft W --objects <source objects>` | nothing | `mapping.json`, a `todo` per gap |
| 4 | Settle every `todo` with the user ([mapping-format.md](mapping-format.md)) | nothing | `mapping.json` |
| 5 | `extract W` | source | `extract/` |
| 6 | `load W` (dry run; repeat until 0 failed) | target | `reports/plan.md` only |
| 7 | `load W --run --limit 20` (pilot), after the user's yes | target | target records |
| 8 | `load W --run`, after the user checked the pilot and said yes | target | target records |
| 9 | `verify W` | target | `reports/verify.md` |

- The target URL is `instance` in `.aspen/config.toml`. Nothing is ever written to the source.
- To create a target object or field: `lean-data-model` → `model-first` → `metadata` →
  `build-and-deploy`, then `describe W --side target`.
- A load is safe to run again. On a server error for a batch, run again with `--batch 50`.
- Done when verify reports 0 failed, 0 differences and 0 not loaded, and the user has looked at
  records in the app. Commit `mapping.json` and `reports/`; the workspace's `.gitignore` keeps
  record data out of git.

## What to tell the user

Each message has three parts, in order: what just happened (one line), what it means, and the one
thing you need from them.

| After | The message |
|---|---|
| A tab opened | "A tab is open for the source/target (`<instance>`). Sign in with an account that can read / create `<objects>`." If no tab opened, add the URL the script printed. |
| `describe` | Object counts on each side; which requested objects exist on both. |
| `draft` | Per object, a table `Field \| Proposal \| Why`: one row per `todo`, one per reference picklist the draft mapped, and one for the key, each with a proposal from the defaults below. Then the fields that map as they are, on one line. End with: "Reply yes to take these, or tell me which rows to change." The first time, add what cannot move: created and modified dates and users, history, files, the activity feed. |
| The dry run | To insert, matched, failed. For failures: a row per field and problem, its count, and the proposed fix. When it's clean: the pilot ask, naming the target, objects, row counts and that the records are permanent. |
| A load | Inserted, failed, held back; the names of a few loaded records to check in the app; the next step (verify, or the full load). |
| `verify` | Sampled, differences, not loaded; whether the migration is done. |

A proposal is not a decision: change `mapping.json` only after the user answers.

## Default proposals

| Gap | Propose | Why |
|---|---|---|
| A platform field (`_p`) on one side only, such as `smb_p`, `smt_p`, `extid_p` | Drop | The instances run different platform versions. A `_p` field can't be created. |
| A custom field (`_c`) the target lacks | Drop, unless the user names a use | A new field is permanent: `lean-data-model` first. |
| A lookup to users | Match by email, blank when there is no match: `"lookup": {"object": "user_p", "match": "email_p"}, "missing": "null"` | Migrating `user_p` creates users on the target. |
| A lookup to another object not migrated | Drop, unless the user wants that object too | Migrating it brings its own decisions. |
| A picklist value not on the target | The closest target value, in `map` | The user confirms each one. |
| A reference picklist (`object_type_ref`, `security_profile_ref` in `schema/target.json`), such as `otype_p` | Drop. Map a value only when the user names the target value it becomes. | Neither the schema nor the dry run lists these values, and the instance refuses one it doesn't have. |
| A required target field nothing maps to | A constant in `value` | Ask which. |
| No key | A mapped field that is unique on the target, or none | It matters only for a second source, or a reload from a new workspace. |

## Red flags

| Thought | Reality |
|---|---|
| "I'll list the options and let the user pick" | Propose one per row. They answer yes once, not twelve times. |
| "I'll upsert on the legacy id" / "add `legacy_id_c` everywhere" | No upsert; the id map makes a re-run safe, and a field is permanent. |
| "I'll skip the pilot" | A bad full load cannot be deleted. |
| "The pilot will show whether the target accepts it" | The pilot writes permanent records. It is not a test: settle the value with the user first. |
| "The load failed, so I'll clear the target and reload" | Nothing deletes. Fix the mapping and run again. |

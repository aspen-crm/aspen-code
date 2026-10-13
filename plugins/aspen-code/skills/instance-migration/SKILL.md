---
name: instance-migration
description: Use when moving records from one Aspen instance to another — migrating, copying, seeding or consolidating data from a source instance into the target instance, mapping source objects, fields and picklist values onto the target's, or loading thousands of records through the REST API. Aspen to Aspen only.
---

# Instance migration

Copy records from a **source** Aspen instance into the **target** instance whose directory you are
in. `scripts/migrate.mjs` beside this file does the mechanics (describe, page, batch, remap ids,
resume); you and the user decide the mapping.

```sh
M="<this skill's dir>/scripts/migrate.mjs"
node "$M" --help
```

The script uses the REST API; the CLI has no data commands. There is no upsert and `id_p` can't be
set, so every target record gets a new id; the workspace's id map connects the two and makes a
re-run skip what already loaded. Don't add a legacy-id field for it.

This skill never deletes. Records can be deleted (`DELETE /api/v24.3/data/<object>`, on an object
whose describe says `deletable: true`), but only as a separate step the user asks for and approves.
Don't add a delete command, and don't offer a delete as the fix for a bad load: fix the mapping
and run again.

When you call the API yourself, to explore or to check a failure the script reports:

- **Describe is `POST /describe/object_p` with `{"data": [{"name": …, "object-type": …}]}`**; any
  other body returns 422. The fields are not on the returned record: follow its `variant-index`
  into `supplemental.variants[]`. Pass `object-type` to see the fields a write of that type is
  checked against.
- **Read `status` before `data`.** A failed request (a `SELECT` with no `LIMIT`) comes back HTTP
  200 with `status: FAILURE`, `failures` and no `data`; a 500 has `failures` and no `data` too.
- **A write returns the new id as `id`; a query returns the columns you selected** (`id_p`).
- **Batch items succeed or fail on their own**; the batch rolls back only when a trigger errors or
  an insert breaks a unique constraint.
- **Triggers create records too.** Aspen derives a `contact_role_p` (with `role_p` blank) from
  `contact_p.primary_account_p`, `account_p.primary_contact_p`, `opportunity_p.customer_p` (the
  contact, or the account's primary contact) and cases, and a `team_role_p` from the owner of an
  account, opportunity or case. Inserting the same pair again breaks `contact_role_chk_p` and rolls
  back the batch, so key those objects on the pair — `"key": {"field": "contact_role_chk_p", "of":
  ["contact_p", "what_p"]}`, and `team_role_chk_p` over `team_p` and `what_p` — and `load` matches
  the derived record instead (`onMatch: "update"` writes your `role_p` onto it).

## Sign-in

The first command that reaches an instance opens a browser tab for the user to sign in. A
background process then keeps that sign-in in memory, never on disk, and every later command
reuses it without a tab, until an hour passes with no command or `signout W`. You never see the
token. `--then` chains steps (`load W --run --then verify`) and stops at the first that fails; a
dry run can't chain into `load --run`: the user reads it first.

- Run a command that may open a tab in the background; it waits for the user.
- Instance refused the signed-in user: `signout W`, then run the command again and sign in as one
  who can read (source) or write (target) the objects.
- The machine must reach both instances (VPN), and the browser must run on this machine.
- Never ask for an API key or token, and don't run `aspen login` for a migration.

## The flow

From the target instance directory, with `aspen doctor` clean. `W` is
`data/migrations/<source-name>`.

| # | Command | Reaches | Writes |
|---|---|---|---|
| 1 | `init W --source <url> --target <url>` | nothing | `mapping.json`, `.gitignore` |
| 2 | `describe W` | both | `schema/` |
| 3 | `draft W --objects <source objects>` | nothing | `mapping.json`, a `todo` per gap |
| 4 | Settle every `todo` with the user ([mapping-format.md](mapping-format.md)) | nothing | `mapping.json` |
| 5 | `extract W` | source | `extract/` |
| 6 | `load W` (dry run; repeat until 0 failed) | target | `reports/plan.md` only |
| 7 | `load W --run --limit 20` (pilot), after the user's yes | target | target records |
| 8 | `load W --run --then verify`, after the user checked the pilot and said yes | target | target records, `reports/verify.md` |
| 9 | `signout W` | both | nothing; revokes the kept sign-ins |

- The target URL is `instance` in `.aspen/config.toml`. Nothing is ever written to the source.
- The pilot writes real records and nothing here can undo a bad full load: never skip it, and
  settle values with the user before it rather than testing them on it.
- To create a target object or field: `lean-data-model` → `model-first` → `metadata` →
  `build-and-deploy`, then `describe W --side target`.
- A load is safe to run again. On a server error for a batch, run again with `--batch 50`.
- Done when verify reports 0 failed, 0 differences and 0 not loaded, and the user has looked at
  records in the app. Commit `mapping.json` and `reports/`; the workspace's `.gitignore` keeps
  record data out of git.

## What to tell the user

Each message: what just happened (one line), what it means, and the one thing you need from them.

| After | The message |
|---|---|
| A tab opened | Which instance it is for, and that the account must be able to read / create `<objects>`. The URL the script printed, if no tab opened. |
| `describe` | Object counts on each side; which requested objects exist on both. |
| `draft` | Per object, a `Field \| Proposal \| Why` table: one row per `todo`, per reference picklist the draft mapped, and for the key, each with one proposal from the defaults below. Then the fields that map as they are, on one line. End: "Reply yes to take these, or tell me which rows to change." The first time, add what can't move: created and modified dates and users, history, files, the activity feed. |
| The dry run | To insert, matched, failed; per failing field and problem, its count and the proposed fix. When clean: the pilot ask, naming the target, objects and row counts. |
| A load | Inserted, failed, held back; a few loaded record names to check in the app; the next step. |
| `verify` | Sampled, differences, not loaded; whether the migration is done. |

A proposal is not a decision: change `mapping.json` only after the user answers.

## Default proposals

| Gap | Propose | Why |
|---|---|---|
| A platform field (`_p`) on one side only, such as `smb_p`, `smt_p`, `extid_p` | Drop | The instances run different platform versions; a `_p` field can't be created. |
| A custom field (`_c`) the target lacks | Drop, unless the user names a use | A new field can't be deleted yet: `lean-data-model` first. |
| A lookup to users | Match by email, blank when there is no match: `"lookup": {"object": "user_p", "match": "email_p"}, "missing": "null"` | Migrating `user_p` creates users on the target. |
| A lookup to another object not migrated | Drop, unless the user wants that object too | Migrating it brings its own decisions. |
| A picklist value not on the target | The closest target value, in `map` | The user confirms each one. |
| A reference picklist (`object_type_ref`, `security_profile_ref` in `schema/target.json`), such as `otype_p` | Drop; map a value only when the user names the target value | Neither the schema nor the dry run lists these values, and the instance refuses one it doesn't have. |
| A required target field nothing maps to | A constant in `value` | Ask which. |
| No key | A mapped field unique on the target, or none | It matters only for a second source, or a reload from a new workspace. |
| `contact_role_p`, `team_role_p` | The composite key (above) | Triggers derive some of these pairs before the load reaches them. |

Pick the target object or field by the `description` in `schema/target.json`, not its name.

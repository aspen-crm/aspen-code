---
name: instance-migration
description: Use when moving records from one Aspen instance to another — migrating, copying, seeding or consolidating data from a source instance into the target instance, mapping source objects, fields and picklist values onto the target's, or loading thousands of records through the REST API. Aspen to Aspen only.
---

# Instance migration

Copy records from a **source** Aspen instance into the **target** instance whose directory you
are in. `scripts/migrate.mjs` beside this file reads both instances, pages, batches, remaps ids
and resumes. You and the user decide the mapping. Everything written to the target is
permanent: nothing on Aspen deletes.

The CLI has no data commands. The script uses the REST API (`/api/v24.3/data/*`,
`/api/v24.3/describe/*`), signing in to each instance through the browser. There is no upsert, and a record's `id`
cannot be set, so every target record gets a new id; the id map in the workspace connects the
two.

```sh
M="<this skill's dir>/scripts/migrate.mjs"
node "$M" --help
```

## 1. Sign-in: the user signs in in the browser, you never see a token

Each command that reaches an instance signs in to it the way `aspen login` does: a browser tab
opens, the user signs in, and the token stays in the script's memory until the command ends.
Nothing is saved: no API key, no token file, no keychain entry. `describe` signs in to both
instances (`--side` names one), `extract` to the source, `load` and `verify` to the target.
`init` and `draft` sign in to nothing.

- Run those commands in the background; each waits for the user. Say which instance's tab
  opened and which account to use: on the source, one that can read every migrated object; on
  the target, one that can write them. If no tab opened, give the user the URL the script
  printed. It holds no secret.
- The machine must reach both instances (VPN), and the browser must run on this machine: the
  sign-in comes back to `127.0.0.1`.
- Never ask for an API key or a token, and never keep one between commands. Don't run
  `aspen login` for a migration: the CLI's login stays on the target directory's instance.

## 2. Start the workspace

From the target instance directory, with `aspen doctor` clean (`using-aspen`):

```sh
node "$M" init data/migrations/<source-name> --source <url> --target <url>
node "$M" describe data/migrations/<source-name>
node "$M" draft data/migrations/<source-name> --objects company_c,contact_p,opportunity_p
```

- The target URL is `instance` in `.aspen/config.toml`. `init` refuses any other.
- `describe` writes both schemas to `schema/`. The object names are the keys of `objects` in
  `schema/source.json`. Nothing is written to either instance until `load --run`, and nothing is
  ever written to the source.
- Ask the user which source objects to migrate; `--objects` takes **source** names. `draft`
  writes `mapping.json`, matching objects and fields by name and type, and marks each gap with a
  `todo`. The format: `mapping-format.md` beside this file.

## 3. Settle every `todo` with the user

Ask one object at a time. Don't guess a value mapping, a default or a key.

| `todo` | Ask | Then |
|---|---|---|
| Source object has no target object | Map it to an existing object, leave it out, or create it? | Before creating, run `lean-data-model`. A platform object often fits: `company_c` → `account_p`. |
| Source field has no target field | Map it to another field, transform it, leave it out, or create it? | For a transform, write `expr` and put the user's words in `note`. To leave it out, set `drop: true`. |
| Picklist value not on the target | Which target value does each one become? | Add a `map` entry per value, or a `default`. |
| Target field is required, and nothing maps to it | Which constant or rule fills it? | Use `value` or `expr`. |
| Lookup to an object that is not migrated | Migrate that object too, match it by a field (users by email), or leave the field blank? | Use `lookup: "obj"`, `lookup: {object, match}`, or `drop`. |
| No `key` | Which field identifies the same record on both sides? | Without a key, running a second migration from another source, or reloading after a data change, can duplicate records. A key that repeats on the source, such as a company name, would merge records; the dry run reports each repeat as an error. |

**Creating a target object or field** follows the normal loop: `lean-data-model` →
`model-first` → `metadata` → `build-and-deploy`. Then run `describe --side target` again so the
mapping sees it.

Tell the user what cannot move: the created and modified dates and users (system fields).
Record history, files and the activity feed are not migrated either. Add a custom field for
the original created date only if they need it.

## 4. Extract, then a dry run

```sh
node "$M" extract data/migrations/<source-name>
node "$M" load data/migrations/<source-name>          # dry run: writes reports/plan.md, sends nothing
```

The dry run converts every row and reports its errors:
- a value missing from a map
- a required field left blank
- a lookup to a record that is not in the extract

Fix the mapping and run it again until there are no errors. Then show the user the summary:
the load order, the row counts, and the fields filled in by the second pass.

## 5. Load: ask first, then a pilot

State the target instance, the objects and the row counts, and get a yes. Then:

```sh
node "$M" load data/migrations/<source-name> --run --limit 20   # pilot: at most 20 new rows per object
```

A pilot record whose parent is not in the pilot waits; it is not loaded without its parent. The
user checks the pilot records in the app. With their yes:

```sh
node "$M" load data/migrations/<source-name> --run
```

- It is safe to run again: rows already in the id map are skipped, and rows whose `key`
  matches an existing target record are matched instead of inserted.
- Keep the default batch of 100 rows: 200-row `contact_p` batches have failed. If a batch fails
  with a server error, run again with `--batch 50`. The script waits and retries when the
  instance limits the request rate.
- Failed rows go to `errors/<object>.jsonl`, and the counts to `reports/load.md`. Fix the
  mapping or the data, then run again. A record matched by `key` goes into the id map too, so
  lookups to it resolve.

## 6. Verify

```sh
node "$M" verify data/migrations/<source-name>
```

For each object it counts the records extracted, loaded and not loaded. Then it reads a sample
of target records back (`--sample`, default 20) and compares them field by field with the
converted source rows.

You can say the migration is done when both are true:
- verify reports 0 failed and 0 mismatches
- the user has looked at some records in the app

Commit `mapping.json` and `reports/`. Reports hold counts and field names, not record values.
The workspace's own `.gitignore` keeps record data
(`extract/`, `idmap/`, `errors/`, `schema/`) out of git.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask for an API key, or keep the token for the next command" | Never. Each command signs in through the browser and keeps nothing. |
| "I'll upsert on the legacy id" | There is no upsert. The id map and `key` make a re-run safe. |
| "I'll add a `legacy_id_c` field to every object for traceability" | The id map already records it, and a field is permanent. Add one only if the user needs to see the source id on the record. |
| "The sector values look obvious; I'll map them" | Ask. A wrong map writes permanent records. |
| "I'll skip the pilot, they're in a hurry" | A bad full load cannot be deleted. The pilot is 20 rows. |
| "The load failed, so I'll clear the target and reload" | Nothing deletes. Fix the mapping and run again: the id map skips rows already loaded. |
| "I'll `aspen login` to the source to read it" | The script signs in to the source itself; stay in the target directory. |

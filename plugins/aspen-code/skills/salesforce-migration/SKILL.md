---
name: salesforce-migration
description: Use when moving records from a Salesforce org into an Aspen instance — reading an SFDC object's schema, mapping it onto the Aspen data model including this instance's customizations, reporting the gaps and ETLs that mapping needs, and extracting, transforming and loading the records. Salesforce to Aspen only; Salesforce is never written to.
---

# Salesforce migration

Read a **Salesforce** object, map it onto the **Aspen** instance whose directory you are in,
say what does not fit, and load it. `scripts/sfmigrate.mjs` beside this file does the Salesforce
half; the Aspen half is the `instance-migration` skill's `migrate.mjs`, unchanged. You and the
user decide the mapping. Everything written to Aspen is permanent: nothing on Aspen deletes.

```sh
SF="<this skill's dir>/scripts/sfmigrate.mjs"
M="<the instance-migration skill's dir>/scripts/migrate.mjs"
node "$SF" --help
```

Salesforce is reached only through the `sf` CLI, which holds its own auth. Never ask for a
Salesforce password, token or connected app: if `sf org list` shows no usable org, the user runs
`sf org login web` themselves. Salesforce is only ever read.

## The flow

From the target instance directory, with `aspen doctor` clean. `W` is `data/migrations/<org>`.

| # | Command | Reaches | Writes |
|---|---|---|---|
| 1 | `sfmigrate init W --org <alias>` | the `sf` CLI | `mapping.json`, `.gitignore` |
| 2 | `sfmigrate describe W --objects Account,Contact` | Salesforce | `schema/source.json` |
| 3 | `migrate describe W --side target` | Aspen (browser) | `schema/target.json` |
| 4 | `sfmigrate probe W --sample 500` | Salesforce | `schema/fill.json` |
| 5 | `sfmigrate draft W` | nothing | `mapping.json`, `reports/gaps.md`, `mapping/fields.csv` |
| 6 | Settle every `todo` with the user ([mapping-format.md](mapping-format.md)) | nothing | `mapping.json` |
| 7 | `sfmigrate extract W` | Salesforce | `extract/` |
| 8 | `migrate load W` (dry run; repeat until 0 failed) | Aspen | `reports/plan.md` only |
| 9 | `migrate load W --run --limit 20` (pilot), after the user's yes | Aspen | target records |
| 10 | `migrate load W --run`, after the user checked the pilot and said yes | Aspen | target records |
| 11 | `migrate verify W` | Aspen | `reports/verify.md` |

- Steps 2 and 3 both write into `schema/`; draft needs both. Step 4 is optional but do it: it is
  what turns 464 Salesforce fields into the handful that hold data.
- `sfmigrate gaps W` re-reports after the user changes the mapping, and exits 1 while a todo is left.
- Load order, id remapping, resume and the second pass for self-lookups are `migrate.mjs`'s job
  and are unchanged. A load is safe to run again.
- To create a target object or field: `lean-data-model` → `model-first` → `metadata` →
  `build-and-deploy`, then `migrate describe W --side target` and `sfmigrate draft W` again.
- Done when verify reports 0 failed, 0 differences and 0 not loaded, and the user has looked at
  records in the app. Commit `mapping.json`, `mapping/fields.csv` and `reports/`; the workspace's
  `.gitignore` keeps record data out of git.

## What draft decides on its own

Drop is the proposal for anything the target cannot carry, because a new Aspen field is
permanent. Only a field that **matched a target field and still does not fit** becomes a todo.

| Salesforce | Proposal |
|---|---|
| `Id`, audit fields, anything not createable and not computed | Dropped silently: Aspen stamps its own `cb_p`/`ct_p`/`mb_p`/`mt_p`. |
| A field whose name or label matches a target field | Mapped, `exact`. |
| A field matched through the synonym table (`Description` → `about_p`) | Mapped, `close`, with `matched by synonym` in the report. |
| A lookup to an object in the same migration | `"lookup": "<SFDC object>"`, resolved through the id map. |
| `OwnerId` and any lookup to `User` | Matched by email to whichever object the target field looks up (`user_p` on one instance, `team_p` on another), blank when there is no match. A todo when that object has no unique email field. |
| A field nothing on the target matches | Dropped, and listed in the report under **holds data** or **empty in the sample**. |
| A formula or roll-up field | A gap: Aspen has no computed-field type. Its value can be extracted as data, or the rule moves to a Rust trigger (`server-code`). |
| A multi-select picklist | A gap: Aspen picklists hold one value. |
| `RecordTypeId`, `CurrencyIsoCode`, `IsPersonAccount` | Named as a modelling decision rather than a field match. |
| Picklist values missing on the target | A todo, with the values that do exist already in `map`. |
| A required target field nothing maps to | A todo: ask which constant or field fills it. |

## What to tell the user

Each message has three parts, in order: what just happened (one line), what it means, and the one
thing you need from them.

| After | The message |
|---|---|
| `init` | The org's username and instance URL, and the target instance. If `sf org list` shows nothing usable, ask the user to run `sf org login web`. |
| `describe` | Field counts per object, and how many need an ETL. |
| `probe` | How many fields hold data out of how many exist. This is the number that makes the mapping tractable — lead with it. |
| `draft` | Per object, the **Needs your decision** table from `reports/gaps.md`, then one line for what maps as it is, then the count of dropped-but-populated fields with the top few by fill rate. End with: "Reply yes to take these, or tell me which rows to change." The first time, add what cannot move: created and modified dates and users, history, files, the feed. |
| The dry run | To insert, matched, failed. For failures: a row per field and problem, its count, and the proposed fix. When it's clean: the pilot ask, naming the target, objects, row counts and that the records are permanent. |
| A load | Inserted, failed, held back; the names of a few loaded records to check in the app; the next step. |
| `verify` | Sampled, differences, not loaded; whether the migration is done. |

A proposal is not a decision: change `mapping.json` only after the user answers.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask about all 464 fields" | Probe first, then ask only about what matched badly or holds data. The rest is a drop list the user skims. |
| "I'll create Aspen fields for the Salesforce fields that don't fit" | A field is permanent. `lean-data-model` first, and only for a use the user named. |
| "I'll ask the user for a Salesforce token" | The `sf` CLI holds the auth. If it has no org, the user runs `sf org login web`. |
| "The formula field is computed, so it's not my problem" | Its value is real data. Extract the value, or move the rule to a trigger — but say which. |
| "I'll upsert on the Salesforce Id" | There is no upsert, and `id_p` cannot be set. The id map makes a re-run safe. |
| "I'll skip the pilot" | A bad full load cannot be deleted. Nothing on Aspen deletes. |
| "The pilot will show whether the target accepts it" | The pilot writes permanent records. It is not a test: settle the value with the user first. |
| "Record types will map themselves" | They are a modelling decision. Ask before mapping anything that depends on one. |

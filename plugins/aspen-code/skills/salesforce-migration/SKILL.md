---
name: salesforce-migration
description: Use when moving records from a Salesforce org or a Salesforce export (CSVs with a manifest) into an Aspen instance — reading an SFDC object's schema, mapping it onto the Aspen data model including this instance's customizations, reporting the gaps and ETLs that mapping needs, and extracting, transforming and loading the records. Salesforce to Aspen only; Salesforce is never written to.
---

# Salesforce migration

Read a **Salesforce** object, map it onto the **Aspen** instance whose directory you are in,
say what does not fit, and load it. `scripts/sfmigrate.mjs` beside this file does the Salesforce
half; the Aspen half is the `instance-migration` skill's `migrate.mjs`. The user decides which
objects move and settles every mapping question; the scripts do everything else. Loaded records
can be deleted (`instance-migration` has the API), as a separate step the user asks for; new
objects and fields can't be deleted yet.

```sh
SF="<this skill's dir>/scripts/sfmigrate.mjs"
M="<the instance-migration skill's dir>/scripts/migrate.mjs"
node "$SF" --help
```

The source is an **export on disk** (`manifest.json`, `describe/<Object>.json` and one CSV per
object) or a **live org**. With an export, Salesforce is not reached at all: describe, probe and
extract read the files, so a filtered or date-shifted export loads exactly as it is. Never write
your own CSV converter. A live org is reached only through the `sf` CLI, which holds its own auth:
never ask for a Salesforce password, token or connected app; if `sf org list` shows nothing
usable, the user runs `sf org login web`.

## The flow

From the target instance directory, with `aspen doctor` clean. `W` is `data/migrations/<name>`.

| # | Step | Reaches | Writes |
|---|---|---|---|
| 1 | `sfmigrate init W --from-export <dir>`, or `--org <alias>` for a live org | nothing, or the `sf` CLI | `mapping.json`, `.gitignore`; prints the objects and their record counts |
| 2 | **Ask which objects to migrate**: one multi-select, with the counts | nothing | — |
| 3 | `sfmigrate plan W --objects <their choice>` | Aspen; Salesforce only without an export | `schema/`, `mapping.json`, `reports/gaps.md`, `mapping/fields.csv` |
| 4 | **One decision round per object** (below) | nothing | `mapping.json` |
| 5 | `sfmigrate extract W`, then `migrate load W` (dry run) | the export or Salesforce; Aspen | `extract/`, `reports/plan.md` |
| 6 | After the user's one yes for the write: `migrate load W --run --limit 20 --then load --run --then verify` | Aspen | target records, `reports/verify.md` |

- Aspen sign-in: `plan` opens one browser tab, and every Aspen command after it reuses that
  sign-in until an hour passes with none ([instance-migration](../instance-migration/SKILL.md)
  `## Sign-in`). Run `migrate signout W` when done.
- `plan` is describe, the target's describe, probe and draft in one run. `--keep-target` reuses
  `schema/target.json` (no sign-in); `--redraft` drafts settled objects again. An object that had
  no target is drafted again on its own once the target has one.
- The step-6 chain stops at the first step that fails: a pilot with a failed row never reaches
  the full load. Bring the failures to the user, fix the mapping with them, dry-run again, and
  ask again before any `--run`. A pilot is a write: re-running it needs a new yes.
- An export regenerated after `init` is refused: `init` again, then `plan`. Owner lookups read
  `User.csv` from the export; without one, `init` with `--org` as well.
- Draft and the dry run read the target's rules from `schema/target.json` (lengths, ranges,
  object-dependent picklists, the currencies the instance has) and the CRM rules the describe
  doesn't declare (`TARGET_RULES` in `migrate.mjs`). Other triggers and validation rules show only
  on a real write: the pilot.
- Load order, id remapping, resume and the second pass for self-lookups are `migrate.mjs`'s job.
  A load is safe to run again.
- Done when verify reports 0 failed, 0 differences and 0 not loaded (or only the rows the user
  chose to leave out), and the user has looked at records in the app. Commit `mapping.json`,
  `mapping/fields.csv` and `reports/`; the workspace's `.gitignore` keeps record data out of git.

### Step 2: scope comes first

Ask before anything is drafted or created. An object with no Aspen counterpart is **skipped** by
default. Building a new object is the last option, marked permanent (it can't be deleted yet),
and only for a use the user names: then `lean-data-model` → `model-first` → `metadata` →
`build-and-deploy`, with no lifecycle unless they ask for one, then `plan` again.

### Step 4: one decision round per object

From `reports/gaps.md`, one message per object (an `AskUserQuestion` round where it fits) with
only what needs the user:

- **Needs your decision**: every todo, each with your proposal already filled in. A picklist
  value gets the target item closest in meaning; its count in the data says how much it matters.
- **Changed on the way in**: the rows draft proposed `normalize`, `truncate` or `distinctFrom`
  for, and the fields Aspen sets itself, so the user sees what will differ from Salesforce.

Then write `mapping.json` from their answers, all at once. Never settle a todo, or change a
proposal, without the user's answer. Don't ask about empty or Salesforce-owned fields, and ask
about a key only if the target may already hold these records.

## What draft decides on its own

Drop is the proposal for anything the target cannot carry, because a new Aspen field can't be
deleted yet. Only a field that **matched a target field and still does not fit** becomes a todo.

| Salesforce | Proposal |
|---|---|
| `Id`, audit fields, anything not createable and not computed | Dropped silently: Aspen stamps its own `cb_p`/`ct_p`/`mb_p`/`mt_p`. |
| A field whose name or label matches a target field | Mapped, `exact`. |
| A field matched through the synonym table (`Description` → `about_p`) | Mapped, `close`, with `matched by synonym` in the report. |
| A lookup to an object in the same migration | `"lookup": "<SFDC object>"`, resolved through the id map. |
| A Salesforce reference onto an Aspen polyid (`customer_p`, `what_p`, `who_p`, `owner_p`) | The id through the id map, or a User by email, with the companion (`whaton_p`…) as `"objectOf"`. The objects it may hold come from the target's `allowed-objects`/`included-polyids`; a row pointing at one it can't hold (a Lead in `who_p`) carries blank. Nothing it points at can land (no user with a unique email): dropped. `Opportunity.AccountId` is `customer_p`. |
| `AccountContactRelation`, `OpportunityContactRole`, `CaseContactRole` | `contact_role_p`, never `contact_rel_p` (a team member's relationship strength with a contact). The parent fills `what_p`, `Roles`/`Role` is proposed for `role_p`. Keyed on `contact_role_chk_p` over `contact_p` and `what_p`, so a role Aspen's triggers already derived (a primary account or contact, an opportunity's customer, a case's contact) is matched, not inserted twice. `AccountContactRelation` extracts only `IsDirect = false`. |
| `AccountTeamMember`, `OpportunityTeamMember`, `CaseTeamMember` | `team_role_p`: the User matched to `team_p` by email, the parent in `what_p`, keyed on `team_role_chk_p` (the owner's row is already derived). `CaseTeamMember` extracts only users; a case's contacts are `CaseContactRole`. |
| `Task`, `Event` and `TaskRelation`, `EventRelation` | `task_p`/`meeting_p`. The activity's own row names its owner in `who_p` (a team member) and is not given `WhoId`; each contact in its relation is a child row (`parent_p`), copying the subject, start and due date it must carry. Users and leads in a relation are not carried. Migrate the relations with their activity. |
| `Event`, `Product2`, `Period`, `User`, `EmailMessage` | `meeting_p`, `product_p`, `fiscal_period_p`, `team_p`, `email_p`, by their descriptions. `Email`/`Phone` on a contact are `work_email_p`/`office_phone_p`; `ProductCode` is `sku_p`. |
| A phone or URL field | `"normalize": "phone"` (E.164 where the number says its country) or `"url"` (https:// added, cut or blank when too long); `"linkedin"` for `linkedin_profile_p`, in Aspen's own form. What can't be converted is left blank and counted by the dry run. |
| Text longer than the target allows | `"truncate": true`, with the longest value in the note. |
| Contact phones and emails | `"distinctFrom"`: office or home blank when it equals mobile, personal email when it equals work. The CRM refuses the same value in both. |
| Contact `OwnerId` | Dropped: Aspen makes the person loading a contact its owner, whatever the row says. |
| A combobox (`Subject`) onto a text field | Mapped as it is: it is free text with suggestions. |
| Billing, shipping, mailing and other address fields | A gap: Aspen keeps addresses as `account_address_p`/`contact_address_p` records. Migrate them from a second workspace once the parent has loaded. |
| An object Aspen derives (`contact_owner_p`, `contact_channel_p`, `contact_merge_p`, `miner_*`) | A todo: don't load it. |
| An object with no Aspen counterpart | A todo: skip it unless the user names a use (step 2). |
| `Lead` | `lead_p`, with a note: it is an early deal, not an unqualified person, and its trigger creates a contact for each lead it can't match. Migrate Contact and Account first. |
| `OwnerId` and any lookup to `User` | Matched by email to whichever object the target field looks up (`user_p` on one instance, `team_p` on another), blank when there is no match. |
| A field nothing on the target matches | Dropped, and listed in the report under **holds data** or **empty in the sample**. |
| A formula or roll-up field | A gap: Aspen has no computed-field type. Its value can be extracted as data, or the rule moves to a Rust trigger (`server-code`). |
| A multi-select picklist | A gap: Aspen picklists hold one value. |
| `RecordTypeId`, `IsPersonAccount` | Named as a modelling decision rather than a field match. |
| A currency field (`Amount`) | Its record currency too: `ccode_p`, matched from `CurrencyIsoCode` to the `currency_p` whose code is labelled with it (`"by": "value"`). Codes in the data the target has no `currency_p` for are a todo with their counts and a `where` that keeps the rest. Without `CurrencyIsoCode`, a todo for the org's currency. |
| A percent field onto a target that takes 0 to 1 (`maxValue` 1) | Divided by 100 (`expr`). |
| Picklist values missing on the target | A todo with only the values the data holds, each with its count; those that match a target item by name or label are already in `map`. For an object-dependent picklist, only the items the parent object allows. |
| A required target field nothing maps to | The Salesforce field of the same name, even a computed one (`Contact.Name` → `name_p`); otherwise a todo for a constant or a field. |

## What to tell the user

Each message has three parts, in order: what just happened (one line), what it means, and the one
thing you need from them.

| After | The message |
|---|---|
| `init` | The source (the export and when it finished, or the org's username and URL) and the target, then the scope question: the objects with their counts. |
| `plan` | Per object: how many fields hold data, how many map, how many need a decision. Then the first decision round. The first time, add what cannot move: created and modified dates and users, history, files, the feed. |
| A decision round | What needs a decision, each with your proposal, and what changes on the way in. End with: "Reply yes to take these, or tell me which to change." |
| The dry run | To insert, failed, and the **Changed on the way in** counts. For failures: a row per field and problem, its count, and the proposed fix. When it's clean: the one write ask, naming the target, objects and row counts, and that a failed pilot stops before the full load. |
| The load chain | Inserted, failed; verify's differences; the names of a few loaded records to check in the app. |

A proposal is not a decision: change `mapping.json` only after the user answers.

## Red flags

| Thought | Reality |
|---|---|
| "I'll write a converter for the export's CSVs" | `init --from-export` reads them: describe, fill rates, extract, owners. |
| "Quote has no Aspen object, so I'll ask whether to build one" | Ask which objects to migrate first. No counterpart means skip, unless the user names a use. |
| "These todos are obvious, I'll settle them" | Propose; the user decides. One round per object keeps it quick. |
| "The pilot hit a rule; I'll fix it and run the pilot again" | Every `--run` needs its own yes. Dry-run the fix, then ask. |
| "`contact_rel_p` sounds like `AccountContactRelation`" | Names mislead. Map by the `description` `reports/gaps.md` quotes for each Aspen object and field, or ask. |
| "I'll ask about all 464 fields" | Ask only about what matched badly or holds data. The rest is a drop list the user skims. |
| "I'll create Aspen fields for the Salesforce fields that don't fit" | A field can't be deleted yet. `lean-data-model` first, and only for a use the user named. |
| "I'll design a lifecycle for the new object" | Only if the user asks. Migrated records need a place to land, not a workflow. |
| "I'll ask the user for a Salesforce token" | The `sf` CLI holds the auth. If it has no org, the user runs `sf org login web`. |
| "The formula field is computed, so it's not my problem" | Its value is real data. Extract the value, or move the rule to a trigger — but say which. |
| "I'll upsert on the Salesforce Id" | There is no upsert, and `id_p` cannot be set. The id map makes a re-run safe. |
| "I'll skip the pilot" | Undoing a bad full load means deleting every record it wrote. The pilot finds the problem on 20, and the chain stops there. |
| "The dry run is clean, so the load will be" | It checks what the describe and `TARGET_RULES` declare. Other triggers answer only on a real write: that is the pilot. |
| "Record types will map themselves" | They are a modelling decision. Ask before mapping anything that depends on one. |

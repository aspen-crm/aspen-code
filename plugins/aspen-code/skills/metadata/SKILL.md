---
name: metadata
description: Use when authoring or changing Aspen metadata in metadata/custom/ — objects, fields, picklists, layouts, list views, tabs, tab collections, lifecycles, record types, or an extends overlay on a platform component — and validating it offline with aspen compile --metadata. Run lean-data-model and model-first first when the change creates something.
---

# Authoring metadata

You write JSON into `metadata/custom/`, one file per component; `aspen compile --metadata`
validates it offline with the instance's own validator and writes the resolved result to
`metadata/compiled/`. The instance directory's `AGENTS.md` is the authority on paths, naming and
required keys — **read it first**, every session. When a rule below disagrees with `AGENTS.md` or
with the compiler, they win; tell the human this skill needs fixing.

## The loop

1. **Find the shape — copy, never invent.** Three sources, best first:
   - `metadata/active/<ctype path>/` — custom components **already deployed** on this instance, as
     authored source. The closest thing to what you are about to write.
   - `metadata/platform/<ctype path>/` — the platform's own components.
   - `metadata/compiled/` — the resolved truth after `aspen compile`, with every default filled
     in. Read it to see what an attribute resolves to; strip resolved-only keys when you copy.

   Filter a large file with `jq`, e.g.
   `jq '.fields[] | select(.type=="picklist")' metadata/platform/object_p/opportunity_p.json`.
   Never probe attribute names or enum values by trial and error — every failed compile is a
   guess you could have read.

   `metadata-shapes.md` beside this file has the shapes with no example to copy: a dot-walked
   list-view column, a `custom_page` tab, a `query-filter` on the current user.

2. **Author into `metadata/custom/`**, at the path `AGENTS.md` gives — subcomponents nest inside
   their parent type's directory (`object_p/layout_p/`, `object_p/list_view_p/`,
   `object_p/tab_p/`, `object_p/picklist_p/`). File name = component name + `.json`.
   - **A new component:** `"name"`, ending `_c`.
   - **Changing a platform component:** an overlay with `"extends": "<platform name>"` carrying
     **only** the attributes you change (fields you add go in its `fields`). `extends` appears only
     in `custom/`. Look at `metadata/active/object_p/` — extended platform objects look exactly
     like this.

3. **Compile:** `aspen compile --metadata`. Nothing leaves the machine. It validates `custom/`
   against `active/` + `platform/` exactly as `checkin-prep` would. On failure it prints
   `The metadata is not valid:` and one line per component, **most of them cascade**: every
   component after the first failure reports it "passed initial validation, but further checks
   were skipped due to other errors in the batch." Keep only the causes:

   ```sh
   aspen compile --metadata > /tmp/aspen-compile.out 2>&1; grep -v 'skipped due to other errors' /tmp/aspen-compile.out
   ```

   Fix every cause it names, compile again, repeat until it passes. If **only** cascade lines
   come back, the cause is in `active/` or `platform/`, not your change: see `diagnose` (usually
   version skew).

4. **Read the result back** in `metadata/compiled/` — it is your source with the platform merged
   in. Then hand off to `build-and-deploy`.

## Naming (the validator enforces these; `AGENTS.md` has the full list)

- Every dot-separated segment ends `_c` (yours) or `_p` (platform), starts with a letter, is
  lowercase letters/digits/underscores, and has 2–24 characters before the suffix.
- **No underscore in the last two characters before the suffix:** `tier_1_c` fails, `tier_one_c`
  passes. Numbered picklist items are the usual casualty.
- A subcomponent is `<parent>.<segment>`: `renewal_c.layout_c`, `renewal_c.status_c`. The
  component's own segment ends `_c` too — `renewal_c.layout_p` is rejected as not custom.
- Fields live inside their object's file under `fields`. There is no `field_p` directory.
- An object-specific picklist is `<object>.<field>` in `object_p/picklist_p/`; a shared one lives in
  the top-level `picklist_p/`.

## Field types — copy from a real object, these are the common pairs

| kind | `type` / `subtype` | notes |
|---|---|---|
| text | `text` / `text` | `max-length` |
| long text | `text` / `long` | cannot be `indexed` |
| number | `number` / `number` or `percentage` | `min-value` **and** `max-value`, both as **strings** (`"0"`) |
| currency | `currency` / `currency` | |
| date / datetime | `date` / `date`, `datetime` / `datetime` | |
| checkbox | `checkbox` / `checkbox` | two values is a checkbox, not a picklist |
| picklist | `picklist` / `picklist` | `picklist: "<object>.<field>"` |
| lookup | `id` / `lookup` | `relationship: "<object>"` |
| owning parent | `id` / `parent` | `relationship`, usually `deletion-strategy: cascade` |
| polymorphic | `polyid` / `lookup` | `allowed-objects` — plus two companion fields, below |

- `deletion-strategy`: `cascade`, `block`, or `set_to_null` (default). An `id` field cannot be
  `required` under `set_to_null`.
- **A polyid needs its companions authored by you:** for `owner_c` with
  `related-object-field: "owneron_c"` and `related-display-field: "ownerdn_c"`, add `owneron_c` as
  `picklist`/`object_ref` with `polymorphic-field: "owner_c"`, and `ownerdn_c` as plain `text`.
- `indexed` is valid on text, picklist, date, datetime, number, currency and uuid — not on `id`,
  `polyid`, `checkbox` or long text.
- `searchable: true` needs a search config to go with it; default to `false`.
- Never author platform-derived fields (`id_p`, audit fields) — the instance adds them.
- A new field on an object with record types must also appear in each `object_type_p`, or typed
  records reject it.

## Making an object usable

An object is not reachable until it has a `layout_p`, a `list_view_p`, and a `tab_p` placed in a
`tab_collection_p`. After creating one, check all four exist.

- **Layout:** needs `object`; sections carry `columns` (`one_column` | `two_column_flow`) and
  `fields` as objects `{"name": ..., "field": ...}` — plain strings are rejected. Fields by raw
  name (`amount_p`), never an alias.
- **List view:** needs `tab` (the full tab name); columns `{name, field}`; sort entries
  `{name, column, direction}`; the filter is `query-filter`, an XQL string. There are no relative
  dates — "next quarter" is a static range someone must edit; say so.
- **Tab:** `{"tab-type", "object", "default-list-view": "<full list view name>", "label", "active"}`.
  A tab surfaces only its default list view; a second view on the same tab is unreachable.
- **Tab collection:** author your own `tab_collection_p` (e.g. `sales_ops_c`) listing the platform
  tabs you want beside yours. If you instead `extends` an existing collection, its `tabs` list
  **replaces** the custom children — include every existing custom tab (read them from `active/`)
  or the check-in fails with "Child components must not be dropped".

## Rules

- **Nothing deletes.** Retire a component, field, column or tab with `"active": false` and keep
  the file. Dropping a child entry or deleting a deployed file fails check-in ("Child components
  cannot be dropped"). Reordering is fine.
- **Deploy a platform overlay as its own package**, apart from your custom work, so one rejection
  cannot take the rest with it. Some platform components refuse any overlay (observed on 26.3.3:
  a base object type, a platform picklist such as `task_p.priority_p`, the stock `aspen_crm_p` tab
  collection) — `aspen compile` will say so; don't fight it, author a custom one.
- A value derived from other fields is a stored field maintained by a trigger, and a status flow
  is a `lifecycle_p` — see `model-first` before reaching for anything else.
- For a set of related objects, fan out to `schema-explorer` to map what exists, and to
  `metadata-reviewer` to audit the diff before deploy.

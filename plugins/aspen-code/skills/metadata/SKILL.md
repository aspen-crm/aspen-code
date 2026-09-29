---
name: metadata
description: Use when authoring or changing Aspen metadata in metadata/custom/ — objects, fields, picklists, layouts, list views, tabs, tab collections, lifecycles, record types, or an extends overlay on a platform component — and validating it offline with aspen compile --metadata. Run lean-data-model and model-first first when the change creates something.
---

# Authoring metadata

You write JSON into `metadata/custom/`, one file per component; `aspen compile --metadata`
validates it offline with the instance's own validator and writes the resolved result to
`metadata/compiled/`. The instance directory's `AGENTS.md` is the authority on paths and naming, and
the Aspen docs (below) on each component type's attributes — read them, don't recall them.

## The loop

1. **Read the docs page for each ctype you touch**, through `aspen-docs` (table below), before
   the first file. If `aspen-docs` is not connected, for example because it needs authorizing,
   stop and tell the user to authorize it (`/mcp`). Don't author from memory.

   **Then find the shape — copy, never invent.** Three sources, best first:
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
     like this. "Only" is literal: `ctype`, `extends`, the changes, nothing else. Leave out the
     identifying attributes, such as a layout's `object` ("is locked and cannot be extended").
   - **Child components of an overlay** (a layout's `sections`, an object's `fields`): list only
     your new `_c` children, plus `{"extends": "<platform child>", …changes}` for a platform child
     you change. Platform children merge in on their own. A platform child copied in by `name` is
     rejected ("does not match the expected namespace of custom"). Some child attributes are
     locked too, for example `active` on some platform layout sections.
   - **No authored file carries `mtype` or `namespace`**, whether it is new or an overlay
     ("unknown fields: mtype", "namespace field not allowed in input"). The instance `AGENTS.md`
     "Every metadata file" example shows both. That example is wrong (CLI 26.4.1), so leave them out.

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

## Reference: the Aspen docs, not this skill

Attribute lists, types and examples for every component type live in the Aspen documentation,
reachable through the plugin's **`aspen-docs`** MCP server (`searchDocumentation`, then `getPage`
on the URL it returns). Read the page for the ctype you are writing before authoring it:

| For | Page |
|---|---|
| Naming, namespaces, the common attributes | `https://aspencrm.gitbook.io/docs/platform/introduction/components-overview` |
| Where a file goes, `name` vs `extends`, overlays | `…/platform/introduction/managing-component-files` |
| Field types, subtypes and their attributes (lookups, polyids, currency, picklists) | `…/platform/component-types/field` |
| Object, object type, picklist, layout, list view, tab, tab collection, lifecycle, … | `…/platform/component-types/<type>` (e.g. `list-view`, `tab-collection`) |

If the MCP is unavailable, fetch the same page with `.md` appended, or the index at
`https://aspencrm.gitbook.io/docs/llms.txt`. If that fails too (a 403, or a network block
page), say so and have the user authorize `aspen-docs`. Don't carry on from memory. **Precedence:** the compiler's verdict, then real
components in `active/`/`platform/`, then the docs, then this skill.

## What the docs do not say — learned from real check-ins

- **Nothing deletes.** Retire a component, field, column or tab with `"active": false` and keep
  the file. Dropping a deployed custom child entry or deleting a deployed file fails check-in
  ("Child components cannot be dropped"). Platform children are never dropped by leaving them out
  of an overlay, because they merge in through `extends`. Reordering is fine.
- **An object is not reachable until it has a layout, a list view, and a tab placed in a tab
  collection.** After creating one, check all four exist.
- **Extending a tab collection replaces its custom children.** Its `tabs` list must include every
  existing custom tab (read them from `active/`), or check-in fails with "Child components must
  not be dropped". Usually simpler: author your own `tab_collection_p` listing the platform tabs you
  want beside yours.
- **A tab surfaces only its `default-list-view`**; a second list view on the same tab is
  unreachable.
- **List-view filters have no relative dates** — "next quarter" is a static range someone must
  edit. Say so.
- **`number` bounds are decimal strings** (`"min-value": "0"`); a bare integer fails "expected a
  Decimal type". Copy the form real components use.
- **A new field on an object with record types** must also appear in each `object_type_p`, or
  typed records reject it.
- **`searchable: true` needs a search config** to go with it; default to `false`.
- **Some platform components refuse any overlay** (observed on 26.3.3: a base object type, a
  platform picklist such as `task_p.priority_p`, the stock `aspen_crm_p` tab collection). The
  compiler says so — author a custom one instead. Deploy any platform overlay as **its own
  package**, so one rejection cannot take your custom work with it.
- A value derived from other fields is a stored field maintained by a trigger, and a status flow
  is a `lifecycle_p` — see `model-first`.
- For a set of related objects, fan out to `schema-explorer` to map what exists, and to
  `metadata-reviewer` to audit the diff before deploy.

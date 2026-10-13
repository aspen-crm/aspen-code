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
     you change. Platform children merge in on their own. Some child attributes are locked too,
     for example `active` on some platform layout sections.
   - **A child entry that points at a field is `{name, field}`, and only `name` is namespaced.**
     `name` must end `_c`: a platform child copied in by `name` is rejected ("does not match the
     expected namespace of custom"), and `{"extends": "<platform child>"}` works only if that child
     already exists on the component ("extension for nonexistent component"). `field` may be any
     field, platform included. So `{"name": "ccode_c", "field": "ccode_p"}` is how a custom
     overlay reaches a platform field — in an object type, a layout detail section, or a
     related-list column.
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

- **Metadata can't be deleted yet** (it's on the roadmap). Retire a component, field, column or
  tab with `"active": false` and keep
  the file. Dropping a deployed custom child entry or deleting a deployed file fails check-in
  ("Child components cannot be dropped"). Platform children are never dropped by leaving them out
  of an overlay, because they merge in through `extends`. Reordering is fine.
- **An object is not reachable until it has a layout, a list view, and a tab placed in a tab
  collection.** After creating one, check all four exist.
- **An overlay's custom children are the whole custom list.** A tab collection overlay (e.g. adding
  your tabs to `aspen_crm_p`) must keep listing every custom tab already deployed (read them from
  `active/`), or check-in fails with "Child components cannot be dropped". Its platform tabs are
  locked: you add beside them, never change them.
- **A tab opens on its `default-list-view`.** Other active list views on the same object and tab
  are reachable only from the Saved Views panel (or `?view=<list view name>`), so put the view
  people need daily in `default-list-view`.
- **List-view filters have no date offsets** — `TODAY()` and `NOW()` exist, but "next quarter" is
  a static range someone must edit. Say so.
- **`number` bounds are decimal strings** (`"min-value": "0"`), as platform components write
  them; a bare integer fails "expected a Decimal type". A `number` field needs **both**
  (otherwise it fails "missing field `max-value`" or "`min-value`"); on `currency` both are
  optional.
- **A `checkbox` `default-value` is a JSON boolean** (`false`), not the string `"false"`.
- **A new field on an object with record types** must also be listed in each of its
  `object_type_p`, platform ones included (`account_p.account_p`, all three `team_p` types), or
  typed records reject it ("is not allowed for object type"). On a platform object type, overlay
  it with `"fields": [{"name": "<field>_c", "field": "<field>_c"}]` for a custom field, or
  `{"name": "<platform field minus _p>_c", "field": "<platform field>"}` for a platform one.
- **The platform adds `_p` fields to an object that its object types don't get.** Some
  attributes add hidden fields when you compile: a `currency` field adds `ccode_p` and `ccdate_p`, for
  example. The Field docs say system fields are included in every object type, but that is not
  true of all of them, and nothing fails until a record write: "Field '<x>_p' is not allowed for
  object type …". After compiling, compare each object type against its object. The
  standard columns every object has (`id_p` … `otype_p`) are always allowed, so skip them:

  ```sh
  o=<object>; for t in metadata/compiled/object_type_p/$o.*.json; do
    jq -r --slurpfile obj metadata/compiled/object_p/$o.json '[.fields[].field] as $in
      | "\(.name): \(($obj[0].fields | map(select(.active != false).name)) - $in | join(", "))"' "$t"
  done
  ```

  Platform object types leave some `_p` fields out on purpose (`product_p.bundle_p` omits
  `uom_p`), so add only the ones your writes set, as `{"name": "<x>_c", "field": "<x>_p"}`.
  An entry name must be unique in the object type; if `<x>_c` is already taken, use another
  free `_c` name, or it fails "Component … is duplicated". Read the field's type before you set
  it: `ccode_p` takes a `currency_p` record id, not `"USD"`.
- **`searchable: true` needs a search config** to go with it; default to `false`.
- **Some platform components refuse an overlay** (26.4.1). Read the object's `extensibility` and
  any component's `locks` in `platform/` before planning:
  - `"extensibility": "locked"` refuses any overlay, even a label: `user_p`, `file_p`,
    `security_policy_p`, `contact_channel_p`, `contact_rel_p`, `contact_merge_p`,
    `join_request_p`, the `miner_*_p` objects.
  - `"limited"` (`activity_p`, `email_p`, `meeting_p`) refuses custom object types; `email_p` and
    `meeting_p` also lock `fields`, so no new fields.
  - A platform field cannot be retired: its `active` is locked.
  - A `_c` layout for a platform object is refused ("reserved for the platform"): extend the
    platform layout instead. A layout for your own object type on a platform object is fine.
  - Platform object types, most platform picklists and `aspen_crm_p` take new `_c` entries. Their
    platform entries are locked, except a picklist item's `label`, `description` and usually
    `active`, plus `parent-objects` on most object-dependent picklists: widen those rather than
    forcing data to fit.

  Deploy any platform overlay as **its own package**, so one rejection cannot take your custom
  work with it.
- A value derived from other fields is a stored field maintained by a trigger, and a status flow
  is a `lifecycle_p` — see `model-first`.
- For a set of related objects, fan out to `schema-explorer` to map what exists, and to
  `metadata-reviewer` to audit the diff before deploy.

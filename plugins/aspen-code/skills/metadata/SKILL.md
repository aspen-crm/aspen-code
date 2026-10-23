---
name: metadata
description: Use when authoring or changing Aspen metadata in metadata/custom/ — objects, fields, picklists, layouts, list views, tabs, tab collections, lifecycles, record types, or an extends overlay on a platform component — and validating it offline with aspen compile --metadata.
---

# Authoring metadata

You write JSON into `metadata/custom/`, one file per component; `aspen compile --metadata`
validates it offline with the instance's own validator and writes the resolved result to
`metadata/compiled/`. Creating something? `lean-data-model` and `model-first` come first. The
instance directory's `AGENTS.md` owns paths and naming; the docs own each type's attributes.
Not routed here from `using-aspen`? Read its "Where the docs are wrong" table first.

## The loop

1. **Read the docs page for each ctype you touch** (table below) through `aspen-docs`, then copy
   a shape rather than inventing one, best source first:
   - `metadata/active/<ctype path>/` — custom components already deployed on this instance.
   - `metadata/platform/<ctype path>/` — the platform's own components.
   - `metadata/compiled/` — the resolved result after a compile, every default filled in; strip
     resolved-only keys when you copy.
   - The sample instances, when none of these has the shape or you want one wired to the rest
     (object, layout, list view, tab, collection): [samples.md](../using-aspen/samples.md).

   Filter a large file with `jq`, e.g.
   `jq '.fields[] | select(.type=="picklist")' metadata/platform/object_p/opportunity_p.json`.
   Read attribute names and enum values rather than finding them by failed compiles.
   [metadata-shapes.md](metadata-shapes.md) has the shapes with no example to copy: a dot-walked
   list-view column, a `custom_page` tab, a `query-filter` on the current user, an undocumented
   enum.

2. **Author into `metadata/custom/`** at the path `AGENTS.md` gives; subcomponents nest in their
   parent type's directory (`object_p/layout_p/`, `object_p/list_view_p/`, `object_p/tab_p/`,
   `object_p/picklist_p/`). File name = component name + `.json`.
   - **New component:** `"name"`, ending `_c`.
   - **Changing a platform component:** an overlay of `ctype`, `"extends": "<platform name>"` and
     only the attributes you change (new fields go in its `fields`) — nothing else. `extends`
     appears only in `custom/`; the extended platform objects in `metadata/active/object_p/` are
     real examples. Leave out identifying attributes such as a layout's `object` ("is locked and
     cannot be extended").
   - **An overlay's children** (a layout's `sections`, an object's `fields`): list only your new
     `_c` children, plus `{"extends": "<platform child>", …changes}` for a platform child you
     change. Platform children merge in by themselves. Some child attributes are locked, such as
     `active` on some platform layout sections.
   - **A child that points at a field is `{name, field}`, and only `name` is namespaced.** `name`
     ends `_c`: a platform child copied in by `name` fails "does not match the expected namespace
     of custom", and `extends` works only on a child that exists ("extension for nonexistent
     component"). `field` may be any field, so `{"name": "ccode_c", "field": "ccode_p"}` reaches a
     platform field from an object type, a layout section or a related-list column.
   - **No authored file carries `mtype` or `namespace`** ("unknown fields: mtype", "namespace
     field not allowed in input"), even though the instance `AGENTS.md` "Every metadata file"
     example shows both — that example is wrong at CLI 26.4.1.

3. **Compile:** `aspen compile --metadata`. Nothing leaves the machine; it validates `custom/`
   against `active/` + `platform/` exactly as `checkin-prep` would. A failure prints
   `The metadata is not valid:` and one line per component, mostly cascade ("passed initial
   validation, but further checks were skipped due to other errors in the batch"). Keep the
   causes:

   ```sh
   aspen compile --metadata > /tmp/aspen-compile.out 2>&1
   node "<this skill's dir>/../diagnose/scripts/causes.mjs" /tmp/aspen-compile.out
   ```

   Under an agent the failure is one JSON `detail` string, so `grep -v` drops the causes with the
   cascade; the script reads either shape. Fix every cause and compile again until it passes. If
   only cascade lines come back, the cause is in `active/` or `platform/`, usually version skew:
   `diagnose`. Before you call a failure a platform limit, compile once more changing one thing
   (a label-only overlay against a `fields` change, say).

4. **Read the result** in `metadata/compiled/` (your source with the platform merged in), then
   `build-and-deploy`.

## Docs pages

Through `aspen-docs` (`searchDocumentation`, then `getPage`):

| For | Page |
|---|---|
| Naming, namespaces, the common attributes | `https://aspencrm.gitbook.io/docs/platform/introduction/components-overview` |
| Where a file goes, `name` vs `extends`, overlays | `…/platform/introduction/managing-component-files` |
| Field types, subtypes and their attributes (lookups, polyids, currency, picklists) | `…/platform/component-types/field` |
| Object, object type, picklist, layout, list view, tab, tab collection, lifecycle, … | `…/platform/component-types/<type>` (e.g. `list-view`, `tab-collection`) |

## What the docs do not say

- **Retire, never delete.** Set `"active": false` and keep the file. Dropping a deployed custom
  child entry or deleting a deployed file fails check-in ("Child components cannot be dropped").
  Leaving platform children out of an overlay doesn't drop them, and reordering is fine.
- **An object is reachable only with a layout, a list view, and a tab placed in a tab
  collection.** After creating one, check all exist.
- **An overlay's custom children are the whole custom list.** A tab collection overlay (adding
  tabs to `aspen_crm_p`) must keep listing every custom tab already deployed (read them from
  `active/`). Its platform tabs are locked: add beside them.
- **List-view filters have no date offsets.** `TODAY()` and `NOW()` exist; "next quarter" is a
  static range someone must edit. Say so.
- **`number` bounds are decimal strings** (`"min-value": "0"`; a bare integer fails "expected a
  Decimal type"), and a `number` needs both ("missing field `max-value`"). On `currency` the
  bounds are optional, but the field is not alone:
- **A `currency` field comes in a pair.** The entered `currency`/`currency` field names its
  companion in `converted-amt`, a `currency`/`converted` field named with `cc` before the
  namespace (`amount_c` → `amountcc_c`) whose `entered-amt` points back. Without it the compile
  fails "missing field `converted-amt`" or "references nonexistent field". Copy the pair from
  `metadata/platform/object_p/opportunity_p.json` (`amount_p`, `amountcc_p`); the converted field
  is system-managed and read-only on layouts.
- **A layout must render every mode.** Each of `create`, `edit` and `view` needs at least one
  active section, or the compile fails "Every render mode must be covered by at least one active
  section, but no section renders in: view". A detail section without `render-modes` covers all
  three; a related list, activity, attachment or people-role section covers only `view`; an
  address section `edit` and `view`; a `custom_code` section only the modes it lists. A detail
  section limited to `["create", "edit"]` needs a `view` section beside it.
- **A `checkbox` `default-value` is a JSON boolean** (`false`).
- **`searchable: true` needs a search config**; default to `false`.
- **A new field on an object with record types** must be listed in each of its `object_type_p`,
  platform ones included, or typed records reject it ("is not allowed for object type"). On a
  platform object type, overlay it with `"fields": [{"name": "<field>_c", "field": "<field>_c"}]`
  for a custom field, or `{"name": "<platform field minus _p>_c", "field": "<platform field>"}`
  for a platform one.
- **A platform overlay is refused, or a write fails "Field '<x>_p' is not allowed for object
  type":** read [platform-overlays.md](platform-overlays.md) — what each refusal means, and the
  `_p` fields a compile adds that object types don't get. Deploy a platform overlay as its own
  package, so one rejection can't take your custom work with it.

# Platform overlays: what refuses, what is locked

Read before planning an overlay of a platform (`_p`) component, and when a record write fails
"Field '<x>_p' is not allowed for object type". Checked against 26.4.1. The compiler enforces
`extensibility` and `locks` from this directory's `metadata/platform/`, which differ between
instances, so read the file there, then test a plan with a minimal overlay and
`aspen compile --metadata` before building on it.

## What refuses an overlay

- `"extensibility": "locked"` refuses any overlay, even a label: `user_p`, `file_p`,
  `security_policy_p`, `contact_channel_p`, `contact_rel_p`, `contact_merge_p`, `join_request_p`,
  the `miner_*_p` objects.
- `"limited"` (`activity_p`, `email_p`, `meeting_p`) refuses custom object types; `email_p` and
  `meeting_p` also lock `fields`, so no new fields.
- A platform field cannot be retired: its `active` is locked.
- A `_c` layout for a platform object is refused ("reserved for the platform"): extend the platform
  layout instead. A layout for your own object type on a platform object is fine.
- A platform object type takes new `fields` entries only when its file in
  `metadata/platform/object_p/object_type_p/` has `{"locator": "fields", "state": "unlocked"}`.
  Without it, `fields` is locked even when the file has no `locks` at all: a label-only overlay
  compiles, and a `fields` overlay fails "attribute '<type>.fields' is locked and cannot be
  extended". This depends on the instance, not the object: on one 26.4.1 instance only
  `account_p.account_p` unlocked `fields`, on another every platform type but `user_p`'s. Where
  it is locked, a new field needs a custom object type on that object that lists it, and records
  of that type.
- Most platform picklists and `aspen_crm_p` take new `_c` entries. Their platform entries are
  locked, except a picklist item's `label`, `description` and usually `active`, plus
  `parent-objects` on most object-dependent picklists: widen those rather than forcing data to fit.

## `_p` fields an object type doesn't get

Some attributes add hidden `_p` fields when you compile — a `currency` field adds `ccode_p` and
`ccdate_p` — and the object's types don't always include them, whatever the Field docs say about
system fields. Nothing fails until a record write: "Field '<x>_p' is not allowed for object type
…". After compiling, list what each object type lacks (the standard columns every object has,
`id_p` … `otype_p`, are always allowed; ignore them):

```sh
o=<object>; for t in metadata/compiled/object_type_p/$o.*.json; do
  jq -r --slurpfile obj metadata/compiled/object_p/$o.json '[.fields[].field] as $in
    | "\(.name): \(($obj[0].fields | map(select(.active != false).name)) - $in | join(", "))"' "$t"
done
```

Platform object types leave some out on purpose (`product_p.bundle_p` omits `uom_p`), so add only
the ones your writes set, as `{"name": "<x>_c", "field": "<x>_p"}`. An entry name must be unique
in the object type; if `<x>_c` is taken, use another free `_c` name, or it fails "Component … is
duplicated". Read the field's type before you set it: `ccode_p` takes a `currency_p` record id,
not `"USD"`.

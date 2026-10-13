# Platform overlays: when one is refused

Read when `aspen compile --metadata` or a check-in refuses an overlay of a platform (`_p`)
component, and when a record write fails "Field '<x>_p' is not allowed for object type". Plan as
if an overlay works, new fields included: what is locked differs between instances, and the
compile and the check-in are the only way to know. Checked against 26.4.1.

## What a refusal means

- "attribute '<x>.fields' is locked and cannot be extended" on a platform object type: it takes
  no new fields on this instance. List the field on a custom object type on that object instead,
  and give the records that type. Refused on the platform object itself: put the field on a
  custom object (`lean-data-model`).
- Any other "is locked" on a platform entry: that entry can't change. A platform field cannot be
  retired (its `active`); a platform picklist item takes a new `label`, `description`, usually
  `active`, and on most object-dependent picklists `parent-objects`: widen those rather than
  forcing data to fit. Add `_c` entries beside the platform ones.
- "reserved for the platform" on a `_c` layout for a platform object: extend the platform layout
  instead. A layout for your own object type on a platform object is fine.

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

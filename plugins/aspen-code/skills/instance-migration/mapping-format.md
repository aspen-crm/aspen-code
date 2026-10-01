# mapping.json

One file per migration, in the workspace. `init` writes the connections, `draft` writes the
objects, and you and the user settle every `todo`. `load` refuses to run while any `todo` is
left.

```json
{
  "source": { "url": "https://legacy.example.com/acme/legacy/" },
  "target": { "url": "https://aspen.example.com/acme/prod/" },
  "objects": [
    {
      "source": "company_c",
      "target": "account_p",
      "key": "name_p",
      "onMatch": "skip",
      "where": "status_c = 'active_c'",
      "fields": [
        { "target": "name_p", "from": "name_c" },
        { "target": "industry_p", "from": "sector_c", "map": { "tech_c": "technology_p", "bank_c": "financial_services_p" }, "default": null, "note": "user: anything else stays blank" },
        { "target": "parent_account_p", "from": "parent_c", "lookup": "company_c" },
        { "target": "owner_p", "from": "owner_p", "lookup": { "object": "user_p", "match": "email_p" } },
        { "target": "ccode_p", "value": "USD" },
        { "from": "legacy_score_c", "drop": true, "note": "user: not needed" }
      ]
    }
  ]
}
```

## Object entries

| Key | Meaning |
|---|---|
| `source`, `target` | Object names on each instance. |
| `key` | Optional. A **target** field that identifies the same record on both sides, such as an email or a name. `load` looks up target records by it, so a record that already exists is matched rather than inserted twice. Without a key, only the id map stops duplicates. |
| `onMatch` | `skip` (default) leaves a matched target record as it is. `update` writes the mapped fields onto it, and onto records already loaded, on every run. |
| `where` | Optional. An AQL condition on the source (see the AQL reference in `aspen-docs`), added to every extract query. |
| `fields` | One entry per target field written, plus one `drop` entry per source field left out on purpose. |

## Field entries: one way to get the value

| Form | Value written |
|---|---|
| `"from": "f"` | The source field's value, converted to the string the API expects. |
| `"value": "USD"` | A constant. `null` leaves the field blank. |
| `"from": "f", "map": {…}` | The source value looked up in the table. A value missing from the table is an error unless `default` is set (`null` is allowed). |
| `"from": "f", "lookup": "obj"` | The target id of the record migrated from `obj`, read from the id map. `obj` must be in this mapping. |
| `"from": "f", "lookup": ["a", "b"]` | For a field that can point to several objects: the target id from whichever object's id map holds the source id. |
| `"from": "f", "lookup": { "object": "user_p", "match": "email_p" }` | For an object that is not migrated: find the source record's `email_p`, then the target record with the same `email_p`. |
| `"expr": "…"` | A JavaScript expression over the source row `r`, e.g. `` `${r.first_c} ${r.last_c}`.trim() ``. It returns a string, a number, a boolean or `null`. Use it only for a rule the user stated, and keep their words in `note`. |
| `"from": "f", "drop": true` | Nothing. It records that the field was left out on purpose. |

Other keys on a field entry:

| Key | Meaning |
|---|---|
| `missing: "null"` | On a `lookup`: write blank instead of reporting an error when the referenced record is not in the extract (for example, filtered out by `where`), or when a match lookup finds no target record (a user with no account on the target). |
| `note` | Free text. Put the user's decision here. |
| `todo` | Written by `draft`. Settle it, then delete the key. |

## What `load` does with values

- Every value is sent as a string. Numbers and booleans are converted; `null` clears the field.
- Datetimes are sent as `YYYY-MM-DDTHH:MM:SS.mmmZ`. Dates are sent as `YYYY-MM-DD`.
- A lookup that points to a record in the same object, or to an object loaded later, is left
  blank on insert and filled in by a second pass.
- System fields (`id_p`, `cb_p`, `ct_p`, `mb_p`, `mt_p`, `st_p`) cannot be written. `draft`
  leaves them out, and it sets file fields to `drop`: files are not migrated.
- Long text is read in full. A plain query cuts it at 255 characters.

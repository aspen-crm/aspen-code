# mapping.json

One file per migration, in the workspace. `init` writes the connections, `draft` writes the
objects, and you and the user settle every `todo`. `load` refuses to run while any `todo` is
left, including one inside `byParent`.

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
        { "target": "owner_p", "from": "owner_p", "lookup": { "object": "team_p", "match": "email_p" } },
        { "target": "ccode_p", "from": "ccode_p", "lookup": { "object": "currency_p", "match": "currency_code_p" } },
        { "from": "legacy_score_c", "drop": true, "note": "user: not needed" }
      ]
    }
  ],
  "accept": [
    { "object": "company_c", "field": "parent_account_p", "problem": "lookup not in the extract", "max": 12, "note": "user: parents outside the scope stay behind" }
  ]
}
```

## `accept`: failures the user chose to leave out

Each entry names a source object, a target field and the **Problem** text as the report's Errors
table prints them (`*` matches any run of characters, for a refusal that quotes a value), with an
optional `max` on the rows it may cover and the user's reason in `note`. A failed row whose every
error matches an entry is accepted: `load` counts it under Accepted, lists it under
**Accepted failures** instead of **Errors**, and exits 0 when no other row failed, so a
`--then` chain goes on. `verify` doesn't count those rows as not loaded. An entry that would cover
more rows than its `max` covers none, and the report says so: more failed than the user agreed to.

## Object entries

| Key | Meaning |
|---|---|
| `source`, `target` | Object names on each instance. |
| `key` | Optional. A **target** field that identifies the same record on both sides, such as an email or a name. `load` looks up target records by it, so a record that already exists is matched rather than inserted twice. Without a key, only the id map stops duplicates. Or a platform uniqueness key over fields the entry writes, `{"field": "contact_role_chk_p", "of": ["contact_p", "what_p"]}`: it matches the record whose `contact_role_chk_p` is `<contact id>\|<what id>`, such as one a trigger derived. |
| `onMatch` | `skip` (default) leaves a matched target record as it is. `update` writes the mapped fields onto it, and onto records already loaded, on every run. |
| `where` | Optional. An AQL condition on the source (see the AQL reference in `aspen-docs`), added to every extract query. |
| `fields` | One entry per target field written, plus one `drop` entry per source field left out on purpose. |

## Field entries: one way to get the value

| Form | Value written |
|---|---|
| `"from": "f"` | The source field's value, converted to the string the API expects. |
| `"value": "imported_c"` | A constant. `null` leaves the field blank. |
| `"from": "f", "map": {…}` | The source value looked up in the table. A value missing from the table is an error unless `default` is set (`null` is allowed). |
| `"from": "f", "lookup": "obj"` | The target id of the record migrated from `obj`, read from the id map. `obj` must be in this mapping. |
| `"from": "f", "lookup": ["a", "b"]` | For a field that can point to several objects: the target id from whichever object's id map holds the source id. |
| `"from": "f", "lookup": { "object": "user_p", "match": "email_p" }` | For an object that is not migrated: find the source record's `email_p`, then the target record with the same `email_p`. Records this run inserts into `user_p` are matched too: the entry that loads them goes first. |
| `"from": "f", "lookup": { "object": "currency_p", "match": "currency_code_p", "by": "value" }` | The value itself (after `map`) is what to match: the target record whose `currency_code_p` equals it. For a source that holds a code, not a record id. No match file is extracted. |
| `"objectOf": "what_p"` | For a polyid's companion (`whaton_p`, `customeron_p`, `owneron_p`): the target object the named polyid's id resolved through, or blank when it is blank. Use it rather than a constant whenever the polyid's lookup lists more than one object; it keeps the pair from disagreeing. |
| `"expr": "…"` | A JavaScript expression over the source row `r`, e.g. `` `${r.first_c} ${r.last_c}`.trim() ``. It returns a string, a number, a boolean or `null`. It is one expression, evaluated as `return (<expr>)`: for statements, wrap them in an arrow function called at once, `(() => { … })()`. Use it only for a rule the user stated, and keep their words in `note`. |
| `"from": "f", "drop": true` | Nothing. It records that the field was left out on purpose. |
| `"from": "f", "byParent": {"account_p": {"map": {…}, "default": …}, "opportunity_p": {…}}` | For an object-dependent picklist (`dependsOn` in `schema/target.json`) on rows that point at different objects: the map for the object the record's parent-object field names (`whaton_p`). Each object's table holds only the values `picklistsByParent` allows on it, and may carry its own `todo`. Not with `map`. |

Other keys on a field entry:

| Key | Meaning |
|---|---|
| `normalize` | `"phone"`, `"url"` or `"linkedin"`: the value converted to what the target accepts, or blank when that would mean guessing. `phone`: E.164 from an explicit `+` or `00` country code or a 10-digit North American number; an extension is dropped. `url`: http or https, `https://` added when there is no scheme, the query and fragment cut when too long. `linkedin`: Aspen's own form, `https://www.linkedin.com/in/<profile>`. The plan and load reports count what changed under **Changed on the way in**. |
| `truncate: true` | Text longer than the target field's `maxLength` is cut to it, and counted in the report. |
| `distinctFrom` | A target field (or a list of them): this field is left blank when it holds the same value. For a pair the CRM refuses to be equal, such as a contact's mobile and office phones. |
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
- A target field the describe marks `read-only` (an increment, a converted currency, or a field
  the initial lifecycle state locks) gets a `todo` from `draft`: drop it or map elsewhere.
- `ccode_p` takes a `currency_p` record id, not a code such as `"USD"`: match it by
  `currency_code_p`, as in the example above. Any object with a currency field has a `ccode_p`, and
  the instance refuses a currency value without it: the dry run fails such a row too.
- The dry run fails a row the target would refuse for what `schema/target.json` declares: a text
  longer than `maxLength`, a number outside `minValue`..`maxValue`, a phone that is not E.164
  (`+` and up to 15 digits), a URL that is not http or https, and an object-dependent picklist
  value (`dependsOn`) its parent object does not allow (`picklistItems[].parentObjects`). It also
  checks the CRM rules the describe doesn't declare, in `migrate.mjs`'s `TARGET_RULES`: a
  contact's mobile, office and home phones differ, and so do its work and personal emails.
  Other triggers and validation rules it cannot see: the pilot finds those.
- `schema/target.json`'s `currencies` lists the codes the instance has a `currency_p` record for,
  and `picklistsByParent` each object-dependent picklist field (`"<object>.<field>"`) with its
  `dependsOn` and the values each parent object allows.
- A field the instance's own trigger sets (`record.set` in the code of a trigger
  `rust/aspen.server.json` declares on the object) is dropped by `draft`, naming the trigger.
- A row the target accepts with a `WARNING` counts as loaded, the same as `SUCCESS`.
- Long text is read in full. A plain query cuts it at 255 characters.

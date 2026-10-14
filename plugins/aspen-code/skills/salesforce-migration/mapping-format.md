# mapping.json, for a Salesforce source

The file is the one `instance-migration`'s `migrate.mjs` loads, so its
[mapping format](../instance-migration/mapping-format.md) applies in full. This page is the
delta: what `source` means, the two Salesforce-only keys, and what `draft` puts where.

`load` refuses to run while any `todo` is left.

```json
{
  "source": {
    "kind": "salesforce",
    "org": "acme-prod",
    "username": "someone@acme.com",
    "instanceUrl": "https://acme.my.salesforce.com",
    "apiVersion": "68.0"
  },
  "target": { "url": "https://aspen.example.com/acme/prod/" },
  "objects": [
    {
      "source": "Account",
      "target": "account_p",
      "key": "name_p",
      "onMatch": "skip",
      "where": "Type = 'Customer' AND IsDeleted = false",
      "fields": [
        { "target": "name_p", "from": "Name" },
        { "target": "about_p", "from": "Description", "note": "user: keep the SFDC description" },
        { "target": "parent_account_p", "from": "ParentId", "lookup": "Account" },
        { "target": "owner_p", "from": "OwnerId", "lookup": { "object": "team_p", "match": "email_p" }, "sfMatch": { "object": "User", "field": "Email" }, "missing": "null" },
        { "target": "industry_p", "from": "Industry", "map": { "Biotechnology": "biotech_p" }, "default": null, "note": "user: anything else stays blank" },
        { "target": "score_p", "from": "Health_Score__c", "note": "user: keep the formula's value as data" },
        { "from": "Territories__c", "drop": true, "note": "user: multi-select, not needed" }
      ],
      "report": []
    }
  ]
}
```

## What is different from an Aspen source

| Key | Meaning |
|---|---|
| `source.kind` | Always `"salesforce"`. |
| `source.org` | The `sf` CLI alias or username. Every Salesforce command passes it as `--target-org`; no credential is ever stored here. |
| `source.instanceUrl`, `username`, `apiVersion` | Written by `init` from `sf org display`, so the report can say which org this was. |
| `source.export` | Written by `init --from-export`: the export's directory, its `started`/`finished` stamps and its objects. Every command refuses an export whose stamps changed since. |
| `objects[].source` | The Salesforce API name, case-sensitive: `Account`, `Opportunity`, `Custom_Thing__c`. |
| `objects[].where` | A **SOQL** condition, not AQL. It is appended to the extract query. With an export, the same condition filters the CSV rows: clauses joined by `AND`, each `Field = value`, `!=`, `IN (…)`, `NOT IN (…)` or `Rel.Type = 'Contact'` (the object the row's lookup points at, by its id's key prefix). Anything else is refused. |
| `objects[].report` | Written by `draft`: one row per field behind `reports/gaps.md` and `mapping/fields.csv`. `sfmigrate gaps` re-renders from it. Not read by `load`. |
| `fields[].from` | The Salesforce field API name, or a parent's field through its relationship (`Event.Subject` on an `EventRelation`), which `extract` selects and flattens to that name. |

## `sfMatch`: the source half of a match lookup

`"lookup": {"object": "user_p", "match": "email_p"}` tells `load` to find the target record whose
`email_p` equals the source record's value. With an Aspen source that value comes from the same
object and field name on both sides; with Salesforce the names differ, so `sfMatch` says where to
read it:

```json
{ "target": "owner_p", "from": "OwnerId",
  "lookup": { "object": "user_p", "match": "email_p" },
  "sfMatch": { "object": "User", "field": "Email", "where": "IsActive = true" },
  "missing": "null" }
```

`extract` then queries `SELECT Id, Email FROM User` and writes
`extract/match/user_p.email_p.json` as `{ "<SFDC id>": "<email>" }` — the file `load` already
expects. `where` is optional. `migrate.mjs` ignores `sfMatch`; only `sfmigrate extract` reads it.

A match lookup without `sfMatch` extracts nothing, and `load` reports every row as missing the
referenced record — unless the Salesforce value is itself the thing to match (`"by": "value"`):

```json
{ "target": "ccode_p", "from": "CurrencyIsoCode", "map": { "USD": "usd_p", "EUR": "eur_p" },
  "lookup": { "object": "currency_p", "match": "currency_code_p", "by": "value" } }
```

## `schema/fill.json`

Written by `probe`, read by `draft`: `objects.<Object>.fields.<Field>` is `{ "fill": 0..1,
"maxLen": <longest value>, "values": { "<picklist value>": <rows> } }`, with `values` on picklist
fields only. `source` is `"export"` (every record in the export) or `"org"` (a sample of `sample`
records).

## Picklists

Salesforce picklist values are labels like `Biotechnology`; Aspen's are names like `biotech_p`.
`draft` seeds `map` with each value that matches a target item's name or label, ignoring case, and
lists the rest in the `todo`, with how many rows hold each. With fill rates, only the values the
data holds are asked about. An object-dependent picklist (`dependsOn` in `schema/target.json`,
such as `team_role_p`) is seeded only with the items its parent object allows, so
`AccountTeamMember` and `OpportunityTeamMember` get different maps. `default` applies to anything
not in the table; without it, an unmapped value fails the row.

## Conversions `load` already does

Everything in the Aspen mapping format still holds: values are sent as strings, `null` clears a
field, datetimes become `YYYY-MM-DDTHH:MM:SS.mmmZ`, dates `YYYY-MM-DD`, and a lookup to the same
object or to one loaded later is filled by a second pass. On top of that, `sfmigrate extract`
turns the Bulk API's empty strings into `null`, so a blank Salesforce lookup arrives blank rather
than as `""`.

## What `expr` is for

A rule the user stated, over the Salesforce row `r`, with their words in `note`:

```json
{ "target": "name_p", "expr": "`${r.FirstName ?? ''} ${r.LastName}`.trim()", "note": "user: one name field on the target" }
{ "target": "revenue_p", "expr": "r.AnnualRevenue == null ? null : Number(r.AnnualRevenue) / 1000", "note": "user: target is in thousands" }
{ "target": "region_p", "expr": "r.BillingCountry === 'US' ? 'na_p' : 'intl_p'", "note": "user: two regions only" }
```

`extract` reads the `r.Field` names out of every `expr` and adds them to the SOQL select, so a
field used only in an expression does not need its own entry. A name that is not a field on the
object stops the extract rather than silently arriving as `undefined`.

# The platform objects, and what people call them

Question 1 of `lean-data-model` is "which platform object already holds this". This is the
catalogue to check it against. Read it before authoring a new object, every time — the business
word and the platform word are usually different, which is exactly why the check gets skipped.

**The list below is platform 26.4.1's own set and is a convenience, not the authority.** The
authority is `ls metadata/platform/object_p/` in the instance directory you are in, because the
platform's own set moves between releases.

## The words that catch people out

| You were asked for | It already exists as |
|---|---|
| deal, pipeline, opportunity | `opportunity_p` |
| company, organisation, org, customer, client, firm, account | `account_p` |
| person, people, individual | `contact_p` |
| prospect, unqualified lead | `lead_p` |
| ticket, issue, incident, request, case | `case_p` |
| todo, reminder, follow-up, action item | `task_p` |
| event, appointment, call, visit | `meeting_p` |
| note, comment | `note_p` |
| document, file, attachment | `file_p`, `attachment_p` |
| product, SKU, item, service | `product_p` |
| product family, category | `product_category_p` |
| user, login | `user_p` |
| employee, staff, worker, contractor, partner, team member | `team_p` (object types `team_p.employee_p`, `contractor_p`, `partner_p`) |
| account team, deal team, role on a record | `team_role_p`, `contact_role_p` |
| address | `account_address_p`, `contact_address_p` |
| email, phone, channel | `email_p`, `contact_channel_p` |
| currency, FX rate | `currency_p`, `exchange_rate_p` |
| tax, tax rate | `tax_rate_p` |
| quarter, period, fiscal calendar | `fiscal_period_p` |

## The catalogue

37 objects. **New `_c` fields** says whether an overlay may add fields: "locked" objects refuse
any overlay; `activity_p` takes fields but no custom object types.

| Object | Label | Fields | New `_c` fields |
|---|---|---|---|
| `account_address_p` | Account Address | 10 | yes |
| `account_p` | Account | 9 | yes |
| `activity_p` | Activity | 18 | yes |
| `attachment_p` | Attachment | 10 | yes |
| `bundle_item_p` | Bundle Item | 3 | yes |
| `case_p` | Case | 15 | yes |
| `contact_address_p` | Contact Address | 9 | yes |
| `contact_channel_p` | Contact Channels | 12 | no (locked) |
| `contact_merge_p` | Contact Merge | 7 | no (locked) |
| `contact_owner_p` | Contact Owners | 4 | yes |
| `contact_p` | Contact | 22 | yes |
| `contact_rel_p` | Contact Relationship | 13 | no (locked) |
| `contact_role_p` | Contact Role | 7 | yes |
| `currency_p` | Currency | 5 | yes |
| `email_p` | Email | 19 | no |
| `exchange_rate_p` | Exchange Rate | 5 | yes |
| `file_p` | File | 11 | no (locked) |
| `fiscal_period_p` | Fiscal Period | 5 | yes |
| `join_request_p` | Join Request | 8 | no (locked) |
| `lead_p` | Lead | 13 | yes |
| `meeting_p` | Meeting | 21 | no |
| `miner_check_p` | Miner Check | 5 | no (locked) |
| `miner_delete_p` | Miner Delete | 3 | no (locked) |
| `miner_sync_failure_p` | Miner Sync Failure | 8 | no (locked) |
| `miner_sync_job_p` | Miner Sync Job | 7 | no (locked) |
| `miner_sync_state_p` | Miner Sync State | 10 | no (locked) |
| `note_p` | Note | 6 | yes |
| `opportunity_p` | Opportunity | 14 | yes |
| `product_category_item_p` | Product Category Item | 3 | yes |
| `product_category_p` | Product Category | 3 | yes |
| `product_p` | Product | 8 | yes |
| `security_policy_p` | Security Policy | 3 | no (locked) |
| `task_p` | Task | 17 | yes |
| `tax_rate_p` | Tax Rate | 4 | yes |
| `team_p` | Team | 13 | yes |
| `team_role_p` | Team Role | 7 | yes |
| `user_p` | User | 13 | no (locked) |

## Before adding a field to one

A platform object that takes `_c` fields is almost always the right place for one, and needs no
new component. A field you add to `account_p`, `case_p`, `opportunity_p`, `product_p` or `team_p`
must also be listed on each of its object types, and a platform object type may refuse it on
this instance. What a platform component cannot be is
**overridden**: its own entries stay locked. `metadata` has the details and the workarounds.

Two traps worth knowing before you extend one:

- **A field's `description` carries behaviour the type does not.** `contact_p.name_p` is
  `required: true` and derived from the name parts; writing it failed on every record on a live
  instance. Read the
  description in the compiled tier, not just `type` and `required`.
- **Some child rows are created for you.** Setting `contact_p.primary_account_p` makes a
  `contact_role_p`; setting the `owner_p` of an opportunity, account or case makes a
  `team_role_p` (`opportunity_p.owner_p` is a polyid that takes only a `user_p`). Before modelling
  a join object, create one parent and look at what appeared underneath it.

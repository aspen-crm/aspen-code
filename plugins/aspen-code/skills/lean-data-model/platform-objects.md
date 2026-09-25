# The platform objects, and what people call them

Question 1 of `lean-data-model` is "which platform object already holds this". This is the
catalogue to check it against. Read it before authoring a new object, every time — the business
word and the platform word are usually different, which is exactly why the check gets skipped.

**The list below is from a real instance at platform 26.3.3 and is a convenience, not the
authority.** The authority is `ls metadata/platform/object_p/` in the instance directory you are in, because
an installed application package adds `_a` objects this cannot know about.

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
| employee, staff, worker, team member | `employee_p` |
| account team, deal team, role on a record | `employee_role_p`, `contact_role_p` |
| address | `account_address_p`, `contact_address_p` |
| email, phone, channel | `email_p`, `contact_channel_p` |
| currency, FX rate | `currency_p`, `exchange_rate_p` |
| quarter, period, fiscal calendar | `fiscal_period_p` |

## The catalogue

| Object | Label | Fields |
|---|---|---|
| `account_address_p` | Account Address | 10 |
| `account_p` | Account | 9 |
| `activity_p` | Activity | 15 |
| `attachment_p` | Attachment | 10 |
| `bundle_item_p` | Bundle Item | 3 |
| `case_p` | Case | 16 |
| `contact_address_p` | Contact Address | 9 |
| `contact_channel_p` | Contact Channels | 12 |
| `contact_owner_p` | Contact Owner | 4 |
| `contact_p` | Contact | 22 |
| `contact_rel_p` | Contact Relationships | 11 |
| `contact_role_p` | Contact Role | 7 |
| `currency_p` | Currency | 5 |
| `email_p` | Email | 18 |
| `employee_p` | Employee | 10 |
| `employee_role_p` | Employee Role | 7 |
| `exchange_rate_p` | Exchange Rate | 5 |
| `file_p` | File | 11 |
| `fiscal_period_p` | Fiscal Period | 8 |
| `lead_p` | Lead | 9 |
| `meeting_p` | Meeting | 20 |
| `note_p` | Note | 6 |
| `opportunity_p` | Opportunity | 12 |
| `product_category_item_p` | Product Category Item | 3 |
| `product_category_p` | Product Category | 3 |
| `product_p` | Product | 9 |
| `task_p` | Task | 17 |
| `user_p` | User | 13 |

## Before adding a field to one

A platform object can be **extended** with `_c` fields, which is almost always the right move and
needs no new component. What it cannot be is **overridden**: a base object type, a platform
picklist and the stock `tab_collection_p:aspen_crm_p` all reject an override, by import and by the
offline validator alike. `using-aspen` has the details and the workarounds.

Two traps worth knowing before you extend one:

- **A field's `description` carries behaviour the type does not.** `contact_p.name_p` is
  `required: true` and derived from the name parts; writing it fails on every record. Read the
  description in the compiled tier, not just `type` and `required`.
- **Some child rows are created for you.** Setting `contact_p.primary_account_p` makes a
  `contact_role_p`; setting `opportunity_p.owner_p` makes an `employee_role_p`. Before modelling a
  join object, create one parent and look at what appeared underneath it.

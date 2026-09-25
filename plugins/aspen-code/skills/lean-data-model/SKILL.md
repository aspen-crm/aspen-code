---
name: lean-data-model
description: Use BEFORE creating any new object, field, picklist, record type, tab or tab collection on an Aspen instance — especially when the request names a business noun (deal, company, ticket, project, task, contract). Checks whether the platform or this instance already holds the concept, and whether it earns a component at all. Nothing on Aspen deletes, so this runs before the first file, not at review.
---

# Earn the component

Every component you author here is **permanent**. Aspen has no delete: an object, field, picklist
or tab that turns out to be a mistake is retired with `"active": false` and stays in the model,
in the metadata, and in everyone's way, forever.

That asymmetry is the whole point of this skill. Building is fast and unbuilding is impossible,
so the question "should this exist" has to be asked at the only moment it is cheap — **before the
first file**, not in the summary after them.

An AI builder gets this wrong in a specific, predictable direction. The most common CRM shape in
the training data is a large one, so asked for "a deal object" it produces a good one, correctly
placed, well named, with a layout and a list view and a tab — on an instance that already had
`opportunity_p`. Everything about it is right except that it should not exist.

## The six questions

Ask all six, out loud, before authoring. They take a minute and they are the whole skill.

**1. Which platform object already holds this?**
There are ~48. Look, do not remember: `ls metadata/platform/object_p/ metadata/active/object_p/`
(the second lists what this instance has already added). The business word and the
platform word are rarely the same — `platform-objects.md` beside this file maps the ones that
catch people out. Deal is `opportunity_p`. Company is `account_p`. Ticket is `case_p`.

**2. Is it a field on an object that exists, rather than a new object?**
A concept that has no lifecycle of its own, no list anyone opens, and no records that outlive
their parent, is a field. If the answer is "it is like X but for Y", it is usually X plus a field,
or X plus an `object_type_p` with its own layout.

**3. Is it a picklist rather than an object, and a checkbox rather than a picklist?**
Two values is a `checkbox`. It needs no component, no items to keep in sync, no parent-scoping
rule to trip over, and it reads as yes/no in every list view. A picklist earns its place when the
set is genuinely open to growing.

**4. Who opens it weekly, and in what role?**
Name the role. "Sales ops, at month end" is an answer. "Users" is not. **If no role can be named,
do not build it.** This question kills more components than the other five together, and it is
the one people skip.

**5. Does the nav need a tab, or does a related list do?**
A child record reachable from its parent's layout costs no nav entry. A nav of 50 tabs is scanned
by nobody, and every tab needs its own list view to be reachable at all.

**6. Are you copying Salesforce?**
Name the Salesforce object you are mirroring. If you can, that is the reason to stop: Opportunity
+ Quote + QuoteLine + Order + OrderLine + PriceBook + PriceBookEntry is seven objects for what is
often one deal and its lines. Salesforce carries that graph for twenty years of backward
compatibility. You do not have that constraint, and you cannot delete what you copy.

## Answering them

Write the answers where the human can read them, in a line or two. Not a form — a decision:

> `deal_c`: not building it. `opportunity_p` already holds this, with amount, probability, close
> date and next step, and `opportunity_line_c` hangs off it. Adding `source_c` and `campaign_c`
> to `opportunity_p` covers what was actually asked for.

A good answer is often "yes, build it" — a genuinely distinct concept, a different lifecycle, a
different audience, records that outlive the parent. Say which, in one line, and carry on.

## Check the size before you add to it

Nothing here stops a write for you, so run these counts yourself on an unfamiliar instance, and
whenever a request adds an object, picklist or tab. They are thresholds for a conversation with
the human, not rules:

| Check | Worth raising at |
|---|---|
| A new object whose name, synonym or field names match one that exists | most of its distinctive fields already on another object |
| An object growing wide | more than 25 fields |
| A picklist too thin to be one | 2 items or fewer — that is a checkbox |
| A nav collection growing long | more than 15 tabs |
| A new object while an older one is still unusable | any `_c` object with no layout, list view or tab |

```sh
ls metadata/active/object_p/ | grep -c '_c\.json$'                        # custom objects
jq '.fields | length' metadata/active/object_p/<object>.json               # width
ls metadata/active/object_p/layout_p metadata/active/object_p/tab_p        # which are reachable
```

Ignore the field names every object has — name, owner, status, description, dates — when judging
overlap; that is what a CRM record looks like, not evidence of a copy.

**Findings are about what to build next, not a demand to remove what is there.** Nothing deletes;
a flagged object that is already deployed is a fact to work with, and the useful response is to
stop the next one, not to churn the model.

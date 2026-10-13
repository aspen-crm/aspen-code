---
name: lean-data-model
description: Use before creating an object, field, picklist, record type, tab or tab collection on an Aspen instance — especially when the request names a business noun (deal, company, ticket, project, task, contract). Checks whether the platform or this instance already holds the concept, and whether it earns a component.
---

# Earn the component

A component can't be deleted yet: a mistake is retired with `"active": false` and stays in the
model and in everyone's way. So decide whether it should exist before the first file. The usual
miss is a well-built "deal" object, with layout, list view and tab, on an instance that already
has `opportunity_p`.

## Six questions

Answer them before authoring.

1. **Which platform object already holds this?** Look, don't recall:
   `ls metadata/platform/object_p/ metadata/active/object_p/` (the second is what this instance
   has added). The business word and the platform word rarely match —
   [platform-objects.md](platform-objects.md) maps the ones that catch people out: deal is
   `opportunity_p`, company is `account_p`, ticket is `case_p`.
2. **Is it a field on an existing object?** No lifecycle of its own, no list anyone opens, no
   records that outlive the parent: a field. "Like X but for Y" is usually X plus a field, or an
   `object_type_p` of X with its own layout.
3. **A picklist, or a checkbox?** Two values is a `checkbox`: no items to sync, no parent-scoping,
   reads as yes/no in every list. A picklist earns its place when the set can grow.
4. **Who opens it weekly, in what role?** "Sales ops, at month end" is an answer; "users" is not.
   If no role can be named, don't build it.
5. **Does it need a tab, or does a related list do?** A child reachable from its parent's layout
   needs no nav entry, and every tab needs its own list view.
6. **Are you copying Salesforce?** If you can name the Salesforce object you're mirroring,
   reconsider: Opportunity + Quote + QuoteLine + Order + OrderLine + PriceBook + PriceBookEntry is
   seven objects for what is often one deal and its lines.

State the decision in a line or two, for example:

> `deal_c`: not building it. `opportunity_p` already holds amount, probability, close date and
> next step, and `opportunity_line_c` hangs off it. Adding `source_c` and `campaign_c` to
> `opportunity_p` covers what was asked for.

"Yes, build it" is often right — a distinct concept, lifecycle or audience, or records that
outlive the parent. Say which and carry on.

## Size checks

On an unfamiliar instance, and when a request adds an object, picklist or tab, raise these with
the human. They are prompts for a conversation, not rules:

| Check | Worth raising at |
|---|---|
| A new object whose name, synonym or field names match one that exists | most of its distinctive fields already on another object |
| An object growing wide | more than 25 fields |
| A picklist too thin to be one | 2 items or fewer — a checkbox |
| A nav collection growing long | more than 15 tabs |
| A new object while an older one is unusable | any `_c` object with no layout, list view or tab |

```sh
ls metadata/active/object_p/ | grep -c '_c\.json$'                        # custom objects
jq '.fields | length' metadata/active/object_p/<object>.json               # width
ls metadata/active/object_p/layout_p metadata/active/object_p/tab_p        # which are reachable
```

Ignore the fields every record has (name, owner, status, description, dates) when judging overlap.
A flagged object that is already deployed is a fact to work with: the useful response is to stop
the next one, not to churn the model.

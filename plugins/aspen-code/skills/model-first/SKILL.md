---
name: model-first
description: Use before authoring a feature, screen, dashboard, number, score, rollup, rule, validation, approval or status flow on an Aspen instance, and always before custom UI. Decides whether each piece is metadata, a Rust trigger or a TypeScript page, and records it in a placement table.
---

# Place it before you build it

An instance has three tiers, and the request rarely says which it needs. Decide before the first
file: metadata can't be deleted yet, so a piece built in the wrong tier stays, and fixing it means
authoring the skipped model *and* rewriting whatever read the old shape.

```
1  metadata   objects, fields, picklists, lifecycles, layouts, list views, tabs
2  trigger    Rust in rust/ — derivation, validation, cascade
3  UI         TypeScript page or layout section
```

**Default to tier 1.** Tier 2 is for what a stored field can't maintain itself; tier 3 for what no
layout can render. A page answering a tier-1 question looks right on screen and is wrong underneath.

## A workflow: its journey first

When the request is a workflow (people moving through several records or screens), write its
journey in one line before the ladder: **actor → entry record → actions → context carried forward
→ what is stored when it's done**. For example: seller → opportunity → configure, price, review →
the opportunity and its quote → an approved quote with its lines. Navigation starts at the entry
record; the objects behind the workflow stay behind it. Skip this for a single field, rule or
screen.

## The ladder

The first yes decides. People name the screen they imagine ("dashboard", "page"), not the tier.

| # | Question | If yes |
|---|---|---|
| 1 | A **noun** the business talks about? | An object, or a field on one that exists (`lean-data-model`) |
| 2 | A **derived number** (total, rollup, score, health, remaining, %)? | A stored field, maintained by a trigger on its inputs |
| 3 | A **set of states** a record moves through (draft, review, approved, active, expired, closed)? | A `lifecycle_p` |
| 4 | A **rule** about what may be saved? | A before-trigger that rejects the save (`server-code` asks how) |
| 5 | A **list of records, or one record's fields**? | `list_view_p` + `layout_p` + `tab_p` in a `tab_collection_p` |
| 6 | None of these | Tier 3, with the reason in the table |

Why the default holds:

- A derived number computed in a page can't be listed, filtered, sorted, reported on, read by a
  trigger or seen by the runtime MCP, and the next surface that needs it reimplements it.
- A picklist plus Rust comparing old and new has no allowed transitions, initial or terminal state,
  and nothing the UI renders as a flow. `lifecycle_p` declares all of them (`state-type` `initial_p`
  or `complete_p`).
- A page is one write path of several: the data API, the runtime MCP, bulk loads and other triggers
  bypass any check in it.
- Rule evaluation, assignment, scoring or allocation in the browser runs only while someone has the
  page open; records changed any other way are never processed.

## The placement table

Write it before authoring and show the human, one row per thing the request asks for:

| Thing | Source | Tier | Component | Why not the tier above |
|---|---|---|---|---|

**Required:** when the table adds the first new object or the first custom page (tier 3), show it
and wait for the user's yes before authoring. Metadata can't be deleted yet, and these two cost the
most when the guess is wrong. Any other table: show it and carry on.

- **Source** is where the row comes from: `source rule` (the request, or a document the user gave),
  `integrity` (keeps records consistent), `proposed` (a rule you are adding) or `fixture` (sample
  data or a test-only check). When you report, list `proposed` and `fixture` rows apart from the
  rest; a `fixture` never ships as a product rule.
- A tier-3 row needs a reason, or it isn't built.
- A tier-2 row names the stored field it maintains or the save it rejects (row 4); a trigger that
  does neither is a tier-3 answer.
- Format and worked rows from real instances: [placement-table.md](placement-table.md). Three
  whole models placed this way, metadata and triggers: [samples.md](../using-aspen/samples.md).

## When tier 3 is right

When it renders what no `layout_p` can — an editable grid, a chart, a timeline, a multi-object
workspace, a side-by-side comparison, a bulk editor — built over stored fields with `custom-ui`.

A value that must be computed on read (it depends on the viewer, on today's date, or on a
combination too wide to store) stays in the page. Name it in the table and give the reason in the
module header:

```
// aspen-derived-exempt: recomputed per open; a stored credit table would be stale
// the moment a deal moved, and this platform has no scheduler.
```

## Then

Work the rows top tier first — `metadata`, then `server-code`, then `build-and-deploy` — and build
the page over the deployed model.

---
name: model-first
description: Use BEFORE authoring anything on an Aspen instance — a feature, screen, dashboard, number, score, rollup, rule, validation, approval or status flow. Decides which tier each piece belongs in (metadata, Rust trigger, TypeScript page) and produces the placement table that records the decision. Invoke it before the first file, and always before writing custom UI.
---

# Place it before you build it

An Aspen instance has three tiers, and the request does not say which one it wants. Deciding that
is this skill's whole job. Do it before the first file, because **nothing on this platform
deletes** — a thing built in the wrong tier is permanent, and moving it later means authoring the
model you skipped *and* rewriting everything that read the old shape.

```
1  metadata   objects, fields, picklists, lifecycles, layouts, list views, tabs
2  trigger    Rust in rust/ — derivation, validation, cascade
3  UI         TypeScript page or layout section
```

**The default is tier 1.** Tier 2 exists for what a stored field cannot maintain itself. Tier 3
exists for what no layout can render. A tier-3 answer to a tier-1 question is the single most
common way an AI-built instance goes wrong, and it is invisible at review time because the screen
looks right.

## The ladder

Ask these in order. The first yes decides the tier. Do not skip ahead because the request used
the word "dashboard" or "page" — people name the screen they imagine, not the tier they need.

| # | Question | If yes |
|---|---|---|
| 1 | Is it a **noun** the business talks about? | An object, or a field on one that exists |
| 2 | Is it a **derived number** (total, rollup, score, health, remaining, %)? | A stored field, maintained by a trigger on its inputs |
| 3 | Is it a **set of states** a record moves through? | A `lifecycle_p` with states and transitions |
| 4 | Is it a **rule** about what may be saved? | A before-trigger that calls `error::bail!` |
| 5 | Is it a **list of records, or one record's fields**? | `list_view_p` + `layout_p` + `tab_p` in a `tab_collection_p` |
| 6 | None of the above | Tier 3 — and the placement table records why |

## The placement table

Before authoring, write this out and show the human. One row per thing the request asks for.

| Thing | Tier | Component | Why not the tier above |
|---|---|---|---|

- Every **tier-3 row carries a reason**. A row with an empty reason is not built.
- Every **tier-2 row names the field it maintains**. A trigger that writes nothing stored is a
  tier-3 answer wearing a tier-2 costume.
- `placement-table.md` beside this file has the format and six worked rows taken from real
  instances, including three that were got wrong the first time.

## The four failures this exists to stop

Each was found in a shipped instance, not imagined.

**A derived number that is never stored.** A budget page computed contracted, consumed, remaining
and margin in the browser, in 396 lines, over an object model that holds none of them. The number
cannot be listed, filtered, sorted, reported on, read by a trigger, alerted on, or seen by the
runtime MCP — and a second surface that needs it reimplements it. Store it; maintain it from a
trigger on its inputs. If it genuinely cannot be stored, say so in the table (see the escape hatch
below).

**A status flow matched by hand.** A picklist plus Rust that compares old and new gives you no
allowed-transition set, no initial state, no terminal state, and nothing the UI can render as a
flow. `lifecycle_p` carries all four declaratively, with `state-type` of `initial_p` or
`complete_p`. Reach for it whenever the words are draft, review, approved, active, expired,
cancelled, closed.

**Validation in the page.** The page is one of at least four write paths. The data API, the
runtime MCP, a bulk load and another trigger all bypass it completely, so a rule enforced in
TypeScript is not enforced. It belongs in a before-trigger with `error::bail!`, which is also the
only confirmed way to surface a message to the user on this platform.

**An engine in the browser.** Rule evaluation, assignment, scoring and allocation written as page
code run only while someone has the page open. Records changed by any other path are never
processed. If it must run on change, it is a trigger.

## When tier 3 is right

It often is. A page earns its place when it renders something no `layout_p` can: an editable grid,
a chart, a timeline, a multi-object workspace, a side-by-side comparison, a bulk editor. Build it
— over a model that already exists, composed from stored fields, with `custom-ui`.

**The escape hatch.** A value that genuinely must be computed on read — because it depends on the
viewer, on today's date, or on a combination too wide to store — stays in the page. Name it in the
placement table and write the reason into the module header:

```
// aspen-derived-exempt: recomputed per open; a stored credit table would be stale
// the moment a deal moved, and this platform has no scheduler.
```

That is a real line from a real instance, and it is the correct call there. The hatch costs one
comment and leaves the reasoning behind, which is the difference between a decision and a habit.

## After the table

Hand the table to the human, then work each row top tier first: `metadata` for tier 1,
`server-code` for tier 2, then `build-and-deploy`. Author the model, compile, deploy, verify — then
build the page over it.

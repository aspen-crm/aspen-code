# The placement table

The artifact `model-first` produces. One row per thing the request asks for, written before the
first file and shown to the human.

| Thing | Tier | Component | Why not the tier above |
|---|---|---|---|

- **Thing** — in the requester's words, not yours. "Remaining budget", not `remaining_c`.
- **Tier** — 1 metadata, 2 Rust trigger, 3 TypeScript page or layout section.
- **Component** — the actual name you will author: `engagement_c.remaining_c`, `budget_calc_c`,
  `budget_page_c`. Not "a field".
- **Why not the tier above** — required on every tier-2 and tier-3 row. Tier-1 rows leave it blank.

A row you cannot fill in is a row you do not understand yet. Ask, do not guess.

## Worked rows

Real placements from shipped instances. The three marked **was wrong** shipped the other way
first, and are the reason this file exists.

| Thing | Tier | Component | Why not the tier above |
|---|---|---|---|
| Deals list, openable and in the nav | 1 | `list_view_p` + `layout_p` + `tab_p` in a new `tab_collection_p` | — |
| Contract value remaining on an engagement | 1+2 | field `engagement_c.remaining_c`, maintained by `budget_roll_c` | **was wrong**: computed in the page, so nothing could list or alert on it |
| Legal agreement draft → review → approved → executed | 1 | `lifecycle_p:legal_agreement_c.status_c` | **was wrong**: a picklist plus a Rust equality check, which encoded no allowed transitions |
| Quote-line discount cannot exceed the rep's cap | 2 | `quote_guard_c.before_insert` with `error::bail!` | A page check is bypassed by the data API, the runtime MCP and every bulk load |
| Territory rule evaluation across all accounts | 2 | `terr_enqueue_c` + `territory_eval_run_c` | **was wrong**: rule semantics lived in the browser, so accounts changed by any other path were never re-evaluated |
| Editable weekly timesheet grid with undo | 3 | `project_plan_page_c` | No `layout_p` renders an editable grid; every cell it writes is a stored field |
| Commission per person, per split, per line | 3 | `employeeCommissionsSection` | `aspen-derived-exempt`: recomputed per open — a stored table would be stale the moment a deal moved, and the platform has no scheduler |

Note the last two. Tier 3 is a legitimate answer, twice, on the same instance. The grid is right
because it renders what a layout cannot, over fields that already exist. The commission section is
right because the value genuinely cannot be stored, and it says so in a line that survives in the
code.

## The shape of a wrong table

A table where every row is tier 3 and the "why not" column reads "needs custom UI" is the failure
this is meant to catch. "Needs custom UI" is the conclusion, not the reason. The reason names what
a layout, a list view or a stored field could not do.

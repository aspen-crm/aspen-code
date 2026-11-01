# Aspen dev harness: design

Status: proposal. Nothing here changes the plugin yet.

## The problem

The plugin works well for one person, one instance, and one session. Customers have teams,
several instances, and a change process. Three of the plugin's own facts make that gap expensive:

1. **Metadata can't be deleted.** Every deploy to a shared instance is permanent.
2. **One check-in at a time per instance**, and recovery (`clear-package`, `checkin-clear`) wipes
   everyone's staged work.
3. **The human is the test runner.** "Deployed and verified" rests on someone creating a record in
   the UI (`build-and-deploy` step 5).

The harness turns the plugin into a team loop: git is the source of truth, machines verify every
change before a person reviews it, and deploying means promoting a tested commit, not editing a
shared instance.

## Principles

- **Permanent effects get deterministic gates.** If a mistake can't be undone, a hook or CI blocks
  it. Skill prose is for judgment, not for safety.
- **The CLI stays the authority.** The harness adds no `aspen` verbs. It wraps the CLI in plugin
  scripts and hooks, and names what the platform must add.
- **The agent never holds a credential**, locally or in CI. Agent jobs and deploy jobs are
  separate.
- **Host-neutral.** Logic lives in Node scripts and hooks that both Claude Code and Codex run.
- **Works solo, scales to teams.** An admin with one instance and no CI gets the same loop with
  stricter local gates.

## Architecture

```
               ┌────────────── knowledge ──────────────┐
               │ platform pack (aspen-code, per release)│
               │ org pack (customer's own skills)       │
               │ instance (AGENTS.md, LESSONS.md)       │
               └───────────────────┬────────────────────┘
                                   │
  developer ─► agent session ─► inner loop ─────────────► dev instance (per developer)
                 │   ▲            place → author → verify → deploy → round-trip
                 │   └─ hooks: guard-instance, guard-ui, guard-deploy*, guard-metadata*
                 ▼
              git PR ─► CI: offline verify ─► review agent (read-only) ─► human review
                                   │
                         merge ─► deploy job (service identity*) ─► test ─► prod
                                   │                                   ▲
                                   └── round-trip specs ───────────────┘
                                                            * proposed
```

### 1. Workspace contract

The instance directory from `aspen init` stays as is; its `AGENTS.md` owns layout. The harness adds
one folder the CLI never reads:

| Path | Holds |
|---|---|
| `harness/policy.json` | Instances by role (`dev`, `test`, `prod`), which are protected, who may deploy where |
| `harness/specs/*.json` | Round-trip specs: a write, then what must be true |
| `harness/reports/` | Verify reports, keyed by tree hash (gitignored) |
| `.github/workflows/aspen.yml` | CI from the repo template |

Proposed: a repo template (`aspen-crm/aspen-instance-template`) that `getting-started` offers after
`aspen init`.

### 2. Environments

| Role | Who deploys | When |
|---|---|---|
| Dev, one per developer | The developer's agent session | Any time, after local verify |
| Test | CI, from `main` | On merge, serialized |
| Prod | CI, from a tag | After test round-trips pass and a human approves |

Per-developer instances remove the check-in contention and keep experiments off shared instances.
Every target is built from the same commit, so test and prod get exactly what was verified.

**Drift check:** before a deploy, compare `metadata/active/` (what the instance runs) against the
last deployed commit. A difference means someone changed the instance outside git; stop and show it.

### 3. Inner loop

The existing skills already define it. The harness makes "done" machine-checkable:

```
using-aspen → lean-data-model / model-first → metadata / server-code / custom-ui
           → verify → build-and-deploy (own dev instance) → round-trip → LESSONS.md
```

New script, `verify.mjs`, runs in one pass and writes one JSON report:

1. `aspen doctor`: no `problem`.
2. `aspen compile` for each changed tier.
3. `lint-ui-tokens.mjs` over `typescript/src`.
4. `metadata-reviewer` findings on the diff (blocking: destructive changes).
5. Round-trip specs against the dev instance, when one is reachable.

The report uses `build-and-deploy`'s four lists (implemented, verified, partial, unverified) and the
tree hash it was run on.

### 4. Guardrails

Three layers, each doing what it's good at:

| Layer | Enforces | Fails |
|---|---|---|
| Hooks (local) | CLI shape, folder, instance, UI tokens, deploy preconditions | Open, by design |
| CI | Compile, lint, reviewer, specs, deploy permission | Closed |
| Platform | Who may check in to a protected instance | Closed |

Local hooks fail open, so they can't be the last line of defense for prod. CI and the platform are.

Proposed hooks:

- **`guard-deploy`**: before `aspen move save-package`, require a passing verify report for the
  current tree hash, and refuse any `move` verb against an instance `policy.json` marks protected.
  Still offline and read-only: it reads the report and the policy file.
- **`guard-metadata`**: deny deleting or renaming a file under `metadata/custom/` that exists in
  `metadata/active/`. Today only the reviewer agent catches this.

Recovery verbs stay a human question in every mode.

### 5. Verification

**Round-trip specs** replace the manual UI check for anything a record write can prove:

```json
{
  "name": "opportunity rollup",
  "write": { "object": "opportunity_line_c", "create": { "quantity_c": 2, "price_c": 50 } },
  "expect": { "parent.total_c": 100 },
  "reject": [{ "create": { "quantity_c": -1 }, "message": "Quantity must be positive" }]
}
```

The runner tags every record it creates and deletes them afterward (records can be deleted;
metadata can't). Locally it signs in through the existing `instance-migration` broker
(`signin.mjs`: browser once, token in memory, never on disk). In CI it uses the deploy job's service
identity.

**Custom UI:** Playwright drives the page from its native entry point and saves screenshots to the
report. `custom-ui` step 5 already describes the checks; the harness runs them.

### 6. Identity

| Actor | Credential |
|---|---|
| Developer | OAuth in the browser, keyring (`aspen login`), or the in-memory broker |
| Agent | None. It runs commands that use the developer's login. |
| CI agent job (review, triage) | None. Read-only, offline. |
| CI deploy job | Short-lived token from workload identity (GitHub OIDC → Aspen token exchange) |

Keep the agent job and the deploy job separate so an agent prompt can never reach the deploy token.
Until the platform supports token exchange, CI runs offline checks only and developers deploy test
and prod by hand, with `guard-deploy` and a second person's approval.

### 7. Knowledge

Three packs, with the existing precedence rule (CLI, then real components, then docs, then skills):

1. **Platform pack:** `aspen-code`. Today it's pinned to one x-platform release, and customers on
   another release get advice that may be wrong. Proposed: one marketplace channel per release, and
   `session-start` names the channel that matches the instance.
2. **Org pack:** the customer's own plugin with naming rules, approved patterns, and placement-table
   precedents. Installed from their own marketplace; it never overrides a platform safety rule.
3. **Instance:** `AGENTS.md` and `LESSONS.md`, committed, shared by every teammate's agent.

**Lessons flow up.** Today a platform lesson depends on someone filing an issue. Proposed: a
`lessons` command that drafts an issue for `aspen-crm/aspen-code` from `LESSONS.md` lines marked
platform-wide, for the developer to review and send. Nothing leaves the customer's repo without
that review.

### 8. Headless agents in CI

| Job | Agent | Permissions |
|---|---|---|
| PR review | `metadata-reviewer` on the PR diff, posts findings | Read-only |
| CI failure triage | `diagnose` with `causes.mjs` on the captured output | Read-only, suggests a fix |

Both run `claude -p` or `codex exec` with the plugin and no instance credential.

### 9. Evals

The plugin tests its hooks, not the agent. The harness adds a golden-task suite run per plugin
release and per x-platform release on a disposable instance:

- Tasks: add a rollup, add a status flow, add a validation rule, build a comparison page, recover a
  stuck package.
- Checks: placement-table tier matches the expected one, verify passes, round-trip specs pass, no
  forbidden CLI shape.
- Metrics: success rate, permanent components created that the task didn't need, gate violations,
  and human interventions.

The "unneeded permanent components" metric matters most. It's the cost customers can't undo.

## What the platform must add

| Ask | Unblocks | Without it |
|---|---|---|
| Disposable or per-developer instances | Safe experiments, evals, no check-in contention | Gate harder; one dev instance shared by queue |
| Workload identity token exchange | CI deploys and CI round-trips | Humans deploy; CI stays offline |
| Server-side protected instances | Real prod gate | `guard-deploy` plus process |
| Metadata delete or rollback | Cheaper mistakes | Everything above stays necessary |

## Phases

1. **Plugin only:** repo template, `verify.mjs`, round-trip runner on the existing broker,
   `guard-deploy`, `guard-metadata`, offline CI, PR review agent.
2. **With the platform:** per-developer instances, CI identity, protected instances, CI deploys.
3. **At scale:** release channels, golden-task evals, lessons flow.

Phase 1 ships value on today's platform. Phases 2 and 3 depend on the asks above.

## Open questions

- **Who's the customer developer?** Admins without git need solo mode as a first-class path, not a
  degraded one.
- **Does `aspen` expose deployed state cheaply enough for the drift check**, or does it need a
  fetch each time? Verify against the CLI before building it.
- **Do round-trip specs belong in the instance repo or in the platform** as a test component type?
  The repo is faster to ship; the platform would let tests run on every check-in.

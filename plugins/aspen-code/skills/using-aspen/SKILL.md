---
name: using-aspen
description: Use for ANY change to an Aspen instance with the aspen CLI — authoring or extending objects, fields, picklists, layouts, list views, tabs, writing a Rust record trigger or web API, compiling, deploying through the check-in chain, and verifying. Routes each moment of the loop to the right skill, in order. Start here.
---

# Building on Aspen

You build one instance's **metadata** and **Rust server code** on this machine with the `aspen`
CLI; the **instance validates and deploys** what it is given. There is one loop, and every step
has a skill. Announce it: "Using [skill] to [purpose]."

## Before the loop: is this machine ready?

Three facts, in this order. The session-start note states them when hooks are on; otherwise check:

| Fact | How to tell | If not |
|---|---|---|
| The CLI is installed | `aspen --version` (or `~/.aspen/bin/aspen --version`) | `getting-started` §1 |
| It is signed in to the right instance | `aspen doctor` → `instance.logged-in`, `configuration.record-matches-login` | `getting-started` §2 — the **user** runs `aspen login` |
| You are in that instance's directory | a `.aspen/config.toml` here or above | `getting-started` §3 — `aspen init` |

Then run **`aspen doctor`** once in the instance directory. It is the CLI's own readiness report
(JSON when an agent runs it, one `id` + `status` per check, exit 1 only on a `problem`). Fix every
`problem` before authoring; read the `fix` it gives. `instance.cli-matches-instance` failing means
the CLI and the instance are on different releases — nothing will compile or deploy correctly
until that is resolved (see `diagnose`).

## The directory

`aspen init` wrote it, and its own `AGENTS.md` (which `CLAUDE.md` imports) is the authority on
the layout and naming rules. Read it once per session. The short version:

```
<domain>_<instance>/
  .aspen/config.toml      which instance this directory is for
  metadata/custom/        AUTHORED — the only metadata you write, and the only layer committed
  metadata/platform/      fetched from the instance      — read-only
  metadata/active/        fetched: custom already deployed — read-only
  metadata/compiled/      written by `aspen compile`       — read-only, the resolved truth
  rust/                   the one server crate (triggers, web APIs)
  typescript/             the one UI codefile (not covered by this plugin yet)
  data/
```

Anything written outside `metadata/custom/` is replaced by the next fetch or compile.

## The loop

| # | Moment | Skill |
|---|---|---|
| 0 | Machine not ready: install, sign in, create the instance directory | `getting-started` |
| 1 | The request **creates** an object, field, picklist, record type, tab or collection | `lean-data-model` — should it exist at all? |
| 2 | Any feature, number, rule, status flow, screen | `model-first` — which tier: metadata, trigger, or page |
| 3 | Authoring metadata into `metadata/custom/` | `metadata` |
| 4 | Writing a Rust record trigger or web API in `rust/` | `server-code` |
| 5 | Compile, deploy through the check-in chain, prove it with a record round-trip | `build-and-deploy` |
| — | A compile, check-in, or the instance behaves unexpectedly | `diagnose` |

Steps 1 and 2 happen **before the first file**. Nothing on this platform deletes, so they are only
cheap now. Skip them only when the tier is already settled: fixing a field you authored last turn,
a trigger's logic, a label.

Editing **one** existing component (a label, one picklist item)? Go straight to `metadata` step 1:
copy the shape, change it, compile.

## Fan-out (read-only subagents)

| Moment | Agent |
|---|---|
| "What does our `<domain>` model look like?" across many objects | `schema-explorer` |
| Audit a metadata diff for breaking changes and dangling references before deploy | `metadata-reviewer` |

## Non-negotiables

- **The CLI is the authority on its own verbs.** When a skill and `aspen <command> --help`
  disagree, `--help` wins — and the skill is wrong; tell the human so it gets fixed in this plugin.
- **Never handle credentials.** `aspen login` is OAuth in a browser and refuses to run from an
  agent. The user runs it. You never see, type, ask for, or print a token or API key.
- **`aspen compile` before every deploy.** It runs the instance's own validator offline and
  reports what `checkin-prep` would, without a round trip on the shared instance.
- **Deploying changes a shared instance.** Confirm with the human before `aspen move save-package`
  and before any recovery verb (`clear-package`, `checkin-clear`, `clear-dev`).
- **"Deployed" is not "done"** until a record round-trip proves the behavior.
- **Nothing deletes.** Retire with `"active": false`; never delete a JSON file that was deployed.
- **What you learn about the platform belongs in this plugin**, not in per-user memory. When a
  compile or check-in teaches you something no skill says, tell the human it belongs in
  `aspen-crm/aspen-code`, and add a one-line lesson to the instance repo (see `diagnose`).

## Red flags — stop

| Thought | Reality |
|---|---|
| "I'll run `aspen login` for them" | It refuses under an agent. Hand the command to the user. |
| "I'll edit `metadata/compiled/` / `active/`" | Replaced on the next compile/fetch. Author in `metadata/custom/`. |
| "I'll guess the attribute name" | Copy a real component from `metadata/compiled/` or `platform/`. |
| "It compiled, so it works" | Deploy, then a record round-trip. |
| "The check-in is stuck; I'll clear it" | Shared state. Ask first — `build-and-deploy`. |
| "I'll name the crate `server_main_c`" | Don't rename anything. The CLI deploys the `rust/` crate as `server_main_c` itself. |
| "A deal object" | `opportunity_p` exists. `lean-data-model`. |

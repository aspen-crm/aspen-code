---
name: using-aspen
description: Use for ANY change to an Aspen instance with the aspen CLI — authoring or extending objects, fields, picklists, layouts, list views, tabs, writing a Rust record trigger or web API, compiling, deploying through the check-in chain, verifying, and migrating records from another instance. Routes each moment of the loop to the right skill, in order. Start here.
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
| Its build dependencies are installed | `aspen doctor` → `toolchain.*`, `typescript.deps-installed` | `getting-started` §4 — `install-deps.mjs` |

Then run **`aspen doctor`** once in the instance directory. It is the CLI's own readiness report
(JSON when an agent runs it, one `id` + `status` per check, exit 1 only on a `problem`). Fix every
`problem` before authoring; read the `fix` it gives. `instance.cli-matches-instance` failing means
the CLI and the instance are on different releases — nothing will compile or deploy correctly
until that is resolved (see `diagnose`).

## The directory and the reference

`aspen init` wrote the directory; its `AGENTS.md` (imported by `CLAUDE.md`) and the docs page
*Managing Component Files* describe the layout. In one line: author metadata only in
`metadata/custom/` (the `platform/`, `active/` and `compiled/` layers are replaced by the next
fetch or compile), server code in `rust/`, UI in `typescript/`.

The **Aspen docs** are the reference, shipped as the `aspen-docs` MCP server —
`searchDocumentation`, then `getPage` on the URL it returns (fallback: any page URL + `.md`, or
`https://aspencrm.gitbook.io/docs/llms.txt`). If neither is reachable, tell the user and have
them authorize `aspen-docs` (`/mcp`) before you author anything. They cover every component type (Platform), the CLI
(*Aspen CLI Developer Guide*, *Command Reference*), the Rust SDK, AQL, and the REST API. Skills
here carry the loop and what the docs leave out. When sources disagree: the CLI (`--help`, and
what it actually does) and the compiler first, then real components in `metadata/active/` and
`platform/`, then the docs, then a skill — and say which was wrong so it gets fixed.

### Where the docs are wrong for CLI 26.4.1 — follow this, not the page

| The docs say | Actually |
|---|---|
| Log in with `aspen login -i <url> -k <api-key>` | `aspen login -i <url>` is OAuth in a browser, run **by the user** in their own terminal (it refuses under an agent). This plugin never uses an API key. |
| `aspen download aspenc` fetches the validator | No `download` command exists. aspenup installs `aspenc` with `aspen`; `aspen compile --metadata` runs it. |
| `aspen move --rust --dev` for fast Rust iteration | It looks for code in `server/` and `ui/`, not the `rust/` and `typescript/` that `aspen init` creates. Deploy code through the check-in chain until that is fixed. |
| A `custom_page` tab's `page-ui-code` is a URL template | The form that passed check-in is `ui_main_c.<route name>` (see `metadata/metadata-shapes.md`). |
| The Query Service example formats a value into the AQL string | Fine for constants and ids; never for request-supplied text. |

## The loop

| # | Moment | Skill |
|---|---|---|
| 0 | Machine not ready: install, sign in, create the instance directory | `getting-started` |
| 1 | The request **creates** an object, field, picklist, record type, tab or collection | `lean-data-model` — should it exist at all? |
| 2 | Any feature, number, rule, status flow, screen | `model-first` — which tier: metadata, trigger, or page |
| 3 | Authoring metadata into `metadata/custom/` | `metadata` |
| 4 | Writing a Rust record trigger or web API in `rust/` | `server-code` |
| 4b | Writing a page or layout section in `typescript/`, or styling any control in it | `aspen-design-system` — the platform's classes, and the shadow-root traps |
| 5 | Compile, deploy through the check-in chain, prove it with a record round-trip | `build-and-deploy` |
| — | A compile, check-in, or the instance behaves unexpectedly | `diagnose` |
| — | Move records (and the objects and fields they need) from another Aspen instance into this one | `instance-migration` |

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
- **Right binary, right folder, right instance — every `aspen` command.** Run it from the
  session's instance directory (or pass that directory with `--dir`), and only after
  `.aspen/config.toml` there names the instance the user means *and* the one the CLI is signed
  in to. If the shell's `aspen` is a folder-local Builder-era CLI, run `~/.aspen/bin/aspen` by
  its full path. Never point a command at another instance's folder without the user asking. A
  guard hook enforces this (Claude Code asks or refuses; Codex refuses and says how to confirm).
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
| "I'll `cd` to the other instance folder and deploy there too" | A different instance. Only when the user asked for that folder — the guard will ask. |
| "I'll run `aspen login` for them" | It refuses under an agent. Hand the command to the user. |
| "I'll edit `metadata/compiled/` / `active/`" | Replaced on the next compile/fetch. Author in `metadata/custom/`. |
| "I'll guess the attribute name" | Copy a real component from `metadata/compiled/` or `platform/`. |
| "It compiled, so it works" | Deploy, then a record round-trip. |
| "The check-in is stuck; I'll clear it" | Shared state. Ask first — `build-and-deploy`. |
| "I'll just `bail!` if the rule fails" | Ask the developer how each failure should reach the UI and the API first — `server-code` step 1. |
| "I'll name the crate `server_main_c`" | Don't rename anything. The CLI deploys the `rust/` crate as `server_main_c` itself. |
| "A deal object" | `opportunity_p` exists. `lean-data-model`. |

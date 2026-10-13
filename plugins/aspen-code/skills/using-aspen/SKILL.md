---
name: using-aspen
description: Use first for any change to an Aspen instance with the aspen CLI — metadata (objects, fields, picklists, layouts, list views, tabs), a Rust trigger or web API, a TypeScript page, compiling, deploying, verifying, or migrating records in. Routes each step to the skill that owns it.
---

# Building on Aspen

You author one instance's metadata, Rust server code and TypeScript UI on this machine with the
`aspen` CLI; the instance validates and deploys what it is given.

## Is this machine ready?

The session-start note says what is missing. Without hooks, check:

| Fact | Check | If not |
|---|---|---|
| The CLI is installed | `aspen --version` (or `~/.aspen/bin/aspen --version`) | `getting-started` step 1 |
| Signed in to the right instance | `aspen doctor` → `instance.logged-in`, `configuration.record-matches-login` | `getting-started` step 2 |
| In that instance's directory | `.aspen/config.toml` here or above | `getting-started` step 3 |
| Build dependencies installed | `aspen doctor` → `toolchain.*`, `typescript.deps-installed` | `getting-started` step 4 |

Then run `aspen doctor` once in the instance directory (JSON under an agent, one `id` + `status`
per finding, exit 1 only on a `problem`) and fix each `problem` with the `fix` it gives — except
`instance.logged-in` and `instance.credential-accepted`, whose fixes name `--api-key`: sign in as
`getting-started` step 2 says instead. A failing `instance.cli-matches-instance` means nothing will
compile or deploy correctly until it is resolved (`diagnose`).

## The loop

| # | Moment | Skill |
|---|---|---|
| 0 | Machine not ready: install, sign in, create the instance directory | `getting-started` |
| 1 | The request creates an object, field, picklist, record type, tab or collection | `lean-data-model` |
| 2 | A feature, number, rule, status flow or screen | `model-first` |
| 3 | Authoring metadata in `metadata/custom/` | `metadata` |
| 4 | A Rust record trigger or web API in `rust/` | `server-code` |
| 4b | A page or layout section in `typescript/` | `custom-ui` |
| 5 | Compile, deploy through the check-in chain, prove it with a record round-trip | `build-and-deploy` |
| — | A compile, check-in, or the instance behaves unexpectedly | `diagnose` |
| — | Records (and the objects and fields they need) from another Aspen instance | `instance-migration` |
| — | Records from a Salesforce org | `salesforce-migration` |

Steps 1 and 2 come before the first file, while they are cheap: metadata can't be deleted yet.
Skip them when the tier is settled — a label, one picklist item, fixing what you authored last
turn — and go straight to `metadata`.

Read-only subagents: `schema-explorer` answers a model-shape question across many objects;
`metadata-reviewer` audits a non-trivial metadata diff before deploy.

## Rules

- **`aspen <command> --help` and the compiler are the authority** on the CLI. When a skill
  disagrees, follow the CLI and tell the human the skill needs fixing in `aspen-crm/aspen-code`.
- Run every `aspen` command from the session's instance directory (`cd <dir> && …`; only
  `compile`, `doctor` and `init` take `--dir`, and `move save-package --dir` names a package). A
  guard hook checks the binary, folder and instance of each command; follow what it says.
- **Never handle a credential.** No `--api-key`/`-k`. You run the OAuth login in the shape
  `getting-started` step 2 gives, the user approves in the browser, and the token goes to the OS
  keyring. You never see, ask for or print a token.
- Choose an object or field by its `description`, not its name: `contact_rel_p` is a team
  member's relationship strength with a contact; `contact_role_p` links a contact to a record.
  Read it in `metadata/platform/object_p/<name>.json` (or the describe); ask when none fits.
- Metadata can't be deleted yet. Retire with `"active": false`; never delete a deployed file.
- Deploying and the recovery verbs change a shared instance: get the human's go-ahead
  (`build-and-deploy`). "Deployed" is done only after a record round-trip proves the behavior.
- A platform fact a compile or check-in taught you that no skill states belongs in this plugin:
  tell the human, and add a lesson to the instance repo (`diagnose`).

## The directory and the reference

The instance directory's `AGENTS.md` (written by `aspen init`, imported by `CLAUDE.md`) owns the
layout. Author metadata only in `metadata/custom/` (`platform/`, `active/` and `compiled/` are
replaced by the next fetch or compile), server code in `rust/`, UI in `typescript/`.

The Aspen docs are the reference for every component type, the CLI, the Rust SDK, AQL and the REST
API, through the `aspen-docs` MCP server: `searchDocumentation`, then `getPage` on the URL it
returns (fallback: the page URL + `.md`, or `https://aspencrm.gitbook.io/docs/llms.txt`). If
neither is reachable, ask the user to authorize `aspen-docs` (`/mcp`) rather than authoring from
memory. When sources disagree: the CLI and compiler, then real components in `metadata/active/`
and `platform/`, then the docs, then a skill.

## Known issues at the pinned release

These skills are verified against x-platform **26.4.1** ([`xplatform.json`](../../xplatform.json)):
the `aspen` CLI 26.4.1 and its metadata validator, App API v24.3, Rust 1.98.1 to `wasm32-wasip2`,
the `aspen-crm` crate 0.1.0, and `@aspen-crm/sdk` / `@aspen-crm/x-cli` 0.2.0. *Observed on a live
instance* marks a fact not checkable in source. When the instance serves another release (the
session-start note says so), `--help`, `aspen doctor` and the installed SDK win over any skill.

**The 26.4.1 SDKs are not published.** `aspen init` 26.4.1 pins `aspen-crm`, `@aspen-crm/sdk` and
`@aspen-crm/x-cli` to `0.1.0`, the only versions on crates.io and npm, built for the previous
release:

- A 26.4.1 instance refuses to render a page built against `@aspen-crm/sdk` 0.1.0 ("… SDK is no
  longer supported").
- crates.io `aspen-crm` 0.1.0 lacks a record-value case the 26.4.1 host has, under the same label.
  A component that queries has been refused at check-in for it (*observed on a live instance*).

Tell the human before building a page or a querying trigger. Don't change the pins or point them
at an x-platform checkout.

**Where the docs are wrong for CLI 26.4.1:**

| The docs say | Actually |
|---|---|
| Log in with `aspen login -i <url> -k <api-key>` | This plugin never uses an API key. `aspen login -i <url>` is OAuth in a browser; under an agent it needs `--agent no` and `ASPEN_INTERACTIVE=1` (`getting-started` step 2). |
| `aspen download aspenc` fetches the validator | No `download` command. aspenup installs `aspenc` with `aspen`; `aspen compile --metadata` runs it. |
| `aspen move --rust --dev` for fast Rust iteration | It looks for `server/` and `ui/`, not the `rust/` and `typescript/` `aspen init` creates. Deploy code through the check-in chain. |
| A `custom_page` tab's `page-ui-code` is a URL template | Only `ui_main_c.<route name>` resolves (`metadata/metadata-shapes.md`). |
| The Query Service example formats a value into the AQL string | Fine for constants and ids; never for request-supplied text. |

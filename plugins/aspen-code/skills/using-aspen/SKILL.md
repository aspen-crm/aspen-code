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
| In that instance's directory | `.aspen/config.toml` here or above | `getting-started` steps 3 and 6 |
| Build dependencies installed | `aspen doctor` → `toolchain.*`, `typescript.deps-installed` | `getting-started` step 4 |

Then run `aspen doctor` once in the instance directory (JSON under an agent, one `id` + `status`
per finding, exit 1 only on a `problem`) and fix each `problem` with the `fix` it gives — except
`instance.logged-in` and `instance.credential-accepted`, whose fixes name `--api-key` (sign in as
`getting-started` step 2 says instead). A failing `instance.cli-matches-instance` means nothing will
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
| — | Records from a Salesforce org or a Salesforce export (CSVs) | `salesforce-migration` |

Steps 1 and 2 come before the first file, while they are cheap: metadata can't be deleted yet.
Skip them when the tier is settled — a label, one picklist item, fixing what you authored last
turn — and go straight to `metadata`.

Read-only subagents: `schema-explorer` answers a model-shape question across many objects;
`metadata-reviewer` audits a non-trivial metadata diff before deploy (Codex: `spawn_agent` with the
body of `agents/<name>.md` as its task).

Worked examples: three sample instances with their metadata, triggers and data
([samples.md](samples.md)).

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
- Metadata can't be deleted yet (records can). Retire with `"active": false`; never delete a
  deployed file.
- Deploying and the recovery verbs change a shared instance: get the human's go-ahead
  (`build-and-deploy`). "Deployed" is done only after a record round-trip proves the behavior.
- **Ask only at the gates above** (credentials, a deploy or recovery verb, installing, the first
  new object or custom page in a placement table). Each is a `Required:` line in its skill: stop
  there for the user's yes, unless they already gave it for that exact action. Anything
  reversible in the instance directory — a pin, a config file, a rebuild — do it and say what you
  changed.
- **Ship what isn't blocked.** When one piece can't deploy, deploy the rest and name the one
  blocker, rather than holding the whole change.
- **Test a cause before you act on it or send the human after it.** One compiler message or one
  skill line is a lead, not a diagnosis. When the cause would create a permanent component or
  send someone to find a fix, run the cheapest check that could prove it wrong first: query the
  registry, or compile again changing one thing (`diagnose` step 3).
- A platform fact a compile or check-in taught you that no skill states belongs in this plugin:
  tell the human, and add a lesson to the instance's `LESSONS.md` (`diagnose`).

## In Codex

- A thread stays in the folder it started in. Build only in a thread whose folder is the
  instance directory (`getting-started` step 6); elsewhere, `cd <dir> && …` every command and read
  `<dir>/AGENTS.md` and `<dir>/LESSONS.md` first.
- Edit files with `apply_patch`. A script that rewrites files (a heredoc, `python - <<'PY'`,
  `sed -i`) skips the pre-write guards; the UI part is only caught after the fact.
- A generator that emits metadata is reviewed like hand-written metadata (`metadata`).
- Custom UI is done only when `lint-ui-tokens.mjs typescript/src` is clean and `aspen compile`
  passes (`custom-ui` step 4).
- Ask questions with `request_user_input`. A `Required:` line is a hard stop: quote it when you
  pause, and don't proceed until the user answers.
- Codex loads `AGENTS.md`, not `CLAUDE.md`: anything for both hosts goes in `AGENTS.md` or a
  file it links.

## The directory and the reference

The instance directory's `AGENTS.md` (written by `aspen init`, imported by `CLAUDE.md`) owns the
layout. Lessons earlier sessions learned on this instance are in `LESSONS.md` beside it, linked
from `AGENTS.md`; read it before building. Author metadata only in `metadata/custom/`
(`platform/`, `active/` and `compiled/` are replaced by the next fetch or compile), server code in
`rust/`, UI in `typescript/`.

The Aspen docs are the reference for every component type, the CLI, the Rust SDK, AQL and the REST
API, through the `aspen-docs` MCP server: `searchDocumentation`, then `getPage` on the URL it
returns (fallback: the page URL + `.md`, or `https://aspencrm.gitbook.io/docs/llms.txt`). If
neither is reachable, ask the user to authorize `aspen-docs` (`/mcp`) rather than authoring from
memory. When sources disagree: the CLI and compiler, then real components in `metadata/active/`
and `platform/`, then the docs, then a skill.

## The release these skills match

Verified against x-platform **26.4.1** ([`xplatform.json`](../../xplatform.json)): the `aspen`
CLI 26.4.1, App API v24.3, Rust 1.98.1 to `wasm32-wasip2`. *Observed on a live instance* marks a
fact seen on a run rather than in the release. When the instance serves another release (the session-start note
says so), `--help`, `aspen doctor` and the installed SDK win over any skill.

### Where the docs are wrong for CLI 26.4.1

| The docs say | Actually |
|---|---|
| Log in with `aspen login -i <url> -k <api-key>` | This plugin never uses an API key. `aspen login -i <url>` is OAuth in a browser; under an agent it needs `--agent no` and `ASPEN_INTERACTIVE=1` (`getting-started` step 2). |
| `aspen download aspenc` fetches the validator | No `download` command. aspenup installs `aspenc` with `aspen`; `aspen compile --metadata` runs it. |
| `aspen move --rust --dev` for fast Rust iteration | It looks for `server/` and `ui/`, not the `rust/` and `typescript/` `aspen init` creates. Deploy code through the check-in chain. |
| A `custom_page` tab's `page-ui-code` is a URL template | Only `ui_main_c.<route name>` resolves (`metadata/metadata-shapes.md`). |
| The Query Service example formats a value into the AQL string | Fine for constants and ids; never for request-supplied text. |

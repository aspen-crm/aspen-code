# Working on aspen-code

The Claude Code + Codex plugin for the aspenup `aspen` CLI. Skills and two read-only agents in
`plugins/aspen-code/`, one offline SessionStart hook. See [README.md](README.md) for what ships.

## Rules

- **The CLI is the authority.** Every verb, flag and path a skill states must be one the current
  CLI has: check `aspen <command> --help`, and when behavior matters, the CLI source
  (`app/server/packages/aspen/src` in x-platform). If a skill disagrees with the CLI, fix the skill.
- **The instance directory's `AGENTS.md` (written by `aspen init`) owns layout and naming.**
  Skills point to it and add only what it does not say; don't restate it in a way that can drift.
- **Never teach a CLI shape that does not exist** (`metacode/`, `.aspen/bin/aspen` in the
  folder, `./ac validate`, `aspen download`, API-key login). `scripts/validate.mjs` fails on
  those.
- **The model never handles a credential.** OAuth login is handed to the user; no `--api-key`.
  `instance-migration` signs in through the browser for each command (`scripts/signin.mjs`); the
  token lives only in that process's memory and is never written.
- **Every skill is routed from `using-aspen`**, and its frontmatter `description` says *when* to
  use it. Keep bodies procedures, not essays.
- **Agents are read-only** — never give `schema-explorer` or `metadata-reviewer` Write/Edit.
- **Hooks stay offline, read-only and fail open**: they never run the CLI (the aspenup proxy can
  reach the network), never read a secret, and exit 0 with no output on any error. There are three:
  `session-start.mjs` (readiness note), `guard-instance.mjs` (right binary, folder and instance
  for every `aspen` command) and `guard-ui.mjs` (design tokens, native controls and glyph icons on
  every write in `typescript/`, and a question when a write first declares a page, layout
  section or `custom_page` tab). Anything
  else the plugin enforces lives in skill prose.
- **Installing is consented, planned and idempotent.** `install-deps.mjs` prints its plan by
  default, installs project dependencies only with `--run` and machine-wide tools only with
  `--machine`, and skips anything already satisfied. Keep new install steps to that shape.
- **Bump the version in both manifests** on every shipped change.

## Verify before "done"

```sh
node scripts/validate.mjs
node --test plugins/aspen-code/test/*.test.mjs
claude plugin validate . && claude plugin validate plugins/aspen-code
```

A skill change that states CLI behavior is verified against the CLI (help, source, or a real run
on a dev instance), not from memory — say which in the PR.

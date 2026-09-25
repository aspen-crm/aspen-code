# Working on aspen-code

The Claude Code + Codex plugin for the aspenup `aspen` CLI. Skills and two read-only agents in
`plugins/aspen-code/`, one offline SessionStart hook. See [README.md](README.md) for what ships.

## Rules

- **The CLI is the authority.** Every verb, flag and path a skill states must be one the current
  CLI has: check `aspen <command> --help`, and when behavior matters, the CLI source
  (`app/server/packages/aspen/src` in x-platform). If a skill disagrees with the CLI, fix the skill.
- **The instance directory's `AGENTS.md` (written by `aspen init`) owns layout and naming.**
  Skills point to it and add only what it does not say; don't restate it in a way that can drift.
- **Never teach the Builder-era CLI** (`metacode/`, `.aspen/bin/aspen` in the folder, `./ac
  validate`, `aspen download`, API-key login). `scripts/validate.mjs` fails on those.
- **The model never handles a credential.** OAuth login is handed to the user; no `--api-key`.
- **Every skill is routed from `using-aspen`**, and its frontmatter `description` says *when* to
  use it. Keep bodies procedures, not essays.
- **Agents are read-only** — never give `schema-explorer` or `metadata-reviewer` Write/Edit.
- **The hook stays offline, read-only and quiet**: it never runs the CLI (the aspenup proxy can
  reach the network), never reads a secret, and exits 0 on any error.
- **Bump the version in both manifests** on every shipped change.

## Verify before "done"

```sh
node scripts/validate.mjs
node --test plugins/aspen-code/test/*.test.mjs
claude plugin validate . && claude plugin validate plugins/aspen-code
```

A skill change that states CLI behavior is verified against the CLI (help, source, or a real run
on a dev instance), not from memory — say which in the PR.

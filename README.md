# Aspen Code

The Claude Code and Codex plugin for building on an Aspen instance with the **aspenup** CLI
(`aspen login` / `init` / `compile` / `doctor` / `move`).

This repository is the authoring lane: the model, the code, and deploying them. Working a
live instance's records instead — view, search, report, create, update — is the separate
`aspencrm-ai` plugin in [aspen-tools](https://github.com/aspen-crm/aspen-tools). Neither
needs the other.

Still **0.0.x**: in use, but the version says what it says.

**Setting up?** Point Claude Code or Codex at [setup/README.md](setup/README.md). It installs the
plugin and the Aspen CLI, gets you signed in, and gives you the first prompt.

## What it does

1. **Gets the machine ready.** A session-start check (offline, silent when there is nothing to say)
   notices when the CLI is missing, not signed in, or signed in to a different instance than the
   directory, and prompts the model to walk the user through it.
2. **Installs the CLI** — with the user's consent:
   - macOS/Linux: `curl --proto '=https' --tlsv1.2 -LsSf https://static-assets.veevaxdev.com/tooling/latest/cli/installer.sh | sh`
   - Windows: `irm https://static-assets.veevaxdev.com/tooling/latest/cli/installer.ps1 | iex`
3. **Signs in with OAuth.** `aspen login -i <instance URL>` opens a browser. The CLI refuses to do
   this under an agent, so the model hands the command to the user to run in their own terminal —
   it never sees or asks for a credential.
4. **Creates the instance directory** with `aspen init`, then **installs what it needs to build**
   — `aspen init` installs nothing. A bundled script shows the plan, then installs the Rust
   toolchain the crate pins (with `wasm32-wasip2`), the crate's dependencies, and `typescript/`'s
   npm packages; with separate consent it also installs rustup and a Node that meets the UI
   tooling's `^24.11.1`. Then `aspen doctor` confirms it.
5. **Builds on it:** decide whether a component should exist and which tier it belongs in, author
   metadata and Rust triggers, validate offline with `aspen compile`, deploy through the check-in
   chain with the user's go-ahead, and prove it with a record round-trip.
6. **Migrates records** from another Aspen instance with a bundled script. It uses the REST API,
   and the user signs in to each instance in the browser when a command needs it; the token is
   never stored, and the model never sees it. The user settles the mapping. Then comes a dry run, a pilot, the full load and a check.

| Skill | When |
|---|---|
| `using-aspen` | The router — any Aspen change starts here |
| `getting-started` | Install/update the CLI, OAuth sign-in, `aspen init`, install the project's dependencies, `aspen doctor` |
| `lean-data-model` | Before creating any object, field, picklist or tab: should it exist? |
| `model-first` | Before any feature: metadata, trigger, or page? |
| `metadata` | Authoring `metadata/custom/` and validating with `aspen compile --metadata` |
| `server-code` | Rust record triggers and web APIs in `rust/` (six verified patterns) |
| `custom-ui` | TypeScript pages and layout sections in `typescript/`: where they go, design tokens and components, build/lint checks, verifying the rendered UI |
| `build-and-deploy` | `aspen compile` → `save-package` → `checkin-prep` → `checkin-index` → `checkin-deploy` → verify |
| `diagnose` | Failed compiles/check-ins, version skew, login trouble, triggers that don't fire |
| `instance-migration` | Copy records from another Aspen instance: map objects, fields and picklist values with the user, dry run, pilot, bulk load through the REST API, verify |

Agents: `schema-explorer` and `metadata-reviewer`, both read-only.

**Docs:** the plugin connects the [Aspen documentation](https://aspencrm.gitbook.io/docs) as the
`aspen-docs` MCP server (GitBook's public endpoint, no sign-in). The component-type reference lives
there, not in the skills; the skills keep the loop and what the docs leave out. The skills assume
the whole site — Platform, Customization (CLI, Aspen SDK, Custom UI), API and AQL. While
Customization and API are sign-in-only, the public endpoint cannot return them; they become
reachable when those sections are published.

**Guard:** before any `aspen` command runs, a hook checks it is run from an instance directory
whose instance matches both the session's folder and the login. It refuses a deploy verb outside
an instance folder or against a mismatched login, and asks before a command leaves the session's
folder.

**UI guard:** before a file write or edit in `typescript/`, a hook denies a hardcoded colour,
spacing, radius, type value or shadow where the design system publishes a token, an `--ap-*` name
the installed `@aspen-crm/sdk` does not define, a table/button/select/textarea rebuilt from
semantic tokens alone, a native `<select>`/`<datalist>`/date or time `<input>` (the browser draws
their menus and calendars), and a text glyph or emoji standing in for an icon; each has a
documented exemption comment. `custom-ui` carries the anatomy of Aspen's select, lookup and date
controls and the icons they draw. It asks once when a write first
declares a page, layout section or `custom_page` tab. `custom-ui`'s `lint-ui-tokens.mjs` runs the
same checks over a tree for CI.

Not in 0.0.1: the remaining guard hooks.

## Install

| | Claude Code | Codex |
|---|---|---|
| Add the marketplace | `/plugin marketplace add aspen-crm/aspen-code` | `codex plugin marketplace add aspen-crm/aspen-code` |
| Install | `/plugin install aspen-code@aspen-code` | `codex plugin add aspen-code@aspen-code` |
| Update | `/plugin marketplace update aspen-code` | `codex plugin marketplace upgrade aspen-code` |

**Already have `aspen-code@aspen`?** That plugin shipped from aspen-tools and is no longer
offered there. Uninstall it first or you will have two sets of Aspen skills:
`/plugin uninstall aspen-code@aspen`, or `codex plugin remove aspen-code@aspen`.

No git? Claude Code can add `https://raw.githubusercontent.com/aspen-crm/aspen-code/main/setup/marketplace.json`
instead, which installs the latest release zip; [setup/README.md](setup/README.md) covers Codex.

Then start a **new** session. In Codex, review and trust the plugin's hook (plugin install does
not trust hooks); without it the skills still work, and the model checks the CLI itself.

Try: *"Set me up to build on my Aspen instance."*

## Develop

```sh
node scripts/validate.mjs                              # manifests, skills, links, retired-CLI phrases
node --test plugins/aspen-code/test/*.test.mjs         # the session-start hook
claude plugin validate . && claude plugin validate plugins/aspen-code
```

To try a local change: `claude --plugin-dir ./plugins/aspen-code`, or point the marketplace at
your checkout (`/plugin marketplace add ~/path/to/aspen-code`). Bump the version in **both**
`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` on every change you ship — the
validator fails if they differ.

**Releasing:** publish a GitHub release tagged `v<version>`. The `release` workflow attaches
`aspen-code.zip`, which the no-git marketplace (`setup/marketplace.json`) installs from.

## License

[Apache License 2.0](LICENSE).

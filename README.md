# Aspen Code

The Claude Code and Codex plugin for building on an Aspen instance with the **aspenup** CLI
(`aspen login` / `init` / `compile` / `doctor` / `move`).

> **Internal testing (0.0.x).** This replaces `aspen-code@aspen` from
> [aspen-tools](https://github.com/aspen-crm/aspen-tools) (2.8.x), which targets the Builder-era
> CLI. Production users are unaffected: it is a separate marketplace. When it is ready it will be
> promoted into aspen-tools and the old versions deprecated — see [Promotion](#promotion).

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

| Skill | When |
|---|---|
| `using-aspen` | The router — any Aspen change starts here |
| `getting-started` | Install/update the CLI, OAuth sign-in, `aspen init`, install the project's dependencies, `aspen doctor` |
| `lean-data-model` | Before creating any object, field, picklist or tab: should it exist? |
| `model-first` | Before any feature: metadata, trigger, or page? |
| `metadata` | Authoring `metadata/custom/` and validating with `aspen compile --metadata` |
| `server-code` | Rust record triggers and web APIs in `rust/` (six verified patterns) |
| `build-and-deploy` | `aspen compile` → `save-package` → `checkin-prep` → `checkin-index` → `checkin-deploy` → verify |
| `diagnose` | Failed compiles/check-ins, version skew, login trouble, triggers that don't fire |

Agents: `schema-explorer` and `metadata-reviewer`, both read-only.

**Docs:** the plugin connects the [Aspen documentation](https://aspencrm.gitbook.io/docs) as the
`aspen-docs` MCP server (GitBook's public endpoint, no sign-in). The component-type reference lives
there, not in the skills; the skills keep the loop and what the docs leave out. The skills assume
the whole site — Platform, Customization (CLI, Aspen SDK, Custom UI), API and AQL. While
Customization and API are sign-in-only, the public endpoint cannot return them; they become
reachable when those sections are published.

**Guard:** before any `aspen` command runs, a hook checks it is aspenup's CLI (not a Builder-era
folder-local one), run from an instance directory, whose instance matches both the session's
folder and the login. It refuses a deploy verb outside an instance folder or against a
mismatched login, and asks before a command leaves the session's folder.

Not in 0.0.1: TypeScript UI authoring guidance, and the other guard hooks from 2.8.x.

## Install (testers)

You need read access to this repository; the hosts clone it with your git credentials.

**Uninstall the production plugin first**, or you will have two sets of Aspen skills:

| | Claude Code | Codex |
|---|---|---|
| Remove prod | `/plugin uninstall aspen-code@aspen` | `codex plugin remove aspen-code@aspen` |
| Add this marketplace | `/plugin marketplace add aspen-crm/aspen-code` | `codex plugin marketplace add aspen-crm/aspen-code` |
| Install | `/plugin install aspen-code@aspen-code` | `codex plugin add aspen-code@aspen-code` |
| Update | `/plugin marketplace update aspen-code` | `codex plugin marketplace upgrade aspen-code` |

Then start a **new** session. In Codex, review and trust the plugin's hook (plugin install does
not trust hooks); without it the skills still work, and the model checks the CLI itself.

Try: *"Set me up to build on my Aspen instance."*

To go back to production: uninstall `aspen-code@aspen-code`, reinstall `aspen-code@aspen`.

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

## Promotion

When 0.x is ready for production:

1. Copy `plugins/aspen-code/` over `plugins/aspen/code/` in aspen-tools, set the version to the
   next major above the current prod line (3.0.0), and release it there. Testers switch back to
   `aspen-code@aspen`; the plugin name stays `aspen-code`, so nothing else changes for users.
2. Deprecate the 2.x line in aspen-tools' release notes and README (the Builder-era CLI path).
3. Archive this repository, or keep it as the pre-release channel.

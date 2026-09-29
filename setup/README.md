# Set up Aspen Code

This page is written for **Claude Code or Codex** to follow. It installs the `aspen-code` plugin
and the Aspen CLI, and gets the user signed in. A person can follow it too.

**Give your agent this prompt** (start `claude` or `codex` in the folder where your Aspen project
should live, e.g. `~/Aspen`):

```text
Read the Aspen Code setup guide — run `gh api repos/aspen-crm/aspen-code/contents/setup/README.md -H "Accept: application/vnd.github.raw"` — and follow it. My Aspen instance is https://<host>/<domain>/<instance>.
```

> Access: `aspen-crm/aspen-code` is private during testing. You need read access to it, and git
> credentials for GitHub in your terminal (`gh auth login`).

---

## For the agent

Follow the steps in order. Each step ends with a check; run it. Ask before anything that installs
software or changes the user's configuration, and say what it will do. Never ask for, type, or
print a password, token or API key.

First work out two things:
- **The host:** Claude Code (`CLAUDECODE` is set) or Codex (`CODEX_THREAD_ID` or `CODEX_SANDBOX`
  is set). If unsure, ask.
- **The OS:** macOS/Linux, or Windows (PowerShell).

Get the **instance URL** from the prompt, or ask for it: `https://<host>/<domain>/<instance>`,
the instance's address in the browser up to the instance name.

### 1. Check access to the plugin repository

```sh
git ls-remote https://github.com/aspen-crm/aspen-code.git HEAD
```

If this fails, stop. The user needs read access to `aspen-crm/aspen-code`, and GitHub credentials
in their terminal (`gh auth login`, then `gh auth setup-git`). Say so, and wait.

### 2. Remove the production plugin, if it is installed

The production `aspen-code@aspen` (from `aspen-crm/aspen-tools`) defines skills with the same
names. With both installed, the model gets two sets of Aspen instructions.

| Host | Check | Remove (ask first) |
|---|---|---|
| Claude Code | `claude plugin list` shows `aspen-code@aspen` | `claude plugin uninstall aspen-code@aspen` |
| Codex | `codex plugin list` shows `aspen-code@aspen` | `codex plugin remove aspen-code@aspen` |

Remove only `aspen-code@aspen`. Leave `aspen-cowork@aspen` and the `aspen` marketplace alone —
removing a marketplace uninstalls everything from it.

### 3. Install the plugin

| Host | Commands |
|---|---|
| Claude Code | `claude plugin marketplace add aspen-crm/aspen-code` then `claude plugin install aspen-code@aspen-code` |
| Codex | `codex plugin marketplace add aspen-crm/aspen-code` then `codex plugin add aspen-code@aspen-code` |

**Check:** `claude plugin list` (or `codex plugin list`) shows `aspen-code@aspen-code` at 0.0.1 or
later, enabled.

Already installed? Update it: `claude plugin marketplace update aspen-code` (Claude Code) or
`codex plugin marketplace upgrade aspen-code` (Codex).

### 4. Install or update the Aspen CLI

Is it installed? Check with `aspen --version`, or by its full path `~/.aspen/bin/aspen --version`
(Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).

**Installed:** update it. It prints "already the promoted release" when there's nothing to do.

```sh
~/.aspen/bin/aspenup self update
```

**Not installed:** tell the user it downloads from `static-assets.veevaxdev.com`, installs to
`~/.aspen`, and adds `~/.aspen/bin` to their shell's PATH. Then, with their go-ahead:

macOS / Linux:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://static-assets.veevaxdev.com/tooling/latest/cli/installer.sh | sh -s -- -y
```

Windows (PowerShell):

```powershell
irm https://static-assets.veevaxdev.com/tooling/latest/cli/installer.ps1 | iex
```

If the host refuses to run the installer, hand the user the command for their OS and ask them
to run it in their own terminal. Then wait.

**Check:** `~/.aspen/bin/aspen --version` prints a version. This session's PATH predates the
install, so use the full path for the rest of this session.

### 5. Sign in — the user does this

`aspen login` signs in with OAuth in a browser. The CLI refuses to run it from an agent, so
**don't run it yourself, and don't suggest an API key.** Give the user this, filled in, and wait:

> In your own terminal (VS Code: **Terminal → New Terminal**), run:
>
> ```
> aspen login -i https://<host>/<domain>/<instance>
> ```
>
> A browser opens; sign in to the instance and approve. Come back when it says "Login succeeded".

**Check:** the `instance` field of `~/.config/aspen/credentials.json` (Windows:
`%APPDATA%\aspen\credentials.json`) names that instance. Read only that field; the file never
holds the secret, which is in the OS keychain.

### 6. Restart, then the first prompt

The plugin loads when a session starts, so tell the user:

1. **Restart** Claude Code or Codex in the same folder.
   - **Codex:** when asked, review and **trust** the Aspen Code hooks. They run the setup checks
     and make sure every `aspen` command uses the right CLI, folder and instance.
2. Send this as the first prompt:

   ```text
   Set me up to build on my Aspen instance at https://<host>/<domain>/<instance>.
   ```

The plugin takes it from there:
- **Creates the instance folder** with `aspen init`, asking where it should go.
- **Installs the build dependencies:** the Rust toolchain and crates, Node, and the npm packages,
  showing the plan and asking first.
- **Checks everything** with `aspen doctor`.

Then **open a new session inside that instance folder** (`<domain>_<instance>`) and describe the
change you want, e.g. *"Add a renewal date and an auto-renew flag to accounts, and show them on the
account layout."*

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `marketplace add` fails with a 404 or an authentication error | No access to the private repo, or no git credentials: see step 1 |
| Two copies of each Aspen skill | The production `aspen-code@aspen` is still installed: step 2 |
| `aspen: command not found` right after installing | Use `~/.aspen/bin/aspen`, or restart the terminal |
| `aspen login` says "Interactive login is not supported" | It was run by the agent. The user runs it in their own terminal |
| npm fails with `E401` / "Unable to authenticate" | npm is pointed at a private mirror. When the plugin asks, let it use the public registry |
| Go back to production | `claude plugin uninstall aspen-code@aspen-code`, then `claude plugin install aspen-code@aspen`. Codex: `codex plugin remove aspen-code@aspen-code`, then `codex plugin add aspen-code@aspen` |

# Set up Aspen Code

This page is written for **Claude Code or Codex** to follow. It installs the `aspen-code` plugin
and the Aspen CLI, and gets the user signed in. A person can follow it too.

**Give your agent this prompt** (start `claude` or `codex` in the folder where your Aspen project
should live, e.g. `~/Aspen`):

```text
Run `curl -fsSL https://raw.githubusercontent.com/aspen-crm/aspen-code/main/setup/README.md` (use curl.exe on Windows), read the whole document, and follow its setup steps. My Aspen instance is https://<host>/<domain>/<instance>.
```

`git` is recommended but not required. Without it, Claude Code installs the plugin from its
release zip, and Codex from a downloaded copy.

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

### 1. Choose where the plugin comes from

Run `git --version`. If git is missing, suggest installing it (`xcode-select --install` on macOS,
`winget install --id Git.Git -e` on Windows, the distribution's package on Linux), but carry on
without it if the user would rather not. Pick the marketplace `<source>` for step 3:

| Host | With git | Without git |
|---|---|---|
| Claude Code | `aspen-crm/aspen-code` | `https://raw.githubusercontent.com/aspen-crm/aspen-code/main/setup/marketplace.json` |
| Codex | `aspen-crm/aspen-code` | `~/.aspen-code`, after the download below |

**Codex without git only:** download the plugin (it fetches only from `github.com`).

macOS / Linux:

```sh
rm -rf ~/.aspen-code && mkdir -p ~/.aspen-code && curl -fsSL https://github.com/aspen-crm/aspen-code/archive/refs/heads/main.tar.gz | tar -xz -C ~/.aspen-code --strip-components=1
```

Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force "$HOME\.aspen-code" -ErrorAction SilentlyContinue; New-Item -ItemType Directory "$HOME\.aspen-code" | Out-Null; curl.exe -fsSL -o "$env:TEMP\aspen-code.tar.gz" https://github.com/aspen-crm/aspen-code/archive/refs/heads/main.tar.gz; tar -xzf "$env:TEMP\aspen-code.tar.gz" -C "$HOME\.aspen-code" --strip-components=1
```

**Check:** `~/.aspen-code/.claude-plugin/marketplace.json` exists. If the download fails, it's
network or proxy trouble. Say so and stop.

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
| Claude Code | `claude plugin marketplace add <source>` then `claude plugin install aspen-code@aspen-code` |
| Codex | `codex plugin marketplace add <source>` then `codex plugin add aspen-code@aspen-code` |

`<source>` is the one you picked in step 1.

**Check:** `claude plugin list` (or `codex plugin list`) shows `aspen-code@aspen-code` at 0.0.2 or
later, enabled.

Already installed? Update it: `claude plugin update aspen-code@aspen-code` (Claude Code) or
`codex plugin marketplace upgrade aspen-code` (Codex). Codex installed from the download? Re-run
the step 1 download first.

### 4. Install or update the Aspen CLI

Is it installed? Check with `aspen --version`, or by its full path `~/.aspen/bin/aspen --version`
(Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).

**Installed:** update it. It prints "already the promoted release" when there's nothing to do.

```sh
~/.aspen/bin/aspenup self update
```

**Not installed:** tell the user it downloads from `static-assets.veevaxdev.com` and installs to
`~/.aspen`. It leaves their shell profile alone. Then, with their go-ahead:

macOS / Linux:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://static-assets.veevaxdev.com/tooling/latest/cli/installer.sh | sh -s -- -y --no-modify-path
```

Windows (PowerShell):

```powershell
irm https://static-assets.veevaxdev.com/tooling/latest/cli/installer.ps1 -OutFile "$env:TEMP\aspenup-installer.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\aspenup-installer.ps1" -NoModifyPath -Yes
```

If the host refuses to run the installer, hand the user the command for their OS and ask them
to run it in their own terminal. Then wait.

**Check:** `~/.aspen/bin/aspen --version` prints a version. This session's PATH predates the
install, so use the full path for the rest of this session.

**Ask the user to put it on their PATH.** Don't edit their shell profile yourself. Give them the
line to add: `. "$HOME/.aspen/env"` in `~/.zshrc` (zsh) or `~/.bashrc` (bash; `~/.bash_profile` on
macOS), `source "$HOME/.aspen/env.fish"` in `~/.config/fish/config.fish` (fish). On Windows, give
them the change the installer printed. New terminals then find `aspen`.

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

### 6. Load the plugin, then the first prompt

No restart is needed. Tell the user:

1. **Load the plugin** into this session:
   - **Claude Code:** type `/reload-plugins`.
   - **Codex:** type `/new` to start a new thread, which picks up the plugin. When asked, review
     and **trust** the Aspen Code hooks. They run the setup checks and make sure every `aspen`
     command uses the right CLI, folder and instance.
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
| `marketplace add` fails | With `aspen-crm/aspen-code`: git is missing or GitHub is unreachable; use the without-git source in step 1. Otherwise GitHub is unreachable from this network |
| Two copies of each Aspen skill | The production `aspen-code@aspen` is still installed: step 2 |
| `aspen: command not found` right after installing | Use `~/.aspen/bin/aspen`, or add the PATH line from step 4 and open a new terminal |
| `aspen login` says "Interactive login is not supported" | It was run by the agent. The user runs it in their own terminal |
| npm fails with `E401` / "Unable to authenticate" | `typescript/package-lock.json` was resolved through a private mirror. When the plugin asks, let it delete the lockfile and `node_modules` and re-install from public npm |
| Go back to production | `claude plugin uninstall aspen-code@aspen-code`, then `claude plugin install aspen-code@aspen`. Codex: `codex plugin remove aspen-code@aspen-code`, then `codex plugin add aspen-code@aspen` |

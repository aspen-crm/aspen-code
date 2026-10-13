# Set up Aspen Code

This page is written for **Claude Code or Codex** to follow. It installs the `aspen-code` plugin
and the Aspen CLI, and gets the user signed in. A person can follow it too.

**Give your agent this prompt** (start `claude` or `codex` in the folder where your Aspen project
should live, e.g. `~/Aspen`):

```text
Run `curl -fsSL https://raw.githubusercontent.com/aspen-crm/aspen-code/main/setup/README.md` (use curl.exe on Windows), read the whole document, and follow its setup steps. Ask me for my Aspen instance URL when you need it.
```

---

## For the agent

Follow the steps in order. Each step ends with a check; run it. Ask before anything that installs
software or changes the user's configuration, and say what it will do. Never ask for, type, or
print a password, token or API key.

First work out two things:
- **The host:** Claude Code (`CLAUDECODE` is set) or Codex (`CODEX_THREAD_ID` or `CODEX_SANDBOX`
  is set). If unsure, ask.
- **The OS:** macOS/Linux, or Windows (PowerShell).

**Ask for the instance URL** unless the user already gave it: `https://<host>/<domain>/<instance>`,
the instance's address in the browser up to the instance name. Ask once, early — the CLI download
(step 2) and sign-in both need it.

### 1. Install the plugin

| Host | Commands |
|---|---|
| Claude Code | `claude plugin marketplace add https://raw.githubusercontent.com/aspen-crm/aspen-code/main/setup/marketplace.json` then `claude plugin install aspen-code@aspen-code` |
| Codex | `codex plugin marketplace add aspen-crm/aspen-code` then `codex plugin add aspen-code@aspen-code` |

**Codex, if `marketplace add` fails because git is missing:** download the plugin (it fetches
only from `github.com`), then run the Codex commands with `~/.aspen-code` in place of
`aspen-crm/aspen-code`.

macOS / Linux:

```sh
rm -rf ~/.aspen-code && mkdir -p ~/.aspen-code && curl -fsSL https://github.com/aspen-crm/aspen-code/archive/refs/heads/main.tar.gz | tar -xz -C ~/.aspen-code --strip-components=1
```

Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force "$HOME\.aspen-code" -ErrorAction SilentlyContinue; New-Item -ItemType Directory "$HOME\.aspen-code" | Out-Null; curl.exe -fsSL -o "$env:TEMP\aspen-code.tar.gz" https://github.com/aspen-crm/aspen-code/archive/refs/heads/main.tar.gz; tar -xzf "$env:TEMP\aspen-code.tar.gz" -C "$HOME\.aspen-code" --strip-components=1
```

If the download fails, it's network or proxy trouble. Say so and stop.

**Check:** `claude plugin list` (or `codex plugin list`) shows `aspen-code@aspen-code` at 0.0.15 or
later, enabled. If the list also shows `aspen-code@aspen`, an older copy with the same skill names,
ask to remove it: `claude plugin uninstall aspen-code@aspen` (Codex: `codex plugin remove
aspen-code@aspen`). Remove only that plugin; removing the `aspen` marketplace uninstalls everything
from it.

Already installed? Update it. Each release carries a new version number, which is what an update
fetches.

| Host | Commands |
|---|---|
| Claude Code | `claude plugin marketplace update aspen-code`, then `claude plugin update aspen-code@aspen-code` |
| Codex | `codex plugin marketplace upgrade aspen-code` |

If an update reports "already at the latest version" but the version is older than the latest
release, reinstall: `claude plugin uninstall aspen-code@aspen-code`, then `claude plugin install
aspen-code@aspen-code` (Codex: `codex plugin remove`, then `codex plugin add`).

Codex installed from the download? Re-run the download first, in place of the upgrade.
Restart Claude Code or Codex afterwards.

### 2. Install or update the Aspen CLI

**The CLI comes from the instance's environment.** Each environment has its own download host,
`<cdn>` = `https://static-assets.<app domain>`, where the app domain is the last two labels of the
instance URL's host:

| Instance URL | `<cdn>` |
|---|---|
| `https://0000-01-0101-ip.veevaxdev.com/acme.com/dev` | `https://static-assets.veevaxdev.com` |
| `https://acme.aspen-crm2.com/acme.com/prod` | `https://static-assets.aspen-crm2.com` |

The CLI only fetches toolchains from the host it was installed from, so a copy installed from
another environment can't serve this instance. If the host doesn't end in an Aspen domain (a
custom domain), ask the user which `static-assets.` host their environment uses.

Is it installed? Check with `aspen --version`, or by its full path `~/.aspen/bin/aspen --version`
(Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).

**Installed:** check where it came from: `~/.aspen/bin/aspenup show` prints a `cdn:` line.
- It is `<cdn>`: update it. It prints "already the promoted release" when there's nothing to do.

  ```sh
  ~/.aspen/bin/aspenup self update
  ```
- It names another host: it was installed from a different environment. Tell the user, and with
  their go-ahead re-run the installer below from `<cdn>`, which re-points it.

**Not installed:** tell the user it downloads from `<cdn>` (filled in) and installs to `~/.aspen`.
It leaves their shell profile alone. Then, with their go-ahead, run it with `<cdn>` filled in:

macOS / Linux:

```sh
curl --proto '=https' --tlsv1.2 -LsSf <cdn>/tooling/latest/cli/installer.sh | sh -s -- -y --no-modify-path
```

Windows (PowerShell):

```powershell
irm <cdn>/tooling/latest/cli/installer.ps1 -OutFile "$env:TEMP\aspenup-installer.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\aspenup-installer.ps1" -NoModifyPath -Yes
```

If the host refuses to run the installer, hand the user the command for their OS and ask them
to run it in their own terminal. Then wait.

**Check:** `~/.aspen/bin/aspen --version` prints a version. This session's PATH predates the
install, so use the full path for the rest of this session.

**Ask the user to put it on their PATH.** Don't edit their shell profile yourself. Give them the
line to add: `. "$HOME/.aspen/env"` in `~/.zshrc` (zsh) or `~/.bashrc` (bash; `~/.bash_profile` on
macOS), `source "$HOME/.aspen/env.fish"` in `~/.config/fish/config.fish` (fish). On Windows, give
them the change the installer printed. New terminals then find `aspen`.

### 3. Sign in — you run it, the user approves

`aspen login` signs in with OAuth in a browser. Under an agent the CLI refuses it unless told the
user is there to approve: `--agent no` and `ASPEN_INTERACTIVE=1` say so, for this one command.
**Never use an API key.** Tell the user a browser will open for them to sign in and approve, then
run this, filled in, with a timeout of at least 6 minutes (the CLI waits up to 5):

macOS / Linux:

```sh
ASPEN_INTERACTIVE=1 ~/.aspen/bin/aspen login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring
```

Windows (PowerShell):

```powershell
$env:ASPEN_INTERACTIVE='1'; & "$HOME\.aspen\bin\aspen.exe" login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring; Remove-Item Env:ASPEN_INTERACTIVE
```

If the browser doesn't open, give the user the URL the CLI prints. It ends with "Login
succeeded". If it fails because the machine has no keychain (headless Linux), give the user
`aspen login -i <url>` to run in their own terminal (VS Code: **Terminal → New Terminal**) and
wait.

**Check:** the `instance` field of `~/.config/aspen/credentials.json` (Windows:
`%APPDATA%\aspen\credentials.json`) names that instance. Read only that field; the secret is in
the OS keychain, or in this file only if the user chose file storage.

### 4. Load the plugin, then the first prompt

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

- **Moves the session** into the new instance folder (`<domain>_<instance>`). If that folder is
  outside the one the session started in, open a new session there.

Then describe the change you want, e.g. *"Add
a renewal date and an auto-renew flag to accounts, and show them on the account layout."*

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `marketplace add` fails | Codex without git: use the download in step 1. Otherwise GitHub is unreachable from this network |
| Two copies of each Aspen skill | The production `aspen-code@aspen` is still installed: remove it (step 1's check) |
| `aspen: command not found` right after installing | Use `~/.aspen/bin/aspen`, or add the PATH line from step 2 and open a new terminal |
| `aspen login` says "Interactive login is not supported" | It ran under an agent without `--agent no` and `ASPEN_INTERACTIVE=1`: use the step 3 command |
| npm fails with `E401` / "Unable to authenticate" | `typescript/package-lock.json` was resolved through a private mirror. When the plugin asks, let it delete the lockfile and `node_modules` and re-install from public npm |
| Go back to production | `claude plugin uninstall aspen-code@aspen-code`, then `claude plugin install aspen-code@aspen`. Codex: `codex plugin remove aspen-code@aspen-code`, then `codex plugin add aspen-code@aspen` |

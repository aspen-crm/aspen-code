---
name: getting-started
description: Use when the aspen CLI is not installed or out of date, not signed in, signed in to the wrong instance, there is no instance directory yet, or its build dependencies (Rust toolchain, crates, Node, npm packages) are missing — on a fresh machine, a first session, or when the session-start note says so. Installs or updates the CLI (with consent), runs the OAuth sign-in the user approves in the browser, creates the instance directory with aspen init, installs its dependencies, and checks it with aspen doctor.
---

# Getting started

Six steps, each ending in a check you run. Do them in order and stop at the first one that is
already done — the session-start note usually says which.

## 1. Install or update the CLI — with consent

**Already installed? Update it, don't skip it** — a found CLI is often behind the promoted release:

```sh
aspenup self update     # the launcher → the promoted release; prints "already the promoted release" when current
aspenup update          # in an instance directory: the aspen toolchain that instance serves
```

The launcher and the toolchain are separate. `self update` never changes which `aspen` runs; in
an instance directory the proxy runs the toolchain that instance serves, and `aspenup update`
refreshes that answer. Don't install a newer toolchain than the instance serves — that is the
mismatch `aspen doctor` reports as `instance.cli-matches-instance`. Say what changed (the versions
before and after), then go to step 2.

Not installed:

The CLI ships as **aspenup**, a launcher that installs `aspen` and `aspenc` and later fetches the
toolchain each instance serves — always from the environment it was installed from. So install it
from **the instance's environment**: `<cdn>` = `https://static-assets.<app domain>`, the app domain
being the last two labels of the instance URL's host (`https://abc.aspen-crm2.com/acme.com/dev` →
`https://static-assets.aspen-crm2.com`). Ask for the instance URL first if you don't have it; for a
custom-domain host, ask the user for their environment's `static-assets.` host.

An existing install from another environment can't serve this instance: `aspenup show` prints its
`cdn:`. If that isn't `<cdn>`, tell the user and, with consent, re-run the installer below.

Tell the user what it does (downloads from `<cdn>`, filled in; installs to `~/.aspen`) and **ask
before running it**, with `<cdn>` filled in:

macOS / Linux:

```sh
curl --proto '=https' --tlsv1.2 -LsSf <cdn>/tooling/latest/cli/installer.sh | sh -s -- -y --no-modify-path
```

Windows (PowerShell):

```powershell
irm <cdn>/tooling/latest/cli/installer.ps1 -OutFile "$env:TEMP\aspenup-installer.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\aspenup-installer.ps1" -NoModifyPath -Yes
```

`-y` skips the installer's own confirmation, which cannot be answered from your shell — the user's
consent to you is the confirmation. `--no-modify-path` leaves the user's shell profile alone: that
file is theirs to change, not yours.

**If the host blocks it** (a permission prompt the user declines, or a security classifier), stop
— no workarounds. Hand them the command for their OS and say: *run this in a terminal (VS Code:
Terminal → New Terminal), then tell me when it finishes.*

**Check:** `~/.aspen/bin/aspen --version` (Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).
This session's PATH predates the install, so use that full path for the rest of the session.

**Then ask the user to put it on their PATH.** Never edit a shell profile yourself. Give them the
line for their shell to add in their own editor; new terminals then find `aspen`:

| Shell | File | Line |
|---|---|---|
| zsh | `~/.zshrc` | `. "$HOME/.aspen/env"` |
| bash | `~/.bashrc` (macOS: `~/.bash_profile`) | `. "$HOME/.aspen/env"` |
| fish | `~/.config/fish/config.fish` | `source "$HOME/.aspen/env.fish"` |
| PowerShell | user `Path` | the change the installer printed |

If they would rather not, the full path works everywhere.

## 2. Sign in — you run it, the user approves in the browser

`aspen login` is OAuth in a browser. Under an agent it refuses ("Interactive login is not
supported (an agent is driving this invocation)") unless told the user is there to approve:
`--agent no` overrides the agent detection for that one command, and `ASPEN_INTERACTIVE=1` the
terminal detection. **Never pass `--api-key`/`-k`** — this plugin never handles a secret. The
guard hook refuses any other shape of `aspen login`.

Ask for the instance URL if you do not have it — it looks like
`https://<host>/<domain>/<instance>`, the address of the instance in the browser minus anything
after the instance name. Tell the user: *a browser will open — sign in to the instance and
approve.* Then run it, filled in, with a timeout of at least 6 minutes (the CLI waits up to 5 for
the approval). Use the full path from step 1 if `aspen` is not on this session's PATH.

macOS / Linux:

```sh
ASPEN_INTERACTIVE=1 aspen login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring
```

Windows (PowerShell):

```powershell
$env:ASPEN_INTERACTIVE='1'; aspen login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring; Remove-Item Env:ASPEN_INTERACTIVE
```

- **The browser didn't open:** the CLI prints "Open this URL to log in…". Give the user that URL;
  it carries no secret.
- **"Login succeeded"** ends it. The token goes from the browser to the CLI and the OS keyring;
  you never see it. Don't add `--debug`.
- **No keyring** (a headless Linux box): `--credential-store keyring` fails rather than ask about
  a file, a question you cannot answer. Hand the user `aspen login -i <url>` to run in their own
  terminal (VS Code: **Terminal → New Terminal**), where the CLI can ask them, and wait for "Login
  succeeded".
- **Denied or timed out:** say so and offer to run it again.

The CLI holds **one login at a time** — signing in to another instance replaces the current one.
Say so before you sign in while it is signed in elsewhere.

**Check:** `aspen doctor` in the instance directory reports `instance.logged-in` and
`instance.credential-accepted` as `ok`. Before a directory exists, read the `instance` field of
`~/.config/aspen/credentials.json` (Windows: `%APPDATA%\aspen\credentials.json`) — it names the
instance, and holds no secret unless the user chose file storage. Read only that field.

## 3. Create the instance directory — `aspen init`

What it creates is in the *Aspen CLI Developer Guide* (`aspen-docs`). What matters here:

- It needs the login, and it creates the directory, named after the instance, **under** the one
  you give it. **Ask where it should go** (e.g. `~/Aspen`), then `aspen init --dir ~/Aspen`, which
  creates `~/Aspen/<domain>_<instance>` — `<dir>` in the steps below.
- It refuses only when that instance-named folder already holds files and no
  `.aspen/config.toml`; the parent may hold anything. It never overwrites a file you authored. Run
  again from **inside** an instance directory, it completes a fresh clone or refreshes the fetched
  `platform/` and `active/` layers.
- Don't move the session there yet. Steps 4 and 5 take `<dir>` as an argument, and step 6 moves
  it.

**Check:** `.aspen/config.toml` names the instance you signed in to.

## 4. Install the project's dependencies — right after `aspen init`

`aspen init` installs nothing. Building needs the Rust toolchain the crate pins (with
`wasm32-wasip2`) and its crates, and a Node that satisfies the UI tooling (`^24.11.1`, npm
`^11.6.2`) plus `typescript/`'s packages. The bundled script does all of it. Resolve it from the
absolute directory holding this `SKILL.md`, and pass it the instance directory (it defaults to the
one the working directory sits in):

```sh
node "<this skill's dir>/scripts/install-deps.mjs" <dir>             # the plan; changes nothing
node "<this skill's dir>/scripts/install-deps.mjs" <dir> --run       # install the project's dependencies
node "<this skill's dir>/scripts/install-deps.mjs" <dir> --run --machine   # also rustup / Node for this user
```

1. **Show the user the plan** and ask to install. It has two kinds of step, and they need
   separate consent:
   - *project* — a pinned Rust toolchain, `cargo fetch --locked`, and `npm ci`/`npm install` in
     `typescript/`: writes inside the instance directory and the user's package caches.
   - *machine* — rustup (rustup.rs, or winget on Windows) and Node (via nvm, fnm, winget or
     Homebrew, whichever is present): installs a tool for the user. Name the tool and how.
2. **Run it** with `--run`, adding `--machine` only when the user agreed to the machine steps.
   Exit 0 means everything is installed; 3 means it stopped at a machine step it was not allowed to
   do (or one it cannot do, printed as `manual` — hand the user that one); 1 means a step failed.
3. **npm registry.** The script installs from public npm (`registry.npmjs.org`), where the Aspen
   packages are, whatever the user's `.npmrc` names — so a corporate mirror they are not signed in
   to doesn't matter. Don't edit the user's `.npmrc`. If npm fails, the result says why: a
   network that only reaches a mirror → re-run with `--configured-registry`; a `package-lock.json`
   resolved through a mirror → ask, then delete it and `typescript/node_modules` and re-run.
4. `npm install` writes `typescript/package-lock.json` the first time — suggest committing it.
5. On macOS/Linux rustup installs with `--no-modify-path`. If the run installed it, ask the user to add
   `. "$HOME/.cargo/env"` to their shell profile (fish: `source "$HOME/.cargo/env.fish"`); never edit
   it yourself. A tool installed during the run is never on this session's PATH, and the script finds
   rustup in `~/.cargo/bin` itself. On Windows, Rust also needs the Visual Studio C++ Build Tools —
   the script cannot install those; say so.

## 5. Check the directory — `aspen doctor`

```sh
aspen doctor --dir <dir>   # JSON under an agent; one {id, section, status, message, fix?} per finding
```

Exit 1 means at least one `problem`. After step 4 every `toolchain.*`, `rust.*` and
`typescript.*` check should be `ok`, except two warnings that stay until the first build:
`rust.component-built` and `typescript.bundle-built`. If a dependency check still fails, re-run the
script — it re-checks and does only what is missing.

Not fine, stop and tell the user:

- `instance.cli-matches-instance` — the CLI and the instance are on different releases. See
  `diagnose` → version skew.
- `configuration.record-matches-login` — signed in to a different instance than this directory's.
  Back to step 2 with this directory's URL.

## 6. Move into the new directory

Only when step 3 created a new instance directory. Every `aspen` command runs from inside it, so
`cd <dir>` — don't ask — and tell the user the session is now there. Suggest `git init` and a
first commit.

**Check:** `pwd` in a separate command prints `<dir>`. If it doesn't, the host keeps the session
in the folder it started in (Claude Code does when `<dir>` is outside it): tell the user to
reopen the host in `<dir>` (VS Code: **File → Open Folder**) before building.

Then hand off to `using-aspen`.

## Safety

- Consent before installing, and before anything that writes to the instance.
- Never type, echo, ask for, or read a credential.
- Components created while testing can't be deleted yet. On a shared instance, keep them few and
  clearly named.

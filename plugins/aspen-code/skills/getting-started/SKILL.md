---
name: getting-started
description: Use when the aspen CLI is missing or out of date, not signed in or signed in to the wrong instance, there is no instance directory yet, or its build dependencies (Rust toolchain, crates, Node, npm packages) are missing — a fresh machine, a first session, or when the session-start note says so.
---

# Getting started

Six steps, each ending in a check. Start at the first one not yet done; the session-start note
usually says which.

## 1. Install or update the CLI — with consent

**Installed already: update it**, since a found CLI is often behind the promoted release:

```sh
aspenup self update     # the launcher → the promoted release ("already the promoted release" when current)
aspenup update          # in an instance directory: the aspen toolchain that instance serves
```

`self update` never changes which `aspen` runs; in an instance directory the proxy runs the
toolchain that instance serves. Don't install a newer toolchain than the instance serves — that is
the `instance.cli-matches-instance` mismatch. Report the versions before and after, then step 2.

**Not installed:** the CLI ships as **aspenup**, a launcher that installs `aspen` and `aspenc` and
later fetches each instance's toolchain, always from the environment it was installed from. So
install from the instance's environment: `<cdn>` = `https://static-assets.<app domain>`, the app
domain being the last two labels of the instance host (`https://abc.aspen-crm2.com/acme.com/dev` →
`https://static-assets.aspen-crm2.com`). Ask for the instance URL if you don't have it; for a
custom-domain host, ask for their `static-assets.` host. An existing install whose `aspenup show`
prints another `cdn:` can't serve this instance — tell the user and, with consent, reinstall.

Say what it does (downloads from `<cdn>`, installs to `~/.aspen`) and **ask before running it**:

```sh
curl --proto '=https' --tlsv1.2 -LsSf <cdn>/tooling/latest/cli/installer.sh | sh -s -- -y --no-modify-path
```

```powershell
irm <cdn>/tooling/latest/cli/installer.ps1 -OutFile "$env:TEMP\aspenup-installer.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\aspenup-installer.ps1" -NoModifyPath -Yes
```

`-y` answers the installer's own prompt (the user's consent to you is the confirmation);
`--no-modify-path` leaves the shell profile to the user. If the host blocks the command, don't work
around it: give the user the command for their OS to run in a terminal and wait for them.

**Check:** `~/.aspen/bin/aspen --version` (Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).
This session's PATH predates the install, so use that full path for the rest of the session.

Then give the user the line to add to their shell profile (never edit it yourself); the full path
works without it:

| Shell | File | Line |
|---|---|---|
| zsh | `~/.zshrc` | `. "$HOME/.aspen/env"` |
| bash | `~/.bashrc` (macOS: `~/.bash_profile`) | `. "$HOME/.aspen/env"` |
| fish | `~/.config/fish/config.fish` | `source "$HOME/.aspen/env.fish"` |
| PowerShell | user `Path` | the change the installer printed |

## 2. Sign in — you run it, the user approves in the browser

`aspen login` is OAuth in a browser. Under an agent it refuses ("Interactive login is not
supported (an agent is driving this invocation)") unless told the user is there: `--agent no`
overrides the agent detection for that command, `ASPEN_INTERACTIVE=1` the terminal detection.
Never pass `--api-key`/`-k`; the guard hook refuses any other shape of `aspen login`.

The instance URL looks like `https://<host>/<domain>/<instance>` (the browser address minus
anything after the instance name). Tell the user a browser will open for them to sign in and
approve, then run it with a timeout of at least 6 minutes (the CLI waits up to 5):

```sh
ASPEN_INTERACTIVE=1 aspen login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring
```

```powershell
$env:ASPEN_INTERACTIVE='1'; aspen login -i https://<host>/<domain>/<instance> --agent no --credential-store keyring; Remove-Item Env:ASPEN_INTERACTIVE
```

- **No browser opened:** give the user the "Open this URL to log in…" URL it printed; it holds no
  secret.
- **"Login succeeded"** ends it; the token went to the OS keyring. Don't add `--debug`.
- **No keyring** (headless Linux): it fails rather than ask about a file. Have the user run
  `aspen login -i <url>` in their own terminal, where the CLI can ask them.
- **Denied or timed out:** say so and offer to run it again.

The CLI holds one login at a time; say so before signing in while it is signed in elsewhere.

**Check:** `aspen doctor` in the instance directory reports `instance.logged-in` and
`instance.credential-accepted` as `ok`. Before a directory exists, read only the `instance` field
of `~/.config/aspen/credentials.json` (Windows: `%APPDATA%\aspen\credentials.json`).

## 3. Create the instance directory — `aspen init`

It needs the login and creates a folder named after the instance **under** the directory you give
it. Ask where (e.g. `~/Aspen`), then `aspen init --dir ~/Aspen`, which creates
`~/Aspen/<domain>_<instance>` — `<dir>` below. It refuses only when that folder already holds files
and no `.aspen/config.toml`, and never overwrites a file you authored; run again from inside an
instance directory, it completes a fresh clone or refreshes `platform/` and `active/`. The layout
is in the *Aspen CLI Developer Guide* (`aspen-docs`). Stay where you are until step 6.

**Check:** `.aspen/config.toml` names the instance you signed in to.

## 4. Install the project's dependencies

`aspen init` installs nothing. Building needs the Rust toolchain the crate pins (with
`wasm32-wasip2`) and its crates, and Node `^24.11.1` / npm `^11.6.2` plus `typescript/`'s
packages. The bundled script, resolved from this skill's directory, does all of it:

```sh
node "<this skill's dir>/scripts/install-deps.mjs" <dir>                   # the plan; changes nothing
node "<this skill's dir>/scripts/install-deps.mjs" <dir> --run             # the project's dependencies
node "<this skill's dir>/scripts/install-deps.mjs" <dir> --run --machine   # also rustup / Node for this user
```

1. **Show the user the plan.** Its two kinds of step need separate consent: *project* (pinned Rust
   toolchain, `cargo fetch --locked`, `npm ci`/`npm install` in `typescript/`) and *machine*
   (rustup via rustup.rs or winget; Node via nvm, fnm, winget or Homebrew — name the tool and how).
2. **Run it** with `--run`, plus `--machine` only if the user agreed to those steps. Exit 0: all
   installed; 3: stopped at a machine step it wasn't allowed to do, or one printed `manual` (hand
   that to the user); 1: a step failed.
3. **npm** installs from public `registry.npmjs.org` whatever the user's `.npmrc` says; never edit
   `.npmrc`. If npm fails: a network that reaches only a mirror → `--configured-registry`; a
   `package-lock.json` resolved through a mirror → ask, then delete it and `typescript/node_modules`
   and re-run.
4. The first `npm install` writes `typescript/package-lock.json` — suggest committing it.
5. rustup installs with `--no-modify-path`; if the run installed it, ask the user to add
   `. "$HOME/.cargo/env"` to their profile (fish: `source "$HOME/.cargo/env.fish"`). The script
   finds rustup in `~/.cargo/bin` itself. On Windows, Rust also needs the Visual Studio C++ Build
   Tools, which the script can't install; say so.

## 5. Check the directory — `aspen doctor`

```sh
aspen doctor --dir <dir>   # one {id, section, status, message, fix?} per finding
```

After step 4 every `toolchain.*`, `rust.*` and `typescript.*` check is `ok` except
`rust.component-built` and `typescript.bundle-built`, which warn until the first build, and
`typescript.sdk-pins` once the SDK is pinned to the CDN (`using-aspen` known issues). A failing
dependency check: re-run the script, which does only what is missing. Stop and tell the user on:

- `instance.cli-matches-instance` — CLI and instance on different releases (`diagnose`).
- `configuration.record-matches-login` — signed in to another instance; back to step 2 with this
  directory's URL.

## 6. Move into the new directory

Only when step 3 created one: `cd <dir>`, tell the user the session is there, and suggest
`git init` and a first commit. **Check:** `pwd` in a separate command prints `<dir>`. If not, the
host keeps the session where it started (Claude Code does when `<dir>` is outside it): ask the user
to reopen the host in `<dir>` before building.

Then `using-aspen`. Components created while testing can't be deleted yet: on a shared instance,
keep them few and clearly named.

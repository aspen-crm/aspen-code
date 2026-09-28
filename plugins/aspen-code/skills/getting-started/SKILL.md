---
name: getting-started
description: Use when the aspen CLI is not installed or out of date, not signed in, signed in to the wrong instance, there is no instance directory yet, or its build dependencies (Rust toolchain, crates, Node, npm packages) are missing — on a fresh machine, a first session, or when the session-start note says so. Installs or updates the CLI (with consent), hands the user the OAuth sign-in, creates the instance directory with aspen init, installs its dependencies, and checks it with aspen doctor.
---

# Getting started

Five steps, each ending in a check you run. Do them in order and stop at the first one that is
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
toolchain each instance serves. Tell the user what it does (downloads from
`static-assets.veevaxdev.com`, installs to `~/.aspen`, adds `~/.aspen/bin` to their shell PATH)
and **ask before running it**.

macOS / Linux:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://static-assets.veevaxdev.com/tooling/latest/cli/installer.sh | sh -s -- -y
```

Windows (PowerShell):

```powershell
irm https://static-assets.veevaxdev.com/tooling/latest/cli/installer.ps1 | iex
```

`-y` skips the installer's own confirmation, which cannot be answered from your shell — the user's
consent to you is the confirmation. Add `--no-modify-path` if they do not want rc files touched.

**If the host blocks it** (a permission prompt the user declines, or a security classifier), stop
— no workarounds. Hand them the command for their OS and say: *run this in a terminal (VS Code:
Terminal → New Terminal), then tell me when it finishes.*

**Check:** `~/.aspen/bin/aspen --version` (Windows: `& "$HOME\.aspen\bin\aspen.exe" --version`).
This session's PATH predates the install, so use that full path until the user restarts the host.

## 2. Sign in — the user does this, with OAuth

`aspen login` opens a browser for OAuth and refuses to run under an agent ("Interactive login is
not supported (an agent is driving this invocation)") or without a terminal. That is deliberate.
**Do not try to run it, and do not suggest `--api-key`** — this plugin never handles a secret.

Ask for the instance URL if you do not have it — it looks like
`https://<host>/<domain>/<instance>`, the address of the instance in the browser minus anything
after the instance name. Then give the user this, filled in, and wait:

> **About a minute, in your own terminal** (VS Code: **Terminal → New Terminal**; not the `!`
> prefix, which runs as the agent and is refused):
>
> ```
> aspen login -i https://<host>/<domain>/<instance>
> ```
>
> A browser opens; sign in to the instance and approve. Come back when the terminal says
> "Login succeeded".

The CLI holds **one login at a time** — signing in to another instance replaces the current one.
The token goes to the OS keyring; if there is none (a headless Linux box), the CLI asks the user
in their terminal before writing it to a file. You never see it either way.

**Check:** `aspen doctor` in the instance directory reports `instance.logged-in` and
`instance.credential-accepted` as `ok`. Before a directory exists, read the `instance` field of
`~/.config/aspen/credentials.json` (Windows: `%APPDATA%\aspen\credentials.json`) — it names the
instance and holds no secret. Read only that field.

## 3. Create the instance directory — `aspen init`

What it creates is in the *Aspen CLI Developer Guide* (`aspen-docs`). What matters here:

- It needs the login, and it names the directory after the instance. **Ask where it should go**
  (e.g. `~/Aspen`), then `aspen init --dir <there>`.
- It refuses a non-empty directory that is not already an instance directory, and never
  overwrites a file. Run again from **inside** an instance directory, it completes a fresh clone or
  refreshes the fetched `platform/` and `active/` layers.
- Afterwards the session should work **in** that directory: tell the user to reopen the host there
  (or `cd` for your commands, and say you did). Suggest `git init` and a first commit.

**Check:** `.aspen/config.toml` names the instance you signed in to.

## 4. Install the project's dependencies — right after `aspen init`

`aspen init` installs nothing. Building needs the Rust toolchain the crate pins (with
`wasm32-wasip2`) and its crates, and a Node that satisfies the UI tooling (`^24.11.1`, npm
`^11.6.2`) plus `typescript/`'s packages. The bundled script does all of it. Resolve it from the
absolute directory holding this `SKILL.md`, and run it from the instance directory:

```sh
node "<this skill's dir>/scripts/install-deps.mjs"             # the plan; changes nothing
node "<this skill's dir>/scripts/install-deps.mjs" --run       # install the project's dependencies
node "<this skill's dir>/scripts/install-deps.mjs" --run --machine   # also rustup / Node for this user
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
3. **npm can't authenticate** ("E401", "Unable to authenticate"): npm is pointed at a private
   registry (a corporate mirror) the user is not signed in to. The Aspen packages are on public
   npm — ask, then re-run with `--public-registry`. Don't edit the user's `.npmrc`.
4. `npm install` writes `typescript/package-lock.json` the first time — suggest committing it.
5. A rustup or Node installed during the run is not on this session's PATH until the user restarts
   the terminal/host; the script finds rustup in `~/.cargo/bin` itself. On Windows, Rust also needs
   the Visual Studio C++ Build Tools — the script cannot install those; say so.

## 5. Check the directory — `aspen doctor`

```sh
aspen doctor            # JSON under an agent; one {id, status, message, fix} per check
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

Then hand off to `using-aspen`.

## Safety

- Consent before installing, and before anything that writes to the instance.
- Never type, echo, ask for, or read a credential.
- Components and records created while testing are **permanent** on the platform — say so before
  the user starts on a shared instance.

---
name: getting-started
description: Use when the aspen CLI is not installed, not signed in, signed in to the wrong instance, or there is no instance directory yet — on a fresh machine, a first session, or when the session-start note says so. Installs the CLI (with consent), hands the user the OAuth sign-in, creates the instance directory with aspen init, and checks it with aspen doctor.
---

# Getting started

Four steps, each ending in a check you run. Do them in order and stop at the first one that is
already done — the session-start note usually says which.

## 1. Install the CLI — with consent

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

`aspen init` needs the login. It creates `<domain>_<instance>/` under the working directory (or
`--dir`), scaffolds `metadata/`, `rust/`, `typescript/`, `data/`, an `AGENTS.md` and a
`.gitignore`, and fetches `metadata/platform/` and `metadata/active/` from the instance.

- **Ask where it should go** (e.g. `~/Aspen`) before running it. It refuses a non-empty directory
  that is not already an instance directory, and it never overwrites a file.
- Run from **inside** an existing instance directory it completes that one — the safe way to
  restore a missing scaffold file or refresh the fetched layers.
- Afterwards, the session should work **in** that directory: tell the user to reopen the host
  there (or `cd` for your commands, and say you did).
- Suggest `git init` and a first commit: `metadata/custom/`, `rust/` and `typescript/` are the
  source; the `.gitignore` already excludes the fetched and compiled layers.

**Check:** `.aspen/config.toml` names the instance you signed in to.

## 4. Check the directory — `aspen doctor`

```sh
aspen doctor            # JSON under an agent; one {id, status, message, fix} per check
```

Exit 1 means at least one `problem`. Work the `remediation` list top down; each carries the exact
command. Expected on a fresh directory, and fine until you need that tier:

- `rust.component-built`, `typescript.bundle-built` — warnings until the first `aspen compile`.
- `typescript.deps-installed` — `npm install` in `typescript/` when you first build UI.
- `toolchain.cargo-runnable` / `toolchain.wasm-target` — needed for Rust:
  install rustup, then `rustup target add wasm32-wasip2` (the crate's `rust-toolchain.toml` pins
  the channel; rustup fetches it on first build).

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

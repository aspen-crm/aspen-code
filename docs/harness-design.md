# Aspen dev harness

Status: proposal. Nothing here changes the plugin yet.

The same loop for one builder or a whole team: build on your own instance, prove it, then promote
it. Only the shared instances change hands.

## The loop

Every builder runs the individual loop. A team adds one rule: people deploy only to their own
instance, and CI deploys everywhere else.

### Individual: one builder, one sandbox instance, no CI needed

1. Ask for a change in plain words.
2. The agent places it: field, trigger, or page (`lean-data-model`, `model-first`).
3. It writes the files in the instance folder (`metadata`, `server-code`, `custom-ui`).
4. Check: `aspen doctor`, `aspen compile`, UI lint, `metadata-reviewer`.
5. You say yes, it deploys to your instance (`build-and-deploy`).
6. Prove it: write a test record, read it back.
7. Commit. Lessons go in `LESSONS.md`.

Gate: nothing deploys until the check passes and you say yes.

### Team: each builder runs steps 1–7 on their own instance, then

1. Open a pull request.
2. CI reruns the check. A review agent reads the diff.
3. A teammate approves and merges.
4. CI deploys `main` to the shared test instance.
5. CI runs the record tests on test.
6. Someone approves the release.
7. CI deploys the same commit to production.

Gate: no person or agent deploys to a shared instance. Only CI does, from git.

Why the split matters: deploys can't be undone, and one instance runs one check-in at a time. Your
own instance takes both risks for you alone. Shared instances only ever get what git and CI already
checked.

## Smallest steps

Each step is one pull request and works without the next. Ship top to bottom.

| # | Change | Why | Size |
|---|---|---|---|
| | **Safer today, plugin only** | | |
| 1 | `guard-instance` asks before any `aspen move` on a production instance (`-ip` in its URL) | The URL already says prod or sandbox | S |
| 2 | New `guard-metadata` hook: refuse deleting a deployed file in `metadata/custom/` | Today only the reviewer agent catches it | S |
| 3 | `verify.mjs`: doctor, compile, lint, one JSON report | One "is it ready" answer for people, hooks, and CI | S |
| 4 | `guard-deploy`: `save-package` needs a passing report for the current files | Turns the deploy gate from prose into a check | S |
| 5 | Drift check with `aspen move download-active-set --custom-dir` | Catches Admin UI or Builder changes before you overwrite them | M |
| | **Prove it with machines** | | |
| 6 | Record test runner, v0: create, expect, clean up, on the existing browser sign-in (`signin.mjs`) | Replaces "check it in the UI" for rules and derived fields | M |
| 7 | Keep test fixtures in `data/` | Committed, never packaged or deployed | S |
| | **Team mode** | | |
| 8 | Instance repo template with offline CI (compile, lint) | Same check on every pull request | S |
| 9 | Review agent in CI: `metadata-reviewer` on the PR diff, read-only | Catches destructive changes before merge | S |
| 10 | CI deploy job to test, with an API key in its own job | The docs reserve API keys for unattended jobs; the agent never sees it | M |
| 11 | Prod release as a staged deploy: prep early, `checkin-deploy` at the window | The CLI already splits the phases | S |
| | **Faster** | | |
| 12 | `getting-started` creates a dev instance per builder (`POST /devtools/instances`) | The developer role can already do this | M |
| 13 | Teach `aspen move --rust --dev` on sandboxes, once it works with `rust/` and `typescript/` | Code changes without a full check-in | S |

## What the platform already offers

x-platform `main` wasn't reachable when this was written. Each row comes from the published Aspen
docs (CLI reference and API v24.3). Check each against `main`, and against the pinned release's
`--help`, before building on it.

| Capability | The harness uses it for | Today |
|---|---|---|
| Instance types: production, sandbox, learning (in the URL and the instance list) | Guards that know prod from sandbox (step 1) | Unused |
| Developers can create instances (`POST /devtools/instances`) | An instance per builder (step 12) | Unused |
| `aspen move download-active-set` | Drift check (step 5) | Unused |
| Staged check-in: prep, index, deploy apart | Release windows for prod (step 11) | Taught |
| API keys for unattended jobs | CI deploys, kept away from the agent (step 10) | Unused |
| JSON output; `doctor --json` with stable check IDs | The verify report (step 3) | Partly used |
| `data/` tier: committed, not packaged | Test fixtures (step 7) | Unused |
| `aspen login --dir`: sign in to a folder's instance | Switching between dev and test folders | Unused |
| Sandbox code override (`move --dev`) | Fast code loop (step 13) | Broken on 26.4.1 |

## Still needed from the platform

| Ask | Why |
|---|---|
| Delete or reset an instance | Created instances pile up; evals need throwaway ones |
| Delete or roll back metadata | The root cause of every gate above |
| Server-side deploy protection for prod | Local hooks let commands through when they fail; only the server can enforce |
| Short-lived CI tokens (OIDC) | Better than a stored API key; not a blocker |

Earlier drafts listed per-builder instances and CI credentials as platform asks. The docs show both
exist today, so they moved into the steps above.

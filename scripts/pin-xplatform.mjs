#!/usr/bin/env node
// Pin the plugin to one x-platform release: read the versions every surface the skills teach
// (CLI, metadata, App API, Rust toolchain, server SDK crate, UI SDK packages) from an x-platform
// checkout at a ref, and write them to plugins/aspen-code/xplatform.json.
//
//   node scripts/pin-xplatform.mjs <x-platform checkout> <ref>           # write the pin
//   node scripts/pin-xplatform.mjs <x-platform checkout> <ref> --check   # exit 1 if it drifted
//
// e.g. `node scripts/pin-xplatform.mjs ~/src/x-platform origin/release/26.4.1`. Reads through
// `git show <ref>:<path>` only, so the checkout's working tree and branch are never touched.
// Fetch the ref first. Re-pinning changes what the skills claim: re-verify them (AGENTS.md).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'aspen-code', 'xplatform.json')

const one = (re, text, what) => {
  const m = re.exec(text)
  if (!m) throw new Error(`could not read ${what}`)
  return m[1]
}

export function readPin (repo, ref) {
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { encoding: 'utf8' })
  const show = (path) => git('show', `${ref}:${path}`)
  const pkg = (path) => JSON.parse(show(path))
  const workspaceVersion = (path) => one(/\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms, show(path), `${path} workspace version`)

  const sdk = pkg('app/ui/packages/sdk/package.json')
  const xcli = pkg('app/ui/packages/x-cli/package.json')
  const release = workspaceVersion('app/server/Cargo.toml')
  return {
    release,
    branch: ref.replace(/^(?:refs\/remotes\/)?origin\//, ''),
    commit: git('rev-parse', `${ref}^{commit}`).trim(),
    committed: git('log', '-1', '--format=%cs', ref).trim(),
    cli: release,
    metadata: release,
    api: one(/LATEST_APP_API_VERSION:\s*AppApiVersion\s*=\s*VERSION_(\d+_\d+)/, show('app/server/shared/api-contract/src/version.rs'), 'App API version').replace('_', '.'),
    rust: {
      channel: one(/^\s*channel\s*=\s*"([^"]+)"/m, show('rust-toolchain.toml'), 'Rust channel'),
      target: one(/WASM_TARGET_TRIPLE:\s*&str\s*=\s*"([^"]+)"/, show('app/server/shared/metacode-package/src/codefile/server.rs'), 'wasm target')
    },
    init: {
      sdk: one(/SDK_RELEASE:\s*&str\s*=\s*"([^"]+)"/, show('app/server/packages/aspen/src/commands/init.rs'), '`aspen init` SDK_RELEASE')
    },
    sdk: {
      'aspen-crm': workspaceVersion('app/server/packages/crust/Cargo.toml')
    },
    ui: {
      '@aspen-crm/sdk': sdk.version,
      '@aspen-crm/x-cli': xcli.version,
      pversion: sdk['x-platform']?.pversion ?? null,
      node: xcli.engines?.node ?? null,
      npm: xcli.engines?.npm ?? null
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repo, ref] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!repo || !ref) {
    console.error('usage: node scripts/pin-xplatform.mjs <x-platform checkout> <ref> [--check]')
    process.exit(2)
  }
  const pin = readPin(repo, ref)
  const text = JSON.stringify(pin, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    const current = readFileSync(PIN, 'utf8')
    if (current === text) { console.log(`xplatform.json matches ${ref} (${pin.commit.slice(0, 10)})`); process.exit(0) }
    console.error(`xplatform.json drifted from ${ref}:\n${text}`)
    process.exit(1)
  }
  writeFileSync(PIN, text)
  console.log(text)
}

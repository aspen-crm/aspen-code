#!/usr/bin/env node
// Offline checks for the plugin, run in CI and before every release:
//
//   node scripts/validate.mjs [plugin-dir]
//
// Manifests agree and are well formed; every skill has frontmatter and is routed from
// using-aspen; every relative link in a skill resolves; hook commands point at real files; the
// read-only agents hold no write tools; and nothing still teaches the retired Builder-era CLI
// (metacode/, .aspen/bin, ./ac validate, aspen download) that this plugin replaces.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))

// Phrases that only make sense for the Builder-era CLI. A skill containing one is stale.
const RETIRED = [
  [/metacode\//, 'metacode/ (the layout is metadata/custom, rust/, typescript/)'],
  [/(^|[\s`(])\.aspen\/bin\/aspen/m, '.aspen/bin/aspen inside the instance folder (aspen is on PATH via aspenup)'],
  [/\.\/ac\b|\bac validate\b/, './ac validate (use aspen compile --metadata)'],
  [/aspen download\b/, 'aspen download (no such verb)'],
  [/aspen move save-package \.\/metacode/, 'save-package ./metacode'],
  [/Aspen Builder created/, 'Builder-created folders (aspen init creates the directory)'],
  [/aspen login[^\n`]*(--api-key|\s-k\s)/, 'API-key login (sign-in is OAuth, run by the user)']
]

export function validatePlugin (root) {
  const claude = json(join(root, '.claude-plugin/plugin.json'))
  const codex = json(join(root, '.codex-plugin/plugin.json'))
  for (const m of [claude, codex]) {
    assert.match(m.name, /^[a-z][a-z0-9-]*$/)
    assert.match(m.version, /^\d+\.\d+\.\d+(?:[+-][\w.-]+)?$/)
    assert.ok(m.description && m.author?.name, 'description and author required')
  }
  assert.equal(claude.name, codex.name, 'plugin names differ between hosts')
  assert.equal(claude.version, codex.version, 'bump both manifests together')
  assert.equal(codex.skills, './skills/')
  assert.ok(codex.interface?.displayName)

  const skills = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  const router = readFileSync(join(root, 'skills/using-aspen/SKILL.md'), 'utf8')
  for (const skill of skills) {
    const dir = join(root, 'skills', skill)
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    const fm = /^---\r?\nname: ([\w-]+)\r?\ndescription: (.+)\r?\n---/.exec(text)
    assert.ok(fm, `${skill}: frontmatter must be name then description`)
    assert.equal(fm[1], skill, `${skill}: name must match its directory`)
    assert.ok(fm[2].length <= 1024, `${skill}: description over 1024 characters`)
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'), `${skill}: resolve files relative to the skill`)
    if (skill !== 'using-aspen') assert.ok(router.includes(`\`${skill}\``), `${skill}: not routed from using-aspen`)
    for (const file of readdirSync(dir)) {
      if (!/\.(md|rs)$/.test(file)) continue
      const body = readFileSync(join(dir, file), 'utf8')
      for (const [re, why] of RETIRED) assert.ok(!re.test(body), `${skill}/${file}: teaches the retired ${why}`)
      for (const [, target] of body.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/.test(target)) continue
        assert.ok(existsSync(join(dir, target)), `${skill}/${file}: broken link ${target}`)
      }
    }
  }

  const hooks = join(root, 'hooks/hooks.json')
  if (existsSync(hooks)) {
    for (const groups of Object.values(json(hooks).hooks)) for (const group of groups) for (const hook of group.hooks) {
      assert.equal(hook.type, 'command')
      const path = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(hook.command)?.[1]
      assert.ok(path && existsSync(join(root, path)), `missing hook: ${hook.command}`)
    }
  }

  // Both hosts reach the same MCP servers: .mcp.json for Claude Code, the manifest for Codex.
  const mcp = existsSync(join(root, '.mcp.json')) ? json(join(root, '.mcp.json')).mcpServers : {}
  const codexMcp = codex.mcpServers ?? {}
  assert.deepEqual(Object.keys(codexMcp).sort(), Object.keys(mcp).sort(), 'MCP servers differ between hosts')
  for (const [name, server] of Object.entries(mcp)) {
    assert.equal(codexMcp[name].url, server.url, `${name}: URL differs between hosts`)
  }

  const agentsDir = join(root, 'agents')
  const agents = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith('.md')) : []
  for (const file of agents) {
    const text = readFileSync(join(agentsDir, file), 'utf8')
    const tools = /^tools: (.+)$/m.exec(text)?.[1] ?? ''
    assert.ok(!/\b(Write|Edit|NotebookEdit)\b/.test(tools), `${file}: read-only agents hold no write tools`)
    assert.ok(router.includes(`\`${file.replace(/\.md$/, '')}\``), `${file}: not routed from using-aspen`)
  }
  return { name: claude.name, version: claude.version, skills: skills.length, agents: agents.length }
}

export function validateMarketplace (repoRoot) {
  const market = json(join(repoRoot, '.claude-plugin/marketplace.json'))
  assert.ok(market.name && market.owner?.name && market.plugins?.length)
  return market.plugins.map((p) => {
    const root = resolve(repoRoot, p.source)
    const result = validatePlugin(root)
    assert.equal(p.name, result.name, `marketplace entry ${p.name} does not match its plugin`)
    return result
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const targets = process.argv.slice(2)
  const results = targets.length ? targets.map(t => validatePlugin(resolve(t))) : validateMarketplace(repo)
  for (const r of results) console.log(JSON.stringify(r))
}

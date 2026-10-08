import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { evaluate } from '../hooks/guard-ui.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = join(root, 'hooks', 'guard-ui.mjs')
const lint = join(root, 'skills', 'custom-ui', 'scripts', 'lint-ui-tokens.mjs')
const CLAUDE = {}

// An instance directory with a UI project: typescript/src and typescript/aspen.client.json.
function instance (t) {
  const dir = mkdtempSync(join(tmpdir(), 'aspen ui '))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const put = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
  put('typescript/aspen.client.json', JSON.stringify({ routing: { 'base-url-path-part': 'acme', routes: [{ path: '/', module: 'src/home.ts', export: 'home' }] } }, null, 2) + '\n')
  put('typescript/src/panel.css', 'a { color: inherit }\n')
  return { dir, put }
}
const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
const decision = (out) => out?.hookSpecificOutput

test('a Claude Code write with a hardcoded value in typescript/ is denied', (t) => {
  const { dir } = instance(t)
  const out = evaluate({ tool_name: 'Write', cwd: dir, tool_input: { file_path: 'typescript/src/panel.css', content: 'a { color: #ff0000 }\n' } }, CLAUDE)
  assert.equal(decision(out).permissionDecision, 'deny')
  assert.match(decision(out).permissionDecisionReason, /--ap-sem-color-\*/)
})

test('a clean write, and a write outside typescript/, pass silently', (t) => {
  const { dir } = instance(t)
  assert.equal(evaluate({ tool_name: 'Write', cwd: dir, tool_input: { file_path: 'typescript/src/panel.css', content: 'a { color: var(--ap-sem-color-text-primary) }\n' } }, CLAUDE), null)
  assert.equal(evaluate({ tool_name: 'Write', cwd: dir, tool_input: { file_path: 'notes/colors.css', content: 'a { color: #ff0000 }\n' } }, CLAUDE), null)
  assert.equal(evaluate({ tool_name: 'Bash', cwd: dir, tool_input: { command: 'echo "#ff0000" > typescript/src/panel.css' } }, CLAUDE), null)
})

test('declaring a new page asks in Claude Code and is context in Codex', (t) => {
  const { dir } = instance(t)
  const content = JSON.stringify({ routing: { 'base-url-path-part': 'acme', routes: [
    { path: '/', module: 'src/home.ts', export: 'home' },
    { name: 'plan_c', path: '/plan', module: 'src/plan.tsx', export: 'plan' }] } })
  const claude = evaluate({ tool_name: 'Write', cwd: dir, tool_input: { file_path: 'typescript/aspen.client.json', content } }, CLAUDE)
  assert.equal(decision(claude).permissionDecision, 'ask')
  assert.match(decision(claude).permissionDecisionReason, /plan_c/)
  const codex = evaluate({ tool_name: 'Write', cwd: dir, turn_id: 't1', tool_input: { file_path: 'typescript/aspen.client.json', content } }, CLAUDE)
  assert.equal(decision(codex).permissionDecision, undefined)
  assert.match(decision(codex).additionalContext, /custom UI surface/)
})

test('a Codex apply_patch is judged on what each file will say, and never applied', (t) => {
  const { dir } = instance(t)
  const out = evaluate({ tool_name: 'apply_patch', cwd: dir, tool_input: { command: patch('*** Update File: typescript/src/panel.css', '@@', '-a { color: inherit }', '+a { color: #ff0000 }') } })
  assert.equal(decision(out).permissionDecision, 'deny')
  assert.equal(readFileSync(join(dir, 'typescript/src/panel.css'), 'utf8'), 'a { color: inherit }\n', 'the hook must not apply the patch')
  assert.equal(evaluate({ tool_name: 'apply_patch', cwd: dir, tool_input: { command: patch('*** Add File: typescript/src/ok.css', '+a { color: var(--ap-sem-color-text-primary) }') } }), null)
})

test('a hard denial wins over a surface question in the same patch', (t) => {
  const { dir } = instance(t)
  const out = evaluate({ tool_name: 'apply_patch', cwd: dir, tool_input: { command: patch(
    '*** Update File: typescript/src/panel.css', '@@', '-a { color: inherit }', '+a { color: #ff0000 }',
    '*** Add File: metadata/custom/tab_p/plan_c.json', '+{"ctype":"tab_p","name":"plan_c","tab-type":"custom_page","page-ui-code":"ui_main_c.plan_c"}') } })
  assert.equal(decision(out).permissionDecision, 'deny')
})

test('the hook fails open: no output on malformed input, and a patch it cannot read', (t) => {
  const { dir } = instance(t)
  const bad = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' })
  assert.equal(bad.status, 0)
  assert.equal(bad.stdout, '')
  const unreadable = spawnSync('node', [hook], { input: JSON.stringify({ tool_name: 'apply_patch', cwd: dir, tool_input: { command: patch('*** Update File: typescript/src/panel.css', '@@', '-not the file', '+a { color: #ff0000 }') } }), encoding: 'utf8' })
  assert.equal(unreadable.status, 0)
  assert.equal(unreadable.stdout, '')
})

test('hooks.json runs guard-ui on Claude Code and Codex file edits', () => {
  const groups = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse
  const ui = groups.find((g) => g.hooks.some((h) => h.command.includes('guard-ui.mjs')))
  assert.ok(ui, 'guard-ui.mjs is registered')
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'apply_patch']) assert.match(tool, new RegExp(`^(${ui.matcher})$`), tool)
  assert.doesNotMatch('Bash', new RegExp(`^(${ui.matcher})$`))
})

test('lint-ui-tokens flags a tree with a hardcode and passes a clean one', (t) => {
  const { dir, put } = instance(t)
  put('typescript/src/plan.ts', 'export const STYLE = `.x { padding: 16px; }`\n')
  const dirty = spawnSync('node', [lint, join(dir, 'typescript', 'src')], { encoding: 'utf8' })
  assert.equal(dirty.status, 1)
  assert.match(dirty.stdout, /padding: 16px/)
  put('typescript/src/plan.ts', 'export const STYLE = `.x { padding: var(--ap-sem-spacing-inner-md); }`\n')
  const clean = spawnSync('node', [lint, join(dir, 'typescript', 'src')], { encoding: 'utf8' })
  assert.equal(clean.status, 0, clean.stdout)
})

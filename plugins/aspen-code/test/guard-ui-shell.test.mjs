import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { evaluate, roots } from '../hooks/guard-ui-shell.mjs'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-ui-shell.mjs')

// A folder holding one instance directory (with a space in its path, as Test3's had) and a file
// in its typescript/src, plus an unrelated folder.
function machine (t) {
  const top = mkdtempSync(join(tmpdir(), 'aspen shell '))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const dir = join(top, 'Test3 - Explore', 'acme_dev')
  const put = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
  put('.aspen/config.toml', 'instance = "https://host.example/acme/dev"\n')
  put('typescript/src/panel.css', 'a { color: var(--ap-sem-color-text-primary) }\n')
  mkdirSync(join(top, 'scratch'))
  return { top, dir, put, scratch: join(top, 'scratch') }
}
const context = (out) => out?.hookSpecificOutput?.additionalContext
const codex = (cmd, workdir) => ({ tool_name: 'exec_command', turn_id: 't', tool_input: { cmd: ['bash', '-lc', cmd], workdir } })

test('a script write of a hardcoded colour in typescript/ comes back as context naming the file', (t) => {
  const m = machine(t)
  m.put('typescript/src/panel.css', 'a { color: #ff0000 }\n')
  const out = evaluate(codex(`python3 - <<'PY'\nopen('typescript/src/panel.css','w').write('a { color: #ff0000 }')\nPY`, m.dir))
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.match(context(out), /panel\.css/)
  assert.match(context(out), /--ap-sem-color-\*/)
  assert.match(context(out), /apply_patch/)
})

test('a Claude Code Bash heredoc is checked the same way', (t) => {
  const m = machine(t)
  m.put('typescript/src/panel.css', 'a { color: #ff0000 }\n')
  const out = evaluate({ tool_name: 'Bash', cwd: m.dir, tool_input: { command: 'cat > typescript/src/panel.css <<EOF\na { color: #ff0000 }\nEOF' } })
  assert.match(context(out), /panel\.css/)
})

test('from a folder above the instance, a quoted absolute path with spaces finds it', (t) => {
  const m = machine(t)
  m.put('typescript/src/panel.css', 'a { color: #ff0000 }\n')
  assert.deepEqual(roots(`python3 -c "open('${m.dir}/typescript/src/panel.css','w')"`, m.top), [m.dir])
  assert.deepEqual(roots(`cd '${m.dir}' && sed -i '' s/a/b/ typescript/src/panel.css`, m.top), [m.dir])
  assert.match(context(evaluate(codex(`python3 -c "open('${m.dir}/typescript/src/panel.css','w')"`, m.top))), /panel\.css/)
})

test('clean files, old files, unrelated folders and other tools pass silently', (t) => {
  const m = machine(t)
  assert.equal(evaluate(codex('ls typescript/src', m.dir)), null)
  m.put('typescript/src/old.css', 'a { color: #ff0000 }\n')
  const old = (Date.now() - 60 * 60 * 1000) / 1000
  utimesSync(join(m.dir, 'typescript/src/old.css'), old, old)
  assert.equal(evaluate(codex('ls typescript/src', m.dir)), null)
  assert.equal(evaluate(codex('echo "#ff0000" > colors.css', m.scratch)), null)
  assert.equal(evaluate({ tool_name: 'Write', cwd: m.dir, tool_input: { file_path: 'typescript/src/panel.css', content: 'a { color: #ff0000 }' } }), null)
})

test('the hook process fails open on garbage and reports over stdin', (t) => {
  const m = machine(t)
  const bad = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' })
  assert.equal(bad.status, 0); assert.equal(bad.stdout, '')
  m.put('typescript/src/panel.css', 'a { color: #ff0000 }\n')
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(codex('true', m.dir)), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /panel\.css/)
})

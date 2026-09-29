import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageAll } from '../skills/instance-migration/scripts/migrate.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'instance-migration', 'scripts', 'migrate.mjs')
const SRC_TOKEN = 'secret-token:aspen_SOURCE_' + randomUUID()
const TGT_TOKEN = 'secret-token:aspen_TARGET_' + randomUUID()
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// ---- a fake Aspen instance: describe, query and record writes, with the rules the real one enforces

const text = (name, o = {}) => ({ name, type: 'text', subtype: o.long ? 'long' : 'text', required: !!o.required, unique: !!o.unique })
const lookup = (name, to) => ({ name, type: 'id', subtype: 'lookup', relationship: to })
const picklist = (name, list = name) => ({ name, type: 'picklist', subtype: 'picklist', picklist: list })
const number = (name) => ({ name, type: 'number', subtype: 'number' })
const date = (name) => ({ name, type: 'date', subtype: 'date' })
const datetime = (name) => ({ name, type: 'datetime', subtype: 'datetime' })
const SYSTEM = [{ name: 'id_p', type: 'id', subtype: 'id' }, datetime('ct_p'), datetime('mt_p'), lookup('cb_p', 'user_p'), lookup('mb_p', 'user_p')]

async function mockInstance ({ base, token, objects, picklists, records, failCreate = () => false }) {
  const calls = []
  let clock = Date.parse('2026-05-01T00:00:00.000Z')
  const fieldsOf = (obj) => [...SYSTEM, ...objects[obj]]
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : null
    const path = new URL(req.url, 'http://x').pathname
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const fail = (detail, status = 200) => send(status, { status: 'FAILURE', failures: [{ error_type: 'INVALID_DATA', detail, display_detail: detail }] })
    if (!path.startsWith(base + '/api/v24.3/')) return send(404, { failures: [{ error_type: 'NOT_FOUND' }] })
    const route = path.slice((base + '/api/v24.3').length)
    calls.push({ method: req.method, route, body })
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { failures: [{ error_type: 'INVALID_SESSION_ID', detail: 'Invalid session' }] })

    if (route === '/describe/identifiers/object_p') {
      return send(200, { status: 'SUCCESS', overview: { size: Object.keys(objects).length, has_more_rows: false }, data: Object.keys(objects).map(name => ({ name, label: name, 'object-type': null })) })
    }
    if (route === '/describe/object_p' || route === '/describe/picklist_p') {
      const variants = []
      const data = body.data.map(({ name }) => {
        const known = route === '/describe/object_p' ? objects[name] : picklists[name]
        if (!known) return { status: 'FAILURE', name, failures: [{ error_type: 'NOT_FOUND' }] }
        variants.push(route === '/describe/object_p'
          ? { name, label: name, active: true, fields: fieldsOf(name).map(f => ({ label: f.name, active: true, required: false, unique: false, 'read-only': false, ...f })) }
          : { name, label: name, items: known.map(v => ({ name: v, label: v, active: true })) })
        return { status: 'SUCCESS', name, 'object-type': null, 'variant-index': variants.length - 1 }
      })
      return send(200, { status: 'SUCCESS', data, supplemental: { variants } })
    }
    if (route === '/data/query') {
      const m = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+?))? LIMIT (\d+)(?: OFFSET (\d+))?$/.exec(body.query)
      if (!m) return fail(`cannot parse ${body.query}`)
      const [, list, obj, where, order, limit, offset = '0'] = m
      if (!objects[obj]) return fail(`unknown object ${obj}`)
      if (+limit > 1000) return fail('LIMIT over 1000')
      if (+offset > 10000) return fail('OFFSET over 10000')
      const tests = []
      for (const part of (where ?? '').split(' AND ').filter(Boolean)) {
        const cond = part.replace(/^\((.*)\)$/, '$1')
        let c
        if ((c = /^(\w+) (>=|>|<=|<) '(.*)'$/.exec(cond))) {
          if (c[1] !== 'ct_p' && c[1] !== 'mt_p') return fail(`operator ${c[2]} not allowed on ${c[1]}`)
          const [, f, op, v] = c
          tests.push(r => op === '>=' ? r[f] >= v : op === '>' ? r[f] > v : op === '<=' ? r[f] <= v : r[f] < v)
        } else if ((c = /^(\w+) = '(.*)'$/.exec(cond))) {
          const [, f, v] = c; tests.push(r => r[f] === v)
        } else if ((c = /^(\w+) IN \((.*)\)$/.exec(cond))) {
          const vals = [...c[2].matchAll(/'([^']*)'/g)].map(x => x[1]); const f = c[1]; tests.push(r => vals.includes(r[f]))
        } else return fail(`cannot parse condition ${cond}`)
      }
      let rows = (records[obj] ?? []).filter(r => tests.every(t => t(r)))
      if (order) {
        const keys = order.split(',').map(s => s.trim())
        rows = [...rows].sort((a, b) => { for (const k of keys) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1 } return 0 })
      }
      rows = rows.slice(+offset, +offset + +limit)
      const cols = list.split(',').map(s => s.trim()).map(s => { const l = /^longtext\((\w+)\) (\w+)$/.exec(s); return l ? { from: l[1], as: l[2], full: true } : { from: s, as: s } })
      const def = Object.fromEntries(fieldsOf(obj).map(f => [f.name, f]))
      for (const c of cols) if (!def[c.from]) return fail(`unknown field ${c.from}`)
      const out = rows.map(r => Object.fromEntries(cols.map(c => {
        const v = r[c.from] ?? null
        return [c.as, v != null && def[c.from].subtype === 'long' && !c.full ? v.slice(0, 255) : v]
      })))
      return send(200, { status: 'SUCCESS', overview: { size: out.length }, data: out })
    }
    const w = /^\/data\/(\w+)$/.exec(route)
    if (w && (req.method === 'POST' || req.method === 'PATCH')) {
      const obj = w[1]
      if (!objects[obj]) return fail(`unknown object ${obj}`, 404)
      if (body.data.length > 500) return send(400, { status: 'FAILURE', failures: [{ error_type: 'BATCH_ERROR', subtype: 'TOO_MANY_RECORDS' }] })
      if (body.data.some(r => Object.values(r).some(v => v !== null && typeof v !== 'string'))) return send(422, { failures: [{ error_type: 'UNPROCESSABLE' }] })
      if (req.method === 'POST' && failCreate(obj)) return send(500, { failures: [{ error_type: 'INTERNAL_ERROR', detail: 'boom' }] })
      const def = Object.fromEntries(fieldsOf(obj).map(f => [f.name, f]))
      const rowFail = (detail) => ({ status: 'FAILURE', failures: [{ error_type: 'INVALID_DATA', detail, display_detail: detail }] })
      const data = body.data.map(row => {
        const existing = req.method === 'PATCH' ? (records[obj] ?? []).find(r => r.id_p === row.id_p) : null
        if (req.method === 'PATCH' && !existing) return rowFail('no such record')
        for (const [k, v] of Object.entries(row)) {
          if (k === 'id_p' && req.method === 'PATCH') continue
          const f = def[k]
          if (!f) return rowFail(`unknown field ${k}`)
          if (SYSTEM.some(s => s.name === k)) return rowFail(`${k} is a system field`)
          if (v === null) continue
          if (f.type === 'datetime' && !DATETIME.test(v)) return rowFail(`${k}: not a valid Datetime`)
          if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return rowFail(`${k}: not a valid Date`)
          if (f.type === 'picklist' && !picklists[f.picklist].includes(v)) return rowFail(`${k}: not a picklist value`)
          if (f.type === 'id' && f.relationship && !(records[f.relationship] ?? []).some(r => r.id_p === v)) return rowFail(`${k}: no such ${f.relationship}`)
        }
        const merged = { ...(existing ?? {}), ...row }
        for (const f of objects[obj]) if (f.required && merged[f.name] == null) return rowFail(`${f.name} is required`)
        for (const f of objects[obj]) if (f.unique && merged[f.name] != null && (records[obj] ?? []).some(r => r !== existing && r[f.name] === merged[f.name])) return rowFail(`${f.name} must be unique`)
        if (existing) { Object.assign(existing, row); return { status: 'SUCCESS', id: existing.id_p } }
        const rec = { ...row, id_p: randomUUID(), ct_p: new Date(clock += 1000).toISOString() };
        (records[obj] ??= []).push(rec)
        return { status: 'SUCCESS', id: rec.id_p }
      })
      return send(200, { status: data.every(d => d.status === 'SUCCESS') ? 'SUCCESS' : 'FAILURE', data })
    }
    send(404, { failures: [{ error_type: 'NOT_FOUND' }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}${base}/`, calls, records, close: () => server.close() }
}

// ---- the two instances: legacy company_c/person_c → account_p/contact_p

const SOURCE_OBJECTS = {
  user_p: [text('email_p', { unique: true })],
  company_c: [text('name_c', { required: true }), picklist('sector_c'), lookup('parent_c', 'company_c'), lookup('owner_p', 'user_p'), text('note_c', { long: true }), number('score_c')],
  person_c: [text('first_c'), text('last_c'), text('email_c'), lookup('company_c', 'company_c'), date('born_c'), datetime('met_c')],
  project_c: [text('name_c'), picklist('stage_c'), lookup('company_c', 'company_c'), number('budget_c'), text('extra_c')]
}
const TARGET_OBJECTS = {
  user_p: [text('email_p', { unique: true })],
  account_p: [text('name_p', { required: true, unique: true }), picklist('industry_p'), lookup('parent_account_p', 'account_p'), lookup('owner_p', 'user_p'), text('description_p', { long: true })],
  contact_p: [text('first_name_p'), text('last_name_p', { required: true }), text('email_p', { unique: true }), lookup('account_p', 'account_p'), date('birthdate_p'), datetime('last_met_c')],
  project_c: [text('name_c', { unique: true }), picklist('stage_c'), lookup('company_c', 'account_p'), number('budget_c'), text('owner_c', { required: true })]
}
const LONG_NOTE = 'n'.repeat(300)
const sourceRecords = () => ({
  user_p: [{ id_p: 'u1', ct_p: '2020-01-01T00:00:00.000Z', email_p: 'a@x.com' }, { id_p: 'u2', ct_p: '2020-01-01T00:00:01.000Z', email_p: 'b@x.com' }],
  company_c: [
    { id_p: 'c2', ct_p: '2021-01-01T00:00:00.000Z', name_c: 'Beta', sector_c: 'bank_c', parent_c: 'c1', owner_p: 'u2', note_c: null, score_c: '7' },
    { id_p: 'c1', ct_p: '2021-01-02T00:00:00.000Z', name_c: 'Acme', sector_c: 'tech_c', parent_c: null, owner_p: 'u1', note_c: LONG_NOTE, score_c: '9' },
    { id_p: 'c3', ct_p: '2021-01-03T00:00:00.000Z', name_c: 'Gamma', sector_c: 'farm_c', parent_c: 'c2', owner_p: null, note_c: 'short', score_c: null }
  ],
  person_c: [
    { id_p: 'p1', ct_p: '2022-01-01T00:00:00.000Z', first_c: 'Ada', last_c: 'Lee', email_c: 'ada@x.com', company_c: 'c1', born_c: '1990-01-02', met_c: '2024-05-06T07:08:09.100Z' },
    { id_p: 'p2', ct_p: '2022-01-01T00:00:00.000Z', first_c: 'Bo', last_c: 'Kim', email_c: 'bo@x.com', company_c: 'c3', born_c: null, met_c: null },
    { id_p: 'p3', ct_p: '2022-01-02T00:00:00.000Z', first_c: 'Cy', last_c: null, email_c: 'cy@x.com', company_c: null, born_c: null, met_c: null }
  ],
  project_c: []
})
const targetRecords = () => ({ user_p: [{ id_p: 't1', ct_p: '2025-01-01T00:00:00.000Z', email_p: 'a@x.com' }] })

// The mapping the model writes after settling every todo with the user. person_c comes first on
// purpose: the load order comes from the lookups, not from the file.
const SETTLED = [
  { source: 'person_c', target: 'contact_p', key: 'email_p', onMatch: 'skip', fields: [
    { target: 'first_name_p', from: 'first_c' },
    { target: 'last_name_p', expr: "r.last_c || 'Unknown'", note: 'user: Unknown when blank' },
    { target: 'email_p', from: 'email_c' },
    { target: 'account_p', from: 'company_c', lookup: 'company_c' },
    { target: 'birthdate_p', from: 'born_c' },
    { target: 'last_met_c', from: 'met_c' }
  ] },
  { source: 'company_c', target: 'account_p', key: 'name_p', onMatch: 'skip', fields: [
    { target: 'name_p', from: 'name_c' },
    { target: 'industry_p', from: 'sector_c', map: { tech_c: 'technology_p', bank_c: 'financial_services_p' }, default: 'other_p' },
    { target: 'parent_account_p', from: 'parent_c', lookup: 'company_c' },
    { target: 'owner_p', from: 'owner_p', lookup: { object: 'user_p', match: 'email_p' }, missing: 'null' },
    { target: 'description_p', from: 'note_c' },
    { from: 'score_c', drop: true }
  ] }
]

async function setup (t, { target = targetRecords(), failCreate } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'aspen migrate '))
  const src = await mockInstance({ base: '/acme/legacy', token: SRC_TOKEN, objects: SOURCE_OBJECTS, picklists: { sector_c: ['tech_c', 'bank_c', 'farm_c'], stage_c: ['a_c', 'b_c', 'x_c'] }, records: sourceRecords() })
  const tgt = await mockInstance({ base: '/acme/prod', token: TGT_TOKEN, objects: TARGET_OBJECTS, picklists: { industry_p: ['technology_p', 'financial_services_p', 'other_p'], stage_c: ['a_c', 'b_c'] }, records: target, failCreate: (o) => failCreate?.(o) ?? false })
  t.after(() => { src.close(); tgt.close(); rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'acme_prod')
  mkdirSync(join(dir, '.aspen'), { recursive: true })
  writeFileSync(join(dir, '.aspen', 'config.toml'), `instance = "${tgt.url}"\n`)
  mkdirSync(join(home, 'tokens'))
  for (const [name, token] of [['legacy', SRC_TOKEN], ['prod', TGT_TOKEN]]) {
    writeFileSync(join(home, 'tokens', name), token + '\n')
    chmodSync(join(home, 'tokens', name), 0o600)
  }
  const ws = join(dir, 'data', 'migrations', 'legacy')
  // Every run is checked: no token in anything the script prints.
  const run = (...args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env, HOME: home, USERPROFILE: home } })
    let stdout = ''; let stderr = ''
    p.stdout.on('data', d => { stdout += d }); p.stderr.on('data', d => { stderr += d })
    p.on('close', (status) => {
      for (const tok of [SRC_TOKEN, TGT_TOKEN]) assert.ok(!(stdout + stderr).includes(tok), 'a token was printed')
      resolve({ status, stdout, stderr })
    })
  })
  const init = () => run('init', ws, '--source', src.url, '--source-token', '~/tokens/legacy', '--target', tgt.url, '--target-token', '~/tokens/prod')
  const mapping = () => JSON.parse(readFileSync(join(ws, 'mapping.json'), 'utf8'))
  const settle = (objects = SETTLED) => writeFileSync(join(ws, 'mapping.json'), JSON.stringify({ ...mapping(), objects }, null, 2))
  const ready = async (objects) => {
    for (const step of [init, () => run('describe', ws)]) { const r = await step(); assert.equal(r.status, 0, r.stderr) }
    settle(objects)
    const r = await run('extract', ws); assert.equal(r.status, 0, r.stderr)
  }
  return { home, dir, ws, src, tgt, run, init, mapping, settle, ready }
}

// Calls that change records: anything but a query or a describe.
const writes = (inst) => inst.calls.filter(c => !(c.method === 'POST' && (c.route === '/data/query' || c.route.startsWith('/describe/'))))
const byName = (inst, obj, field, value) => inst.records[obj].find(r => r[field] === value)
const lines = (file) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []

// ---- init: tokens and the target instance

test('init writes the connections and a .gitignore for record data', async t => {
  const s = await setup(t)
  const r = await s.init()
  assert.equal(r.status, 0, r.stderr)
  const m = s.mapping()
  assert.deepEqual(m.source, { url: s.src.url, tokenFile: '~/tokens/legacy' })
  assert.deepEqual(m.target, { url: s.tgt.url, tokenFile: '~/tokens/prod' })
  assert.deepEqual(m.objects, [])
  const ignore = readFileSync(join(s.ws, '.gitignore'), 'utf8')
  for (const d of ['extract/', 'idmap/', 'errors/', 'schema/']) assert.ok(ignore.includes(d), d)
})

test('a token file others can read is refused, with the fix', async t => {
  const s = await setup(t)
  chmodSync(join(s.home, 'tokens', 'legacy'), 0o644)
  const r = await s.init()
  assert.equal(r.status, 2)
  assert.match(r.stderr, /chmod 600/)
})

test('a token file inside the instance directory is refused', async t => {
  const s = await setup(t)
  const inside = join(s.dir, 'prod.token')
  writeFileSync(inside, TGT_TOKEN); chmodSync(inside, 0o600)
  const r = await s.run('init', s.ws, '--source', s.src.url, '--source-token', '~/tokens/legacy', '--target', s.tgt.url, '--target-token', inside)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /outside the instance directory/)
})

test('a target that is not this directory\'s instance is refused', async t => {
  const s = await setup(t)
  const r = await s.run('init', s.ws, '--source', s.src.url, '--source-token', '~/tokens/legacy', '--target', s.src.url, '--target-token', '~/tokens/prod')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /config\.toml/)
})

test('a refused token names the instance and the file, never the token', async t => {
  const s = await setup(t)
  assert.equal((await s.init()).status, 0)
  writeFileSync(join(s.home, 'tokens', 'legacy'), 'secret-token:aspen_WRONG')
  const r = await s.run('describe', s.ws)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /source.*refused/s)
  assert.ok(!r.stderr.includes('aspen_WRONG'))
})

// ---- describe and draft

test('describe writes both schemas, with lookups and picklist values', async t => {
  const s = await setup(t)
  await s.init()
  const r = await s.run('describe', s.ws)
  assert.equal(r.status, 0, r.stderr)
  const src = JSON.parse(readFileSync(join(s.ws, 'schema', 'source.json'), 'utf8'))
  assert.equal(src.objects.company_c.fields.parent_c.lookup, 'company_c')
  assert.equal(src.objects.company_c.fields.name_c.required, true)
  assert.deepEqual(src.picklists.sector_c, ['tech_c', 'bank_c', 'farm_c'])
  const tgt = JSON.parse(readFileSync(join(s.ws, 'schema', 'target.json'), 'utf8'))
  assert.equal(tgt.objects.account_p.fields.name_p.unique, true)
})

test('draft matches by name and type and marks every gap as a todo', async t => {
  const s = await setup(t)
  await s.init(); await s.run('describe', s.ws)
  const r = await s.run('draft', s.ws, '--objects', 'company_c,project_c')
  assert.equal(r.status, 0, r.stderr)
  const [company, project] = s.mapping().objects
  assert.equal(company.target, null)
  assert.match(company.todo, /no object named company_c/)
  const f = Object.fromEntries(project.fields.map(e => [e.target ?? e.from, e]))
  assert.deepEqual(f.name_c, { target: 'name_c', from: 'name_c' })
  assert.deepEqual(f.budget_c, { target: 'budget_c', from: 'budget_c' })
  assert.deepEqual(f.company_c, { target: 'company_c', from: 'company_c', lookup: 'company_c' })
  assert.deepEqual(f.stage_c.map, { a_c: 'a_c', b_c: 'b_c' })
  assert.match(f.stage_c.todo, /x_c/)
  assert.match(f.extra_c.todo, /no field extra_c/)
  assert.match(f.owner_c.todo, /required/)
  assert.equal(project.key, 'name_c')
  assert.ok(!project.fields.some(e => ['id_p', 'ct_p', 'cb_p'].includes(e.from)), 'system fields left out')
  // Running draft again adds only new objects.
  await s.run('draft', s.ws, '--objects', 'project_c,person_c')
  assert.deepEqual(s.mapping().objects.map(o => o.source), ['company_c', 'project_c', 'person_c'])
})

// ---- extract

test('extract reads every source record, full long text included', async t => {
  const s = await setup(t)
  await s.ready()
  const companies = lines(join(s.ws, 'extract', 'company_c.jsonl'))
  assert.deepEqual(companies.map(c => c.id_p).sort(), ['c1', 'c2', 'c3'])
  assert.equal(companies.find(c => c.id_p === 'c1').note_c, LONG_NOTE)
  assert.equal(lines(join(s.ws, 'extract', 'person_c.jsonl')).length, 3)
  assert.deepEqual(writes(s.src), [], 'nothing is written to the source')
})

// A fake query over rows sorted by (ct_p, id_p), holding the real OFFSET cap at `maxOffset`.
function fakeQuery (stamps, maxOffset) {
  const rows = stamps.map((s, i) => ({ id_p: `r${String(i).padStart(2, '0')}`, ct_p: `2020-01-01T00:00:0${s}.000Z` }))
  const queries = []
  const query = async (aql) => {
    queries.push(aql)
    const m = /FROM t(?: WHERE ct_p >= '([^']+)')? ORDER BY ct_p, id_p LIMIT (\d+)(?: OFFSET (\d+))?$/.exec(aql)
    assert.ok(m, aql)
    const offset = +(m[3] ?? 0)
    assert.ok(offset <= maxOffset, `offset ${offset} over the cap`)
    return rows.filter(r => !m[1] || r.ct_p >= m[1]).slice(offset, offset + +m[2])
  }
  return { rows, queries, query }
}

test('paging moves the created-time window past the OFFSET cap, ties included', async () => {
  // Runs of equal ct_p that straddle page and window edges.
  const { rows, queries, query } = fakeQuery([0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 4, 5, 5, 6, 7, 7, 7, 7, 8, 9, 9, 9], 4)
  const got = []
  for await (const r of pageAll(query, { object: 't', select: 'id_p, ct_p', pageSize: 2, maxOffset: 4 })) got.push(r.id_p)
  assert.deepEqual(got, rows.map(r => r.id_p))
  assert.ok(queries.some(q => q.includes('ct_p >=')), 'the window moved')
})

test('more records at one created time than OFFSET can skip is an error, not a silent gap', async () => {
  const { query } = fakeQuery([1, 1, 1, 1, 1, 1, 1, 2], 4)
  await assert.rejects(async () => { for await (const r of pageAll(query, { object: 't', select: 'id_p, ct_p', pageSize: 2, maxOffset: 4 })) void r }, /created time/)
})

// ---- load: dry run

test('load refuses to run while a todo is left', async t => {
  const s = await setup(t)
  await s.init(); await s.run('describe', s.ws); await s.run('draft', s.ws, '--objects', 'project_c')
  const r = await s.run('load', s.ws)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /todo/)
})

test('the dry run reports every error and writes nothing to the target', async t => {
  const s = await setup(t)
  const objects = structuredClone(SETTLED)
  delete objects[1].fields[1].default // farm_c now has no mapping
  await s.ready(objects)
  const before = writes(s.tgt).length
  const r = await s.run('load', s.ws)
  assert.equal(r.status, 1)
  assert.equal(writes(s.tgt).length, before, 'the dry run wrote to the target')
  const plan = readFileSync(join(s.ws, 'reports', 'plan.md'), 'utf8')
  assert.match(plan, /company_c → account_p/)
  assert.match(plan, /industry_p/)
  assert.ok(plan.indexOf('company_c') < plan.indexOf('person_c'), 'companies load before people')
  assert.ok(!plan.includes('Gamma'), 'record values stay out of the report')
  assert.equal(lines(join(s.ws, 'errors', 'company_c.jsonl')).length, 1)
})

// ---- load --run

test('load --run inserts parents first, remaps every lookup, and converts values', async t => {
  const s = await setup(t)
  await s.ready()
  const r = await s.run('load', s.ws, '--run')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const acme = byName(s.tgt, 'account_p', 'name_p', 'Acme')
  const beta = byName(s.tgt, 'account_p', 'name_p', 'Beta')
  const gamma = byName(s.tgt, 'account_p', 'name_p', 'Gamma')
  assert.equal(s.tgt.records.account_p.length, 3)
  assert.equal(beta.parent_account_p, acme.id_p, 'self lookup filled by the second pass')
  assert.equal(gamma.parent_account_p, beta.id_p)
  assert.equal(acme.parent_account_p ?? null, null)
  assert.equal(acme.owner_p, 't1', 'owner matched by email')
  assert.equal(beta.owner_p ?? null, null, 'no user with that email: blank, as the mapping says')
  assert.deepEqual([acme.industry_p, beta.industry_p, gamma.industry_p], ['technology_p', 'financial_services_p', 'other_p'])
  assert.equal(acme.description_p, LONG_NOTE)
  const ada = byName(s.tgt, 'contact_p', 'email_p', 'ada@x.com')
  assert.equal(ada.account_p, acme.id_p)
  assert.equal(ada.birthdate_p, '1990-01-02')
  assert.equal(ada.last_met_c, '2024-05-06T07:08:09.100Z')
  assert.equal(byName(s.tgt, 'contact_p', 'email_p', 'cy@x.com').last_name_p, 'Unknown')
  const inserts = s.tgt.calls.filter(c => c.method === 'POST' && /^\/data\/(account|contact)_p$/.test(c.route)).map(c => c.route)
  assert.deepEqual(inserts, ['/data/account_p', '/data/contact_p'])
  assert.deepEqual(writes(s.src), [], 'nothing is written to the source')
  assert.equal(lines(join(s.ws, 'idmap', 'company_c.jsonl')).length, 3)
  assert.ok(existsSync(join(s.ws, 'reports', 'load.md')))
})

test('running load again inserts nothing', async t => {
  const s = await setup(t)
  await s.ready()
  assert.equal((await s.run('load', s.ws, '--run')).status, 0)
  const before = s.tgt.calls.length
  const r = await s.run('load', s.ws, '--run')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!s.tgt.calls.slice(before).some(c => c.method !== 'POST' || /^\/data\/(account|contact)_p$/.test(c.route)), 'a second run wrote to the target')
  assert.equal(s.tgt.records.account_p.length, 3)
})

test('a record already on the target is matched by key, not inserted twice', async t => {
  const target = targetRecords()
  target.account_p = [{ id_p: 'a-existing', ct_p: '2025-01-01T00:00:00.000Z', name_p: 'Acme', industry_p: 'other_p' }]
  const s = await setup(t, { target })
  await s.ready()
  assert.equal((await s.run('load', s.ws, '--run')).status, 0)
  assert.equal(s.tgt.records.account_p.length, 3)
  assert.equal(byName(s.tgt, 'contact_p', 'email_p', 'ada@x.com').account_p, 'a-existing')
  assert.equal(byName(s.tgt, 'account_p', 'name_p', 'Acme').industry_p, 'other_p', 'onMatch skip leaves it alone')
})

test('onMatch update writes the mapped fields onto the matched record', async t => {
  const target = targetRecords()
  target.account_p = [{ id_p: 'a-existing', ct_p: '2025-01-01T00:00:00.000Z', name_p: 'Acme', industry_p: 'other_p' }]
  const s = await setup(t, { target })
  const objects = structuredClone(SETTLED); objects[1].onMatch = 'update'
  await s.ready(objects)
  assert.equal((await s.run('load', s.ws, '--run')).status, 0)
  assert.equal(byName(s.tgt, 'account_p', 'name_p', 'Acme').industry_p, 'technology_p')
})

test('a batch the server rejects whole counts as failed, and a later run loads it', async t => {
  let broken = true
  const s = await setup(t, { failCreate: (o) => broken && o === 'contact_p' })
  await s.ready()
  const r = await s.run('load', s.ws, '--run')
  assert.equal(r.status, 1)
  assert.equal(lines(join(s.ws, 'errors', 'person_c.jsonl')).length, 3)
  assert.match(readFileSync(join(s.ws, 'reports', 'load.md'), 'utf8'), /boom|INTERNAL_ERROR/)
  broken = false
  const again = await s.run('load', s.ws, '--run')
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(s.tgt.records.contact_p.length, 3)
  assert.equal(lines(join(s.ws, 'errors', 'person_c.jsonl')).length, 0)
})

test('--limit loads a pilot, holds children whose parent is not loaded, and the full run finishes it', async t => {
  const s = await setup(t)
  await s.ready()
  const pilot = await s.run('load', s.ws, '--run', '--limit', '1')
  assert.equal(pilot.status, 0, pilot.stdout + pilot.stderr)
  assert.equal(s.tgt.records.account_p.length, 1)
  const ids = new Set(s.tgt.records.account_p.map(a => a.id_p))
  for (const c of s.tgt.records.contact_p ?? []) assert.ok(c.account_p == null || ids.has(c.account_p), 'a contact points at an account that is not loaded')
  assert.ok((s.tgt.records.contact_p ?? []).length <= 1)
  const full = await s.run('load', s.ws, '--run')
  assert.equal(full.status, 0, full.stdout + full.stderr)
  assert.equal(s.tgt.records.account_p.length, 3)
  assert.equal(s.tgt.records.contact_p.length, 3)
  assert.equal(byName(s.tgt, 'account_p', 'name_p', 'Beta').parent_account_p, byName(s.tgt, 'account_p', 'name_p', 'Acme').id_p)
})

// ---- verify

test('verify passes after a load and catches a changed record', async t => {
  const s = await setup(t)
  await s.ready()
  assert.equal((await s.run('load', s.ws, '--run')).status, 0)
  const ok = await s.run('verify', s.ws)
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.ok(existsSync(join(s.ws, 'reports', 'verify.md')))
  byName(s.tgt, 'contact_p', 'email_p', 'ada@x.com').first_name_p = 'Changed'
  const bad = await s.run('verify', s.ws)
  assert.equal(bad.status, 1)
  assert.match(readFileSync(join(s.ws, 'reports', 'verify.md'), 'utf8'), /first_name_p/)
})

test('no token is written into the workspace', async t => {
  const s = await setup(t)
  await s.ready()
  await s.run('load', s.ws, '--run'); await s.run('verify', s.ws)
  const walk = (d) => readdirSync(d).flatMap(n => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])
  for (const file of walk(s.ws)) {
    const body = readFileSync(file, 'utf8')
    assert.ok(!body.includes(SRC_TOKEN) && !body.includes(TGT_TOKEN), `${file} holds a token`)
  }
})

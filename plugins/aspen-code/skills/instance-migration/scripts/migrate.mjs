#!/usr/bin/env node
// Copy records from a source Aspen instance into the target instance whose directory this runs
// in, through the REST API. The aspen CLI has no data commands. Each command that reads or writes
// an instance signs in to it through the browser (signin.mjs) and keeps the token in memory only:
// nothing is stored, and no token is printed.
//
//   node migrate.mjs init <workspace> --source <url> --target <url>
//   node migrate.mjs describe <workspace> [--side source|target]   schemas → schema/
//   node migrate.mjs draft <workspace> --objects a,b   add source objects to mapping.json; gaps are todos
//   node migrate.mjs extract <workspace>               source records → extract/
//   node migrate.mjs load <workspace>                  dry run → reports/plan.md; writes nothing
//   node migrate.mjs load <workspace> --run [--limit N] [--batch N]
//   node migrate.mjs verify <workspace> [--sample N]   counts and a field-by-field sample → reports/verify.md
//
// The source is only read: its client has no write method. The target is written only by
// `load --run`. There is no upsert and `id_p` cannot be set on create, so every target record
// gets a new id; idmap/<object>.jsonl records source id → target id after every batch, which
// makes a re-run skip what is already loaded. A lookup to its own object, or to an object that
// loads later, is left blank on insert and filled by a second pass.
//
// AQL refuses `>` on id_p and caps OFFSET at 10000, so extract pages by created time (ct_p,
// indexed): ORDER BY ct_p, id_p, moving a `ct_p >=` window forward before OFFSET runs out.
//
// Exit codes: 0 done; 1 rows failed, wait on a parent, or differ on verify; 2 bad invocation, the
// mapping or the instance is not ready, or a sign-in failed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SignInError, signIn } from './signin.mjs'

const API = '/api/v24.3'
const PAGE = 1000 // AQL LIMIT cap
const MAX_OFFSET = 10000 // AQL OFFSET cap
const MAX_BATCH = 500 // rows per write request
const DEFAULT_BATCH = 100 // contact_p batches of 200 have failed with a bare HTTP 500
const SYSTEM = new Set(['id_p', 'cb_p', 'mb_p', 'ct_p', 'mt_p', 'st_p'])
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const PLANNED = '(planned)'
const IGNORED = ['extract/', 'idmap/', 'errors/', 'schema/']

const HELP = `Copy records from a source Aspen instance into this directory's instance.

  node migrate.mjs init <workspace> --source <url> --target <url>
  node migrate.mjs describe <workspace> [--side source|target]
  node migrate.mjs draft <workspace> --objects <source objects, comma-separated>
  node migrate.mjs extract <workspace>
  node migrate.mjs load <workspace>                     dry run: reports/plan.md, writes nothing
  node migrate.mjs load <workspace> --run               write to the target
      --limit N   at most N new records per object (a pilot)
      --batch N   records per request (default ${DEFAULT_BATCH}, max ${MAX_BATCH})
  node migrate.mjs verify <workspace> [--sample N]

Each command that reaches an instance signs in to it in the browser: describe to both (or the
--side named), extract to the source, load and verify to the target. Nothing is stored.

The mapping format is in mapping-format.md beside the skill.`

class Stop extends Error {
  constructor (message, code = 2) { super(message); this.code = code }
}

const say = (line) => console.log(line)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + '\n') }
const readLines = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const writeLines = (p, rows) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, rows.map((r) => JSON.stringify(r) + '\n').join('')) }
const appendLines = (p, rows) => { if (rows.length) { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, rows.map((r) => JSON.stringify(r) + '\n').join('')) } }
const writeText = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
const sameUrl = (a, b) => String(a).trim().replace(/\/+$/, '').toLowerCase() === String(b).trim().replace(/\/+$/, '').toLowerCase()
const failureText = (j) => (j?.failures ?? []).map((f) => f.display_detail || f.detail || [f.error_type, f.subtype].filter(Boolean).join('/')).join('; ')
// Only ids and timestamps the API returned go into a query this script builds.
const literal = (v) => { if (!/^[\w:.+-]+$/.test(String(v))) throw new Stop(`unexpected value for a query: ${v}`, 1); return `'${v}'` }
const lookupObjects = (e) => typeof e.lookup === 'string' ? [e.lookup] : Array.isArray(e.lookup) ? e.lookup : []
const isMatch = (e) => e.lookup && typeof e.lookup === 'object' && !Array.isArray(e.lookup)
const writable = (o) => Object.entries(o.fields).filter(([n]) => !SYSTEM.has(n))
const selectable = (o) => writable(o).filter(([, f]) => !(f.type === 'id' && f.subtype === 'file'))
const column = ([name, f]) => f.type === 'text' && f.subtype === 'long' ? `longtext(${name}) ${name}` : name

// ---- the workspace and the instance directory it sits in

function instanceRoot (start) {
  for (let d = resolve(start); ; d = dirname(d)) {
    const config = join(d, '.aspen', 'config.toml')
    if (existsSync(config)) return { dir: d, instance: /^\s*instance\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1] ?? null }
    if (dirname(d) === d) return null
  }
}

function workspace (arg) {
  if (!arg) throw new Stop('name the workspace directory, e.g. data/migrations/<source-name>')
  const dir = resolve(arg)
  const root = instanceRoot(dir)
  if (!root) throw new Stop(`${dir} is not inside an instance directory (no .aspen/config.toml above it); run this in the target instance's directory`)
  return { dir, root: root.dir, instance: root.instance, path: (...p) => join(dir, ...p) }
}

function readMapping (ws) {
  const file = ws.path('mapping.json')
  if (!existsSync(file)) throw new Stop(`no ${file}; run init first`)
  const m = readJson(file)
  if (!sameUrl(m.target?.url, ws.instance)) throw new Stop(`mapping.json's target ${m.target?.url} is not this directory's instance (${ws.instance}, from .aspen/config.toml)`)
  if (m.source?.tokenFile || m.target?.tokenFile) {
    say("note: mapping.json's tokenFile is no longer used: each command signs in through the browser. The user can delete that file and revoke its API key.")
    delete m.source?.tokenFile; delete m.target?.tokenFile
  }
  m.objects ??= []
  return m
}

const schema = (ws, side) => {
  const file = ws.path('schema', `${side}.json`)
  if (!existsSync(file)) throw new Stop('no schema yet; run describe first')
  return readJson(file)
}

// ---- the REST client. The source gets only `reader`; `write` exists for the target alone.

async function connect (conn, side) {
  const session = await signIn(conn.url, { side, log: say })
  const base = String(conn.url).replace(/\/+$/, '') + API
  const scrub = (s) => session.secrets().reduce((t, x) => t.split(x).join('<token>'), String(s))
  async function send (method, route, body, { retry = true } = {}) {
    let renewed = false
    for (let attempt = 1; ; attempt++) {
      const token = await session.bearer()
      let res
      try {
        res = await fetch(base + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      } catch (e) {
        if (retry && attempt < 4) { await sleep(500 * attempt); continue }
        throw new Stop(scrub(`${side}: ${method} ${route} got no response from ${conn.url} (${e.cause?.message ?? e.message}).` +
          (retry ? '' : ' That batch may or may not have been written; run load again (a key stops duplicates).')), 1)
      }
      if (res.status === 429 && attempt < 6) { await sleep((Number(res.headers.get('retry-after')) || attempt * 2) * 1000); continue }
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      // A refused request was not applied, so a write is safe to send again once.
      if (res.status === 401 || res.status === 403 || json?.failures?.some((f) => f.error_type === 'INVALID_SESSION_ID')) {
        if (!renewed) { renewed = true; await session.refreshed(); continue }
        throw new Stop(`the ${side} instance (${conn.url}) refused the signed-in user (HTTP ${res.status}); sign in as a user who can ${side === 'target' ? 'read and write' : 'read'} the migrated objects`)
      }
      return { status: res.status, json, text: scrub(text.slice(0, 300)) }
    }
  }
  async function read (route, body, { partial = false } = {}) {
    const r = await send('POST', route, body)
    if (r.status >= 400 || (r.json?.status === 'FAILURE' && !(partial && Array.isArray(r.json.data)))) {
      throw new Stop(`${side}: ${route} failed (HTTP ${r.status}): ${failureText(r.json) || r.text}`, 1)
    }
    return r.json
  }
  const reader = {
    url: conn.url,
    read,
    query: async (aql) => (await read('/data/query', { query: aql })).data ?? []
  }
  return { reader, write: (method, object, rows) => send(method, `/data/${object}`, { data: rows }, { retry: false }), close: session.close }
}

// ---- describe: objects, fields and picklist values, normalized

async function describeInstance ({ read }) {
  const list = await read('/describe/identifiers/object_p', { filter: { active: true }, limit: 1000 })
  if (list.overview?.has_more_rows) say('warning: more than 1000 objects; only the first 1000 were described')
  const names = [...new Set((list.data ?? []).filter((d) => !d['object-type']).map((d) => d.name))]
  const variants = async (route, all) => {
    const out = {}
    for (const chunk of chunks(all, 50)) {
      const r = await read(route, { data: chunk.map((name) => ({ name })), filter_inactive: route === '/describe/object_p' }, { partial: true })
      for (const e of r.data ?? []) {
        const v = e.status === 'SUCCESS' ? r.supplemental?.variants?.[e['variant-index']] : null
        if (v) out[e.name] = v
      }
    }
    return out
  }
  const objects = {}
  for (const [name, v] of Object.entries(await variants('/describe/object_p', names))) {
    objects[name] = {
      label: v.label ?? name,
      fields: Object.fromEntries((v.fields ?? []).filter((f) => f.active !== false).map((f) => [f.name, {
        label: f.label ?? f.name,
        type: f.type,
        subtype: f.subtype ?? null,
        required: !!f.required,
        unique: !!f.unique,
        lookup: f.relationship ?? null,
        objects: f['allowed-objects'] ?? null,
        picklist: f.picklist ?? null
      }]))
    }
  }
  const lists = [...new Set(Object.values(objects).flatMap((o) => Object.values(o.fields).map((f) => f.picklist).filter(Boolean)))]
  const picklists = {}
  for (const [name, v] of Object.entries(await variants('/describe/picklist_p', lists))) {
    picklists[name] = (v.items ?? []).filter((i) => i.active !== false).map((i) => i.name)
  }
  return { objects, picklists }
}

// ---- draft: match by name and type; every gap becomes a todo for the user to settle

function draftObject (name, src, tgt, migrating) {
  const S = src.objects[name]
  const target = tgt.objects[name] ? name : null
  const T = target && tgt.objects[target]
  const entry = { source: name, target, key: null, onMatch: 'skip' }
  if (!T) entry.todo = `no object named ${name} on the target: set "target" to an existing object, create one, or remove this entry`
  const fields = []
  for (const [fname, f] of writable(S)) {
    if (f.type === 'id' && f.subtype === 'file') { fields.push({ from: fname, drop: true, note: 'file fields are not migrated' }); continue }
    const tf = T?.fields[fname]
    if (!tf || SYSTEM.has(fname)) {
      fields.push({ from: fname, todo: T ? `no field ${fname} on ${target}: map it to another field ("target"), transform it ("expr"), create it, or drop it ("drop": true)` : 'choose a target field once the object is mapped, or drop it' })
      continue
    }
    const e = { target: fname, from: fname }
    const refs = f.lookup ? [f.lookup] : f.objects ?? []
    if (tf.type !== f.type) {
      e.todo = `types differ: ${f.type} on the source, ${tf.type} on the target`
    } else if (refs.length) {
      const out = refs.filter((r) => !migrating.has(r))
      if (out.length) e.todo = `points to ${out.join(', ')}, which is not migrated: migrate it too, match it by a field ("lookup": {"object": "${out[0]}", "match": "<field>"}), or drop it`
      else e.lookup = refs.length === 1 ? refs[0] : refs
    } else if (f.picklist && tf.picklist) {
      const values = src.picklists[f.picklist] ?? []
      const allowed = new Set(tgt.picklists[tf.picklist] ?? [])
      const missing = values.filter((v) => !allowed.has(v))
      if (missing.length) {
        e.map = Object.fromEntries(values.filter((v) => allowed.has(v)).map((v) => [v, v]))
        e.todo = `values not on the target picklist ${tf.picklist}: ${missing.join(', ')}; add each to "map", or set "default"`
      }
    }
    fields.push(e)
  }
  if (T) {
    for (const [fname, tf] of writable(T)) {
      if (tf.required && !fields.some((e) => e.target === fname)) fields.push({ target: fname, todo: 'required on the target and nothing maps to it: set "from", "value" or "expr"' })
    }
    entry.key = fields.find((e) => e.target && !e.todo && !e.lookup && T.fields[e.target]?.unique)?.target ?? null
  }
  entry.fields = fields
  return entry
}

function todos (m) {
  const out = []
  for (const o of m.objects) {
    if (o.todo) out.push(`${o.source}: ${o.todo}`)
    for (const e of o.fields ?? []) if (e.todo) out.push(`${o.source}.${e.target ?? e.from}: ${e.todo}`)
  }
  return out
}

// A settled mapping still has to name real things; say which entry is wrong.
function checkMapping (m, T) {
  const names = new Set(m.objects.map((o) => o.source))
  for (const o of m.objects) {
    const TO = T.objects[o.target]
    if (!TO) throw new Stop(`mapping.json: ${o.source} → ${o.target}: no such object on the target (run describe again after creating it)`)
    if (o.onMatch && !['skip', 'update'].includes(o.onMatch)) throw new Stop(`mapping.json: ${o.source}: onMatch is "skip" or "update"`)
    if (o.key && !o.fields.some((e) => e.target === o.key && !e.drop)) throw new Stop(`mapping.json: ${o.source}: key ${o.key} is not one of the fields it writes`)
    for (const e of o.fields) {
      const at = `mapping.json: ${o.source}.${e.target ?? e.from}`
      if (e.drop) continue
      if (!TO.fields[e.target]) throw new Stop(`${at}: ${o.target} has no field ${e.target}`)
      if (SYSTEM.has(e.target)) throw new Stop(`${at}: ${e.target} is a system field and cannot be written`)
      if (!('value' in e) && !e.expr && !e.from) throw new Stop(`${at}: needs "from", "value" or "expr"`)
      for (const x of lookupObjects(e)) if (!names.has(x)) throw new Stop(`${at}: lookup ${x} is not an object in this mapping; migrate it or use {"object", "match"}`)
      if (isMatch(e) && !(e.lookup.object && e.lookup.match)) throw new Stop(`${at}: a match lookup needs "object" and "match"`)
    }
  }
}

// Parents before children. A cycle is broken at the object with the fewest unplaced parents; a
// lookup to the object itself or to one placed later is filled by the second pass.
function loadOrder (m) {
  const byName = Object.fromEntries(m.objects.map((o) => [o.source, o]))
  const deps = Object.fromEntries(m.objects.map((o) => [o.source, new Set(o.fields.filter((e) => !e.drop).flatMap(lookupObjects).filter((d) => d !== o.source && byName[d]))]))
  const order = []
  const placed = new Set()
  const unplaced = (n) => [...deps[n]].filter((d) => !placed.has(d)).length
  while (order.length < m.objects.length) {
    const left = m.objects.map((o) => o.source).filter((n) => !placed.has(n))
    const ready = left.filter((n) => unplaced(n) === 0)
    for (const n of ready.length ? ready : [left.sort((a, b) => unplaced(a) - unplaced(b))[0]]) { order.push(n); placed.add(n) }
  }
  return order.map((n, i) => ({
    entry: byName[n],
    deferred: new Set(byName[n].fields.filter((e) => !e.drop && lookupObjects(e).some((d) => order.indexOf(d) >= i)).map((e) => e.target))
  }))
}

// ---- extract: page by created time, since AQL has no `>` on ids and OFFSET stops at 10000

export async function * pageAll (query, { object, select, where, pageSize = PAGE, maxOffset = MAX_OFFSET }) {
  let since = null
  let offset = 0
  let last = null // the latest ct_p read, and how many rows carry it
  let tie = 0
  const seen = new Set()
  for (;;) {
    const conds = [where && `(${where})`, since && `ct_p >= ${literal(since)}`].filter(Boolean)
    const rows = await query(`SELECT ${select} FROM ${object}${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ORDER BY ct_p, id_p LIMIT ${pageSize}${offset ? ' OFFSET ' + offset : ''}`)
    for (const r of rows) {
      if (r.ct_p === last) tie++
      else { last = r.ct_p; tie = 1 }
      if (!seen.has(r.id_p)) { seen.add(r.id_p); yield r }
    }
    if (rows.length < pageSize) return
    offset += rows.length
    if (offset > maxOffset) {
      // A new window from the latest created time. The rows already read at that time come back
      // first, in id order, so skip exactly that many.
      if (tie > maxOffset) throw new Stop(`more than ${maxOffset} ${object} records share the created time ${last}; they cannot be paged`, 1)
      since = last
      offset = tie
    }
  }
}

const matchRefs = (m) => [...new Map(m.objects.flatMap((o) => o.fields.filter((e) => !e.drop && isMatch(e))).map((e) => [`${e.lookup.object}.${e.lookup.match}`, e.lookup])).values()]

// ---- converting one source row into target values

const compiled = new Map()
function evaluate (expr, row) {
  if (!compiled.has(expr)) compiled.set(expr, new Function('r', `"use strict"; return (${expr})`))
  return compiled.get(expr)(row)
}
const raw = (e, row) => 'value' in e ? e.value : e.expr ? evaluate(e.expr, row) : row[e.from] ?? null

function format (v, f) {
  if (v === null || v === undefined) return { value: null }
  if (typeof v === 'boolean') return { value: String(v) }
  if (typeof v === 'number') return Number.isFinite(v) ? { value: String(v) } : { error: 'not a number' }
  if (typeof v === 'object') return { error: 'not a single value' }
  const s = String(v)
  if (f.type === 'datetime') {
    if (DATETIME.test(s)) return { value: s }
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? { error: 'not a datetime' } : { value: d.toISOString() }
  }
  if (f.type === 'date') { const m = /^\d{4}-\d{2}-\d{2}/.exec(s); return m ? { value: m[0] } : { error: 'not a date' } }
  return { value: s }
}

function convert (row, o, TO, picklists, { resolve, extracted, refs, deferred }) {
  const values = {}
  const errors = []
  let wait = false
  const err = (field, kind, detail) => errors.push({ field, kind, detail })
  for (const e of o.fields) {
    if (e.drop || deferred.has(e.target)) continue
    const f = TO.fields[e.target]
    let v
    try { v = raw(e, row) } catch (x) { err(e.target, 'expr failed', x.message); continue }
    if (e.map && v != null) {
      if (Object.hasOwn(e.map, v)) v = e.map[v]
      else if ('default' in e) v = e.default
      else { err(e.target, 'value not in map', `${e.from} = ${v}`); continue }
    }
    if (e.lookup && v != null) {
      if (isMatch(e)) {
        const r = refs[`${e.lookup.object}.${e.lookup.match}`]
        const key = r.source[v]
        const id = key == null ? undefined : r.target.get(key)
        if (id) v = id
        else if (e.missing === 'null') v = null
        else { err(e.target, 'no match on the target', `no ${e.lookup.object} with ${e.lookup.match} = ${key ?? '(blank)'}`); continue }
      } else {
        const objs = lookupObjects(e)
        const id = resolve(objs, v)
        if (id) v = id
        else if (objs.some((x) => extracted[x]?.has(v))) { wait = true; continue }
        else if (e.missing === 'null') v = null
        else { err(e.target, 'lookup not in the extract', `${objs.join('/')} ${v}`); continue }
      }
    }
    const out = format(v, f)
    if (out.error) { err(e.target, out.error, String(v)); continue }
    if (out.value === null && f.required) { err(e.target, 'required', 'blank'); continue }
    // A reference picklist (object type, security profile, field) names no list; the instance checks it.
    if (f.type === 'picklist' && f.picklist && out.value != null && !(picklists[f.picklist] ?? []).includes(out.value)) { err(e.target, 'not a value of the target picklist', out.value); continue }
    values[e.target] = out.value
  }
  return { values, errors, wait }
}

// ---- load

async function indexBy (api, object, field) {
  const map = new Map()
  for await (const r of pageAll(api.query, { object, select: `id_p, ct_p, ${field}` })) if (r[field] != null && !map.has(r[field])) map.set(r[field], r.id_p)
  return map
}

async function writeBatches (write, method, object, items, size, done) {
  for (const chunk of chunks(items, size)) {
    const r = await write(method, object, chunk.map((i) => i.values))
    const data = Array.isArray(r.json?.data) && r.json.data.length === chunk.length ? r.json.data : null
    if (!data) {
      const why = failureText(r.json) || `HTTP ${r.status} ${r.text}`
      for (const i of chunk) done(i, null, { field: '(batch)', kind: `batch rejected: ${why.slice(0, 160)}`, detail: why })
      continue
    }
    data.forEach((d, k) => d.status === 'SUCCESS'
      ? done(chunk[k], d.id ?? chunk[k].values.id_p, null)
      : done(chunk[k], null, { field: '(record)', kind: `rejected: ${(failureText(d) || 'no reason given').slice(0, 160)}`, detail: failureText(d) }))
  }
}

async function load (ws, m, tgt, { run, limit, batch }) {
  const left = todos(m)
  if (left.length) throw new Stop(`${left.length} todo(s) left in mapping.json; settle them with the user first:\n  ${left.slice(0, 20).join('\n  ')}`)
  const T = schema(ws, 'target')
  checkMapping(m, T)
  const order = loadOrder(m)
  const files = (o) => ({ extract: ws.path('extract', `${o.source}.jsonl`), idmap: ws.path('idmap', `${o.source}.jsonl`), patched: ws.path('idmap', `${o.source}.patched.jsonl`), errors: ws.path('errors', `${o.source}.jsonl`) })
  const rows = {}; const extracted = {}; const idmaps = {}; const matched = {}; const planned = {}; const errors = {}; const stats = {}
  for (const { entry: o } of order) {
    if (!existsSync(files(o).extract)) throw new Stop(`no extract for ${o.source}; run extract first`)
    rows[o.source] = readLines(files(o).extract)
    extracted[o.source] = new Set(rows[o.source].map((r) => r.id_p))
    const pairs = readLines(files(o).idmap)
    idmaps[o.source] = new Map(pairs.map((l) => [l.s, l.t]))
    matched[o.source] = new Set(pairs.filter((l) => l.m).map((l) => l.s))
    planned[o.source] = new Set()
    errors[o.source] = []
    stats[o.source] = { rows: rows[o.source].length, loaded: 0, matched: 0, inserted: 0, updated: 0, waiting: 0, held: 0, failed: 0, patched: 0, pending: 0 }
  }
  const refs = {}
  for (const ref of matchRefs(m)) {
    const file = ws.path('extract', 'match', `${ref.object}.${ref.match}.json`)
    if (!existsSync(file)) throw new Stop(`the mapping matches ${ref.object} by ${ref.match}, which the extract lacks; run extract again`)
    refs[`${ref.object}.${ref.match}`] = { source: readJson(file), target: await indexBy(tgt.reader, ref.object, ref.match) }
  }
  const resolveId = (objs, id) => {
    for (const x of objs) {
      const t = idmaps[x]?.get(id) ?? (!run && planned[x]?.has(id) ? PLANNED : undefined)
      if (t) return t
    }
  }
  const fail = (o, id, e) => { errors[o.source].push({ id, errors: [].concat(e) }) }
  const remember = (o, s, t, isMatched) => {
    idmaps[o.source].set(s, t)
    if (isMatched) matched[o.source].add(s)
    if (run) appendLines(files(o).idmap, [isMatched ? { s, t, m: 1 } : { s, t }])
  }

  // First pass: insert, or match by key; lookups to objects already loaded are resolved now.
  for (const step of order) {
    const o = step.entry
    const TO = T.objects[o.target]
    const st = stats[o.source]
    const existing = o.key ? await indexBy(tgt.reader, o.target, o.key) : null
    const ctx = { resolve: resolveId, extracted, refs, deferred: step.deferred }
    const inserts = []; const updates = []; const keys = new Set()
    for (const row of rows[o.source]) {
      const c = convert(row, o, TO, T.picklists, ctx)
      const known = idmaps[o.source].get(row.id_p)
      if (known) {
        st.loaded++
        if (o.onMatch === 'update' && !c.errors.length && !c.wait) updates.push({ row, values: { id_p: known, ...c.values } })
        continue
      }
      if (c.errors.length) { fail(o, row.id_p, c.errors); continue }
      if (c.wait) { st.waiting++; continue }
      const kv = o.key ? c.values[o.key] : null
      if (kv != null && existing.has(kv)) {
        st.matched++
        if (run) remember(o, row.id_p, existing.get(kv), true)
        else planned[o.source].add(row.id_p)
        if (o.onMatch === 'update') updates.push({ row, values: { id_p: existing.get(kv), ...c.values } })
        continue
      }
      if (kv != null && keys.has(kv)) { fail(o, row.id_p, { field: o.key, kind: 'duplicate key in the source', detail: `another ${o.source} record has the same ${o.key}` }); continue }
      if (kv != null) keys.add(kv)
      if (limit != null && inserts.length >= limit) { st.held++; continue }
      inserts.push({ row, values: c.values })
    }
    if (!run) {
      for (const i of inserts) planned[o.source].add(i.row.id_p)
      st.inserted = inserts.length
      st.updated = updates.length
      continue
    }
    await writeBatches(tgt.write, 'POST', o.target, inserts, batch, (i, id, e) => {
      if (id) { st.inserted++; remember(o, i.row.id_p, id, false) } else fail(o, i.row.id_p, e)
    })
    await writeBatches(tgt.write, 'PATCH', o.target, updates, batch, (i, id, e) => {
      if (id) st.updated++; else fail(o, i.row.id_p, e)
    })
    say(`${o.source} → ${o.target}: ${st.inserted} inserted, ${st.matched} matched, ${st.updated} updated, ${errors[o.source].length} failed`)
  }

  // Second pass: lookups to the object itself or to one loaded after it.
  for (const step of order) {
    if (!step.deferred.size) continue
    const o = step.entry
    const st = stats[o.source]
    const done = new Set(readLines(files(o).patched).map((l) => l.s))
    const items = []
    for (const row of rows[o.source]) {
      const t = idmaps[o.source].get(row.id_p) ?? (!run && planned[o.source].has(row.id_p) ? PLANNED : null)
      if (!t || done.has(row.id_p)) continue
      if (matched[o.source].has(row.id_p) && o.onMatch !== 'update') continue
      const values = {}
      let open = false
      for (const e of o.fields.filter((x) => !x.drop && step.deferred.has(x.target))) {
        const v = raw(e, row)
        if (v == null) continue
        const id = resolveId(lookupObjects(e), v)
        if (id) values[e.target] = id
        else if (lookupObjects(e).some((x) => extracted[x]?.has(v))) open = true
        else if (e.missing !== 'null') fail(o, row.id_p, { field: e.target, kind: 'lookup not in the extract', detail: `${lookupObjects(e).join('/')} ${v}` })
      }
      if (open) st.pending++
      if (Object.keys(values).length) items.push({ row, values: { id_p: t, ...values }, complete: !open })
    }
    if (!run) { st.patched = items.length; continue }
    await writeBatches(tgt.write, 'PATCH', o.target, items, batch, (i, id, e) => {
      if (!id) return fail(o, i.row.id_p, e)
      st.patched++
      if (i.complete) appendLines(files(o).patched, [{ s: i.row.id_p }])
    })
  }

  for (const { entry: o } of order) {
    const byRow = new Map()
    for (const e of errors[o.source]) byRow.set(e.id, [...(byRow.get(e.id) ?? []), ...e.errors])
    stats[o.source].failed = byRow.size
    writeLines(files(o).errors, [...byRow].map(([id, errs]) => ({ id, errors: errs })))
  }
  const report = loadReport(m, order, stats, errors, { run, limit })
  writeText(ws.path('reports', run ? 'load.md' : 'plan.md'), report)
  const total = (k) => Object.values(stats).reduce((n, s) => n + s[k], 0)
  const incomplete = limit == null && (total('waiting') > 0 || total('pending') > 0)
  say(`${run ? 'loaded' : 'dry run'}: ${total('inserted')} ${run ? 'inserted' : 'to insert'}, ${total('matched')} matched, ${total('failed')} failed, ${total('waiting')} waiting on a parent; see reports/${run ? 'load' : 'plan'}.md`)
  return total('failed') > 0 || incomplete ? 1 : 0
}

function loadReport (m, order, stats, errors, { run, limit }) {
  const lines = [
    run ? '# Load' : '# Migration plan (dry run)', '',
    `Source: ${m.source.url}  `, `Target: ${m.target.url}  `, `Run: ${new Date().toISOString()}${limit != null ? ` (pilot: at most ${limit} new records per object)` : ''}`, '',
    `| # | Source → target | Rows | Already loaded | Matched by key | ${run ? 'Inserted' : 'To insert'} | ${run ? 'Updated' : 'To update'} | Waiting | Held | Failed |`,
    '|---|---|---|---|---|---|---|---|---|---|'
  ]
  order.forEach(({ entry: o }, i) => {
    const s = stats[o.source]
    lines.push(`| ${i + 1} | ${o.source} → ${o.target} | ${s.rows} | ${s.loaded} | ${s.matched} | ${s.inserted} | ${s.updated} | ${s.waiting} | ${s.held} | ${s.failed} |`)
  })
  lines.push('', 'Waiting: the record points to a parent that is not loaded yet; it loads on a later run, once the parent does. Held: over `--limit`.')
  const second = order.filter((s) => s.deferred.size)
  if (second.length) {
    lines.push('', '## Filled by the second pass', '')
    for (const { entry: o, deferred } of second) lines.push(`- ${o.source} → ${o.target}: ${[...deferred].join(', ')} (${stats[o.source].patched} ${run ? 'patched' : 'to patch'}, ${stats[o.source].pending} waiting)`)
  }
  const groups = new Map()
  for (const { entry: o } of order) {
    for (const r of errors[o.source]) {
      for (const e of r.errors) {
        const k = `${o.source}\u0000${e.field}\u0000${e.kind}`
        groups.set(k, (groups.get(k) ?? 0) + 1)
      }
    }
  }
  if (groups.size) {
    lines.push('', '## Errors', '', '| Object | Field | Problem | Records |', '|---|---|---|---|')
    for (const [k, n] of groups) { const [o, f, kind] = k.split('\u0000'); lines.push(`| ${o} | ${f} | ${kind.replace(/\|/g, '/')} | ${n} |`) }
    lines.push('', 'Each record and its values: `errors/<object>.jsonl` (not committed).')
  }
  return lines.join('\n') + '\n'
}

// ---- verify: counts, then a sample read back and compared field by field

function same (expected, actual, f) {
  if (expected == null || actual == null) return (expected ?? null) === (actual ?? null)
  if (f.type === 'number' || f.type === 'currency') return Number(expected) === Number(actual)
  if (f.type === 'datetime') return new Date(expected).getTime() === new Date(actual).getTime()
  return String(expected) === String(actual)
}

async function verify (ws, m, tgt, { sample }) {
  const T = schema(ws, 'target')
  checkMapping(m, T)
  const order = loadOrder(m)
  const extracted = {}; const idmaps = {}; const matchedIds = {}; const rows = {}
  for (const { entry: o } of order) {
    rows[o.source] = readLines(ws.path('extract', `${o.source}.jsonl`))
    extracted[o.source] = new Set(rows[o.source].map((r) => r.id_p))
    const pairs = readLines(ws.path('idmap', `${o.source}.jsonl`))
    idmaps[o.source] = new Map(pairs.map((l) => [l.s, l.t]))
    matchedIds[o.source] = new Set(pairs.filter((l) => l.m).map((l) => l.s))
  }
  const refs = {}
  for (const ref of matchRefs(m)) {
    refs[`${ref.object}.${ref.match}`] = { source: readJson(ws.path('extract', 'match', `${ref.object}.${ref.match}.json`)), target: await indexBy(tgt.reader, ref.object, ref.match) }
  }
  const ctx = { resolve: (objs, id) => objs.map((x) => idmaps[x]?.get(id)).find(Boolean), extracted, refs, deferred: new Set() }
  const out = []; const mismatches = []
  for (const { entry: o } of order) {
    const TO = T.objects[o.target]
    // Records matched and left alone (onMatch skip) keep their own values; compare the rest.
    const comparable = rows[o.source].filter((r) => idmaps[o.source].has(r.id_p) && (o.onMatch === 'update' || !matchedIds[o.source].has(r.id_p)))
    const step = Math.max(1, Math.floor(comparable.length / sample))
    const picked = comparable.filter((_, i) => i % step === 0).slice(0, sample)
    const fields = [...new Set(o.fields.filter((e) => !e.drop).map((e) => e.target))]
    const actual = new Map()
    for (const chunk of chunks(picked, 100)) {
      const ids = chunk.map((r) => literal(idmaps[o.source].get(r.id_p)))
      const got = await tgt.reader.query(`SELECT id_p, ${fields.map((n) => column([n, TO.fields[n]])).join(', ')} FROM ${o.target} WHERE id_p IN (${ids.join(', ')}) LIMIT ${chunk.length}`)
      for (const r of got) actual.set(r.id_p, r)
    }
    let differing = 0
    for (const row of picked) {
      const t = idmaps[o.source].get(row.id_p)
      const a = actual.get(t)
      if (!a) { mismatches.push({ object: o.source, id: row.id_p, field: '(record)', expected: t, actual: null }); differing++; continue }
      const c = convert(row, o, TO, T.picklists, ctx)
      let bad = false
      for (const [field, expected] of Object.entries(c.values)) {
        if (!same(expected, a[field], TO.fields[field])) { mismatches.push({ object: o.source, id: row.id_p, field, expected, actual: a[field] ?? null }); bad = true }
      }
      if (bad) differing++
    }
    out.push({ o, extracted: rows[o.source].length, loaded: idmaps[o.source].size, notLoaded: [...extracted[o.source]].filter((id) => !idmaps[o.source].has(id)).length, sampled: picked.length, differing })
  }
  writeLines(ws.path('errors', 'verify.jsonl'), mismatches)
  const lines = ['# Verify', '', `Target: ${m.target.url}  `, `Run: ${new Date().toISOString()}`, '',
    '| Source → target | Extracted | Loaded or matched | Not loaded | Sampled | Differing |', '|---|---|---|---|---|---|']
  for (const r of out) lines.push(`| ${r.o.source} → ${r.o.target} | ${r.extracted} | ${r.loaded} | ${r.notLoaded} | ${r.sampled} | ${r.differing} |`)
  if (mismatches.length) {
    const groups = new Map()
    for (const x of mismatches) groups.set(`${x.object}\u0000${x.field}`, (groups.get(`${x.object}\u0000${x.field}`) ?? 0) + 1)
    lines.push('', '## Differences', '', '| Object | Field | Records |', '|---|---|---|')
    for (const [k, n] of groups) { const [obj, f] = k.split('\u0000'); lines.push(`| ${obj} | ${f} | ${n} |`) }
    lines.push('', 'Each record, expected and actual: `errors/verify.jsonl` (not committed).')
  }
  writeText(ws.path('reports', 'verify.md'), lines.join('\n') + '\n')
  const notLoaded = out.reduce((n, r) => n + r.notLoaded, 0)
  say(`verify: ${out.reduce((n, r) => n + r.sampled, 0)} sampled, ${mismatches.length} differences, ${notLoaded} not loaded; see reports/verify.md`)
  return mismatches.length || notLoaded ? 1 : 0
}

// ---- commands

const VALUED = ['--source', '--target', '--side', '--objects', '--limit', '--batch', '--sample']
function options (args) {
  const o = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--run') o.run = true
    else if (a === '--source-token' || a === '--target-token') throw new Stop(`${a}: token files are no longer used; each command signs in through the browser`)
    else if (VALUED.includes(a)) {
      if (args[i + 1] === undefined) throw new Stop(`${a} needs a value`)
      o[a.slice(2)] = args[++i]
    } else throw new Stop(`unknown option: ${a}\n\n${HELP}`)
  }
  const count = (name, min, max) => {
    if (o[name] === undefined) return undefined
    const n = Number(o[name])
    if (!Number.isInteger(n) || n < min || n > max) throw new Stop(`--${name} is a whole number from ${min} to ${max}`)
    return n
  }
  return { ...o, limit: count('limit', 0, Number.MAX_SAFE_INTEGER), batch: count('batch', 1, MAX_BATCH) ?? DEFAULT_BATCH, sample: count('sample', 1, 1000) ?? 20 }
}

export async function main (argv) {
  const [cmd, wsArg, ...rest] = argv
  if (!cmd || ['help', '--help', '-h'].includes(cmd) || rest.includes('--help')) { say(HELP); return 0 }
  if (!['init', 'describe', 'draft', 'extract', 'load', 'verify'].includes(cmd)) throw new Stop(`unknown command: ${cmd}\n\n${HELP}`)
  const opts = options(rest)
  const ws = workspace(wsArg)

  if (cmd === 'init') {
    if (existsSync(ws.path('mapping.json'))) throw new Stop(`${ws.path('mapping.json')} already exists; edit its "source" and "target" instead`)
    for (const k of ['source', 'target']) if (!opts[k]) throw new Stop(`init needs --${k}`)
    if (!sameUrl(opts.target, ws.instance)) throw new Stop(`the target ${opts.target} is not this directory's instance (${ws.instance}, from .aspen/config.toml)`)
    if (sameUrl(opts.source, opts.target)) throw new Stop('the source and the target are the same instance')
    writeJson(ws.path('mapping.json'), { source: { url: opts.source }, target: { url: opts.target }, objects: [] })
    writeText(ws.path('.gitignore'), '# record data stays out of git\n' + IGNORED.join('\n') + '\n')
    say(`workspace ready: ${ws.dir}\nnext: describe`)
    return 0
  }

  const m = readMapping(ws)
  const opened = []
  const open = async (side) => { const c = await connect(m[side], side); opened.push(c); return c }
  try {
    return await run(cmd, ws, m, opts, open)
  } finally {
    await Promise.allSettled(opened.map((c) => c.close()))
  }
}

async function run (cmd, ws, m, opts, open) {
  if (cmd === 'describe') {
    if (opts.side && !['source', 'target'].includes(opts.side)) throw new Stop('--side is source or target')
    for (const side of opts.side ? [opts.side] : ['source', 'target']) {
      const { reader } = await open(side)
      const s = await describeInstance(reader)
      writeJson(ws.path('schema', `${side}.json`), { url: m[side].url, described: new Date().toISOString(), ...s })
      say(`${side}: ${Object.keys(s.objects).length} objects, ${Object.keys(s.picklists).length} picklists`)
    }
    return 0
  }
  if (cmd === 'draft') {
    if (!opts.objects) throw new Stop('draft needs --objects: the source objects to migrate, comma-separated')
    const src = schema(ws, 'source'); const tgt = schema(ws, 'target')
    const names = opts.objects.split(',').map((s) => s.trim()).filter(Boolean)
    for (const n of names) if (!src.objects[n]) throw new Stop(`${n} is not an object on the source`)
    const have = new Set(m.objects.map((o) => o.source))
    const migrating = new Set([...have, ...names])
    const added = names.filter((n) => !have.has(n))
    for (const n of added) m.objects.push(draftObject(n, src, tgt, migrating))
    writeJson(ws.path('mapping.json'), m)
    for (const o of m.objects.filter((x) => added.includes(x.source))) {
      const n = todos({ objects: [o] }).length
      say(`${o.source} → ${o.target ?? '?'}: ${o.fields.length} fields, ${n} todo(s)${o.target && !o.key ? '; no key: ask which field identifies the same record on both sides' : ''}`)
    }
    say(`${todos(m).length} todo(s) left in mapping.json`)
    return 0
  }
  if (cmd === 'extract') {
    const src = schema(ws, 'source')
    const { reader } = await open('source')
    for (const o of m.objects) {
      const S = src.objects[o.source]
      if (!S) throw new Stop(`${o.source} is not in schema/source.json; run describe again`)
      const out = []
      for await (const r of pageAll(reader.query, { object: o.source, select: ['id_p', 'ct_p', ...selectable(S).map(column)].join(', '), where: o.where })) out.push(r)
      writeLines(ws.path('extract', `${o.source}.jsonl`), out)
      say(`${o.source}: ${out.length} records`)
    }
    for (const ref of matchRefs(m)) {
      const map = {}
      for await (const r of pageAll(reader.query, { object: ref.object, select: `id_p, ct_p, ${ref.match}` })) map[r.id_p] = r[ref.match]
      writeJson(ws.path('extract', 'match', `${ref.object}.${ref.match}.json`), map)
      say(`${ref.object}.${ref.match}: ${Object.keys(map).length} records to match by`)
    }
    return 0
  }
  const target = await open('target')
  if (cmd === 'load') return load(ws, m, target, opts)
  return verify(ws, m, target, opts)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (e) => { const known = e instanceof Stop || e instanceof SignInError; console.error(known ? e.message : (e?.stack ?? String(e))); process.exitCode = known ? e.code : 1 }
  )
}

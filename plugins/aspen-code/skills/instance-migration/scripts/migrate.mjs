#!/usr/bin/env node
// Copy records from a source Aspen instance into the target instance whose directory this runs
// in, through the REST API. The aspen CLI has no data commands. The first command that reaches an
// instance signs in to it through the browser; a background process keeps that sign-in in memory
// for the commands after it (signin.mjs), until an hour passes with none or `signout`. Nothing is
// stored, and no token is printed.
//
//   node migrate.mjs init <workspace> --source <url> --target <url>
//   node migrate.mjs describe <workspace> [--side source|target]   schemas → schema/
//   node migrate.mjs draft <workspace> --objects a,b   add source objects to mapping.json; gaps are todos
//   node migrate.mjs extract <workspace>               source records → extract/
//   node migrate.mjs load <workspace>                  dry run → reports/plan.md; writes nothing
//   node migrate.mjs load <workspace> --run [--limit N] [--batch N]
//   node migrate.mjs verify <workspace> [--sample N]   counts and a field-by-field sample → reports/verify.md
//   node migrate.mjs load <workspace> --run --then verify   steps chained; the first failure stops it
//   node migrate.mjs signout <workspace> [--side source|target]   end the kept sign-ins
//
// The source is only read: its client has no write method. The target is written only by
// `load --run`, and nothing is ever deleted. There is no upsert and `id_p` cannot be set on
// create, so every target record gets a new id; idmap/<object>.jsonl records source id → target
// id after every batch, which makes a re-run skip what is already loaded. A lookup to its own object, or to an object that
// loads later, is left blank on insert and filled by a second pass.
//
// AQL refuses `>` on id_p and caps OFFSET at 10000, so extract pages by created time (ct_p,
// indexed): ORDER BY ct_p, id_p, moving a `ct_p >=` window forward before OFFSET runs out.
//
// Exit codes: 0 done; 1 rows failed, wait on a parent, or differ on verify; 2 bad invocation, the
// mapping or the instance is not ready, or a sign-in failed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IDLE_MS, SignInError, session as openSession, signOut } from './signin.mjs'

const API = `/api/v${pinnedApi()}`
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
  node migrate.mjs signout <workspace> [--side source|target]

describe reaches both instances (or the --side named), extract the source, load and verify the
target. The first command to reach an instance opens the browser to sign in; the commands after
it reuse that sign-in, kept in memory by a background process until ${IDLE_MS / 60000} minutes pass with no
command, or signout. Nothing is stored on disk.

  --then <command> [options]   run another step on the same workspace, e.g.
                               describe <workspace> --side target --then load
                               load <workspace> --run --then verify
  The chain stops at the first step that does not exit 0. A dry run cannot chain into
  load --run: the user reads it and says yes first.

The mapping format is in mapping-format.md beside the skill.`

class Stop extends Error {
  constructor (message, code = 2) { super(message); this.code = code }
}

// The App API version of the plugin's x-platform pin (xplatform.json `api`); 24.3 when it cannot be read.
function pinnedApi () {
  try {
    const api = JSON.parse(readFileSync(new URL('../../../xplatform.json', import.meta.url), 'utf8')).api
    if (/^\d+\.\d+$/.test(api)) return api
  } catch {}
  return '24.3'
}

// A WARNING row or batch was applied; only its warnings differ from SUCCESS.
const applied = (status) => status === 'SUCCESS' || status === 'WARNING'
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
// A key is a target field the record writes, or a platform uniqueness key over fields it writes:
// {"field": "contact_role_chk_p", "of": ["contact_p", "what_p"]} matches the target record whose
// contact_role_chk_p is "<contact id>|<what id>", the text a *_chk_p field holds. That is how a
// record a trigger already derived is matched instead of inserted twice, which breaks the
// constraint and rolls back the whole batch.
const keyField = (o) => typeof o.key === 'object' && o.key ? o.key.field : o.key
const keyValue = (o, values) => {
  if (!(typeof o.key === 'object' && o.key)) return values[o.key] ?? null
  const parts = o.key.of.map((f) => values[f])
  return parts.every((v) => v != null && v !== PLANNED) ? parts.join('|') : null
}

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
  const session = await openSession(conn.url, { side, log: say })
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
        throw new Stop(`the ${side} instance (${conn.url}) refused the signed-in user (HTTP ${res.status}); run signout, then the command again, and sign in as a user who can ${side === 'target' ? 'read and write' : 'read'} the migrated objects`)
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
        const v = applied(e.status) ? r.supplemental?.variants?.[e['variant-index']] : null
        if (v) out[e.name] = v
      }
    }
    return out
  }
  const objects = {}
  for (const [name, v] of Object.entries(await variants('/describe/object_p', names))) {
    objects[name] = {
      label: v.label ?? name,
      description: v.description ?? null, // what the object is for: choose a target by this, not by its name
      includedPolyids: v['included-polyids'] ?? [], // the polyids ({object, field}) that may point at this object
      fields: Object.fromEntries((v.fields ?? []).filter((f) => f.active !== false).map((f) => [f.name, {
        label: f.label ?? f.name,
        description: f.description ?? null,
        type: f.type,
        subtype: f.subtype ?? null,
        required: !!f.required,
        unique: !!f.unique,
        readOnly: !!f['read-only'], // platform-generated (increment, converted currency) or locked in the initial state
        lookup: f.relationship ?? null,
        objects: f['allowed-objects'] ?? null,
        relatedObjectField: f['related-object-field'] ?? null, // a polyid's companion naming the object it points at
        picklist: f.picklist ?? null,
        // What the instance enforces on write, as the describe resolves it (defaults included).
        maxLength: f['max-length'] ?? null,
        minValue: f['min-value'] ?? null,
        maxValue: f['max-value'] ?? null,
        dependsOn: f.dependency === 'object' ? f['parent-object'] ?? null : null // the object_ref field whose object narrows the values
      }]))
    }
  }
  const lists = [...new Set(Object.values(objects).flatMap((o) => Object.values(o.fields).map((f) => f.picklist).filter(Boolean)))]
  const picklists = {}
  const picklistItems = {}
  for (const [name, v] of Object.entries(await variants('/describe/picklist_p', lists))) {
    const items = (v.items ?? []).filter((i) => i.active !== false)
    picklists[name] = items.map((i) => i.name)
    picklistItems[name] = items.map((i) => ({ name: i.name, label: i.label ?? null, parentObjects: i['parent-objects'] ?? null }))
  }
  // A currency value needs the record's currency_p, so which codes have one decides what loads.
  const code = objects.currency_p && Object.keys(objects.currency_p.fields).find((n) => objects.currency_p.fields[n].unique && objects.currency_p.fields[n].picklist)
  const currencies = code ? [...new Set((await read('/data/query', { query: `SELECT ${code} FROM currency_p LIMIT 1000` })).data?.map((r) => r[code]).filter(Boolean) ?? [])] : null
  return { objects, picklists, picklistItems, currencies }
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
    if (tf.readOnly) {
      e.todo = `${fname} is read-only on ${target}: drop it ("drop": true) or map the value to another field`
    } else if (tf.type !== f.type) {
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
    if (o.key && typeof o.key === 'object') {
      if (!o.key.field || !Array.isArray(o.key.of) || !o.key.of.length) throw new Stop(`mapping.json: ${o.source}: a composite key needs "field" and "of"`)
      for (const f of o.key.of) if (!o.fields.some((e) => e.target === f && !e.drop)) throw new Stop(`mapping.json: ${o.source}: key part ${f} is not one of the fields it writes`)
    } else if (o.key && !o.fields.some((e) => e.target === o.key && !e.drop)) throw new Stop(`mapping.json: ${o.source}: key ${o.key} is not one of the fields it writes`)
    for (const e of o.fields) {
      const at = `mapping.json: ${o.source}.${e.target ?? e.from}`
      if (e.drop) continue
      if (!TO.fields[e.target]) throw new Stop(`${at}: ${o.target} has no field ${e.target}`)
      if (SYSTEM.has(e.target)) throw new Stop(`${at}: ${e.target} is a system field and cannot be written`)
      if (!('value' in e) && !e.expr && !e.from && !e.objectOf) throw new Stop(`${at}: needs "from", "value", "expr" or "objectOf"`)
      if (e.objectOf && !o.fields.some((x) => x.target === e.objectOf && x.lookup && !x.drop)) throw new Stop(`${at}: objectOf ${e.objectOf} is not a lookup this object writes`)
      for (const x of lookupObjects(e)) if (!names.has(x)) throw new Stop(`${at}: lookup ${x} is not an object in this mapping; migrate it or use {"object", "match"}`)
      if (isMatch(e) && !(e.lookup.object && e.lookup.match)) throw new Stop(`${at}: a match lookup needs "object" and "match"`)
      if (isMatch(e) && e.lookup.by != null && e.lookup.by !== 'value') throw new Stop(`${at}: a match lookup's "by" is "value" or absent`)
      if (e.normalize && !NORMALIZE.includes(e.normalize)) throw new Stop(`${at}: normalize is one of ${NORMALIZE.join(', ')}`)
      for (const x of [].concat(e.distinctFrom ?? [])) if (!o.fields.some((y) => y.target === x && !y.drop)) throw new Stop(`${at}: distinctFrom ${x} is not a field this object writes`)
    }
  }
}

// Parents before children. A cycle is broken at the object with the fewest unplaced parents; a
// lookup to the object itself or to one placed later is filled by the second pass.
function loadOrder (m) {
  const byName = Object.fromEntries(m.objects.map((o) => [o.source, o]))
  // A match lookup onto an object this mapping also loads waits for it, so it matches what loaded.
  const parents = (e) => isMatch(e) ? m.objects.filter((x) => x.target === e.lookup.object).map((x) => x.source) : lookupObjects(e)
  const deps = Object.fromEntries(m.objects.map((o) => [o.source, new Set(o.fields.filter((e) => !e.drop).flatMap(parents).filter((d) => d !== o.source && byName[d]))]))
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
    deferred: deferredFields(byName[n].fields, (d) => order.indexOf(d) >= i)
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
// The fields filled by the second pass: lookups to the object itself or to one loaded after it,
// and the companion naming what each of those points at.
function deferredFields (fields, later) {
  const out = new Set(fields.filter((e) => !e.drop && lookupObjects(e).some(later)).map((e) => e.target))
  for (const e of fields) if (e.objectOf && out.has(e.objectOf)) out.add(e.target)
  return out
}

// A polyid's companion ({"target": "whaton_p", "objectOf": "what_p"}) names the target object the
// polyid's id resolved through: the object of a match lookup, or the target of the source object
// whose id map held it. Blank when the polyid is blank, so the pair never disagrees.
function pointer (e, v, objs, resolve, targetOf) {
  if (isMatch(e)) return e.lookup.object
  const x = objs.find((o) => resolve([o], v))
  return x ? targetOf[x] ?? null : null
}

const raw = (e, row) => 'value' in e ? e.value : e.expr ? evaluate(e.expr, row) : row[e.from] ?? null

// Rules the CRM triggers enforce on write that the describe does not declare, at the pinned
// release. The dry run checks them; sfmigrate draft proposes the fix.
export const TARGET_RULES = {
  contact_p: {
    // Phone numbers, and the work and personal emails: each pair must differ when both are set.
    // The trigger scopes the error to the second field.
    distinct: [['mobile_phone_p', 'office_phone_p'], ['mobile_phone_p', 'home_phone_p'], ['office_phone_p', 'home_phone_p'], ['work_email_p', 'personal_email_p']],
    // LinkedIn URLs are normalized on write; anything the platform cannot correct is refused.
    normalize: { linkedin_profile_p: 'linkedin' },
    // A new contact's owner is the caller.
    setOnInsert: { owner_p: 'Aspen makes the person loading a contact its owner, whatever the row says; reassigning it is a separate update' }
  }
}

// `"normalize"` on a field entry: the value converted to what the target accepts, or blank when it
// cannot be done without guessing. Each returns null for a value it cannot convert.
const LINKEDIN = 'https://www.linkedin.com/in/'
const NORMALIZERS = {
  // E.164. Unambiguous cases only: an explicit + or 00 country code, a 10-digit North American
  // number, or a leading 1 written apart from it (1-415-...). Anything else is a national format
  // whose country the value does not say.
  phone (s) {
    const t = s.trim().replace(/\s*(?:ext\.?|x|#)\s*\d+$/i, '')
    const digits = t.replace(/\D/g, '')
    const intl = /^\+/.test(t) ? digits : /^00/.test(t) ? digits.slice(2) : null
    if (intl != null) return intl.length >= 8 && intl.length <= 15 ? `+${intl}` : null
    const nanp = (d) => /^[2-9]\d{2}[2-9]\d{6}$/.test(d)
    if (digits.length === 10 && nanp(digits)) return `+1${digits}`
    if (digits.length === 11 && digits[0] === '1' && nanp(digits.slice(1)) && /^\(?1[\s.)-]/.test(t)) return `+${digits}`
    return null
  },
  // http or https; a value with no scheme gets https://. Too long for the field: the query and
  // fragment go first, then the value.
  url (s, f) {
    let t = s.trim().replace(/^\/\//, '')
    if (!t) return null
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = `https://${t}`
    try { if (!['http:', 'https:'].includes(new URL(t).protocol)) return null } catch { return null }
    if (f.maxLength != null && [...t].length > f.maxLength) t = t.replace(/[?#].*$/, '')
    return f.maxLength != null && [...t].length > f.maxLength ? null : t
  },
  // The platform's own normalize_linkedin_url, so what loads is what the instance keeps.
  linkedin (s) {
    let t = s.trim().replace(/[?#].*$/, '')
    for (const p of ['http://linkedin.com/in/', 'https://linkedin.com/in/', 'http://www.linkedin.com/in/', 'www.linkedin.com/in/', 'linkedin.com/in/']) {
      if (t.startsWith(p)) { t = LINKEDIN + t.slice(p.length); break }
    }
    if (!t.startsWith(LINKEDIN)) return null
    const slash = t.indexOf('/', LINKEDIN.length)
    return slash === -1 ? t : t.slice(0, slash)
  }
}
export const NORMALIZE = Object.keys(NORMALIZERS)

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

// What the instance checks on write, so a dry run fails the row instead of the load: the length
// and range the describe declares, and what the phone and url subtypes accept (E.164; http/https).
function rejects (s, f) {
  if (s === '') return null
  if (f.type === 'text') {
    const n = [...s].length
    if (f.maxLength != null && n > f.maxLength) return ['too long', `${n} characters; the field allows ${f.maxLength}`]
    if (f.subtype === 'phone' && !/^\+[0-9]{1,15}$/.test(s)) return ['not an E.164 phone number', s]
    if (f.subtype === 'url') {
      let scheme = null
      try { scheme = new URL(s).protocol } catch {}
      if (scheme !== 'http:' && scheme !== 'https:') return ['not an http or https URL', s]
    }
  }
  if (f.type === 'number' || f.type === 'currency') {
    if (f.minValue != null && Number(s) < Number(f.minValue)) return ['below the minimum', `${s} < ${f.minValue}`]
    if (f.maxValue != null && Number(s) > Number(f.maxValue)) return ['above the maximum', `${s} > ${f.maxValue}`]
  }
  return null
}

function convert (row, o, TO, lists, { resolve, extracted, refs, deferred, targetOf = {} }) {
  const picklists = lists.picklists ?? {}
  const values = {}
  const errors = []
  const changed = [] // values normalize, truncate or distinctFrom changed or blanked, for the report
  const points = {}
  let wait = false
  const err = (field, kind, detail) => errors.push({ field, kind, detail })
  for (const e of o.fields) {
    if (e.drop || e.objectOf || deferred.has(e.target)) continue
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
        const key = e.lookup.by === 'value' ? v : r.source?.[v]
        const id = key == null ? undefined : r.target.get(key)
        if (id) { points[e.target] = e.lookup.object; v = id } else if (e.missing === 'null') v = null
        else { err(e.target, 'no match on the target', `no ${e.lookup.object} with ${e.lookup.match} = ${key ?? '(blank)'}`); continue }
      } else {
        const objs = lookupObjects(e)
        const id = resolve(objs, v)
        if (id) { points[e.target] = pointer(e, v, objs, resolve, targetOf); v = id } else if (objs.some((x) => extracted[x]?.has(v))) { wait = true; continue }
        else if (e.missing === 'null') { v = null; changed.push({ field: e.target, kind: `blank: the ${objs.join('/')} is not in the extract` }) }
        else { err(e.target, 'lookup not in the extract', `${objs.join('/')} ${v}`); continue }
      }
    }
    const out = format(v, f)
    if (out.error) { err(e.target, out.error, String(v)); continue }
    if (out.value != null && e.normalize) {
      const n = NORMALIZERS[e.normalize](out.value, f)
      if (n !== out.value) changed.push({ field: e.target, kind: n == null ? `blank: not convertible by normalize ${e.normalize}` : `normalized (${e.normalize})` })
      out.value = n
    }
    if (out.value != null && e.truncate && f.maxLength != null && [...out.value].length > f.maxLength) {
      out.value = [...out.value].slice(0, f.maxLength).join('')
      changed.push({ field: e.target, kind: `truncated to ${f.maxLength}` })
    }
    if (out.value === null && f.required) { err(e.target, 'required', 'blank'); continue }
    // A reference picklist (object type, security profile, field) names no list; the instance checks it.
    if (f.type === 'picklist' && f.picklist && out.value != null && !(picklists[f.picklist] ?? []).includes(out.value)) { err(e.target, 'not a value of the target picklist', out.value); continue }
    const bad = out.value == null ? null : rejects(out.value, f)
    if (bad) { err(e.target, ...bad); continue }
    values[e.target] = out.value
  }
  // "distinctFrom": blank this field when it holds the same value as the named one(s).
  for (const e of o.fields) {
    if (e.drop || !e.distinctFrom || values[e.target] == null) continue
    const other = [].concat(e.distinctFrom).find((x) => values[x] === values[e.target])
    if (other) { values[e.target] = null; changed.push({ field: e.target, kind: `blank: same as ${other}` }) }
  }
  for (const [a, b] of TARGET_RULES[o.target]?.distinct ?? []) {
    if (values[a] != null && values[a] === values[b]) err(b, `must differ from ${a}`, 'the CRM trigger refuses the same value in both')
  }
  for (const e of o.fields) {
    // A row waiting on its polyid's record is written later; its companion is not blank yet.
    if (wait || e.drop || !e.objectOf || deferred.has(e.target)) continue
    const v = points[e.objectOf] ?? null
    if (v === null && TO.fields[e.target]?.required) { err(e.target, 'required', `blank: ${e.objectOf} is blank`); continue }
    values[e.target] = v
  }
  // An object-dependent picklist value must allow the object its parent-object field names.
  for (const [name, v] of Object.entries(values)) {
    const f = TO.fields[name]
    if (wait || !f?.dependsOn || v == null || !(f.dependsOn in values)) continue
    const on = values[f.dependsOn]
    const allows = (lists.picklistItems?.[f.picklist] ?? []).find((i) => i.name === v)?.parentObjects
    if (on == null) err(name, 'parent object is blank', `${f.dependsOn} is blank`)
    else if (allows && !allows.includes(on)) err(name, 'not allowed on that object', `${v} is not allowed on ${on} (only ${allows.join(', ')})`)
  }
  // Aspen gives any object with a currency field a ccode_p (the record's currency_p) and refuses a
  // currency value sent without one. The describe names no link between them: this is the platform's rule.
  const money = Object.keys(values).filter((n) => values[n] != null && TO.fields[n]?.type === 'currency')
  if (!wait && TO.fields.ccode_p && money.length && values.ccode_p == null && !errors.some((x) => x.field === 'ccode_p')) err('ccode_p', 'required with a currency value', `${money.join(', ')} set, ccode_p blank`)
  return { values, errors, wait, changed }
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
    data.forEach((d, k) => applied(d.status)
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
  const targetOf = Object.fromEntries(m.objects.map((o) => [o.source, o.target]))
  const files = (o) => ({ extract: ws.path('extract', `${o.source}.jsonl`), idmap: ws.path('idmap', `${o.source}.jsonl`), patched: ws.path('idmap', `${o.source}.patched.jsonl`), errors: ws.path('errors', `${o.source}.jsonl`) })
  const rows = {}; const extracted = {}; const idmaps = {}; const matched = {}; const planned = {}; const errors = {}; const stats = {}
  const changes = new Map() // "<object>\0<field>\0<what>" → rows: what normalize, truncate and distinctFrom did
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
    if (ref.by !== 'value' && !existsSync(file)) throw new Stop(`the mapping matches ${ref.object} by ${ref.match}, which the extract lacks; run extract again`)
    refs[`${ref.object}.${ref.match}`] = { ...ref, source: ref.by === 'value' ? null : readJson(file), target: await indexBy(tgt.reader, ref.object, ref.match) }
  }
  // A record this run inserts can be matched by the objects loaded after it (owners onto team members).
  const indexed = (o, values, id) => {
    for (const r of Object.values(refs)) if (r.object === o.target && values[r.match] != null && !r.target.has(values[r.match])) r.target.set(values[r.match], id)
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
    const existing = o.key ? await indexBy(tgt.reader, o.target, keyField(o)) : null
    const ctx = { resolve: resolveId, extracted, refs, deferred: step.deferred, targetOf }
    const inserts = []; const updates = []; const keys = new Set()
    for (const row of rows[o.source]) {
      const c = convert(row, o, TO, T, ctx)
      if (!c.errors.length && !c.wait) for (const x of c.changed) changes.set(`${o.source}\u0000${x.field}\u0000${x.kind}`, (changes.get(`${o.source}\u0000${x.field}\u0000${x.kind}`) ?? 0) + 1)
      const known = idmaps[o.source].get(row.id_p)
      if (known) {
        st.loaded++
        if (o.onMatch === 'update' && !c.errors.length && !c.wait) updates.push({ row, values: { id_p: known, ...c.values } })
        continue
      }
      if (c.errors.length) { fail(o, row.id_p, c.errors); continue }
      if (c.wait) { st.waiting++; continue }
      const kv = o.key ? keyValue(o, c.values) : null
      if (kv != null && existing.has(kv)) {
        st.matched++
        if (run) remember(o, row.id_p, existing.get(kv), true)
        else planned[o.source].add(row.id_p)
        if (o.onMatch === 'update') updates.push({ row, values: { id_p: existing.get(kv), ...c.values } })
        continue
      }
      if (kv != null && keys.has(kv)) { fail(o, row.id_p, { field: keyField(o), kind: 'duplicate key in the source', detail: `another ${o.source} record has the same ${keyField(o)}` }); continue }
      if (kv != null) keys.add(kv)
      if (limit != null && inserts.length >= limit) { st.held++; continue }
      inserts.push({ row, values: c.values })
    }
    if (!run) {
      for (const i of inserts) { planned[o.source].add(i.row.id_p); indexed(o, i.values, PLANNED) }
      st.inserted = inserts.length
      st.updated = updates.length
      continue
    }
    await writeBatches(tgt.write, 'POST', o.target, inserts, batch, (i, id, e) => {
      if (id) { st.inserted++; remember(o, i.row.id_p, id, false); indexed(o, i.values, id) } else fail(o, i.row.id_p, e)
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
      const points = {}
      for (const e of o.fields.filter((x) => !x.drop && !x.objectOf && step.deferred.has(x.target))) {
        const v = raw(e, row)
        if (v == null) continue
        const id = resolveId(lookupObjects(e), v)
        if (id) { values[e.target] = id; points[e.target] = pointer(e, v, lookupObjects(e), resolveId, targetOf) } else if (lookupObjects(e).some((x) => extracted[x]?.has(v))) open = true
        else if (e.missing !== 'null') fail(o, row.id_p, { field: e.target, kind: 'lookup not in the extract', detail: `${lookupObjects(e).join('/')} ${v}` })
        else { const k = `${o.source}\u0000${e.target}\u0000blank: the ${lookupObjects(e).join('/')} is not in the extract`; changes.set(k, (changes.get(k) ?? 0) + 1) }
      }
      for (const e of o.fields.filter((x) => !x.drop && x.objectOf && step.deferred.has(x.target))) {
        if (points[e.objectOf]) values[e.target] = points[e.objectOf]
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
  const report = loadReport(m, order, stats, errors, { run, limit, changes })
  writeText(ws.path('reports', run ? 'load.md' : 'plan.md'), report)
  const total = (k) => Object.values(stats).reduce((n, s) => n + s[k], 0)
  const incomplete = limit == null && (total('waiting') > 0 || total('pending') > 0)
  say(`${run ? 'loaded' : 'dry run'}: ${total('inserted')} ${run ? 'inserted' : 'to insert'}, ${total('matched')} matched, ${total('failed')} failed, ${total('waiting')} waiting on a parent; see reports/${run ? 'load' : 'plan'}.md`)
  return total('failed') > 0 || incomplete ? 1 : 0
}

function loadReport (m, order, stats, errors, { run, limit, changes = new Map() }) {
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
  if (changes.size) {
    lines.push('', '## Changed on the way in', '', 'Values `normalize`, `truncate` and `distinctFrom` changed or left blank, in rows that load.', '', '| Object | Field | Change | Records |', '|---|---|---|---|')
    for (const [k, n] of changes) { const [o, f, kind] = k.split('\u0000'); lines.push(`| ${o} | ${f} | ${kind} | ${n} |`) }
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
    refs[`${ref.object}.${ref.match}`] = { source: ref.by === 'value' ? null : readJson(ws.path('extract', 'match', `${ref.object}.${ref.match}.json`)), target: await indexBy(tgt.reader, ref.object, ref.match) }
  }
  const ctx = { resolve: (objs, id) => objs.map((x) => idmaps[x]?.get(id)).find(Boolean), extracted, refs, deferred: new Set(), targetOf: Object.fromEntries(m.objects.map((o) => [o.source, o.target])) }
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
      const c = convert(row, o, TO, T, ctx)
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

const COMMANDS = ['init', 'describe', 'draft', 'extract', 'load', 'verify', 'signout']

export async function main (argv) {
  const [cmd, wsArg, ...rest] = argv
  if (!cmd || ['help', '--help', '-h'].includes(cmd) || rest.includes('--help')) { say(HELP); return 0 }
  // `--then` starts the next step: its command, then its options; the workspace is the first step's.
  const steps = [[cmd]]
  for (const a of rest) a === '--then' ? steps.push([]) : steps.at(-1).push(a)
  const plan = steps.map(([c, ...o]) => {
    if (!COMMANDS.includes(c)) throw new Stop(`unknown command: ${c ?? '(none after --then)'}\n\n${HELP}`)
    if ((c === 'init' || c === 'signout') && steps.length > 1) throw new Stop(`${c} cannot be chained: run it on its own`)
    return { cmd: c, opts: options(o) }
  })
  if (plan.some((s, i) => s.cmd === 'load' && s.opts.run && plan.slice(0, i).some((p) => p.cmd === 'load' && !p.opts.run))) {
    throw new Stop('load --run cannot follow a dry run in one chain: the user reads the dry run and says yes first')
  }
  const opts = plan[0].opts
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
  if (cmd === 'signout') {
    for (const side of sides(opts)) say(`${side}: ${await signOut(m[side].url) ? 'signed out' : 'no sign-in was kept'}`)
    return 0
  }
  // One session per side for the whole chain.
  const opened = {}
  const open = (side) => (opened[side] ??= connect(m[side], side))
  try {
    let code = 0
    for (const [i, s] of plan.entries()) {
      if (plan.length > 1) say(`== ${s.cmd}`)
      code = await run(s.cmd, ws, i ? readMapping(ws) : m, s.opts, open)
      if (code !== 0 && i < plan.length - 1) { say(`stopped: ${s.cmd} exited ${code}; ${plan.slice(i + 1).map((x) => x.cmd).join(', ')} did not run`); break }
    }
    return code
  } finally {
    await Promise.allSettled(Object.values(opened).map(async (c) => (await c).close()))
  }
}

function sides (opts) {
  if (opts.side && !['source', 'target'].includes(opts.side)) throw new Stop('--side is source or target')
  return opts.side ? [opts.side] : ['source', 'target']
}

async function run (cmd, ws, m, opts, open) {
  if (cmd === 'describe') {
    for (const side of sides(opts)) {
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
    for (const ref of matchRefs(m).filter((r) => r.by !== 'value')) {
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

// Compared by real path: run through a symlinked directory (macOS /var, a plugin cache), the
// module URL is the resolved one.
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (e) => { const known = e instanceof Stop || e instanceof SignInError; console.error(known ? e.message : (e?.stack ?? String(e))); process.exitCode = known ? e.code : 1 }
  )
}

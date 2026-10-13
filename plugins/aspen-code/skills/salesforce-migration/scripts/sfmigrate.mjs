#!/usr/bin/env node
// Read a Salesforce org, map one or more of its objects onto this Aspen instance's data model,
// report the gaps, and write the extract that instance-migration's migrate.mjs loads.
//
//   node sfmigrate.mjs init <workspace> --from-export <dir> | --org <alias|username>
//   node sfmigrate.mjs plan <workspace> --objects Account,Contact   describe both sides, probe, draft
//   node sfmigrate.mjs describe <workspace> --objects Account,Contact   SFDC describe -> schema/source.json
//   node sfmigrate.mjs probe <workspace> [--sample 500]   which fields actually hold data -> schema/fill.json
//   node sfmigrate.mjs draft <workspace> [--redraft]    mapping.json + the gap report
//   node sfmigrate.mjs gaps <workspace>                 re-report after settling todos
//   node sfmigrate.mjs extract <workspace> [--limit N]  SFDC records -> extract/
//
// With --from-export the source is a Salesforce export on disk (manifest.json, describe/<Object>.json
// and one CSV per object, as export_g17.py writes it) and Salesforce is not reached at all: describe,
// probe and extract read the files, so a filtered or date-shifted export loads exactly as it is.
//
// Then the Aspen side is migrate.mjs in the instance-migration skill, unchanged:
//   node migrate.mjs describe <workspace> --side target      (before draft)
//   node migrate.mjs load <workspace>                        dry run
//   node migrate.mjs load <workspace> --run --limit 20       pilot, then --run
//   node migrate.mjs verify <workspace>
//
// Salesforce is reached only through the `sf` CLI, which holds its own auth: this script never
// asks for, reads or prints a token. Salesforce is only read; nothing is written back to it.
//
// Exit codes: 0 done; 1 the org or a report says something is wrong; 2 bad invocation, or the
// workspace, the mapping or the CLI is not ready.

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TARGET_RULES } from '../../instance-migration/scripts/migrate.mjs'

const MIGRATE = fileURLToPath(new URL('../../instance-migration/scripts/migrate.mjs', import.meta.url))

const IGNORED = ['extract/', 'idmap/', 'errors/', 'schema/']
// Salesforce owns these: they are not writable on insert, and Aspen stamps its own.
const SF_SYSTEM = new Set([
  'Id', 'IsDeleted', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById',
  'SystemModstamp', 'LastActivityDate', 'LastViewedDate', 'LastReferencedDate',
  'MasterRecordId', 'ConnectionReceivedId', 'ConnectionSentId', 'UserRecordAccessId'
])

const HELP = `Map a Salesforce object onto this Aspen instance and build the extract.

  node sfmigrate.mjs init <workspace> --from-export <dir>    a Salesforce export on disk
  node sfmigrate.mjs init <workspace> --org <alias|username> a live org through the sf CLI
  node sfmigrate.mjs plan <workspace> --objects <SFDC objects> [--keep-target] [--redraft]
      describe, the Aspen target's describe, probe and draft in one run
  node sfmigrate.mjs describe <workspace> --objects <SFDC objects, comma-separated>
  node sfmigrate.mjs probe <workspace> [--objects <subset>] [--sample 500]
  node sfmigrate.mjs draft <workspace> [--objects <subset>] [--redraft]
  node sfmigrate.mjs gaps <workspace>
  node sfmigrate.mjs extract <workspace> [--limit N] [--mode bulk|rest]

The Aspen side stays with the instance-migration skill's migrate.mjs: load, pilot, verify and
signout. The first Aspen command opens the browser to sign in; later ones reuse that sign-in.

Salesforce is reached through the \`sf\` CLI only, and not at all for an export. Nothing is written
to Salesforce.`

class Stop extends Error {
  constructor (message, code = 2) { super(message); this.code = code }
}

const say = (line) => console.log(line)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + '\n') }
const writeText = (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t) }
const writeLines = (p, rows) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, rows.map((r) => JSON.stringify(r) + '\n').join('')) }
const chunksOf = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const sameUrl = (a, b) => String(a).trim().replace(/\/+$/, '').toLowerCase() === String(b).trim().replace(/\/+$/, '').toLowerCase()
const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean)

// ---- a Salesforce export on disk: manifest.json, describe/<Object>.json, <Object>.csv

function readExport (dir) {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) throw new Stop(`${dir} has no manifest.json; point --from-export at the export's own directory`)
  const man = readJson(file)
  const objects = {}
  for (const o of man.objects ?? []) {
    if (o.status && o.status !== 'ok') continue
    if (existsSync(join(dir, `${o.object}.csv`))) objects[o.object] = { records: o.records ?? null }
  }
  // The owners' emails, when the export carries them: owner lookups then need no live org.
  if (!objects.User && existsSync(join(dir, 'User.csv'))) objects.User = { records: null }
  if (!Object.keys(objects).length) throw new Stop(`${file} lists no object with a CSV beside it`)
  return { dir, org: man.org ?? null, started: man.started ?? null, finished: man.finished ?? null, dateShiftYears: man.date_shift_years ?? null, objects }
}

// The export this workspace was set up from, refused if it was regenerated since: a mapping drafted
// from one export says nothing reliable about another.
function exportOf (m) {
  const x = m.source?.export
  if (!x) return null
  const now = readExport(x.dir)
  if (now.started !== x.started || now.finished !== x.finished) throw new Stop(`the export in ${x.dir} changed since init (finished ${x.finished}, now ${now.finished}): run init again, then plan`)
  return x
}

const exportCsv = (x, object) => {
  const file = join(x.dir, `${object}.csv`)
  if (!existsSync(file)) throw new Stop(`the export in ${x.dir} has no ${object}.csv`)
  return file
}

// RFC 4180, streamed so a large export never sits in memory: a quoted field may hold commas,
// doubled quotes and newlines. Each row comes back keyed by the header.
function * csvRecords (file) {
  const fd = openSync(file, 'r'); const buf = Buffer.alloc(1 << 20); const dec = new StringDecoder('utf8')
  let header = null; let row = []; let field = ''; let quoted = false; let quote = false
  const done = () => { row.push(field.endsWith('\r') && !quoted ? field.slice(0, -1) : field); const r = row; row = []; field = ''; return r }
  const emit = (r) => { if (!header) { header = r.map((h, i) => i ? h : h.replace(/^\uFEFF/, '')); return null } return Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) }
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) {
      for (const c of dec.write(buf.subarray(0, n))) {
        if (quote) { quote = false; if (c === '"') { field += c; continue } quoted = false }
        if (quoted) { if (c === '"') quote = true; else field += c; continue }
        if (c === '"' && field === '') quoted = true
        else if (c === ',') { row.push(field); field = '' } else if (c === '\n') { const r = emit(done()); if (r) yield r } else field += c
      }
    }
    if (field !== '' || row.length) { const r = emit(done()); if (r) yield r }
  } finally { closeSync(fd) }
}

// Standard Salesforce key prefixes, for an object the export does not describe.
const KEY_PREFIX = { '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity', '00Q': 'Lead', '00T': 'Task', '00U': 'Event', '500': 'Case', '00G': 'Group' }

// The `where` draft writes, evaluated on an export's rows: clauses joined by AND, each
// `Field = v`, `!=`, `IN (...)` or `NOT IN (...)`, or `Rel.Type = 'Object'` (the object the row's
// lookup points at, by its id's key prefix). Anything else is refused rather than guessed at.
function exportFilter (where, S, src, object) {
  if (!where) return () => true
  const lit = (t) => { t = t.trim(); const q = /^'(.*)'$/.exec(t); return q ? q[1].replace(/\\'/g, "'") : /^null$/i.test(t) ? '' : t.toLowerCase() === 'true' || t.toLowerCase() === 'false' ? t.toLowerCase() : t }
  const typeOf = (id) => {
    const pre = String(id ?? '').slice(0, 3)
    return Object.entries(src.objects).find(([, o]) => o.keyPrefix === pre)?.[0] ?? KEY_PREFIX[pre] ?? ''
  }
  const tests = where.split(/\s+AND\s+/i).map((clause) => {
    const c = /^\s*\(?\s*([\w.]+)\s*(=|!=|NOT\s+IN|IN)\s*(.+?)\s*\)?\s*$/i.exec(clause)
    if (!c) throw new Stop(`${object}: an export cannot be filtered by \`${clause.trim()}\`; filter the export itself, or write the where as Field = value, IN (...) or Rel.Type = 'Object' clauses`)
    const [, path, op, rest] = c
    const want = /IN/i.test(op) ? rest.replace(/^\(|\)$/g, '').split(',').map(lit) : [lit(rest)]
    const typed = /^(\w+)\.Type$/.exec(path)
    let get
    if (typed) {
      const fk = Object.entries(S?.fields ?? {}).find(([, f]) => f.sf.relationshipName === typed[1])?.[0]
      if (!fk) throw new Stop(`${object}: where names ${path}, but ${object} has no relationship ${typed[1]}`)
      get = (r) => typeOf(r[fk])
    } else if (path.includes('.')) throw new Stop(`${object}: an export cannot be filtered by the parent field ${path}`)
    else get = (r) => { if (!(path in r)) throw new Stop(`${object}: where names ${path}, which the export has no column for`); return r[path] }
    const has = (r) => want.includes(get(r))
    return /^(=|IN)$/i.test(op) ? has : (r) => !has(r)
  })
  return (r) => tests.every((t) => t(r))
}

// One object's rows from the export, in the shape extract writes: the Salesforce Id in id_p,
// CreatedDate in ct_p, a blank cell as null. A parent's field (Task.Subject on a TaskRelation) is
// joined from the parent's own CSV through the row's lookup to it (TaskId).
function exportRows (x, o, fields, src, limit) {
  const S = src.objects[o.source]
  const keep = exportFilter(o.where, S, src, o.source)
  const joins = {}
  for (const f of fields.filter((f) => f.includes('.'))) {
    const [rel, col] = f.split('.')
    const [fk, def] = Object.entries(S.fields).find(([, d]) => d.sf.relationshipName === rel) ?? []
    if (!fk) throw new Stop(`${o.source}: "${f}" names no relationship ${rel} on ${o.source}`)
    ;(joins[rel] ??= { fk, parent: def.sf.referenceTo[0], cols: new Set() }).cols.add(col)
  }
  for (const j of Object.values(joins)) {
    j.rows = new Map()
    for (const r of csvRecords(exportCsv(x, j.parent))) j.rows.set(r.Id, r)
  }
  const out = []
  let checked = false
  for (const r of csvRecords(exportCsv(x, o.source))) {
    if (!checked) {
      const missing = fields.filter((f) => !f.includes('.') && !(f in r))
      if (missing.length) throw new Stop(`${o.source}: the export has no column for ${missing.join(', ')}; export it, or drop it from the mapping`)
      checked = true
    }
    if (!keep(r)) continue
    const row = { id_p: r.Id }
    if (r.CreatedDate) row.ct_p = r.CreatedDate
    for (const f of fields) {
      let v = r[f]
      if (f.includes('.')) { const [rel, col] = f.split('.'); v = joins[rel].rows.get(r[joins[rel].fk])?.[col] }
      row[f] = v === undefined || v === '' ? null : v
    }
    out.push(row)
    if (limit && out.length >= limit) break
  }
  return out
}

// How full each field is, its longest value, and how often each picklist value occurs: what draft
// asks about, and only for what the data holds.
function profile (rows, S, names, into = { records: 0, fields: {} }) {
  const acc = {}
  for (const f of names) acc[f] = { n: 0, maxLen: 0, values: S.fields[f]?.picklist ? {} : null }
  let records = 0
  for (const r of rows) {
    records++
    for (const f of names) {
      const v = r[f]
      if (v === null || v === undefined || v === '') continue
      const a = acc[f]; a.n++; a.maxLen = Math.max(a.maxLen, String(v).length)
      if (a.values && Object.keys(a.values).length < 500) a.values[v] = (a.values[v] ?? 0) + 1
    }
  }
  into.records = Math.max(into.records, records)
  for (const [f, a] of Object.entries(acc)) into.fields[f] = { fill: records ? a.n / records : 0, maxLen: a.maxLen, ...(a.values ? { values: a.values } : {}) }
  return into
}

// The Aspen half of plan: the instance-migration skill's describe, on the kept sign-in or a new one.
function describeTarget (ws) {
  say('== target: the Aspen instance')
  const r = spawnSync(process.execPath, [MIGRATE, 'describe', ws.dir, '--side', 'target'], { stdio: 'inherit', cwd: ws.root })
  if (r.status !== 0) throw new Stop(`describing the target failed (exit ${r.status}); run migrate.mjs describe <workspace> --side target to see why`, r.status || 1)
}

// ---- the sf CLI. It owns the credentials; we only ever read.

function sf (args, { tolerate = false } = {}) {
  const r = spawnSync('sf', [...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 30 })
  if (r.error?.code === 'ENOENT') throw new Stop('the `sf` CLI is not on PATH; install the Salesforce CLI, then `sf org login web`')
  let out = null
  try { out = JSON.parse(r.stdout) } catch { /* fall through to the error below */ }
  if (out && out.status === 0) return out.result
  if (tolerate) return null
  // sf's message spans lines and the useful hint is often in `actions`; keep both on one line.
  const flat = (v) => String(v ?? '').replace(/\s*\n\s*/g, ' ').trim()
  const why = flat(out?.message) || flat((r.stdout || r.stderr || '').split('\n').slice(-3).join(' ')) || 'unknown error'
  const hint = (out?.actions ?? []).map(flat).filter(Boolean).join(' ')
  throw new Stop(`sf ${args.slice(0, 3).join(' ')} failed: ${why}${hint ? ` — ${hint}` : ''}`, 1)
}

const org = (ws, m) => {
  const alias = m.source?.org
  if (!alias) throw new Stop('mapping.json has no source.org; run init --org <alias>')
  return ['--target-org', alias]
}

// ---- the workspace, which must sit inside the target Aspen instance directory

function instanceRoot (start) {
  for (let d = resolve(start); ; d = dirname(d)) {
    const config = join(d, '.aspen', 'config.toml')
    if (existsSync(config)) return { dir: d, instance: /^\s*instance\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1] ?? null }
    if (dirname(d) === d) return null
  }
}

function workspace (arg) {
  if (!arg) throw new Stop('name the workspace directory, e.g. data/migrations/<org-name>')
  const dir = resolve(arg)
  const root = instanceRoot(dir)
  if (!root) throw new Stop(`${dir} is not inside an Aspen instance directory (no .aspen/config.toml above it); run this in the target instance's directory`)
  return { dir, root: root.dir, instance: root.instance, path: (...p) => join(dir, ...p) }
}

function readMapping (ws) {
  const file = ws.path('mapping.json')
  if (!existsSync(file)) throw new Stop(`no ${file}; run init first`)
  const m = readJson(file)
  if (!sameUrl(m.target?.url, ws.instance)) throw new Stop(`mapping.json's target ${m.target?.url} is not this directory's instance (${ws.instance}, from .aspen/config.toml)`)
  m.objects ??= []
  return m
}

const schema = (ws, side) => {
  const file = ws.path('schema', `${side}.json`)
  if (!existsSync(file)) {
    throw new Stop(side === 'source'
      ? 'no schema/source.json yet; run `sfmigrate describe <workspace> --objects ...`'
      : "no schema/target.json yet; run the instance-migration skill's `migrate.mjs describe <workspace> --side target`")
  }
  return readJson(file)
}

// The instance directory's own metadata for `object`, most complete first.
function localObjects (ws, object) {
  const out = []
  for (const base of ['metadata', 'metacode']) {
    for (const sub of ['compiled', 'custom', 'platform']) {
      const file = join(ws.root, base, sub, 'object_p', `${object}.json`)
      if (!existsSync(file)) continue
      try { out.push(readJson(file)) } catch { /* a malformed local file is not worth failing the draft over */ }
    }
  }
  return out
}

// What Aspen says an object and each of its fields are for: the describe's description, else the
// local metadata's. A mapping is chosen by these, not by a name that only looks close.
function describedAs (ws, tgt, object) {
  const T = tgt.objects[object]
  const local = localObjects(ws, object)
  const fields = {}
  for (const name of Object.keys(T?.fields ?? {})) {
    fields[name] = T.fields[name].description ?? local.flatMap((d) => d.fields ?? []).find((f) => f.name === name)?.description ?? null
  }
  return { object: T?.description ?? local.find((d) => d.description)?.description ?? null, fields }
}

const fillRates = (ws) => {
  const file = ws.path('schema', 'fill.json')
  return existsSync(file) ? readJson(file) : null
}

// ---- Salesforce types, in Aspen's vocabulary

// Aspen types: text, number, currency, picklist, checkbox, date, datetime, id, polyid, uuid.
const TYPES = {
  reference: ['id', 'lookup'],
  string: ['text', 'text'],
  textarea: ['text', 'long'],
  encryptedstring: ['text', 'text'],
  email: ['text', 'email'],
  phone: ['text', 'phone'],
  url: ['text', 'url'],
  picklist: ['picklist', 'picklist'],
  combobox: ['picklist', 'picklist'],
  boolean: ['checkbox', 'checkbox'],
  int: ['number', 'number'],
  long: ['number', 'number'],
  double: ['number', 'number'],
  percent: ['number', 'percentage'],
  currency: ['currency', 'currency'],
  date: ['date', 'date'],
  datetime: ['datetime', 'datetime'],
  anyType: ['text', 'text'],
  id: ['id', 'lookup'],
  // No Aspen counterpart: each becomes a gap below, with the ETL the user has to decide on.
  multipicklist: ['picklist', 'picklist'],
  base64: ['id', 'file'],
  address: [null, null],
  location: [null, null],
  time: ['text', 'text']
}

// A field whose value Salesforce computes, or whose shape Aspen has no type for. Takes the
// normalized field: the Salesforce facts live under `sf`. The category is the house vocabulary
// from the Vault mapping: it names the ETL, not just the mismatch.
function gapOf (f) {
  const s = f.sf ?? {}
  if (s.calculated && s.formula) return ['formula', 'Salesforce computes this. Aspen has no computed-field type: either extract the computed value as data, or move the rule to a Rust trigger and store the result (server-code).']
  if (s.calculated) return ['lookup (copied) field', 'A cross-object or roll-up value Salesforce maintains. Extract the value as data, or recompute it in a Rust trigger on the target.']
  if (s.type === 'multipicklist') return ['multi-select picklist', 'Aspen picklists hold one value. Keep the primary value, or model the set as a child object or checkbox fields.']
  if (s.type === 'address') return ['compound address', "Salesforce returns one compound value. Split it into the target's street/city/state/postal/country fields."]
  if (s.type === 'location') return ['compound geolocation', 'Split into two number fields (latitude, longitude).']
  if (s.type === 'time') return ['no time type', 'Aspen has date and datetime only. Store it as text, or fold it into a datetime.']
  if (s.type === 'base64') return ['file body', 'File contents do not migrate with records; attach files separately (the files skill).']
  if (s.type === 'reference' && (s.referenceTo ?? []).length > 1) return ['polymorphic lookup', `Points to ${s.referenceTo.join(', ')}. Aspen needs one target object per lookup, or a polyid field.`]
  return [null, null]
}

// BillingCity -> billing_city, SICDesc -> sic_desc, Custom_Thing__c -> custom_thing
const normalize = (name) => String(name)
  .replace(/__(c|r|s|b|e|kav|mdt|x)$/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// An Aspen name without its _p/_c suffix, normalized the same way.
const bare = (name) => normalize(String(name).replace(/_(p|c)$/, ''))

// Renames common enough to propose without the user saying so, keyed by the normalized
// Salesforce name (BillingCity -> billing_city). Every one still becomes a row in the gap
// report, so a wrong guess is visible before anything loads.
const SYNONYMS = {
  description: ['about', 'notes', 'body'],
  email: ['work_email'], // contact_p.work_email_p "primary and active work email address"
  phone: ['office_phone'], // contact_p.office_phone_p "primary office number"
  who_id: ['who'],
  what_id: ['what'],
  product_code: ['sku'],
  start_date_time: ['when'], // meeting_p.when_p "date and time the meeting starts"
  end_date_time: ['end'],
  is_all_day_event: ['all_day'],
  activity_date: ['due_date'], // a Task's ActivityDate is its due date
  completed_date_time: ['when'], // task_p.when_p "date and time the task was completed"
  lead_source: ['source'],
  start_date: ['start'],
  end_date: ['end'],
  converted_account_id: ['account'],
  converted_contact_id: ['contact'],
  converted_opportunity_id: ['opportunity'],
  number_of_employees: ['employees', 'employee_count'],
  annual_revenue: ['revenue'],
  mobile_phone: ['mobile'],
  billing_street: ['street'],
  billing_city: ['city'],
  billing_state: ['state'],
  billing_postal_code: ['postal_code', 'zip'],
  billing_country: ['country'],
  stage_name: ['stage'],
  close_date: ['close'],
  owner_id: ['owner'],
  account_id: ['account', 'customer'], // opportunity_p.customer_p "account or contact ... as the buyer"
  contact_id: ['contact'],
  parent_id: ['parent', 'parent_account', 'parent_case', 'what'],
  reports_to_id: ['reports_to', 'manager'],
  first_name: ['first'],
  last_name: ['last'],
  title: ['job_title'],
  amount: ['value'],
  web_site: ['website'],
  photo_url: ['photo', 'image']
}

// Salesforce junctions Aspen models as one polymorphic object. contact_role_p "associates a
// contact with any other record" and team_role_p "a person on a team with any other record" (their
// descriptions): what_p, a polyid, names the record and whaton_p its object. No name or label
// matches them, and contact_rel_p -- by its description a team member's relationship strength with
// a contact -- only looks close. `parent` fills what_p, `member` the team member (a Salesforce
// User, matched by email), and `role` is proposed for role_p.
//
// Aspen's triggers derive these rows too: a contact role from contact_p.primary_account_p and
// account_p.primary_contact_p, from opportunity_p.customer_p and from a case's contact; a team
// role from the owner of an account, opportunity or case. Inserting a pair one of them already
// made breaks the *_chk_p key ("<left id>|<what id>") and rolls back the batch, so `key` matches on
// it and the derived row is left as it is. Salesforce's direct AccountContactRelation (the
// contact's own account) is exactly that pair, so it is not extracted at all.
const CONTACT_KEY = ['contact_role_chk', 'contact', 'what']
const TEAM_KEY = ['team_role_chk', 'team', 'what']
const JUNCTIONS = {
  AccountContactRelation: {
    target: 'contact_role', parent: 'AccountId', role: 'Roles', key: CONTACT_KEY, where: 'IsDirect = false',
    note: 'Direct relations are not extracted: contact_role_p already holds each one, derived when the contact loads with its primary account.'
  },
  OpportunityContactRole: { target: 'contact_role', parent: 'OpportunityId', role: 'Role', key: CONTACT_KEY },
  CaseContactRole: { target: 'contact_role', parent: 'CasesId', role: 'Role', key: CONTACT_KEY },
  AccountTeamMember: { target: 'team_role', parent: 'AccountId', member: 'UserId', role: 'TeamMemberRole', key: TEAM_KEY },
  OpportunityTeamMember: { target: 'team_role', parent: 'OpportunityId', member: 'UserId', role: 'TeamMemberRole', key: TEAM_KEY },
  CaseTeamMember: {
    target: 'team_role', parent: 'ParentId', member: 'MemberId', role: 'TeamRoleId', key: TEAM_KEY, where: "Member.Type = 'User'",
    note: "Only members who are users: a case's contacts are contact_role_p rows (CaseContactRole)."
  }
}

// Salesforce activities onto Aspen's activity shape. task_p and meeting_p say it in parent_p's
// description: "The parent record is associated with a team member, while multiple child records
// can reference the same parent to represent associations with different contacts." The CRM
// source holds an activity to one level, a root and its participants, at most 50 contacts, and
// copies the root's what_p onto every row. So a Task or Event is the root, its who_p the owner
// (a team member, matched by email), and each contact in TaskRelation/EventRelation is a child
// row. WhoId is not mapped on the root: Salesforce lists that contact among the relations too.
// A relation's IsWhat rows repeat WhatId, which the root carries already.
const ACTIVITY_ROOTS = { Task: 'TaskRelation', Event: 'EventRelation' }
const PARTICIPANTS = {
  TaskRelation: {
    target: 'task', activity: 'Task', parent: 'TaskId', person: 'RelationId', where: "IsWhat = false AND Relation.Type = 'Contact'",
    copy: { subject: 'Task.Subject', due_date: 'Task.ActivityDate' },
    note: "One row per contact on a task, each a child of the task's own row (parent_p). Leads and users on a task are not carried: who_p holds a contact or a team member, and the task's own row already names its owner."
  },
  EventRelation: {
    target: 'meeting', activity: 'Event', parent: 'EventId', person: 'RelationId', where: "IsWhat = false AND Relation.Type = 'Contact'",
    copy: { subject: 'Event.Subject', when: 'Event.StartDateTime', end: 'Event.EndDateTime', all_day: 'Event.IsAllDayEvent', location: 'Event.Location' },
    note: "One row per contact invited to a meeting, each a child of the meeting's own row (parent_p). Invitees who are users are not carried here: meeting_p lists team members in team_p, and the meeting's own row names its organizer."
  }
}

// Salesforce objects whose Aspen counterpart has another name, each checked against the target's
// description: meeting_p "a scheduled or logged meeting", product_p "sellable product in the
// product catalog", fiscal_period_p "a named, dated period in the fiscal calendar", team_p "an
// employee, contractor, or partner", email_p "customer emails".
const OBJECT_SYNONYMS = { Event: 'meeting', Product2: 'product', Period: 'fiscal_period', User: 'team', EmailMessage: 'email' }

// What a user must hear before an object loads, keyed by the Salesforce object.
const OBJECT_NOTES = {
  Lead: 'lead_p is "a potential future deal in an early stage", linked to an account or contact, not an unqualified person. Its trigger fills account_p and contact_p from email_p/phone_p and creates a contact for each lead it cannot match: migrate Contact and Account first, so leads match the contacts you loaded instead of creating new ones.',
  User: 'team_p is "an employee, contractor, or partner of the company". Owners are matched to team members by email without migrating User; migrate it only to create team members who are not on Aspen yet.',
  EmailMessage: "email_p holds \"customer emails captured from external email system automatically\": Aspen's email sync may already bring these in. Ask whether it is on before loading, or the two copies will both stay.",
  Event: "meeting_p is \"synced from the user's calendar or entered manually\": calendar sync may already bring these in. This is each meeting's own row, naming its organizer; its contacts are EventRelation rows, so migrate EventRelation too.",
  Task: "This is each task's own row, naming its owner; its contacts are TaskRelation rows, so migrate TaskRelation too."
}

// Objects Aspen derives itself. Loading them duplicates or fights the trigger that writes them.
const DERIVED = {
  contact_owner: "contact_p.owner_p (the contact trigger writes the owning row)",
  contact_channel: "contact_p's email, phone and LinkedIn fields (the contact trigger reconciles these rows)",
  contact_merge: 'the contact merge and unmerge endpoints, its only writers'
}

// Salesforce's address fields. Aspen holds an address as its own record, not as fields.
const ADDRESS = /^(Billing|Shipping|Mailing|Other)(Street|City|State|PostalCode|Country|StateCode|CountryCode|Latitude|Longitude|GeocodeAccuracy)$/

// Salesforce platform plumbing: it holds data, but what it means on Aspen is a modelling
// decision, not a field match. Naming each one keeps it out of the undifferentiated drop pile.
const PLATFORM = {
  RecordTypeId: ['record type', 'Aspen models this as an object type (otype_p). Map each Salesforce record type to a target object type by hand, or drop it and let the target default apply.'],
  CurrencyIsoCode: ['multi-currency', 'Mapped to ccode_p when a currency field on this object maps; without one, nothing needs it.'],
  OwnerId: ['owner', 'Matched to the target user by email. Users with no account on the target leave it blank.'],
  IsPersonAccount: ['person account', 'Person accounts are one Salesforce record standing for an account and a contact. Decide which target object each becomes before mapping any field.'],
  ParentId: ['hierarchy', 'A self-lookup. Migrates only if the parent records are in the same extract; load fills it on a second pass.']
}

// ---- describe: one normalized schema for the source, in migrate.mjs's shape

const describeObject = (ws, m, name) => normalizeDescribe(sf(['sobject', 'describe', '--sobject', name, ...org(ws, m)]), name)

function describeFromExport (x, name) {
  const file = join(x.dir, 'describe', `${name}.json`)
  if (!existsSync(file)) throw new Stop(`the export has no describe/${name}.json; re-export ${name}, or describe it from the live org (init --org)`)
  return normalizeDescribe(readJson(file), name)
}

function normalizeDescribe (d, name) {
  const fields = {}
  const picklists = {}
  for (const f of d.fields ?? []) {
    const [type, subtype] = TYPES[f.type] ?? ['text', 'text']
    let picklist = null
    if ((f.type === 'picklist' || f.type === 'multipicklist' || f.type === 'combobox') && (f.picklistValues ?? []).length) {
      picklist = `${name}.${f.name}`
      picklists[picklist] = f.picklistValues.filter((v) => v.active !== false).map((v) => v.value)
    }
    fields[f.name] = {
      label: f.label ?? f.name,
      type,
      subtype,
      required: !f.nillable && !f.defaultedOnCreate && f.createable,
      unique: !!f.unique,
      lookup: (f.referenceTo ?? []).length === 1 ? f.referenceTo[0] : null,
      objects: (f.referenceTo ?? []).length > 1 ? f.referenceTo : null,
      picklist,
      sf: {
        type: f.type,
        length: f.length ?? null,
        precision: f.precision ?? null,
        scale: f.scale ?? null,
        calculated: !!f.calculated,
        formula: f.calculatedFormula ?? null,
        createable: !!f.createable,
        externalId: !!f.externalId,
        referenceTo: f.referenceTo ?? [],
        relationshipName: f.relationshipName ?? null
      }
    }
  }
  return { object: { label: d.label ?? name, custom: !!d.custom, keyPrefix: d.keyPrefix ?? null, fields }, picklists }
}

// ---- draft: propose a target field for every source field, and a category for every gap

// A counterpart chosen by its description wins over a name that only looks the same: a Salesforce
// User is a team member (team_p), not a platform login (user_p).
function pickTargetObject (sourceName, sourceLabel, tgt) {
  const alias = Object.hasOwn(JUNCTIONS, sourceName) ? JUNCTIONS[sourceName].target
    : Object.hasOwn(PARTICIPANTS, sourceName) ? PARTICIPANTS[sourceName].target
      : Object.hasOwn(OBJECT_SYNONYMS, sourceName) ? OBJECT_SYNONYMS[sourceName] : null
  const aliased = alias ? Object.keys(tgt.objects).find((name) => bare(name) === alias) : null
  if (aliased) return aliased
  const want = new Set([normalize(sourceName), normalize(sourceLabel)])
  for (const [name, o] of Object.entries(tgt.objects)) {
    if (want.has(bare(name)) || want.has(normalize(o.label))) return name
  }
  return null
}

function targetIndex (T) {
  const byName = new Map(); const byLabel = new Map()
  for (const [name, f] of Object.entries(T.fields)) {
    if (!byName.has(bare(name))) byName.set(bare(name), name)
    if (!byLabel.has(normalize(f.label))) byLabel.set(normalize(f.label), name)
  }
  return { byName, byLabel }
}

// Which object a Salesforce User lookup lands on differs by instance (user_p on one, team_p on
// another), and so does the field that identifies the same person on both sides. Read both off
// the target schema: a hardcoded email_p fails at load on any instance that does not have one.
function userMatch (tgt, objectName) {
  const O = objectName ? tgt.objects[objectName] : null
  if (!O) return null
  const entries = Object.entries(O.fields)
  const pick = entries.find(([, f]) => f.unique && f.subtype === 'email') ??
    entries.find(([, f]) => f.unique && /e-?mail/i.test(f.label ?? '')) ??
    entries.find(([n, f]) => f.unique && /email/i.test(n))
  return pick ? { object: objectName, match: pick[0] } : null
}

function matchField (fname, f, idx) {
  const n = normalize(fname)
  if (idx.byName.has(n)) return [idx.byName.get(n), 'name']
  const byLabel = idx.byLabel.get(normalize(f.label))
  if (byLabel) return [byLabel, 'label']
  for (const alt of SYNONYMS[n] ?? []) if (idx.byName.has(alt)) return [idx.byName.get(alt), 'synonym']
  return [null, null]
}

function draftObject (ws, name, src, tgt, migrating, fill) {
  const S = src.objects[name]
  if (!S) throw new Stop(`${name} is not in schema/source.json; run describe again`)
  const target = pickTargetObject(name, S.label, tgt)
  const T = target ? tgt.objects[target] : null
  const entry = { source: name, target, key: null, onMatch: 'skip' }
  const junction = T && Object.hasOwn(JUNCTIONS, name) && bare(target) === JUNCTIONS[name].target ? JUNCTIONS[name] : null
  const part = T && Object.hasOwn(PARTICIPANTS, name) && bare(target) === PARTICIPANTS[name].target ? PARTICIPANTS[name] : null
  const root = T && Object.hasOwn(ACTIVITY_ROOTS, name) && ['task', 'meeting'].includes(bare(target)) ? ACTIVITY_ROOTS[name] : null
  const where = junction?.where ?? part?.where
  if (where) entry.where = where
  const note = junction?.note ?? part?.note ?? (Object.hasOwn(OBJECT_NOTES, name) ? OBJECT_NOTES[name] : null)
  if (note) entry.note = note
  if (junction) {
    const [field, ...of] = junction.key.map((b) => Object.keys(T.fields).find((n) => bare(n) === b))
    if (field && of.every(Boolean)) entry.key = { field, of }
  }
  const derived = T ? (Object.hasOwn(DERIVED, bare(target)) ? DERIVED[bare(target)] : /^miner_/.test(target) ? 'the Miner sync, its only writer' : null) : null
  if (derived) entry.todo = `Aspen derives ${target} from ${derived}. Don't load it: drop ${name} from this migration.`
  // The junction's fields whose target its name does not say.
  const forced = junction ? { [junction.parent]: 'what', [junction.role]: 'role', ...(junction.member ? { [junction.member]: 'team' } : {}) }
    : part ? { [part.parent]: 'parent', [part.person]: 'who' } : {}
  if (!T) entry.todo = `no Aspen object matches ${name} by name. Read the object descriptions in schema/target.json: if one holds what ${name} holds, set "target" to it; otherwise skip ${name} (remove it from the mapping). Creating an object is the user's call, offered last: it cannot be deleted yet`
  const idx = T ? targetIndex(T) : null
  const filled = fill?.objects?.[name]?.fields ?? null
  // fill.json held a bare number before max lengths were recorded.
  const rate = (f) => { const v = filled?.[f]; return v == null ? 0 : (typeof v === 'number' ? v : v.fill) }
  const observed = (f) => { const v = filled?.[f]; return (v == null || typeof v === 'number') ? null : v.maxLen }
  // The values the data actually holds, with how often: only those need a target value.
  const used = (f) => { const v = filled?.[f]; return v && typeof v === 'object' && v.values ? v.values : null }
  const valuesOf = (fname, f) => { const c = used(fname); return c ? Object.keys(c).sort((a, b) => c[b] - c[a]) : src.picklists[f.picklist] ?? [] }
  const rows = []
  const fields = []
  const dependent = []

  for (const [fname, f] of Object.entries(S.fields)) {
    const [gap, how] = gapOf(f)
    const row = {
      source: fname, label: f.label, sfType: f.sf.type, target: null, rule: '',
      confidence: 'GAP', gap, note: how ?? '', decision: 'drop',
      fill: filled ? rate(fname) : null
    }

    // Salesforce owns these; Aspen stamps its own. Not a decision anyone makes.
    // A computed field is also not createable, but it carries real data and its rule has to go
    // somewhere on the target, so it is a gap to report rather than a silent drop.
    if (SF_SYSTEM.has(fname) || (!f.sf.createable && !f.sf.calculated)) {
      fields.push({ from: fname, drop: true, note: SF_SYSTEM.has(fname) ? 'Salesforce system field' : 'not createable in Salesforce' })
      continue
    }

    const [tname, rule] = Object.hasOwn(forced, fname)
      ? [Object.keys(T.fields).find((n) => bare(n) === forced[fname]) ?? null, 'junction']
      : T ? matchField(fname, f, idx) : [null, null]
    row.target = tname; row.rule = rule ?? ''
    const tf = tname ? T.fields[tname] : null

    // Nothing on the target to carry it. Drop is the proposal: a new field can't be deleted yet, so it
    // goes through lean-data-model only if the user names a use. The report ranks these by how
    // much data they actually hold, so an empty field is never a question.
    if (!tf) {
      const [pgap, pnote] = PLATFORM[fname] ?? (ADDRESS.test(fname) && T ? addressGap(ws, tgt, target, name) : [])
      row.gap = gap ?? pgap ?? 'no target field'
      row.note = gap ? how : pnote ?? `nothing on ${target ?? 'the target'} matches`
      fields.push({ from: fname, drop: true, note: `no target field; ${row.note}` })
      rows.push(row); continue
    }

    // An activity's own row names its owner, not a contact: the contacts are its relations.
    if (root && fname === 'WhoId') {
      const why = `the contacts are child rows from ${root}, which lists this one too`
      fields.push({ from: fname, drop: true, note: why })
      rows.push({ ...row, target: tname, gap: 'participants', note: why })
      continue
    }

    // A polyid takes the id and, beside it, the object it points at; polyMapping writes both.
    // A relation's person is a contact: its `where` keeps only those.
    if (tf.type === 'polyid' && f.sf.referenceTo.length) {
      const pm = polyMapping(ws, src, tgt, target, tname, fname, part && fname === part.person ? { ...f, sf: { ...f.sf, referenceTo: ['Contact'] } } : f, migrating)
      fields.push(...pm.fields)
      rows.push({ ...row, ...pm.row })
      continue
    }

    // A team member is a Salesforce User, even where the field could also name a contact.
    const member = forced[fname] === 'team' && f.sf.referenceTo.includes('User')
    const refs = member ? ['User'] : f.sf.referenceTo

    // It matched a target field. Now the mismatch, if any, is worth the user's time.
    const e = { target: tname, from: fname }
    row.decision = 'map'
    if (gap && !member) {
      row.note = how
      row.decision = 'todo'
      e.todo = `${gap}: ${how} Proposed target: ${tname}.`
    } else if (refs.length === 1) {
      const to = refs[0]
      if (migrating.has(to)) {
        e.lookup = to
        // A scoped extract points past its own edge (a parent account not exported): blank, not a
        // failure. Not for the row's own parent (a relation's task): without it the row is not one.
        const optional = !tf.required && !Object.hasOwn(forced, fname) && tf.subtype !== 'parent'
        if (optional) e.missing = 'null'
        row.confidence = 'exact'; row.note = `lookup to ${to}, which is migrating: resolved through the id map${optional ? `; blank when that ${to} is not in the extract` : ''}`
      } else if (to === 'User') {
        const on = userMatch(tgt, tf.lookup)
        if (on) {
          e.lookup = on
          e.sfMatch = { object: 'User', field: 'Email' }
          e.missing = 'null'
          row.confidence = 'close'; row.gap = 'user lookup'
          row.note = `matched to ${on.object}.${on.match} by email; blank when that person has no record on the target`
        } else {
          row.gap = 'user lookup'; row.decision = 'todo'
          row.note = tf.lookup
            ? `${tf.lookup} has no unique email field to join on: name the field that identifies the same person on both sides`
            : `${tname} does not name the object it points to`
          e.todo = `${fname} points to a Salesforce User and ${tname} looks up ${tf.lookup ?? 'an object the schema does not name'}: say which field identifies the same person on both sides ({"lookup": {"object": "${tf.lookup ?? '<object>'}", "match": "<field>"}, "sfMatch": {"object": "User", "field": "Email"}}), or drop it`
        }
      } else {
        row.gap = 'lookup not migrating'; row.decision = 'todo'
        row.note = `points to ${to}, which is not in this migration`
        e.todo = `${fname} points to ${to}, which is not migrated: add ${to} to --objects, match it ({"lookup": {"object": "<target object>", "match": "<field>"}, "sfMatch": {"object": "${to}", "field": "<SFDC field>"}}), or drop it`
      }
    } else if (tf.type !== f.type && !(f.sf.type === 'combobox' && tf.type === 'text')) {
      row.gap = 'type mismatch'; row.decision = 'todo'
      row.note = `${f.sf.type} in Salesforce, ${tf.type}/${tf.subtype} on ${tname}`
      e.todo = `types differ: ${f.sf.type} in Salesforce, ${tf.type} on ${tname}. Convert it ("expr"), pick another field, or drop it.`
    } else if (f.picklist && tf.picklist) {
      const values = valuesOf(fname, f)
      settlePicklist(e, row, values, tgt, tf, null, used(fname))
      if (tf.dependsOn) dependent.push({ e, row, values, counts: used(fname), tf })
    } else if (f.sf.type === 'percent' && tf.maxValue != null && Number(tf.maxValue) <= 1) {
      // Salesforce holds 50% as 50; the describe says the target takes a fraction.
      delete e.from
      e.expr = `r.${fname} == null ? null : Number(r.${fname}) / 100`
      row.confidence = 'close'; row.gap = 'percent as a fraction'
      row.note = `Salesforce holds a percent as 0-100 and ${tname} takes ${tf.minValue ?? 'up'} to ${tf.maxValue}: divided by 100`
    } else if (tf.subtype === 'phone' || tf.subtype === 'url') {
      // Salesforce is laxer than Aspen here; the loader converts what it can without guessing.
      e.normalize = TARGET_RULES[target]?.normalize?.[tname] ?? tf.subtype
      row.confidence = 'close'; row.gap = `normalize ${e.normalize}`
      row.note = NORMALIZE_NOTE[e.normalize]
    } else if (f.type === 'text' && tf.type === 'text' && overLength(f, tf, tname, observed(fname), row)) {
      e.truncate = true
    } else if (tf.subtype === 'email') {
      row.confidence = 'close'; row.gap = 'validated email'
      row.note = `${tname} takes only a valid address, and Salesforce is laxer: the pilot shows what it rejects`
    } else {
      row.confidence = rule === 'name' ? 'exact' : 'close'
      if (rule !== 'name') row.note = `matched by ${rule}`
    }
    fields.push(e)
    rows.push(row)
  }

  // The root's who_p is its owner; a child row copies what the root holds and it must carry too.
  const userRef = (from) => ({ label: from, sf: { type: 'reference', referenceTo: ['User'] } })
  const add = (tname, from, f) => {
    if (!tname || fields.some((e) => e.target === tname && !e.drop)) return
    const pm = polyMapping(ws, src, tgt, target, tname, from, f, migrating)
    fields.push(...pm.fields)
    rows.push({ source: from, label: f.label, sfType: 'reference', rule: 'activity', fill: null, ...pm.row })
  }
  const named = (b) => T ? Object.keys(T.fields).find((n) => bare(n) === b) ?? null : null
  if (root && S.fields.OwnerId) add(named('who'), 'OwnerId', userRef('Assigned To'))
  if (part) {
    for (const [b, from] of Object.entries(part.copy)) {
      const tname = named(b)
      if (!tname || fields.some((e) => e.target === tname && !e.drop)) continue
      fields.push({ target: tname, from })
      rows.push({ source: from, label: `the ${part.activity}'s ${from.split('.')[1]}`, sfType: 'parent field', target: tname, rule: 'activity', confidence: 'exact', gap: null, decision: 'map', fill: null, note: `copied from the ${part.activity} this row belongs to` })
    }
    add(named('owner'), `${part.activity}.OwnerId`, userRef('Owner'))
  }

  // An object-dependent picklist takes only the values its parent object allows. Which object that
  // is comes from the polyid whose companion is the field's parent-object (whaton_p beside what_p).
  for (const d of dependent) {
    const on = fields.find((x) => x.target === d.tf.dependsOn && x.objectOf && !x.drop)
    const poly = on ? fields.find((x) => x.target === on.objectOf && x.lookup && !x.drop) : null
    const objs = !poly ? [] : typeof poly.lookup === 'object' && !Array.isArray(poly.lookup) ? [poly.lookup.object]
      : [].concat(poly.lookup).map((x) => pickTargetObject(x, src.objects[x]?.label ?? x, tgt)).filter(Boolean)
    if (objs.length) settlePicklist(d.e, d.row, d.values, tgt, d.tf, objs, d.counts)
  }

  // Aspen gives any object with a currency field a ccode_p, a lookup to currency_p, and refuses a
  // currency value without it. The describe names no link between the two, so this is the platform's
  // rule. Salesforce's CurrencyIsoCode holds the code: it is matched to the currency_p record whose
  // unique code picklist has that label (USD -> usd_p), and the dry run reports a code the target has
  // no record for.
  const cc = T?.fields?.ccode_p
  const money = T && fields.some((x) => !x.drop && T.fields[x.target]?.type === 'currency' && T.fields[x.target]?.subtype === 'currency')
  if (money && cc?.lookup && !fields.some((x) => x.target === 'ccode_p' && !x.drop)) {
    const C = tgt.objects[cc.lookup]
    const code = C ? Object.keys(C.fields).find((n) => C.fields[n].unique && C.fields[n].picklist) : null
    const lookup = code ? { object: cc.lookup, match: code, by: 'value' } : null
    const row = rows.find((r) => r.source === 'CurrencyIsoCode') ?? { source: '', label: cc.label, sfType: '', fill: null }
    if (!rows.includes(row)) rows.push(row)
    Object.assign(row, { target: 'ccode_p', rule: 'currency', gap: 'record currency' })
    const iso = S.fields.CurrencyIsoCode
    if (lookup && iso) {
      const counts = used('CurrencyIsoCode')
      const { map, missing } = seedPicklist(valuesOf('CurrencyIsoCode', iso), tgt.picklistItems?.[C.fields[code].picklist] ?? [])
      const e = { target: 'ccode_p', from: 'CurrencyIsoCode', map, lookup }
      const at = fields.findIndex((x) => x.from === 'CurrencyIsoCode' && x.drop)
      if (at >= 0) fields.splice(at, 1)
      // The codes the data holds that the target has no currency_p record for: those rows fail.
      const n = (v) => counts?.[v] ? ` (${counts[v]})` : ''
      const lacking = counts && tgt.currencies ? Object.keys(counts).filter((v) => map[v] && !tgt.currencies.includes(map[v])) : []
      const covered = counts ? Object.keys(counts).filter((v) => !lacking.includes(v) && map[v]) : []
      const note = [`a currency value needs the record's currency: CurrencyIsoCode matched to the ${cc.lookup} whose ${code} is labelled with it`]
      if (missing.length) note.push(`no ${code} for ${missing.map((v) => v + n(v)).join(', ')}`)
      if (lacking.length) note.push(`the target has no ${cc.lookup} for ${lacking.map((v) => v + n(v)).join(', ')}`)
      Object.assign(row, { confidence: 'close', decision: missing.length || lacking.length ? 'todo' : 'map', note: note.join('; ') })
      if (missing.length) e.todo = `no ${cc.lookup}.${code} is labelled ${missing.join(', ')}: add each to "map", or set "default"`
      else if (lacking.length) e.todo = `${lacking.map((v) => v + n(v)).join(', ')} rows have no ${cc.lookup} on the target, so they would fail: keep only the others ("where": "CurrencyIsoCode IN (${covered.map((v) => `'${v}'`).join(', ')})" on ${name}), drop the currency fields, or add those currencies on the instance first`
      fields.push(e)
    } else {
      const why = lookup
        ? `Aspen refuses a currency value without the record's currency, and ${name} has no CurrencyIsoCode: set "value" to the ${code} of the org's currency (an item of ${C.fields[code].picklist})`
        : `Aspen refuses a currency value without ${cc.lookup}, and ${cc.lookup} has no unique code picklist to match on: say how to fill ccode_p, or drop the currency fields`
      Object.assign(row, { confidence: 'GAP', decision: 'todo', note: why })
      fields.push({ target: 'ccode_p', ...(lookup ? { lookup } : {}), todo: why })
    }
  }

  // What the CRM triggers enforce that the describe does not declare (migrate.mjs TARGET_RULES).
  const rules = T ? TARGET_RULES[target] ?? {} : {}
  for (const [tname, why] of Object.entries(rules.setOnInsert ?? {})) {
    const at = fields.findIndex((x) => x.target === tname && !x.drop)
    if (at < 0) continue
    fields[at] = { from: fields[at].from, drop: true, note: why }
    for (const x of fields) if (x.objectOf === tname) Object.assign(x, { drop: true, note: why })
    const row = rows.find((r) => r.target === tname)
    if (row) Object.assign(row, { decision: 'drop', confidence: 'GAP', gap: 'set by Aspen', note: why })
  }
  for (const [a, b] of rules.distinct ?? []) {
    const e = fields.find((x) => x.target === b && !x.drop)
    if (!e || !fields.some((x) => x.target === a && !x.drop)) continue
    const from = [...new Set([].concat(e.distinctFrom ?? [], a))]
    e.distinctFrom = from.length === 1 ? from[0] : from
    const row = rows.find((r) => r.target === b)
    if (row) row.note = `${row.note ? `${row.note}; ` : ''}blank when it equals ${a}: Aspen refuses the same value in both`
  }

  if (T) {
    for (const [fname, tf] of Object.entries(T.fields)) {
      if (tf.required && !fields.some((e) => e.target === fname && !e.drop)) {
        // Salesforce computes some of what Aspen requires (a contact's Name): its value is data.
        const same = Object.keys(S.fields).find((n) => !SF_SYSTEM.has(n) && normalize(n) === bare(fname))
        if (same) {
          const at = fields.findIndex((e) => e.from === same && e.drop)
          if (at >= 0) fields.splice(at, 1)
          fields.push({ target: fname, from: same })
          rows.push({ source: same, label: S.fields[same].label, sfType: S.fields[same].sf.type, target: fname, rule: 'required', confidence: 'close', gap: null, decision: 'map', fill: rate(same), note: `required on ${target}; filled from ${same}, which Salesforce computes` })
          continue
        }
        fields.push({ target: fname, todo: `required on ${target} and nothing maps to it: set "from", "value" or "expr"` })
        rows.push({ source: '', label: tf.label, sfType: '', target: fname, rule: '', confidence: 'GAP', gap: 'required, unmapped', decision: 'todo', fill: null, note: `required on ${target}: needs a source field or a constant` })
      }
    }
    const ext = Object.entries(S.fields).find(([n, f]) => f.sf.externalId && fields.some((e) => e.from === n && e.target))
    entry.key ??= ext ? fields.find((e) => e.from === ext[0]).target
      : fields.find((e) => e.target && !e.todo && !e.lookup && T.fields[e.target]?.unique)?.target ?? null
  }
  entry.fields = fields
  return { entry, rows }
}

// A polyid's companion field, which names the object it points at: the describe's
// related-object-field, else the local metadata's.
function companion (ws, tgt, object, field) {
  return tgt.objects[object]?.fields?.[field]?.relatedObjectField ??
    localObjects(ws, object).flatMap((d) => d.fields ?? []).find((f) => f.name === field)?.['related-object-field'] ?? null
}

// What a polyid may point at: its own allowed-objects, or else the objects whose included-polyids
// name it (how what_p is opened to account_p, case_p, opportunity_p...). Read from the target, so
// a new opt-in shows up without a change here.
function allowedFor (ws, tgt, object, field) {
  const own = tgt.objects[object]?.fields?.[field]?.objects ??
    localObjects(ws, object).flatMap((d) => d.fields ?? []).find((f) => f.name === field)?.['allowed-objects']
  if (own?.length) return own
  return Object.keys(tgt.objects).filter((o) => {
    const inc = tgt.objects[o].includedPolyids?.length ? tgt.objects[o].includedPolyids
      : localObjects(ws, o).find((d) => d['included-polyids'])?.['included-polyids'] ?? []
    return inc.some((x) => x.object === object && x.field === field)
  })
}

// A Salesforce reference onto an Aspen polyid. The id goes through the id map, or for a User is
// matched by email to the user object the polyid allows; the companion is written by load from the
// object each id resolved to ("objectOf"), so the pair never disagrees. Whatever the polyid cannot
// hold, or a record that is not migrating, carries blank where the polyid is optional.
function polyMapping (ws, src, tgt, target, tname, fname, f, migrating) {
  const tf = tgt.objects[target].fields[tname]
  const on = companion(ws, tgt, target, tname)
  const allowed = allowedFor(ws, tgt, target, tname)
  const carried = []; const lost = []; const waiting = []
  let user = null
  for (const x of f.sf.referenceTo) {
    if (x === 'User') {
      // A Salesforce User is an Aspen user or team member, never a contact with the same email.
      user = allowed.filter((o) => ['user', 'team'].includes(bare(o))).map((o) => userMatch(tgt, o)).find(Boolean) ?? null
      if (!user) lost.push(x)
      continue
    }
    const tx = pickTargetObject(x, src.objects[x]?.label ?? x, tgt)
    if (tx && allowed.includes(tx)) (migrating.has(x) ? carried : waiting).push(x)
    else lost.push(x)
  }
  const holds = allowed.length ? allowed.join(', ') : 'nothing the schema names'
  const todo = (gap, why) => ({ fields: [{ target: tname, from: fname, todo: why }], row: { target: tname, gap, decision: 'todo', note: why } })
  if (!on) return todo('polyid', `${tname} names no companion field to say what it points at; describe the target again`)
  if (user && carried.length) return todo('polymorphic lookup', `${fname} points to a User and to ${carried.join(', ')}; ${tname} cannot be matched by email and by id in one field: map one and drop the other`)
  const blank = !tf.required && (lost.length > 0 || waiting.length > 0)
  const after = lost.length || waiting.length
    ? `; rows pointing at ${[...lost, ...waiting].join(', ')} ${tf.required ? `fail (${tname} is required)` : 'carry blank'}${waiting.length ? ` unless ${waiting.join(', ')} migrates too` : ''}`
    : ''
  if (user) {
    return {
      fields: [{ target: tname, from: fname, lookup: user, sfMatch: { object: 'User', field: 'Email' }, missing: 'null' }, { target: on, objectOf: tname }],
      row: { target: tname, confidence: 'close', gap: 'user lookup', decision: 'map', note: `matched to ${user.object}.${user.match} by email, blank when that person has no record on the target; ${on} follows${after}` }
    }
  }
  if (!carried.length && !waiting.length) {
    const why = `${fname} points to ${f.sf.referenceTo.join(', ')}, and ${tname} holds ${holds}${f.sf.referenceTo.includes('User') ? ' (matched by a unique email, which none of them has)' : ''}: nothing it points at can go here`
    return { fields: [{ from: fname, drop: true, note: why }], row: { target: tname, gap: 'nothing to point at', decision: 'drop', note: why } }
  }
  if (!carried.length) return todo('lookup not migrating', `${fname} points to ${f.sf.referenceTo.join(', ')}, and ${tname} holds ${holds}: migrate ${waiting.join(' or ')} too, or drop it`)
  return {
    fields: [{ target: tname, from: fname, lookup: carried.length === 1 ? carried[0] : carried, ...(blank ? { missing: 'null' } : {}) }, { target: on, objectOf: tname }],
    row: { target: tname, confidence: after ? 'close' : 'exact', gap: after ? 'partly carried' : null, decision: 'map', note: `the ${carried.join(' or ')} it points at, through the id map; ${on} names its object${after}` }
  }
}

// Where an address field goes: the target's own address object, by its description.
function addressGap (ws, tgt, target, name) {
  const child = Object.keys(tgt.objects).find((o) => bare(o) === `${bare(target)}_address`)
  if (!child) return []
  const about = describedAs(ws, tgt, child).object
  return ['address', `Aspen keeps addresses as ${child} records${about ? ` ("${about}")` : ''}, not as fields on ${target}. Migrate them in a second workspace from ${name} to ${child}, with ${target} matched by a unique field, once ${name} has loaded.`]
}

// A value longer than the target's cap is rejected on write. Compare the cap the describe declares
// against what the data holds; the proposal is to cut it to the cap ("truncate").
function overLength (f, tf, tname, maxLen, row) {
  const cap = tf.maxLength
  if (!cap) return false
  const sfMax = f.sf.length ?? 0
  if (maxLen != null && maxLen > cap) {
    row.confidence = 'close'; row.gap = 'cut to fit'
    row.note = `values run to ${maxLen} characters and ${tname} caps at ${cap}: cut to ${cap} ("truncate"). Drop the field instead if a cut value is no use.`
    return true
  }
  if (maxLen == null && sfMax > cap) {
    row.confidence = 'close'; row.gap = 'may not fit'
    row.note = `Salesforce allows ${sfMax} characters and ${tname} caps at ${cap}: anything longer is cut to ${cap} ("truncate")`
    return true
  }
  return false
}

const NORMALIZE_NOTE = {
  phone: 'converted to E.164 where the number says its country (+, 00, or a 10-digit North American number); anything else is left blank, and the dry run counts it under "Changed on the way in"',
  url: 'http or https; a value with no scheme gets https://. One that still does not fit is left blank, and the dry run counts it',
  linkedin: "Aspen's own LinkedIn form (https://www.linkedin.com/in/<profile>); anything that is not a profile URL is left blank, as Aspen would refuse it"
}

// A picklist's map, seeded from the target's items: a Salesforce value matches an item by name or
// by label, ignoring case ("USD" -> usd_p, labelled USD).
function seedPicklist (values, items) {
  const by = new Map()
  for (const i of items) for (const k of [i.name, i.label]) if (k != null && !by.has(String(k).toLowerCase())) by.set(String(k).toLowerCase(), i.name)
  const map = {}; const missing = []
  for (const v of values) { const t = by.get(String(v).toLowerCase()); if (t) map[v] = t; else missing.push(v) }
  return { map, missing }
}

// With `objs`, only the items an object-dependent picklist allows on every one of those objects.
// With `counts`, `values` are the ones the data holds, and each is shown with how often.
function settlePicklist (e, row, values, tgt, tf, objs, counts = null) {
  const items = (tgt.picklistItems?.[tf.picklist] ?? []).filter((i) => !objs || !i.parentObjects || objs.every((o) => i.parentObjects.includes(o)))
  const { map, missing } = seedPicklist(values, items)
  const where = objs ? ` allows on ${objs.join(' and ')}` : ''
  const shown = (v) => counts ? `${v} (${counts[v]})` : v
  const which = counts ? 'values in the data' : 'values'
  e.map = map
  delete e.todo
  if (missing.length) {
    const names = items.map((i) => i.name)
    row.confidence = 'close'; row.gap = 'picklist values'; row.decision = 'todo'
    row.note = `${missing.length} of ${values.length} ${which} are not among those ${tf.picklist}${where || ' holds'}: ${missing.slice(0, 8).map(shown).join(', ')}${missing.length > 8 ? ', ...' : ''}`
    e.todo = `${which} not among those ${tf.picklist}${where || ' holds'}: ${missing.map(shown).join(', ')}. Add each to "map" (${names.slice(0, 12).join(', ')}${names.length > 12 ? ', ...' : ''}), or set "default".`
  } else {
    row.confidence = 'exact'; row.gap = null; row.decision = 'map'; row.note = `all ${values.length} ${which} are among those ${tf.picklist}${where || ' holds'}`
  }
}

// ---- the gap report: what needs a decision, what maps, and what is being dropped

const CSV_COLUMNS = ['sf_object', 'aspen_object', 'sf_field', 'aspen_field', 'label', 'sf_type', 'aspen_type', 'aspen_subtype', 'confidence', 'decision', 'gap_category', 'matched_by', 'fill_rate', 'required', 'picklist', 'ref_target_sf', 'note', 'aspen_description']
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const pct = (v) => v == null ? '' : `${Math.round(v * 100)}%`
const cell = (v, max = 140) => { const t = String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|'); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

function report (ws, m, src, tgt, fill) {
  const lines = []; const csv = [CSV_COLUMNS.join(',')]
  lines.push('# Salesforce -> Aspen: gaps and ETLs\n')
  lines.push(`Source: \`${m.source.org}\` (${m.source.instanceUrl ?? 'Salesforce'})  `)
  lines.push(`Target: ${m.target.url}  `)
  lines.push(`Drafted: ${new Date().toISOString()}`)
  lines.push(!fill ? 'No fill rates: run `sfmigrate probe` to see which Salesforce fields actually hold data.\n'
    : fill.source === 'export' ? 'Fill rates and picklist values from every record in the export.\n'
      : `Fill rates from a sample of ${fill.sample} records per object.\n`)
  const headline = []

  for (const o of m.objects) {
    const S = src.objects[o.source]
    const T = o.target ? tgt.objects[o.target] : null
    const rows = o.report ?? []
    const mapped = rows.filter((r) => r.decision === 'map')
    const decide = rows.filter((r) => r.decision === 'todo')
    const dropped = rows.filter((r) => r.decision === 'drop')
    // A dropped field that holds data is a real gap; an empty one is noise.
    const carries = dropped.filter((r) => r.fill == null || r.fill > 0)
      .sort((a, b) => (b.fill ?? 0) - (a.fill ?? 0) || a.source.localeCompare(b.source))
    const empty = dropped.filter((r) => r.fill != null && r.fill === 0).sort((a, b) => a.source.localeCompare(b.source))
    const sfOwned = (o.fields ?? []).filter((e) => e.drop && !rows.some((r) => r.source === e.from)).length
    headline.push(`${o.source} -> ${o.target ?? '?'}: ${mapped.length} mapped, ${decide.length} to decide, ${carries.length} dropped with data, ${empty.length} dropped empty`)

    const about = o.target && tgt.objects[o.target] ? describedAs(ws, tgt, o.target) : { object: null, fields: {} }
    lines.push(`## ${o.source} -> ${o.target ?? '(no target object)'}\n`)
    if (about.object) lines.push(`> **${o.target}:** ${about.object}\n`)
    lines.push(`${S ? Object.keys(S.fields).length : 0} Salesforce fields: ${mapped.length} mapped, ${decide.length} need a decision, ${dropped.length} proposed for drop, ${sfOwned} Salesforce-owned (never migrate).\n`)
    if (o.todo) lines.push(`**Object:** ${o.todo}\n`)
    if (o.where) lines.push(`**Extracted:** only rows where \`${o.where}\`.\n`)
    if (o.note) lines.push(`**Note:** ${o.note}\n`)

    if (decide.length) {
      lines.push('### Needs your decision\n')
      lines.push('| Salesforce field | Aspen field | What Aspen says it is | Gap / ETL | Proposal |')
      lines.push('|---|---|---|---|---|')
      for (const r of decide) lines.push(`| \`${r.source || '—'}\` (${r.sfType || '—'}) | ${r.target ? `\`${r.target}\`` : '—'} | ${cell(about.fields[r.target])} | ${r.gap ?? ''} | ${r.note.replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
    if (carries.length) {
      lines.push('### Dropped, but holds data\n')
      lines.push('Nothing on the target carries these. Confirm the drop, or name a use and create the field')
      lines.push('(`lean-data-model` first: a field cannot be deleted yet).\n')
      lines.push('| Salesforce field | Type | Filled | Why it is dropped |')
      lines.push('|---|---|---|---|')
      for (const r of carries.slice(0, 40)) lines.push(`| \`${r.source}\` — ${r.label} | ${r.sfType} | ${pct(r.fill) || '?'} | ${(r.gap ?? '')}${r.note ? `: ${r.note.replace(/\|/g, '\\|')}` : ''} |`)
      if (carries.length > 40) lines.push(`| … ${carries.length - 40} more | | | see mapping/fields.csv |`)
      lines.push('')
    }
    if (mapped.length) {
      lines.push('### Maps as it is\n')
      lines.push('| Salesforce field | Aspen field | What Aspen says it is | Confidence | Note |')
      lines.push('|---|---|---|---|---|')
      for (const r of mapped) lines.push(`| \`${r.source}\` | \`${r.target}\` | ${cell(about.fields[r.target])} | ${r.confidence} | ${r.note.replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
    if (empty.length) lines.push(`### Dropped, empty in the sample\n${empty.length} fields hold no data in the sample and are dropped without a question: ${empty.slice(0, 25).map((r) => `\`${r.source}\``).join(', ')}${empty.length > 25 ? `, … (all ${empty.length} in mapping/fields.csv)` : ''}\n`)

    for (const r of rows) {
      const tf = T && r.target ? T.fields[r.target] : null
      const sfF = S?.fields?.[r.source]
      csv.push([o.source, o.target ?? '', r.source, r.target ?? '', r.label, r.sfType, tf?.type ?? '', tf?.subtype ?? '',
        r.confidence, r.decision, r.gap ?? '', r.rule, r.fill == null ? '' : r.fill.toFixed(3), tf?.required ? 'true' : '',
        tf?.picklist ?? '', (sfF?.sf?.referenceTo ?? []).join(' '), r.note, about.fields[r.target] ?? ''].map(csvCell).join(','))
    }
  }

  lines.splice(5, 0, headline.map((h) => `- ${h}`).join('\n') + '\n')
  lines.push('## What cannot move\n')
  lines.push('Created and modified dates and users (Aspen stamps its own), record history, field history,')
  lines.push('file and attachment bodies, feed items, sharing rules, and anything Salesforce computes')
  lines.push('(formula, roll-up) unless its value is extracted as data.\n')
  writeText(ws.path('reports', 'gaps.md'), lines.join('\n'))
  writeText(ws.path('mapping', 'fields.csv'), csv.join('\n') + '\n')
  return headline
}

// ---- extract: SOQL through the sf CLI, into the jsonl migrate.mjs loads

const soql = (object, fields, where, limit) =>
  `SELECT ${['Id', ...fields].join(', ')} FROM ${object}${where ? ` WHERE ${where}` : ''}${limit ? ` LIMIT ${limit}` : ''}`

function query (ws, m, sql, mode) {
  if (mode === 'rest') {
    const r = sf(['data', 'query', '--query', sql, ...org(ws, m)])
    return (r.records ?? []).map(strip)
  }
  const out = join(tmpdir(), `sfmigrate-${process.pid}-${Math.random().toString(36).slice(2)}.json`)
  try {
    const r = sf(['data', 'export', 'bulk', '--query', sql, '--output-file', out, '--result-format', 'json', '--wait', '60', ...org(ws, m)], { tolerate: true })
    if (r === null || !existsSync(out)) {
      say('  bulk export unavailable for this query; falling back to the REST query (capped at 10,000 rows)')
      const rest = sf(['data', 'query', '--query', sql, ...org(ws, m)])
      return (rest.records ?? []).map(strip)
    }
    const text = readFileSync(out, 'utf8').trim()
    return (text ? JSON.parse(text) : []).map(strip)
  } finally {
    if (existsSync(out)) rmSync(out, { force: true })
  }
}

// Salesforce returns an `attributes` envelope, and the Bulk API returns an empty string where
// the record holds no value. migrate.mjs wants the source id in id_p, and a blank lookup has to
// arrive as null or the target rejects it.
// A parent field (`Event.Subject`) arrives nested from REST ({Event: {Subject}}) and dotted from a
// bulk export; both land as the dotted name a mapping's "from" uses.
function strip (r) {
  const { attributes, Id, CreatedDate, ...rest } = r
  const out = { id_p: Id }
  if (CreatedDate) out.ct_p = CreatedDate
  const put = (k, v) => { out[k] = (v === undefined || v === '') ? null : v }
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) if (k2 !== 'attributes') put(`${k}.${k2}`, v2)
    } else put(k, v)
  }
  return out
}

// ---- commands

function main (argv) {
  const [cmd, wsArg] = argv
  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) { say(HELP); return 0 }
  const opts = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { opts[key] = next; i++ } else opts[key] = true
  }
  if (!['init', 'plan', 'describe', 'probe', 'draft', 'gaps', 'extract'].includes(cmd)) throw new Stop(`unknown command ${cmd}\n\n${HELP}`)
  const ws = workspace(wsArg)

  if (cmd === 'init') {
    const dir = typeof opts['from-export'] === 'string' ? resolve(opts['from-export']) : null
    if (!opts.org && !dir) throw new Stop('init needs --from-export <dir> (a Salesforce export: manifest.json, describe/ and one CSV per object) or --org <alias|username> (a live org through the sf CLI, `sf org list`)')
    const x = dir ? readExport(dir) : null
    const o = opts.org ? sf(['org', 'display', '--target-org', String(opts.org)]) : null
    const m = {
      source: o
        ? { kind: 'salesforce', org: String(opts.org), url: o.instanceUrl, username: o.username, instanceUrl: o.instanceUrl, apiVersion: o.apiVersion, ...(x ? { export: x } : {}) }
        : { kind: 'salesforce', url: x.dir, export: x },
      target: { url: opts.target ? String(opts.target) : ws.instance },
      objects: []
    }
    if (!sameUrl(m.target.url, ws.instance)) throw new Stop(`--target ${m.target.url} is not this directory's instance (${ws.instance})`)
    writeJson(ws.path('mapping.json'), m)
    writeText(ws.path('.gitignore'), IGNORED.join('\n') + '\n')
    say(`workspace ${ws.dir}`)
    if (o) say(`source: ${o.username} at ${o.instanceUrl} (API ${o.apiVersion})`)
    if (x) {
      say(`source: the export in ${x.dir}${x.org ? ` (from ${x.org})` : ''}, finished ${x.finished ?? 'at an unknown time'}${x.dateShiftYears ? `, dates shifted ${x.dateShiftYears} years` : ''}`)
      for (const [n, v] of Object.entries(x.objects)) say(`  ${n}: ${v.records ?? '?'} records`)
    }
    say(`target: ${m.target.url}`)
    say('next: ask the user which of these objects to migrate, then sfmigrate plan <workspace> --objects <their choice>')
    return 0
  }

  const m = readMapping(ws)

  if (cmd === 'plan') {
    if (typeof opts.objects !== 'string') throw new Stop('plan needs --objects: the Salesforce objects the user chose to migrate, comma-separated')
    let code = main(['describe', wsArg, '--objects', opts.objects])
    if (code) return code
    if (!(opts['keep-target'] && existsSync(ws.path('schema', 'target.json')))) describeTarget(ws)
    code = main(['probe', wsArg, '--objects', opts.objects, ...(opts.sample ? ['--sample', String(opts.sample)] : [])])
    if (code) return code
    return main(['draft', wsArg, '--objects', opts.objects, ...(opts.redraft ? ['--redraft'] : [])])
  }

  if (cmd === 'describe') {
    const x = exportOf(m)
    if (!opts.objects && !x) throw new Stop('describe needs --objects: the Salesforce objects to read, comma-separated')
    const names = opts.objects ? list(opts.objects) : Object.keys(x.objects).filter((n) => n !== 'User')
    if (x) for (const n of names) if (!x.objects[n]) throw new Stop(`${n} is not in the export (${Object.keys(x.objects).join(', ')})`)
    const existing = existsSync(ws.path('schema', 'source.json')) ? readJson(ws.path('schema', 'source.json')) : { objects: {}, picklists: {} }
    const objects = { ...existing.objects }; const picklists = { ...existing.picklists }
    for (const n of names) {
      const d = x ? describeFromExport(x, n) : describeObject(ws, m, n)
      objects[n] = d.object
      Object.assign(picklists, d.picklists)
      const gaps = Object.values(d.object.fields).filter((f) => gapOf(f)[0]).length
      say(`${n}: ${Object.keys(d.object.fields).length} fields, ${Object.keys(d.picklists).length} picklists, ${gaps} that need an ETL`)
    }
    writeJson(ws.path('schema', 'source.json'), { org: m.source.org ?? m.source.export?.org ?? null, instanceUrl: m.source.instanceUrl ?? null, export: m.source.export?.dir ?? null, described: new Date().toISOString(), objects, picklists })
    say(`schema/source.json: ${Object.keys(objects).length} object(s)`)
    return 0
  }

  if (cmd === 'probe') {
    const src = schema(ws, 'source')
    const x = exportOf(m)
    const names = opts.objects ? list(opts.objects) : Object.keys(src.objects)
    const sample = opts.sample ? Number(opts.sample) : 500
    if (!Number.isInteger(sample) || sample < 1) throw new Stop('--sample takes a whole number of records')
    // fill.json: objects.<Object>.fields.<Field> = { fill: 0..1, maxLen, values?: {<picklist value>: rows} }
    const out = { source: x ? 'export' : 'org', sample: x ? null : sample, probed: new Date().toISOString(), objects: {} }
    for (const n of names) {
      const S = src.objects[n]
      if (!S) throw new Stop(`${n} is not in schema/source.json; run describe first`)
      // File bodies are huge and not queryable in bulk; everything else is fair game.
      const names2 = Object.entries(S.fields).filter(([f, d]) => f !== 'Id' && d.sf.type !== 'base64').map(([f]) => f)
      const p = { records: 0, fields: {} }
      if (x) profile(csvRecords(exportCsv(x, n)), S, names2, p)
      // ORDER BY Id LIMIT N picks the same records in every chunk, so each chunk measures the
      // same sample. SOQL caps how many fields one query can carry.
      else for (const chunk of chunksOf(names2, 150)) profile(query(ws, m, `SELECT Id, ${chunk.join(', ')} FROM ${n} ORDER BY Id LIMIT ${sample}`, 'rest'), S, chunk, p)
      out.objects[n] = p
      const used = Object.values(p.fields).filter((v) => v.fill > 0).length
      say(`${n}: ${p.records} records ${x ? 'in the export' : 'sampled'}, ${used} of ${names2.length} fields hold data`)
    }
    writeJson(ws.path('schema', 'fill.json'), out)
    say('schema/fill.json written; draft marks empty fields as dropped without a question')
    return 0
  }

  if (cmd === 'draft') {
    const src = schema(ws, 'source'); const tgt = schema(ws, 'target'); const fill = fillRates(ws)
    if (!tgt.picklistItems) throw new Stop("schema/target.json predates the length, range and picklist rules draft reads; run the instance-migration skill's `migrate.mjs describe <workspace> --side target` again")
    const names = opts.objects ? list(opts.objects) : Object.keys(src.objects)
    const have = new Set(m.objects.map((o) => o.source))
    const migrating = new Set([...have, ...names])
    // An entry still without a target (the object was created since) is drafted again, and so is
    // every named one with --redraft; a settled entry is otherwise left as the user settled it.
    const added = names.filter((n) => !have.has(n) || opts.redraft || !m.objects.find((o) => o.source === n).target)
    for (const n of added) {
      const { entry, rows } = draftObject(ws, n, src, tgt, migrating, fill)
      entry.report = rows
      const at = m.objects.findIndex((o) => o.source === n)
      if (at >= 0) m.objects[at] = entry; else m.objects.push(entry)
    }
    writeJson(ws.path('mapping.json'), m)
    for (const line of report(ws, m, src, tgt, fill)) say(line)
    if (!fill) say('no fill rates: `sfmigrate probe` first, and the dropped fields that hold data stand out from the empty ones')
    for (const o of m.objects.filter((x) => added.includes(x.source) && x.target && !x.key)) {
      say(`${o.source}: no key, so records already on the target are not matched (a re-run is safe through the id map); name one only if the target may hold some already`)
    }
    say('reports/gaps.md and mapping/fields.csv written')
    say(`${todos(m).length} todo(s) left in mapping.json`)
    return 0
  }

  if (cmd === 'gaps') {
    for (const line of report(ws, m, schema(ws, 'source'), schema(ws, 'target'), fillRates(ws))) say(line)
    say('reports/gaps.md and mapping/fields.csv written')
    const left = todos(m)
    say(left.length ? `${left.length} todo(s) left in mapping.json` : 'no todos left: the mapping is settled')
    return left.length ? 1 : 0
  }

  // extract
  const left = todos(m)
  if (left.length) {
    say(`${left.length} todo(s) still in mapping.json; extracting anyway, but load will refuse until they are settled:`)
    for (const t of left.slice(0, 10)) say(`  - ${t}`)
  }
  const mode = opts.mode ? String(opts.mode) : 'bulk'
  if (!['bulk', 'rest'].includes(mode)) throw new Stop('--mode is bulk or rest')
  const limit = opts.limit ? Number(opts.limit) : null
  if (opts.limit && !Number.isInteger(limit)) throw new Stop('--limit takes a whole number')

  const src = schema(ws, 'source')
  const x = exportOf(m)
  for (const o of m.objects) {
    const known = new Set(Object.keys(src.objects[o.source]?.fields ?? {}))
    const live = (o.fields ?? []).filter((e) => !e.drop && !e.todo)
    // `expr` reads the Salesforce row directly, so anything it names has to be in the select too.
    const fromExpr = live.flatMap((e) => [...String(e.expr ?? '').matchAll(/\br\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1]))
    const unknown = fromExpr.filter((f) => !known.has(f))
    if (unknown.length) throw new Stop(`${o.source}: an "expr" reads r.${unknown[0]}, which is not a field on ${o.source}; check the name or describe again`)
    const fields = [...new Set([...live.filter((e) => e.from).map((e) => e.from), ...fromExpr])]
    if (!fields.length) { say(`${o.source}: nothing to extract (every field is dropped or unsettled)`); continue }
    const rows = x ? exportRows(x, o, fields, src, limit) : query(ws, m, soql(o.source, fields, o.where, limit), mode)
    writeLines(ws.path('extract', `${o.source}.jsonl`), rows)
    say(`${o.source}: ${rows.length} records, ${fields.length} fields`)
  }

  // A match lookup needs the source side of the join: SFDC id -> the value to match on.
  const refs = new Map()
  for (const o of m.objects) {
    for (const e of o.fields ?? []) {
      if (e.drop || !e.sfMatch || !e.lookup?.object) continue
      refs.set(`${e.lookup.object}.${e.lookup.match}`, e)
    }
  }
  for (const [key, e] of refs) {
    let map
    if (x?.objects[e.sfMatch.object]) {
      const keep = exportFilter(e.sfMatch.where, src.objects[e.sfMatch.object], src, e.sfMatch.object)
      map = {}
      for (const r of csvRecords(exportCsv(x, e.sfMatch.object))) if (keep(r)) map[r.Id] = r[e.sfMatch.field] || null
    } else if (x && !m.source.org) {
      throw new Stop(`${key}: the mapping matches ${e.sfMatch.object} by ${e.sfMatch.field}, and the export has no ${e.sfMatch.object}.csv: add one (Id and ${e.sfMatch.field} for every ${e.sfMatch.object} the rows reference), or init with --org as well to read it live`)
    } else {
      const rows = query(ws, m, soql(e.sfMatch.object, [e.sfMatch.field], e.sfMatch.where, null), mode)
      map = Object.fromEntries(rows.map((r) => [r.id_p, r[e.sfMatch.field] ?? null]))
    }
    writeJson(ws.path('extract', 'match', `${key}.json`), map)
    say(`${key}: ${Object.keys(map).length} ${e.sfMatch.object} records to match by ${e.sfMatch.field}`)
  }
  say("next: the instance-migration skill's `migrate.mjs load <workspace>` (dry run; writes nothing)")
  return 0
}

function todos (m) {
  const out = []
  for (const o of m.objects) {
    if (o.todo) out.push(`${o.source}: ${o.todo}`)
    for (const e of o.fields ?? []) if (e.todo) out.push(`${o.source}.${e.target ?? e.from}: ${e.todo}`)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    console.error(e instanceof Stop ? e.message : (e?.stack ?? String(e)))
    process.exitCode = e instanceof Stop ? e.code : 1
  }
}

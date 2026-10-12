#!/usr/bin/env node
// Read a Salesforce org, map one or more of its objects onto this Aspen instance's data model,
// report the gaps, and write the extract that instance-migration's migrate.mjs loads.
//
//   node sfmigrate.mjs init <workspace> --org <alias|username>
//   node sfmigrate.mjs describe <workspace> --objects Account,Contact   SFDC describe -> schema/source.json
//   node sfmigrate.mjs probe <workspace> [--sample 500]   which fields actually hold data -> schema/fill.json
//   node sfmigrate.mjs draft <workspace>                mapping.json + the gap report
//   node sfmigrate.mjs gaps <workspace>                 re-report after settling todos
//   node sfmigrate.mjs extract <workspace> [--limit N]  SFDC records -> extract/
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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const IGNORED = ['extract/', 'idmap/', 'errors/', 'schema/']
// Salesforce owns these: they are not writable on insert, and Aspen stamps its own.
const SF_SYSTEM = new Set([
  'Id', 'IsDeleted', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById',
  'SystemModstamp', 'LastActivityDate', 'LastViewedDate', 'LastReferencedDate',
  'MasterRecordId', 'ConnectionReceivedId', 'ConnectionSentId', 'UserRecordAccessId'
])

const HELP = `Map a Salesforce object onto this Aspen instance and build the extract.

  node sfmigrate.mjs init <workspace> --org <alias|username>
  node sfmigrate.mjs describe <workspace> --objects <SFDC objects, comma-separated>
  node sfmigrate.mjs probe <workspace> [--objects <subset>] [--sample 500]
  node sfmigrate.mjs draft <workspace> [--objects <subset>]
  node sfmigrate.mjs gaps <workspace>
  node sfmigrate.mjs extract <workspace> [--limit N] [--mode bulk|rest]

The Aspen side stays with the instance-migration skill's migrate.mjs: run its
\`describe <workspace> --side target\` before draft, then load, pilot and verify.

Salesforce is reached through the \`sf\` CLI only. Nothing is written to Salesforce.`

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

// The live describe carries type and subtype but not max-length, and Aspen rejects an over-long
// value at write time, which a dry run never sees. The instance directory holds the compiled
// metadata, so read the cap from there.
function localCaps (ws, object) {
  for (const base of ['metadata', 'metacode']) {
    for (const sub of ['compiled', 'custom', 'platform']) {
      const file = join(ws.root, base, sub, 'object_p', `${object}.json`)
      if (!existsSync(file)) continue
      try {
        const d = readJson(file)
        const out = {}
        for (const f of d.fields ?? []) if (f['max-length'] != null) out[f.name] = f['max-length']
        if (Object.keys(out).length) return out
      } catch { /* a malformed local file is not worth failing the draft over */ }
    }
  }
  return {}
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
  description: ['about', 'notes'],
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
  account_id: ['account'],
  contact_id: ['contact'],
  parent_id: ['parent', 'parent_account'],
  reports_to_id: ['reports_to', 'manager'],
  first_name: ['first'],
  last_name: ['last'],
  title: ['job_title'],
  amount: ['value'],
  web_site: ['website'],
  photo_url: ['photo', 'image']
}

// Salesforce platform plumbing: it holds data, but what it means on Aspen is a modelling
// decision, not a field match. Naming each one keeps it out of the undifferentiated drop pile.
const PLATFORM = {
  RecordTypeId: ['record type', 'Aspen models this as an object type (otype_p). Map each Salesforce record type to a target object type by hand, or drop it and let the target default apply.'],
  CurrencyIsoCode: ['multi-currency', "Set only if the target object has a currency-code field; otherwise the target's own currency applies."],
  OwnerId: ['owner', 'Matched to the target user by email. Users with no account on the target leave it blank.'],
  IsPersonAccount: ['person account', 'Person accounts are one Salesforce record standing for an account and a contact. Decide which target object each becomes before mapping any field.'],
  ParentId: ['hierarchy', 'A self-lookup. Migrates only if the parent records are in the same extract; load fills it on a second pass.']
}

// ---- describe: one normalized schema for the source, in migrate.mjs's shape

function describeObject (ws, m, name) {
  const d = sf(['sobject', 'describe', '--sobject', name, ...org(ws, m)])
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
  return { object: { label: d.label ?? name, custom: !!d.custom, fields }, picklists }
}

// ---- draft: propose a target field for every source field, and a category for every gap

function pickTargetObject (sourceName, sourceLabel, tgt) {
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
  if (!T) entry.todo = `no Aspen object matches ${name}: set "target" to an existing object, or create one (lean-data-model -> model-first -> metadata -> build-and-deploy), then describe the target again`
  const idx = T ? targetIndex(T) : null
  const filled = fill?.objects?.[name]?.fields ?? null
  const caps = T ? localCaps(ws, target) : {}
  // fill.json held a bare number before max lengths were recorded.
  const rate = (f) => { const v = filled?.[f]; return v == null ? 0 : (typeof v === 'number' ? v : v.fill) }
  const observed = (f) => { const v = filled?.[f]; return (v == null || typeof v === 'number') ? null : v.maxLen }
  const rows = []
  const fields = []

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

    const [tname, rule] = T ? matchField(fname, f, idx) : [null, null]
    row.target = tname; row.rule = rule ?? ''
    const tf = tname ? T.fields[tname] : null

    // Nothing on the target to carry it. Drop is the proposal: a new field is permanent, so it
    // goes through lean-data-model only if the user names a use. The report ranks these by how
    // much data they actually hold, so an empty field is never a question.
    if (!tf) {
      const [pgap, pnote] = PLATFORM[fname] ?? []
      row.gap = gap ?? pgap ?? 'no target field'
      row.note = gap ? how : pnote ?? `nothing on ${target ?? 'the target'} matches`
      fields.push({ from: fname, drop: true, note: `no target field; ${row.note}` })
      rows.push(row); continue
    }

    // It matched a target field. Now the mismatch, if any, is worth the user's time.
    const e = { target: tname, from: fname }
    row.decision = 'map'
    if (gap) {
      row.note = how
      row.decision = 'todo'
      e.todo = `${gap}: ${how} Proposed target: ${tname}.`
    } else if (f.sf.referenceTo.length === 1) {
      const to = f.sf.referenceTo[0]
      if (migrating.has(to)) {
        e.lookup = to
        row.confidence = 'exact'; row.note = `lookup to ${to}, which is migrating: resolved through the id map`
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
    } else if (tf.type !== f.type) {
      row.gap = 'type mismatch'; row.decision = 'todo'
      row.note = `${f.sf.type} in Salesforce, ${tf.type}/${tf.subtype} on ${tname}`
      e.todo = `types differ: ${f.sf.type} in Salesforce, ${tf.type} on ${tname}. Convert it ("expr"), pick another field, or drop it.`
    } else if (f.picklist && tf.picklist) {
      const values = src.picklists[f.picklist] ?? []
      const allowed = new Set(tgt.picklists[tf.picklist] ?? [])
      const missing = values.filter((v) => !allowed.has(v))
      e.map = Object.fromEntries(values.filter((v) => allowed.has(v)).map((v) => [v, v]))
      if (missing.length) {
        row.confidence = 'close'; row.gap = 'picklist values'; row.decision = 'todo'
        row.note = `${missing.length} of ${values.length} values are not on ${tf.picklist}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`
        e.todo = `values not on the target picklist ${tf.picklist}: ${missing.join(', ')}. Add each to "map", or set "default".`
      } else {
        row.confidence = 'exact'; row.note = `all ${values.length} values exist on ${tf.picklist}`
      }
    } else if (f.type === 'text' && tf.type === 'text' && overLength(f, tf, tname, caps, observed(fname), row)) {
      // overLength filled the row in; nothing more to decide here.
    } else if (['url', 'email', 'phone'].includes(tf.subtype)) {
      row.confidence = 'close'; row.gap = `validated ${tf.subtype}`
      row.note = `${tname} is a ${tf.subtype} field and Aspen validates the format on write. Salesforce is laxer, so some values are rejected at load, not at dry run. Normalize them with "expr", or drop the field.`
    } else {
      row.confidence = rule === 'name' ? 'exact' : 'close'
      if (rule !== 'name') row.note = `matched by ${rule}`
    }
    fields.push(e)
    rows.push(row)
  }

  if (T) {
    for (const [fname, tf] of Object.entries(T.fields)) {
      if (tf.required && !fields.some((e) => e.target === fname && !e.drop)) {
        fields.push({ target: fname, todo: `required on ${target} and nothing maps to it: set "from", "value" or "expr"` })
        rows.push({ source: '', label: tf.label, sfType: '', target: fname, rule: '', confidence: 'GAP', gap: 'required, unmapped', decision: 'todo', fill: null, note: `required on ${target}: needs a source field or a constant` })
      }
    }
    const ext = Object.entries(S.fields).find(([n, f]) => f.sf.externalId && fields.some((e) => e.from === n && e.target))
    entry.key = ext ? fields.find((e) => e.from === ext[0]).target
      : fields.find((e) => e.target && !e.todo && !e.lookup && T.fields[e.target]?.unique)?.target ?? null
  }
  entry.fields = fields
  return { entry, rows }
}

// A value longer than the target's cap is rejected on write, and a dry run never sees it. Compare
// the cap from the local metadata against what the sample actually holds.
function overLength (f, tf, tname, caps, maxLen, row) {
  const cap = caps[tname]
  if (!cap) return false
  const sfMax = f.sf.length ?? 0
  if (maxLen != null && maxLen > cap) {
    row.confidence = 'close'; row.gap = 'too long for the target'
    row.note = `the sample holds values up to ${maxLen} characters and ${tname} caps at ${cap}: those records are rejected at load. Truncate with "expr" (\`r.${row.source}?.slice(0, ${cap})\`), widen ${tname}, or drop the field.`
    return true
  }
  if (maxLen == null && sfMax > cap) {
    row.confidence = 'close'; row.gap = 'may not fit'
    row.note = `Salesforce allows ${sfMax} characters and ${tname} caps at ${cap}; run \`sfmigrate probe\` to see the longest value actually stored`
    return true
  }
  return false
}

// ---- the gap report: what needs a decision, what maps, and what is being dropped

const CSV_COLUMNS = ['sf_object', 'aspen_object', 'sf_field', 'aspen_field', 'label', 'sf_type', 'aspen_type', 'aspen_subtype', 'confidence', 'decision', 'gap_category', 'matched_by', 'fill_rate', 'required', 'picklist', 'ref_target_sf', 'note']
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const pct = (v) => v == null ? '' : `${Math.round(v * 100)}%`

function report (ws, m, src, tgt, fill) {
  const lines = []; const csv = [CSV_COLUMNS.join(',')]
  lines.push('# Salesforce -> Aspen: gaps and ETLs\n')
  lines.push(`Source: \`${m.source.org}\` (${m.source.instanceUrl ?? 'Salesforce'})  `)
  lines.push(`Target: ${m.target.url}  `)
  lines.push(`Drafted: ${new Date().toISOString()}`)
  lines.push(fill ? `Fill rates from a sample of ${fill.sample} records per object.\n` : 'No fill rates: run `sfmigrate probe` to see which Salesforce fields actually hold data.\n')
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

    lines.push(`## ${o.source} -> ${o.target ?? '(no target object)'}\n`)
    lines.push(`${S ? Object.keys(S.fields).length : 0} Salesforce fields: ${mapped.length} mapped, ${decide.length} need a decision, ${dropped.length} proposed for drop, ${sfOwned} Salesforce-owned (never migrate).\n`)
    if (o.todo) lines.push(`**Object:** ${o.todo}\n`)

    if (decide.length) {
      lines.push('### Needs your decision\n')
      lines.push('| Salesforce field | Aspen field | Gap / ETL | Proposal |')
      lines.push('|---|---|---|---|')
      for (const r of decide) lines.push(`| \`${r.source || '—'}\` (${r.sfType || '—'}) | ${r.target ? `\`${r.target}\`` : '—'} | ${r.gap ?? ''} | ${r.note.replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
    if (carries.length) {
      lines.push('### Dropped, but holds data\n')
      lines.push('Nothing on the target carries these. Confirm the drop, or name a use and create the field')
      lines.push('(`lean-data-model` first: a field is permanent).\n')
      lines.push('| Salesforce field | Type | Filled | Why it is dropped |')
      lines.push('|---|---|---|---|')
      for (const r of carries.slice(0, 40)) lines.push(`| \`${r.source}\` — ${r.label} | ${r.sfType} | ${pct(r.fill) || '?'} | ${(r.gap ?? '')}${r.note ? `: ${r.note.replace(/\|/g, '\\|')}` : ''} |`)
      if (carries.length > 40) lines.push(`| … ${carries.length - 40} more | | | see mapping/fields.csv |`)
      lines.push('')
    }
    if (mapped.length) {
      lines.push('### Maps as it is\n')
      lines.push('| Salesforce field | Aspen field | Confidence | Note |')
      lines.push('|---|---|---|---|')
      for (const r of mapped) lines.push(`| \`${r.source}\` | \`${r.target}\` | ${r.confidence} | ${r.note.replace(/\|/g, '\\|')} |`)
      lines.push('')
    }
    if (empty.length) lines.push(`### Dropped, empty in the sample\n${empty.length} fields hold no data in the sample and are dropped without a question: ${empty.slice(0, 25).map((r) => `\`${r.source}\``).join(', ')}${empty.length > 25 ? `, … (all ${empty.length} in mapping/fields.csv)` : ''}\n`)

    for (const r of rows) {
      const tf = T && r.target ? T.fields[r.target] : null
      const sfF = S?.fields?.[r.source]
      csv.push([o.source, o.target ?? '', r.source, r.target ?? '', r.label, r.sfType, tf?.type ?? '', tf?.subtype ?? '',
        r.confidence, r.decision, r.gap ?? '', r.rule, r.fill == null ? '' : r.fill.toFixed(3), tf?.required ? 'true' : '',
        tf?.picklist ?? '', (sfF?.sf?.referenceTo ?? []).join(' '), r.note].map(csvCell).join(','))
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
function strip (r) {
  const { attributes, Id, CreatedDate, ...rest } = r
  const out = { id_p: Id }
  if (CreatedDate) out.ct_p = CreatedDate
  for (const [k, v] of Object.entries(rest)) out[k] = (v === undefined || v === '') ? null : v
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
  if (!['init', 'describe', 'probe', 'draft', 'gaps', 'extract'].includes(cmd)) throw new Stop(`unknown command ${cmd}\n\n${HELP}`)
  const ws = workspace(wsArg)

  if (cmd === 'init') {
    if (!opts.org) throw new Stop('init needs --org: the sf CLI alias or username for the source org (`sf org list`)')
    const o = sf(['org', 'display', '--target-org', String(opts.org)])
    const m = {
      source: { kind: 'salesforce', org: String(opts.org), url: o.instanceUrl, username: o.username, instanceUrl: o.instanceUrl, apiVersion: o.apiVersion },
      target: { url: opts.target ? String(opts.target) : ws.instance },
      objects: []
    }
    if (!sameUrl(m.target.url, ws.instance)) throw new Stop(`--target ${m.target.url} is not this directory's instance (${ws.instance})`)
    writeJson(ws.path('mapping.json'), m)
    writeText(ws.path('.gitignore'), IGNORED.join('\n') + '\n')
    say(`workspace ${ws.dir}`)
    say(`source: ${o.username} at ${o.instanceUrl} (API ${o.apiVersion})`)
    say(`target: ${m.target.url}`)
    say("next: sfmigrate describe <workspace> --objects <SFDC objects>, and migrate.mjs describe <workspace> --side target")
    return 0
  }

  const m = readMapping(ws)

  if (cmd === 'describe') {
    if (!opts.objects) throw new Stop('describe needs --objects: the Salesforce objects to read, comma-separated')
    const names = String(opts.objects).split(',').map((s) => s.trim()).filter(Boolean)
    const existing = existsSync(ws.path('schema', 'source.json')) ? readJson(ws.path('schema', 'source.json')) : { objects: {}, picklists: {} }
    const objects = { ...existing.objects }; const picklists = { ...existing.picklists }
    for (const n of names) {
      const d = describeObject(ws, m, n)
      objects[n] = d.object
      Object.assign(picklists, d.picklists)
      const gaps = Object.values(d.object.fields).filter((f) => gapOf(f)[0]).length
      say(`${n}: ${Object.keys(d.object.fields).length} fields, ${Object.keys(d.picklists).length} picklists, ${gaps} that need an ETL`)
    }
    writeJson(ws.path('schema', 'source.json'), { org: m.source.org, instanceUrl: m.source.instanceUrl, described: new Date().toISOString(), objects, picklists })
    say(`schema/source.json: ${Object.keys(objects).length} object(s)`)
    return 0
  }

  if (cmd === 'probe') {
    const src = schema(ws, 'source')
    const names = opts.objects ? String(opts.objects).split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(src.objects)
    const sample = opts.sample ? Number(opts.sample) : 500
    if (!Number.isInteger(sample) || sample < 1) throw new Stop('--sample takes a whole number of records')
    const out = { sample, probed: new Date().toISOString(), objects: {} }
    for (const n of names) {
      const S = src.objects[n]
      if (!S) throw new Stop(`${n} is not in schema/source.json; run describe first`)
      // File bodies are huge and not queryable in bulk; everything else is fair game.
      const names2 = Object.entries(S.fields).filter(([f, d]) => f !== 'Id' && d.sf.type !== 'base64').map(([f]) => f)
      const fields = {}
      let records = 0
      // ORDER BY Id LIMIT N picks the same records in every chunk, so each chunk measures the
      // same sample. SOQL caps how many fields one query can carry.
      for (const chunk of chunksOf(names2, 150)) {
        const rows = query(ws, m, `SELECT Id, ${chunk.join(', ')} FROM ${n} ORDER BY Id LIMIT ${sample}`, 'rest')
        records = Math.max(records, rows.length)
        for (const f of chunk) {
          const vals = rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined && v !== '')
          const maxLen = vals.reduce((n, v) => Math.max(n, String(v).length), 0)
          fields[f] = { fill: rows.length ? vals.length / rows.length : 0, maxLen }
        }
      }
      out.objects[n] = { records, fields }
      const used = Object.values(fields).filter((v) => v.fill > 0).length
      say(`${n}: ${records} records sampled, ${used} of ${names2.length} fields hold data`)
    }
    writeJson(ws.path('schema', 'fill.json'), out)
    say('schema/fill.json written; draft marks empty fields as dropped without a question')
    return 0
  }

  if (cmd === 'draft') {
    const src = schema(ws, 'source'); const tgt = schema(ws, 'target'); const fill = fillRates(ws)
    const names = opts.objects ? String(opts.objects).split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(src.objects)
    const have = new Set(m.objects.map((o) => o.source))
    const migrating = new Set([...have, ...names])
    const added = names.filter((n) => !have.has(n))
    for (const n of added) {
      const { entry, rows } = draftObject(ws, n, src, tgt, migrating, fill)
      entry.report = rows
      m.objects.push(entry)
    }
    writeJson(ws.path('mapping.json'), m)
    for (const line of report(ws, m, src, tgt, fill)) say(line)
    if (!fill) say('no fill rates: `sfmigrate probe` first, and the dropped fields that hold data stand out from the empty ones')
    for (const o of m.objects.filter((x) => added.includes(x.source) && x.target && !x.key)) {
      say(`${o.source}: no key; ask which field identifies the same record on both sides`)
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
  for (const o of m.objects) {
    const known = new Set(Object.keys(src.objects[o.source]?.fields ?? {}))
    const live = (o.fields ?? []).filter((e) => !e.drop && !e.todo)
    // `expr` reads the Salesforce row directly, so anything it names has to be in the select too.
    const fromExpr = live.flatMap((e) => [...String(e.expr ?? '').matchAll(/\br\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1]))
    const unknown = fromExpr.filter((f) => !known.has(f))
    if (unknown.length) throw new Stop(`${o.source}: an "expr" reads r.${unknown[0]}, which is not a field on ${o.source}; check the name or describe again`)
    const fields = [...new Set([...live.filter((e) => e.from).map((e) => e.from), ...fromExpr])]
    if (!fields.length) { say(`${o.source}: nothing to extract (every field is dropped or unsettled)`); continue }
    const rows = query(ws, m, soql(o.source, fields, o.where, limit), mode)
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
    const rows = query(ws, m, soql(e.sfMatch.object, [e.sfMatch.field], e.sfMatch.where, null), mode)
    const map = Object.fromEntries(rows.map((r) => [r.id_p, r[e.sfMatch.field] ?? null]))
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

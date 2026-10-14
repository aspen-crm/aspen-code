import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'salesforce-migration', 'scripts', 'sfmigrate.mjs')
const URL = 'https://acme.example.com/acme.com/dev/'

// ---- the Salesforce side, as `sfmigrate describe` normalizes it

const sfField = (label, type, o = {}) => ({
  label, type: o.aspen ?? 'text', subtype: 'text', required: false, unique: false,
  lookup: o.to?.length === 1 ? o.to[0] : null, objects: o.to?.length > 1 ? o.to : null, picklist: o.picklist ?? null,
  sf: { type, length: o.length ?? null, precision: null, scale: null, calculated: false, formula: null, createable: true, externalId: false, referenceTo: o.to ?? [], relationshipName: null }
})
const ref = (label, ...to) => sfField(label, 'reference', { to, aspen: 'id' })
const str = (label) => sfField(label, 'string')
const pick = (label, list, multi = false) => sfField(label, multi ? 'multipicklist' : 'picklist', { aspen: 'picklist', picklist: list })
const sfObject = (label, fields) => ({ label, custom: false, fields })

const SOURCE = {
  objects: {
    Account: sfObject('Account', { Name: str('Account Name'), BillingCity: str('Billing City'), OwnerId: ref('Owner ID', 'User'), Website: sfField('Website', 'url', { length: 255 }) }),
    Contact: sfObject('Contact', { LastName: str('Last Name'), Email: sfField('Email', 'email'), Phone: sfField('Business Phone', 'phone'), AccountId: ref('Account ID', 'Account') }),
    Opportunity: sfObject('Opportunity', {
      Name: str('Name'), AccountId: ref('Account ID', 'Account'), OwnerId: ref('Owner ID', 'User'),
      Amount: sfField('Amount', 'currency', { aspen: 'currency' }), Probability: sfField('Probability (%)', 'percent', { aspen: 'number' }),
      CurrencyIsoCode: pick('Opportunity Currency', 'Opportunity.CurrencyIsoCode')
    }),
    User: sfObject('User', { Email: sfField('Email', 'email'), LastName: str('Last Name') }),
    Case: sfObject('Case', { Subject: str('Subject') }),
    Lead: sfObject('Lead', { Email: sfField('Email', 'email') }),
    Product2: sfObject('Product', { Name: str('Product Name'), ProductCode: str('Product Code') }),
    ContactChannel__c: sfObject('Contact Channel', { Name: str('Name') }),
    AccountContactRelation: sfObject('Account Contact Relationship', {
      AccountId: ref('Account ID', 'Account'), ContactId: ref('Contact ID', 'Contact'),
      Roles: pick('Roles', 'AccountContactRelation.Roles', true), IsDirect: sfField('Direct', 'boolean', { aspen: 'checkbox' })
    }),
    OpportunityContactRole: sfObject('Opportunity Contact Role', { OpportunityId: ref('Opportunity ID', 'Opportunity'), ContactId: ref('Contact ID', 'Contact'), Role: pick('Role', 'OpportunityContactRole.Role') }),
    CaseContactRole: sfObject('Case Contact Role', { CasesId: ref('Case ID', 'Case'), ContactId: ref('Contact ID', 'Contact'), Role: pick('Role', 'CaseContactRole.Role') }),
    AccountTeamMember: sfObject('Account Team Member', { AccountId: ref('Account ID', 'Account'), UserId: ref('User ID', 'User'), TeamMemberRole: pick('Team Role', 'AccountTeamMember.TeamMemberRole') }),
    OpportunityTeamMember: sfObject('Opportunity Team Member', { OpportunityId: ref('Opportunity ID', 'Opportunity'), UserId: ref('User ID', 'User'), TeamMemberRole: pick('Team Role', 'OpportunityTeamMember.TeamMemberRole') }),
    Task: sfObject('Task', { Subject: str('Subject'), WhoId: ref('Name ID', 'Contact', 'Lead'), WhatId: ref('Related To ID', 'Account', 'Opportunity', 'Lead'), OwnerId: ref('Assigned To ID', 'Group', 'User') }),
    Event: sfObject('Event', { Subject: str('Subject'), StartDateTime: sfField('Start', 'datetime', { aspen: 'datetime' }), WhoId: ref('Name ID', 'Contact', 'Lead'), OwnerId: ref('Assigned To ID', 'User') }),
    TaskRelation: sfObject('Task Relation', { TaskId: ref('Task ID', 'Task'), RelationId: ref('Relation ID', 'Contact', 'Lead', 'User'), IsWhat: sfField('Is What', 'boolean', { aspen: 'checkbox' }) }),
    EventRelation: sfObject('Event Relation', { EventId: ref('Event ID', 'Event'), RelationId: ref('Relation ID', 'Contact', 'Lead', 'User'), IsWhat: sfField('Is What', 'boolean', { aspen: 'checkbox' }) })
  },
  picklists: {
    'AccountContactRelation.Roles': ['Champion'],
    'OpportunityContactRole.Role': ['Decision Maker'],
    'CaseContactRole.Role': ['Technical Contact'],
    'AccountTeamMember.TeamMemberRole': ['Account Manager', 'Sales Rep'],
    'OpportunityTeamMember.TeamMemberRole': ['Account Manager', 'Sales Rep'],
    'Opportunity.CurrencyIsoCode': ['USD', 'EUR', 'XAU']
  }
}

// ---- the Aspen side, as `migrate describe --side target` normalizes it: allowed-objects,
// related-object-field and included-polyids as the 26.4.1 platform metadata declares them

const field = (label, type, subtype, o = {}) => ({
  label, description: o.description ?? null, type, subtype, required: !!o.required, unique: !!o.unique, readOnly: false,
  lookup: o.lookup ?? null, objects: o.objects ?? null, relatedObjectField: o.on ?? null, picklist: o.picklist ?? null,
  maxLength: o.maxLength ?? null, minValue: o.minValue ?? null, maxValue: o.maxValue ?? null, dependsOn: o.dependsOn ?? null
})
const text = (label, o) => field(label, 'text', 'text', o)
const id = (label, to, o = {}) => field(label, 'id', 'lookup', { ...o, lookup: to })
const poly = (label, on, o = {}) => field(label, 'polyid', 'parent', { ...o, on })
const objectRef = (label, o) => field(label, 'picklist', 'object_ref', o)
const object = (label, fields, o = {}) => ({ label, description: o.description ?? null, includedPolyids: o.included ?? [], fields })
const WHATS = (...objects) => objects.map((object) => ({ object, field: 'what_p' }))

const TARGET = {
  objects: {
    // As a 26.4.1 describe has them: user_p.email_p is not unique (username_p is); team_p.email_p is.
    user_p: object('User', { email_p: field('Email', 'text', 'email', { required: true }), username_p: text('Username', { required: true, unique: true }) }),
    team_p: object('Team', { email_p: text('Email', { unique: true }), user_p: id('User', 'user_p', { unique: true }) }, { description: 'An employee, contractor, or partner of the company.' }),
    account_p: object('Account', { name_p: text('Name', { required: true }), owner_p: id('Owner', 'team_p'), website_p: field('Website', 'text', 'url', { maxLength: 120 }), industry_p: field('Industry', 'picklist', 'picklist', { picklist: 'industry_p' }), parent_account_p: id('Parent Account', 'account_p') },
      { included: WHATS('task_p', 'meeting_p', 'contact_role_p', 'team_role_p') }),
    account_address_p: object('Account Address', { account_p: id('Account', 'account_p'), city_p: text('City') }, { description: 'Physical location or postal address associated with an account.' }),
    contact_p: object('Contact', {
      last_name_p: text('Last Name'), work_email_p: text('Work Email', { description: 'Primary and active work email address.' }),
      office_phone_p: field('Office Phone', 'text', 'phone'), mobile_phone_p: field('Mobile Phone', 'text', 'phone'),
      linkedin_profile_p: field('LinkedIn Profile', 'text', 'url', { maxLength: 120 }), owner_p: id('Owner', 'team_p'),
      primary_account_p: id('Primary Account', 'account_p')
    }),
    contact_channel_p: object('Contact Channels', { contact_p: id('Contact', 'contact_p'), name_p: text('Name') }),
    opportunity_p: object('Opportunity', {
      name_p: text('Name', { required: true }),
      customer_p: poly('Customer', 'customeron_p', { objects: ['account_p', 'contact_p'] }), customeron_p: objectRef('Customer (Object)'),
      owner_p: poly('Owner', 'owneron_p', { objects: ['user_p'] }), owneron_p: objectRef('Owner (Object)'),
      amount_p: field('Amount', 'currency', 'currency'), ccode_p: id('Currency', 'currency_p'),
      probability_p: field('Probability', 'number', 'percentage', { minValue: '0.00', maxValue: '1.00' })
    }, { included: WHATS('task_p', 'meeting_p', 'contact_role_p', 'team_role_p') }),
    currency_p: object('Currency', { name_p: text('Name', { required: true }), currency_code_p: field('Currency Code', 'picklist', 'picklist', { picklist: 'currency_code_p', unique: true }) }),
    case_p: object('Case', { subject_p: text('Subject') }, { included: WHATS('task_p', 'meeting_p', 'contact_role_p', 'team_role_p') }),
    lead_p: object('Lead', { email_p: text('Email') }),
    product_p: object('Product', { name_p: text('Name'), sku_p: text('SKU', { unique: true }) }),
    contact_rel_p: object('Contact Relationship', { team_p: id('Team', 'team_p'), contact_p: id('Contact', 'contact_p') },
      { description: 'Join record between a team member and a contact, capturing the strength of the relationship.' }),
    contact_role_p: object('Contact Role', {
      contact_p: id('Contact', 'contact_p', { required: true }),
      what_p: poly('What', 'whaton_p', { required: true, description: 'Reference to the business record this contact role is associated with.' }),
      whaton_p: objectRef('What (Object)', { required: true }),
      role_p: field('Role', 'picklist', 'picklist', { picklist: 'contact_role_p.role_p' }),
      contact_role_chk_p: text('Uniqueness Key', { unique: true })
    }, { description: 'Associates a contact with any other record, classifying the association via a relationship type.' }),
    team_role_p: object('Team Role', {
      team_p: id('Team', 'team_p', { required: true }),
      what_p: poly('What', 'whaton_p', { required: true }), whaton_p: objectRef('What (Object)', { required: true }),
      role_p: field('Role', 'picklist', 'picklist', { picklist: 'team_role_p', dependsOn: 'whaton_p' }),
      team_role_chk_p: text('Uniqueness Key', { unique: true })
    }),
    task_p: object('Task', {
      subject_p: text('Subject', { required: true }),
      owner_p: poly('Owner', 'owneron_p', { objects: ['user_p'] }), owneron_p: objectRef('Owner (Object)'),
      who_p: poly('Who', 'whoon_p', { objects: ['contact_p', 'team_p'] }), whoon_p: objectRef('Who (Object)'),
      what_p: poly('What', 'whaton_p'), whaton_p: objectRef('What (Object)'),
      parent_p: id('Parent', 'task_p'), due_date_p: field('Due Date', 'date', 'date')
    }),
    meeting_p: object('Meeting', {
      subject_p: text('Subject', { required: true }), when_p: field('When', 'datetime', 'datetime', { required: true }),
      owner_p: poly('Owner', 'owneron_p', { objects: ['user_p'] }), owneron_p: objectRef('Owner (Object)'),
      who_p: poly('Who', 'whoon_p', { required: true, objects: ['contact_p', 'team_p'] }), whoon_p: objectRef('Who (Object)', { required: true }),
      parent_p: id('Parent', 'meeting_p')
    })
  },
  picklistItems: {
    'contact_role_p.role_p': [{ name: 'decision_maker_p', label: 'Decision Maker' }, { name: 'champion_p', label: 'Champion' }],
    // Object-dependent: each item names the objects whose records it may be used on.
    team_role_p: [{ name: 'account_manager_p', label: 'Account Manager', parentObjects: ['account_p'] }, { name: 'sales_rep_p', label: 'Sales Rep', parentObjects: ['opportunity_p'] }],
    currency_code_p: [{ name: 'usd_p', label: 'USD' }, { name: 'eur_p', label: 'EUR' }],
    industry_p: [{ name: 'biotech_p', label: 'Biotechnology' }]
  },
  currencies: ['usd_p'] // the codes with a currency_p record on the instance
}
TARGET.picklists = Object.fromEntries(Object.entries(TARGET.picklistItems).map(([n, items]) => [n, items.map((i) => i.name)]))

function draft (t, objects, source = SOURCE, { target = TARGET, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sfmigrate '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.aspen'))
  writeFileSync(join(root, '.aspen', 'config.toml'), `instance = "${URL}"\n`)
  const ws = join(root, 'data', 'migrations', 'acme')
  mkdirSync(join(ws, 'schema'), { recursive: true })
  writeFileSync(join(ws, 'mapping.json'), JSON.stringify({ source: { kind: 'salesforce', org: 'acme' }, target: { url: URL }, objects: [] }))
  writeFileSync(join(ws, 'schema', 'source.json'), JSON.stringify(source))
  writeFileSync(join(ws, 'schema', 'target.json'), JSON.stringify(target))
  for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const r = spawnSync(process.execPath, [script, 'draft', ws, '--objects', objects], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const m = JSON.parse(readFileSync(join(ws, 'mapping.json'), 'utf8'))
  const entry = (source) => m.objects.find((o) => o.source === source)
  return { m, entry, gaps: readFileSync(join(ws, 'reports', 'gaps.md'), 'utf8'), csv: readFileSync(join(ws, 'mapping', 'fields.csv'), 'utf8'), out: r.stdout }
}

const to = (o, name) => o.fields.find((e) => e.target === name && !e.drop)
const from = (o, name) => o.fields.find((e) => e.from === name)
const CORE = 'Account,Contact,Opportunity,Case'
const TEAM_MATCH = { object: 'team_p', match: 'email_p' }
const USER_MATCH = { object: 'user_p', match: 'email_p' }
const BY_EMAIL = { object: 'User', field: 'Email' }

test('contact roles go to contact_role_p, never contact_rel_p, keyed on the pair a trigger may have made', t => {
  const { entry, out, gaps, csv } = draft(t, `${CORE},AccountContactRelation,OpportunityContactRole,CaseContactRole`)
  for (const [source, parent, lookup] of [['AccountContactRelation', 'AccountId', 'Account'], ['OpportunityContactRole', 'OpportunityId', 'Opportunity'], ['CaseContactRole', 'CasesId', 'Case']]) {
    const o = entry(source)
    assert.equal(o.target, 'contact_role_p', source)
    assert.deepEqual(to(o, 'what_p'), { target: 'what_p', from: parent, lookup }, source)
    assert.deepEqual(to(o, 'whaton_p'), { target: 'whaton_p', objectOf: 'what_p' }, source)
    assert.equal(to(o, 'contact_p').lookup, 'Contact', source)
    assert.deepEqual(o.key, { field: 'contact_role_chk_p', of: ['contact_p', 'what_p'] }, source)
  }
  // Roles is proposed for role_p; a multi-select is a decision, a single picklist a value map,
  // matched to the target's items by label.
  assert.match(to(entry('AccountContactRelation'), 'role_p').todo, /multi/i)
  assert.deepEqual(to(entry('OpportunityContactRole'), 'role_p').map, { 'Decision Maker': 'decision_maker_p' })
  assert.equal(to(entry('OpportunityContactRole'), 'role_p').todo, undefined)
  // The direct relations are the pairs Aspen already derived from each contact's primary account.
  assert.equal(entry('AccountContactRelation').where, 'IsDirect = false')
  assert.equal(entry('OpportunityContactRole').where, undefined)
  assert.doesNotMatch(out, /(Relation|Role): no key/)
  // The report quotes what Aspen says each object and field is for.
  assert.match(gaps, /> \*\*contact_role_p:\*\* Associates a contact with any other record/)
  assert.match(gaps, /`what_p` \| Reference to the business record/)
  assert.match(csv.split('\n')[0], /aspen_description$/)
})

test('a junction whose parent is not migrating is a todo, not a guess', t => {
  const { entry } = draft(t, 'Contact,AccountContactRelation')
  const acr = entry('AccountContactRelation')
  assert.equal(acr.target, 'contact_role_p')
  assert.match(from(acr, 'AccountId').todo, /migrate Account too/)
})

test('team members go to team_role_p: the user matched to a team member by email, keyed on the pair', t => {
  const { entry } = draft(t, `${CORE},AccountTeamMember,OpportunityTeamMember`)
  for (const [source, parent, lookup] of [['AccountTeamMember', 'AccountId', 'Account'], ['OpportunityTeamMember', 'OpportunityId', 'Opportunity']]) {
    const o = entry(source)
    assert.equal(o.target, 'team_role_p', source)
    assert.deepEqual(to(o, 'team_p'), { target: 'team_p', from: 'UserId', lookup: TEAM_MATCH, sfMatch: BY_EMAIL, missing: 'null' }, source)
    assert.deepEqual(to(o, 'what_p'), { target: 'what_p', from: parent, lookup }, source)
    assert.deepEqual(to(o, 'whaton_p'), { target: 'whaton_p', objectOf: 'what_p' }, source)
    assert.deepEqual(o.key, { field: 'team_role_chk_p', of: ['team_p', 'what_p'] }, source)
  }
  // team_role_p is object-dependent: each junction maps only the roles its parent object allows.
  const atm = to(entry('AccountTeamMember'), 'role_p')
  assert.deepEqual(atm.map, { 'Account Manager': 'account_manager_p' })
  assert.match(atm.todo, /team_role_p allows on account_p: Sales Rep\b.*\(account_manager_p\)/)
  const otm = to(entry('OpportunityTeamMember'), 'role_p')
  assert.deepEqual(otm.map, { 'Sales Rep': 'sales_rep_p' })
  assert.match(otm.todo, /team_role_p allows on opportunity_p: Account Manager\b.*\(sales_rep_p\)/)
})

test('a Salesforce User is a team member, not a platform login', t => {
  const { entry } = draft(t, 'User')
  assert.equal(entry('User').target, 'team_p')
})

test('lengths, ranges and the record currency come from the target describe', t => {
  const { entry } = draft(t, CORE)
  const opp = entry('Opportunity')
  // probability_p takes 0.00-1.00; Salesforce holds 50% as 50.
  assert.deepEqual(to(opp, 'probability_p'), { target: 'probability_p', expr: 'r.Probability == null ? null : Number(r.Probability) / 100' })
  // A currency value needs ccode_p: CurrencyIsoCode matched to currency_p by its code's label.
  const cc = to(opp, 'ccode_p')
  assert.deepEqual(cc.lookup, { object: 'currency_p', match: 'currency_code_p', by: 'value' })
  assert.deepEqual(cc.map, { USD: 'usd_p', EUR: 'eur_p' })
  assert.match(cc.todo, /XAU/)
  assert.ok(!opp.fields.some((e) => e.from === 'CurrencyIsoCode' && e.drop), 'CurrencyIsoCode is mapped, not also dropped')
  // A url field is normalized by the loader (https://, cut to fit or blank), not left to fail.
  assert.equal(to(entry('Account'), 'website_p').normalize, 'url')
})

test('without CurrencyIsoCode, the record currency is a todo, not a silent rejection', t => {
  const src = structuredClone(SOURCE)
  delete src.objects.Opportunity.fields.CurrencyIsoCode
  const { entry } = draft(t, CORE, src)
  assert.match(to(entry('Opportunity'), 'ccode_p').todo, /org's currency/)
})

test("an opportunity's account is its customer, and its owner a user, each with the object beside it", t => {
  const { entry } = draft(t, CORE)
  const opp = entry('Opportunity')
  assert.deepEqual(to(opp, 'customer_p'), { target: 'customer_p', from: 'AccountId', lookup: 'Account' })
  assert.deepEqual(to(opp, 'customeron_p'), { target: 'customeron_p', objectOf: 'customer_p' })
  assert.deepEqual(to(opp, 'owner_p'), { target: 'owner_p', from: 'OwnerId', lookup: USER_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.deepEqual(to(opp, 'owneron_p'), { target: 'owneron_p', objectOf: 'owner_p' })
})

test('an owner is matched by email on the object its field looks up: team_p for an account, user_p (not unique) for a deal', t => {
  const { entry, gaps } = draft(t, CORE)
  assert.deepEqual(to(entry('Account'), 'owner_p').lookup, TEAM_MATCH)
  assert.deepEqual(to(entry('Opportunity'), 'owner_p').lookup, USER_MATCH)
  assert.match(gaps, /user_p\.email_p is not unique, so an email two of them share is left blank too/)
  assert.doesNotMatch(gaps, /team_p\.email_p is not unique/)
})

test("a task's own row names its owner, and points at what it is about; leads it cannot hold carry blank", t => {
  const { entry } = draft(t, `${CORE},Task,TaskRelation`)
  const task = entry('Task')
  assert.equal(task.target, 'task_p')
  assert.equal(from(task, 'WhoId').drop, true, 'the contacts are TaskRelation rows')
  assert.deepEqual(to(task, 'who_p'), { target: 'who_p', from: 'OwnerId', lookup: TEAM_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.deepEqual(to(task, 'whoon_p'), { target: 'whoon_p', objectOf: 'who_p' })
  assert.deepEqual(to(task, 'owner_p'), { target: 'owner_p', from: 'OwnerId', lookup: USER_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.deepEqual(to(task, 'what_p'), { target: 'what_p', from: 'WhatId', lookup: ['Account', 'Opportunity'], missing: 'null' })
  assert.deepEqual(to(task, 'whaton_p'), { target: 'whaton_p', objectOf: 'what_p' })
  assert.match(task.note, /TaskRelation/)
})

test('TaskRelation and EventRelation are child rows: one per contact, under the activity they belong to', t => {
  const { entry } = draft(t, `${CORE},Task,Event,TaskRelation,EventRelation`)
  const tr = entry('TaskRelation')
  assert.equal(tr.target, 'task_p')
  assert.equal(tr.where, "IsWhat = false AND Relation.Type = 'Contact'")
  assert.deepEqual(to(tr, 'parent_p'), { target: 'parent_p', from: 'TaskId', lookup: 'Task' })
  assert.deepEqual(to(tr, 'who_p'), { target: 'who_p', from: 'RelationId', lookup: 'Contact' })
  assert.deepEqual(to(tr, 'whoon_p'), { target: 'whoon_p', objectOf: 'who_p' })
  assert.deepEqual(to(tr, 'subject_p'), { target: 'subject_p', from: 'Task.Subject' })
  assert.deepEqual(to(tr, 'due_date_p'), { target: 'due_date_p', from: 'Task.ActivityDate' })
  assert.deepEqual(to(tr, 'owner_p'), { target: 'owner_p', from: 'Task.OwnerId', lookup: USER_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.equal(tr.todo, undefined)
  assert.ok(!tr.fields.some((e) => e.todo), JSON.stringify(tr.fields.filter((e) => e.todo)))

  const event = entry('Event')
  assert.equal(event.target, 'meeting_p')
  assert.deepEqual(to(event, 'who_p'), { target: 'who_p', from: 'OwnerId', lookup: TEAM_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.equal(from(event, 'WhoId').drop, true)
  const er = entry('EventRelation')
  assert.equal(er.target, 'meeting_p')
  assert.deepEqual(to(er, 'parent_p'), { target: 'parent_p', from: 'EventId', lookup: 'Event' })
  assert.deepEqual(to(er, 'who_p'), { target: 'who_p', from: 'RelationId', lookup: 'Contact' })
  assert.deepEqual(to(er, 'when_p'), { target: 'when_p', from: 'Event.StartDateTime' })
  assert.deepEqual(to(er, 'subject_p'), { target: 'subject_p', from: 'Event.Subject' })
})

test('renamed objects and fields are matched by what Aspen says they are', t => {
  const { entry } = draft(t, `${CORE},Event,Product2`)
  assert.equal(entry('Event').target, 'meeting_p')
  assert.equal(entry('Product2').target, 'product_p')
  assert.equal(to(entry('Product2'), 'sku_p').from, 'ProductCode')
  assert.equal(to(entry('Contact'), 'work_email_p').from, 'Email')
  assert.equal(to(entry('Contact'), 'office_phone_p').from, 'Phone')
})

test('what the user must hear: addresses are records, derived objects are not loaded, and a Lead is not a person', t => {
  const { entry, gaps } = draft(t, `${CORE},Lead,ContactChannel__c`)
  assert.match(gaps, /`BillingCity`.*address.*account_address_p/)
  assert.match(entry('ContactChannel__c').todo, /Aspen derives contact_channel_p .*Don't load it/)
  assert.match(entry('Lead').note, /creates a contact for each lead it cannot match/)
  assert.match(gaps, /\*\*Note:\*\* lead_p is/)
})

// ---- a Salesforce export on disk: a manifest, a describe per object and one CSV per object

const rawField = (name, type, o = {}) => ({
  name, label: o.label ?? name, type, nillable: true, defaultedOnCreate: false, createable: o.createable ?? true, unique: false,
  referenceTo: o.to ?? [], relationshipName: o.rel ?? null, picklistValues: (o.values ?? []).map((value) => ({ value, active: true })),
  length: o.length ?? 0, calculated: false, externalId: false
})
const rawObject = (name, keyPrefix, fields) => ({
  name, label: name, keyPrefix, custom: false,
  fields: [rawField('Id', 'id', { createable: false }), rawField('CreatedDate', 'datetime', { createable: false }), ...fields]
})
const EXPORT = {
  Account: [rawObject('Account', '001', [rawField('Name', 'string', { label: 'Account Name' }), rawField('Website', 'url', { length: 255 }),
    rawField('OwnerId', 'reference', { to: ['User'], rel: 'Owner' }), rawField('Industry', 'picklist', { values: ['Biotechnology', 'Banking', 'Retail'] }),
    rawField('ParentId', 'reference', { to: ['Account'], rel: 'Parent', label: 'Parent Account ID' })]),
  'Id,Name,Website,OwnerId,Industry,ParentId,CreatedDate\n' +
  '001A,"Acme,\nInc.",acme.com,005U1,Biotechnology,,2020-01-01T00:00:00.000Z\n' +
  '001B,"Beta ""B""",https://beta.io,005U2,Biotechnology,001X,2020-01-02T00:00:00.000Z\n' +
  '001C,Gamma,,005U1,Banking,001A,2020-01-03T00:00:00.000Z\n'],
  Contact: [rawObject('Contact', '003', [rawField('LastName', 'string', { label: 'Last Name' }), rawField('Email', 'email'),
    rawField('Phone', 'phone', { label: 'Business Phone' }), rawField('MobilePhone', 'phone', { label: 'Mobile Phone' }),
    rawField('AccountId', 'reference', { to: ['Account'], rel: 'Account' }), rawField('OwnerId', 'reference', { to: ['User'], rel: 'Owner' }),
    rawField('Linkedin_Profile__c', 'url', { label: 'LinkedIn Profile', length: 255 })]),
  'Id,LastName,Email,Phone,MobilePhone,AccountId,OwnerId,Linkedin_Profile__c,CreatedDate\n' +
  '003A,Lee,ada@x.com,(415) 555-0100,(415) 555-0100,001A,005U1,http://linkedin.com/in/ada/?trk=1,2021-01-01T00:00:00.000Z\n' +
  '003B,Kim,bo@x.com,11 98765 4321,,001B,005U2,,2021-01-02T00:00:00.000Z\n'],
  Opportunity: [rawObject('Opportunity', '006', [rawField('Name', 'string'), rawField('AccountId', 'reference', { to: ['Account'], rel: 'Account' }),
    rawField('Amount', 'currency'), rawField('CurrencyIsoCode', 'picklist', { label: 'Opportunity Currency', values: ['USD', 'EUR', 'JPY'] })]),
  'Id,Name,AccountId,Amount,CurrencyIsoCode,CreatedDate\n006A,One,001A,1000,USD,2022-01-01T00:00:00.000Z\n006B,Two,001B,2000,EUR,2022-01-02T00:00:00.000Z\n006C,Three,001A,,USD,2022-01-03T00:00:00.000Z\n'],
  Task: [rawObject('Task', '00T', [rawField('Subject', 'combobox', { values: ['Call', 'Email'] }),rawField('OwnerId', 'reference', { to: ['Group', 'User'], rel: 'Owner' })]),
    'Id,Subject,OwnerId,CreatedDate\n00TA,Call,005U1,2023-01-01T00:00:00.000Z\n00TB,Email,005U2,2023-01-02T00:00:00.000Z\n'],
  TaskRelation: [rawObject('TaskRelation', '0RT', [rawField('TaskId', 'reference', { to: ['Task'], rel: 'Task' }),
    rawField('RelationId', 'reference', { to: ['Contact', 'Lead', 'User'], rel: 'Relation' }), rawField('IsWhat', 'boolean')]),
  'Id,TaskId,RelationId,IsWhat,CreatedDate\n0RTA,00TA,003A,false,2023-01-01T00:00:00.000Z\n0RTB,00TA,00QX,false,2023-01-01T00:00:00.000Z\n0RTC,00TB,001A,true,2023-01-02T00:00:00.000Z\n']
}

function fromExport (t, url = URL) {
  const root = mkdtempSync(join(tmpdir(), 'sfmigrate export '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.aspen'))
  writeFileSync(join(root, '.aspen', 'config.toml'), `instance = "${url}"\n`)
  const dir = join(root, 'export')
  mkdirSync(join(dir, 'describe'), { recursive: true })
  for (const [name, [describe, csv]] of Object.entries(EXPORT)) {
    writeFileSync(join(dir, 'describe', `${name}.json`), JSON.stringify(describe))
    writeFileSync(join(dir, `${name}.csv`), csv)
  }
  writeFileSync(join(dir, 'User.csv'), 'Id,Email\n005U1,a@x.com\n005U2,b@x.com\n')
  const manifest = { org: 'acme', started: 's1', finished: 'f1', objects: Object.keys(EXPORT).map((object) => ({ object, status: 'ok', records: 3 })) }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  const ws = join(root, 'data', 'migrations', 'acme')
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' })
  const mapping = () => JSON.parse(readFileSync(join(ws, 'mapping.json'), 'utf8'))
  const lines = (f) => readFileSync(join(ws, 'extract', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { root, dir, ws, run, mapping, lines, manifest }
}

test('an export on disk is the whole source: plan reads its describe and CSVs, and asks only about values the data holds', t => {
  const x = fromExport(t)
  const init = x.run('init', x.ws, '--from-export', x.dir)
  assert.equal(init.status, 0, init.stderr)
  assert.match(init.stdout, /Opportunity: 3 records/)
  assert.match(init.stdout, /ask the user which of these objects to migrate/)
  mkdirSync(join(x.ws, 'schema'), { recursive: true })
  writeFileSync(join(x.ws, 'schema', 'target.json'), JSON.stringify(TARGET))
  const plan = x.run('plan', x.ws, '--objects', 'Account,Contact,Opportunity,Task,TaskRelation', '--keep-target')
  assert.equal(plan.status, 0, plan.stderr)
  const fill = JSON.parse(readFileSync(join(x.ws, 'schema', 'fill.json'), 'utf8'))
  assert.equal(fill.source, 'export')
  assert.deepEqual(fill.objects.Account.fields.Industry.values, { Biotechnology: 2, Banking: 1 })
  const m = x.mapping()
  const entry = (source) => m.objects.find((o) => o.source === source)
  // Retail is a Salesforce value no record holds: no question about it.
  const industry = to(entry('Account'), 'industry_p')
  assert.deepEqual(industry.map, { Biotechnology: 'biotech_p' })
  assert.match(industry.todo, /Banking \(1\)/)
  assert.doesNotMatch(industry.todo, /Retail/)
  // Phones and URLs are normalized by the loader; the CRM's own rules come with them.
  const contact = entry('Contact')
  assert.equal(to(contact, 'office_phone_p').normalize, 'phone')
  assert.equal(to(contact, 'office_phone_p').distinctFrom, 'mobile_phone_p')
  assert.equal(to(contact, 'linkedin_profile_p').normalize, 'linkedin')
  assert.equal(from(contact, 'OwnerId').drop, true, "Aspen makes the loader a new contact's owner")
  assert.match(from(contact, 'OwnerId').note, /person loading/)
  // A parent outside the export is blank, not a failure; a relation's own task is not optional.
  assert.deepEqual(to(entry('Account'), 'parent_account_p'), { target: 'parent_account_p', from: 'ParentId', lookup: 'Account', missing: 'null' })
  assert.equal(to(entry('TaskRelation'), 'parent_p').missing, undefined)
  // A combobox is free text with suggestions: it maps onto a text field without a question.
  assert.deepEqual(to(entry('Task'), 'subject_p'), { target: 'subject_p', from: 'Subject' })
  // EUR has a currency_code_p item but no currency_p record on the target.
  assert.match(to(entry('Opportunity'), 'ccode_p').todo, /EUR \(1\).*CurrencyIsoCode IN \('USD'\)/)
})

test('extract converts the export: quoted values, a filtered relation, its parent field, and owners from User.csv', t => {
  const x = fromExport(t)
  assert.equal(x.run('init', x.ws, '--from-export', x.dir).status, 0)
  mkdirSync(join(x.ws, 'schema'), { recursive: true })
  writeFileSync(join(x.ws, 'schema', 'target.json'), JSON.stringify(TARGET))
  assert.equal(x.run('plan', x.ws, '--objects', 'Account,Contact,Task,TaskRelation', '--keep-target').status, 0)
  const m = x.mapping()
  for (const o of m.objects) { delete o.todo; for (const e of o.fields) { if (e.todo && !e.target) e.drop = true; delete e.todo } }
  writeFileSync(join(x.ws, 'mapping.json'), JSON.stringify(m))
  const r = x.run('extract', x.ws)
  assert.equal(r.status, 0, r.stderr)
  const accounts = x.lines('Account.jsonl')
  assert.deepEqual(accounts.map((a) => a.Name), ['Acme,\nInc.', 'Beta "B"', 'Gamma'])
  assert.equal(accounts[2].Website, null, 'a blank cell is null')
  assert.equal(accounts[0].ct_p, '2020-01-01T00:00:00.000Z')
  // IsWhat = false AND Relation.Type = 'Contact': the lead and the IsWhat row are left out.
  const rel = x.lines('TaskRelation.jsonl')
  assert.deepEqual(rel.map((r) => r.id_p), ['0RTA'])
  assert.equal(rel[0]['Task.Subject'], 'Call')
  assert.deepEqual(JSON.parse(readFileSync(join(x.ws, 'extract', 'match', 'team_p.email_p.json'), 'utf8')), { '005U1': 'a@x.com', '005U2': 'b@x.com' })

  // An export regenerated since init is refused: the mapping describes the old one.
  writeFileSync(join(x.dir, 'manifest.json'), JSON.stringify({ ...x.manifest, finished: 'f2' }))
  const stale = x.run('extract', x.ws)
  assert.equal(stale.status, 2)
  assert.match(stale.stderr, /changed since init/)
})

test('draft drafts again an object that had no target, once the target has one', t => {
  const root = mkdtempSync(join(tmpdir(), 'sfmigrate '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.aspen'))
  writeFileSync(join(root, '.aspen', 'config.toml'), `instance = "${URL}"\n`)
  const ws = join(root, 'data', 'migrations', 'acme')
  mkdirSync(join(ws, 'schema'), { recursive: true })
  const stale = { source: 'Product2', target: null, todo: 'no Aspen object matches Product2', fields: [] }
  writeFileSync(join(ws, 'mapping.json'), JSON.stringify({ source: { kind: 'salesforce', org: 'acme' }, target: { url: URL }, objects: [stale] }))
  writeFileSync(join(ws, 'schema', 'source.json'), JSON.stringify(SOURCE))
  writeFileSync(join(ws, 'schema', 'target.json'), JSON.stringify(TARGET))
  const r = spawnSync(process.execPath, [script, 'draft', ws, '--objects', 'Product2'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const m = JSON.parse(readFileSync(join(ws, 'mapping.json'), 'utf8'))
  assert.equal(m.objects.length, 1)
  assert.equal(m.objects[0].target, 'product_p')
})

// ---- matching rules, per-parent picklists, preflight

// A custom team object: a member on an account or a deal, one role list for both parents; and a
// lookup named <Object>Id, with a digit, that only the Id-stripping rule reaches.
const TEAMS = structuredClone(SOURCE)
Object.assign(TEAMS.objects, {
  Deal_Team__c: sfObject('Deal Team', { WhatId: ref('Related To ID', 'Account', 'Opportunity'), Role__c: pick('Role', 'Deal_Team__c.Role__c') }),
  Kit__c: sfObject('Kit', { Name: str('Name'), Product2Id: ref('Product', 'Product2'), Product_Id__c: str('Product ID (text)'), Case_Id__c: ref('Case', 'Case'), Code__c: { ...str('Code'), sf: { ...str('Code').sf, createable: false } } })
})
TEAMS.picklists['Deal_Team__c.Role__c'] = ['Account Manager', 'Sales Rep']
const TEAMED = structuredClone(TARGET)
TEAMED.objects.team_role_p.label = 'Deal Team' // reached by its label, as a custom object would be
TEAMED.objects.kit_c = object('Kit', { name_c: text('Name'), product_c: id('Product', 'product_p'), case_c: id('Case', 'case_p'), code_c: text('Code') })
TEAMED.picklistsByParent = { 'team_role_p.role_p': { picklist: 'team_role_p', dependsOn: 'whaton_p', values: { account_p: ['account_manager_p'], opportunity_p: ['sales_rep_p'] } } }

test('a lookup named <Object>Id reaches <object>, a field the exporting user may not create still maps, and one target takes one field', t => {
  const { entry } = draft(t, `${CORE},Product2,Kit__c`, TEAMS, { target: TEAMED })
  const kit = entry('Kit__c')
  assert.equal(kit.target, 'kit_c')
  assert.deepEqual(to(kit, 'product_c'), { target: 'product_c', from: 'Product2Id', lookup: 'Product2', missing: 'null' })
  assert.equal(to(kit, 'case_c').from, 'Case_Id__c')
  assert.equal(to(kit, 'code_c').from, 'Code__c', 'not createable for the exporting user, but it holds data')
  assert.equal(from(kit, 'Product_Id__c').drop, true)
  assert.match(from(kit, 'Product_Id__c').note, /product_c already takes Product2Id/)
})

test('an object-dependent picklist on a row that can point at two objects gets one map, and one todo, per object', t => {
  const { entry, gaps } = draft(t, `${CORE},Deal_Team__c`, TEAMS, { target: TEAMED })
  const role = to(entry('Deal_Team__c'), 'role_p')
  assert.equal(role.map, undefined)
  assert.deepEqual(role.byParent.account_p.map, { 'Account Manager': 'account_manager_p' })
  assert.match(role.byParent.account_p.todo, /team_role_p allows on account_p: Sales Rep\./)
  assert.deepEqual(role.byParent.opportunity_p.map, { 'Sales Rep': 'sales_rep_p' })
  assert.match(role.byParent.opportunity_p.todo, /allows on opportunity_p: Account Manager\./)
  assert.match(gaps, /`Role__c`[^\n]*allows on account_p/)
  assert.match(gaps, /`Role__c`[^\n]*allows on opportunity_p/)
})

test('preflight takes each object\'s fullest source row as its test values, then hands the write to migrate.mjs', t => {
  const x = fromExport(t, 'http://127.0.0.1:9/acme/dev/')
  assert.equal(x.run('init', x.ws, '--from-export', x.dir).status, 0)
  mkdirSync(join(x.ws, 'schema'), { recursive: true })
  writeFileSync(join(x.ws, 'schema', 'target.json'), JSON.stringify(TARGET))
  assert.equal(x.run('plan', x.ws, '--objects', 'Account,Contact', '--keep-target').status, 0)
  const r = x.run('preflight', x.ws)
  assert.equal(r.status, 2, 'nothing answers at the target, so the sign-in fails after the sample is written')
  const sample = JSON.parse(readFileSync(join(x.ws, 'schema', 'sample.json'), 'utf8'))
  assert.equal(sample.Account.id_p, '001B', 'the account with the most mapped fields filled')
  assert.equal(sample.Contact.LastName, 'Lee')
})

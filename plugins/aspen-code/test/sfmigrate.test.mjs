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
  sf: { type, length: null, precision: null, scale: null, calculated: false, formula: null, createable: true, externalId: false, referenceTo: o.to ?? [], relationshipName: null }
})
const ref = (label, ...to) => sfField(label, 'reference', { to, aspen: 'id' })
const str = (label) => sfField(label, 'string')
const pick = (label, list, multi = false) => sfField(label, multi ? 'multipicklist' : 'picklist', { aspen: 'picklist', picklist: list })
const sfObject = (label, fields) => ({ label, custom: false, fields })

const SOURCE = {
  objects: {
    Account: sfObject('Account', { Name: str('Account Name'), BillingCity: str('Billing City'), OwnerId: ref('Owner ID', 'User') }),
    Contact: sfObject('Contact', { LastName: str('Last Name'), Email: sfField('Email', 'email'), Phone: sfField('Business Phone', 'phone'), AccountId: ref('Account ID', 'Account') }),
    Opportunity: sfObject('Opportunity', { Name: str('Name'), AccountId: ref('Account ID', 'Account'), OwnerId: ref('Owner ID', 'User') }),
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
    'AccountTeamMember.TeamMemberRole': ['Account Manager'],
    'OpportunityTeamMember.TeamMemberRole': ['Sales Rep']
  }
}

// ---- the Aspen side, as `migrate describe --side target` normalizes it: allowed-objects,
// related-object-field and included-polyids as the 26.4.1 platform metadata declares them

const field = (label, type, subtype, o = {}) => ({
  label, description: o.description ?? null, type, subtype, required: !!o.required, unique: !!o.unique, readOnly: false,
  lookup: o.lookup ?? null, objects: o.objects ?? null, relatedObjectField: o.on ?? null, picklist: o.picklist ?? null
})
const text = (label, o) => field(label, 'text', 'text', o)
const id = (label, to, o = {}) => field(label, 'id', 'lookup', { ...o, lookup: to })
const poly = (label, on, o = {}) => field(label, 'polyid', 'parent', { ...o, on })
const objectRef = (label, o) => field(label, 'picklist', 'object_ref', o)
const object = (label, fields, o = {}) => ({ label, description: o.description ?? null, includedPolyids: o.included ?? [], fields })
const WHATS = (...objects) => objects.map((object) => ({ object, field: 'what_p' }))

const TARGET = {
  objects: {
    user_p: object('User', { email_p: text('Email', { unique: true }) }),
    team_p: object('Team', { email_p: text('Email', { unique: true }), user_p: id('User', 'user_p', { unique: true }) }, { description: 'An employee, contractor, or partner of the company.' }),
    account_p: object('Account', { name_p: text('Name', { required: true }), owner_p: id('Owner', 'team_p') },
      { included: WHATS('task_p', 'meeting_p', 'contact_role_p', 'team_role_p') }),
    account_address_p: object('Account Address', { account_p: id('Account', 'account_p'), city_p: text('City') }, { description: 'Physical location or postal address associated with an account.' }),
    contact_p: object('Contact', { last_name_p: text('Last Name'), work_email_p: text('Work Email', { description: 'Primary and active work email address.' }), office_phone_p: text('Office Phone'), primary_account_p: id('Primary Account', 'account_p') }),
    contact_channel_p: object('Contact Channels', { contact_p: id('Contact', 'contact_p'), name_p: text('Name') }),
    opportunity_p: object('Opportunity', {
      name_p: text('Name', { required: true }),
      customer_p: poly('Customer', 'customeron_p', { objects: ['account_p', 'contact_p'] }), customeron_p: objectRef('Customer (Object)'),
      owner_p: poly('Owner', 'owneron_p', { objects: ['user_p'] }), owneron_p: objectRef('Owner (Object)')
    }, { included: WHATS('task_p', 'meeting_p', 'contact_role_p', 'team_role_p') }),
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
      role_p: field('Role', 'picklist', 'picklist', { picklist: 'team_role_p.role_p' }),
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
  picklists: { 'contact_role_p.role_p': ['decision_maker_p', 'champion_p'], 'team_role_p.role_p': ['account_manager_p'] }
}

function draft (t, objects) {
  const root = mkdtempSync(join(tmpdir(), 'sfmigrate '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.aspen'))
  writeFileSync(join(root, '.aspen', 'config.toml'), `instance = "${URL}"\n`)
  const ws = join(root, 'data', 'migrations', 'acme')
  mkdirSync(join(ws, 'schema'), { recursive: true })
  writeFileSync(join(ws, 'mapping.json'), JSON.stringify({ source: { kind: 'salesforce', org: 'acme' }, target: { url: URL }, objects: [] }))
  writeFileSync(join(ws, 'schema', 'source.json'), JSON.stringify(SOURCE))
  writeFileSync(join(ws, 'schema', 'target.json'), JSON.stringify(TARGET))
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
  // Roles is proposed for role_p; a multi-select is a decision, a single picklist a value map.
  assert.match(to(entry('AccountContactRelation'), 'role_p').todo, /multi/i)
  assert.match(to(entry('OpportunityContactRole'), 'role_p').todo, /Decision Maker/)
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
    assert.match(to(o, 'role_p').todo, /Account Manager|Sales Rep/, source)
  }
})

test("an opportunity's account is its customer, and its owner a user, each with the object beside it", t => {
  const { entry } = draft(t, CORE)
  const opp = entry('Opportunity')
  assert.deepEqual(to(opp, 'customer_p'), { target: 'customer_p', from: 'AccountId', lookup: 'Account' })
  assert.deepEqual(to(opp, 'customeron_p'), { target: 'customeron_p', objectOf: 'customer_p' })
  assert.deepEqual(to(opp, 'owner_p'), { target: 'owner_p', from: 'OwnerId', lookup: USER_MATCH, sfMatch: BY_EMAIL, missing: 'null' })
  assert.deepEqual(to(opp, 'owneron_p'), { target: 'owneron_p', objectOf: 'owner_p' })
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

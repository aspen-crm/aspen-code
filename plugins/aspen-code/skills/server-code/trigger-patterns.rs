//! Trigger patterns for the aspen-crm release `aspen init` pins and the 26.4.1 platform objects.
//!
//! This file is a complete `src/lib.rs`. It builds as-is (`cargo build --release --locked`)
//! against the crate `aspen init` scaffolds, given `jiff = "0.2"` in `Cargo.toml` and the
//! registration below as `aspen.server.json`. Every entry there needs its `impl` here, so drop the
//! entries you do not copy. Copy the `helpers` block once, then the ONE handler closest to what you
//! need. The handlers follow the SDK source and the platform object metadata. None has been
//! deployed in this form, so prove yours with a record round-trip.
//!
//! Registration these handlers expect in `aspen.server.json`. Event strings are exactly these
//! six: before_insert, after_insert, before_update, after_update, before_delete, after_delete.
//! `entrypoints!` rejects any other string at compile time. `object` is not checked: a typo, or a
//! `_p` object that triggers are not enabled on, compiles, deploys and never fires.
//!
//! ```json
//! {
//!   "record-triggers": [
//!     { "name": "case_owner_default_c",  "object": "case_p",            "events": ["before_insert"] },
//!     { "name": "target_team_default_c", "object": "campaign_target_c", "events": ["before_insert"] },
//!     { "name": "opp_won_brief_c",       "object": "opportunity_p",     "events": ["before_update", "after_update"] },
//!     { "name": "opp_motion_sync_c",     "object": "opportunity_p",     "events": ["after_insert", "after_update"] },
//!     { "name": "org_health_c",          "object": "org_c",             "events": ["before_insert", "before_update"] },
//!     { "name": "champion_exit_c",       "object": "contact_role_p",    "events": ["before_delete"] },
//!     { "name": "opp_close_rules_c",     "object": "opportunity_p",     "events": ["before_insert", "before_update"] },
//!     { "name": "case_escalation_c",     "object": "case_p",
//!       "events": ["before_insert", "before_update", "after_insert", "after_update"] }
//!   ]
//! }
//! ```
//!
//! The rules every handler follows:
//! - Never write to the records the trigger is running on. The platform refuses that nested
//!   write, and the user's whole save fails. A value on the record itself is set in
//!   `before_insert`/`before_update` with `record.set`, so it lands in the same write.
//! - Collect work across the whole batch, then issue at most one insert and one update per
//!   object type. A batch of N records is one round trip, not N.

use std::collections::{HashMap, HashSet};

use aspen_crm::error;
use aspen_crm::record::trigger::{
    AfterInsertContext, AfterUpdateContext, BeforeDeleteContext, BeforeInsertContext,
    BeforeUpdateContext, ImmutableBatch, ImmutableObjectRecord, MutableBatch, MutableObjectRecord,
};
use aspen_crm::record::{FieldError, FieldState, RecordError, RecordFieldValue, ValidFieldValue};
use aspen_crm::services::query::SelectQueryRow;
use aspen_crm::services::record::{BatchProcessed, InsertRequest, RecordInput, UpdateRequest};
use aspen_crm::services::PlatformServices;
use aspen_crm::types::{Decimal, Uuid};
use jiff::{Span, Timestamp};

aspen_crm::entrypoints!(Entrypoints);

struct Entrypoints;

// ── helpers ──────────────────────────────────────────────────────────────────
// Copy this whole block. Each function exists because the raw match is long and the
// variant that comes back is not the one you would guess.

/// Today plus `days`, as the calendar `Date` a `date` field wants. `Timestamp + Span::days`
/// compiles and then fails at runtime ("units of hours or smaller"), so convert first.
fn today_plus_days(days: i64) -> jiff::civil::Date {
    Timestamp::now()
        .in_tz("UTC")
        .map(|z| z.date().saturating_add(Span::new().days(days)))
        .unwrap_or_else(|_| jiff::civil::Date::new(2000, 1, 1).unwrap())
}

/// An id-shaped batch field (`record.get(..)?`, before-* or after-*). Match all the
/// id-shaped variants together; which one comes back follows the field's metadata.
fn id_of(state: FieldState) -> Option<Uuid> {
    match state {
        FieldState::Value(
            RecordFieldValue::Id(id)
            | RecordFieldValue::IdParent(id)
            | RecordFieldValue::IdLookup(id)
            | RecordFieldValue::PolyidParent(id)
            | RecordFieldValue::PolyidLookup(id),
        ) => Some(id),
        _ => None,
    }
}

fn picklist_of(state: FieldState) -> Option<String> {
    match state {
        FieldState::Value(RecordFieldValue::Picklist(s)) => Some(s),
        _ => None,
    }
}

/// A `number` or `number/percentage` batch field. Both are `Decimal`.
fn decimal_of(state: FieldState) -> Option<Decimal> {
    match state {
        FieldState::Value(RecordFieldValue::Number(d) | RecordFieldValue::NumberPercentage(d)) => {
            Some(d)
        }
        _ => None,
    }
}

/// A `currency`/`currency` batch field (the entered amount, e.g. `amount_p`).
fn currency_of(state: FieldState) -> Option<Decimal> {
    match state {
        FieldState::Value(RecordFieldValue::Currency(d)) => Some(d),
        _ => None,
    }
}

/// An id-shaped cell out of a query row. Query cells are `Option<ValidFieldValue>`, a
/// different shape from batch fields; a polyid read back is `PolyidParent`/`PolyidLookup`.
fn cell_id(row: &SelectQueryRow, index: usize) -> Option<Uuid> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(
            RecordFieldValue::Id(id)
            | RecordFieldValue::IdParent(id)
            | RecordFieldValue::IdLookup(id)
            | RecordFieldValue::PolyidParent(id)
            | RecordFieldValue::PolyidLookup(id),
        ))) => Some(*id),
        _ => None,
    }
}

fn cell_text(row: &SelectQueryRow, index: usize) -> Option<String> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(RecordFieldValue::Text(s)))) => Some(s.clone()),
        _ => None,
    }
}

fn cell_picklist(row: &SelectQueryRow, index: usize) -> Option<String> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(
            RecordFieldValue::Picklist(s) | RecordFieldValue::PicklistObjectRef(s),
        ))) => Some(s.clone()),
        _ => None,
    }
}

fn cell_decimal(row: &SelectQueryRow, index: usize) -> Option<Decimal> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(
            RecordFieldValue::Number(d) | RecordFieldValue::NumberPercentage(d),
        ))) => Some(*d),
        _ => None,
    }
}

fn cell_currency(row: &SelectQueryRow, index: usize) -> Option<Decimal> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(RecordFieldValue::Currency(d)))) => Some(*d),
        _ => None,
    }
}

/// `'id1','id2',…` for an `IN (…)`. Built from `Uuid`s only, never from request text.
fn id_list(ids: &[Uuid]) -> String {
    ids.iter().map(|id| format!("'{id}'")).collect::<Vec<_>>().join(",")
}

/// Turn row-level rejections into a hard error. `execute_insert`/`execute_update` return
/// `Ok` even when every row failed validation; the failures are inside. A bare `?` hides
/// exactly the error you are looking for (wrong variant, missing discriminator).
fn check_failures(result: &BatchProcessed, ctx: &str) -> error::Result<()> {
    if !result.failures().is_empty() {
        let msgs: Vec<String> = result
            .failures()
            .iter()
            .flat_map(|f| {
                f.field_errors()
                    .iter()
                    .map(|e| format!("{}: {}", e.field_name(), e.message()))
                    .chain(f.record_errors().iter().map(|e| e.message().to_string()))
            })
            .collect();
        error::bail!("{ctx}: {}", msgs.join("; "));
    }
    Ok(())
}

/// A task record pointed at `what`. `task_p.owner_p` and `what_p` are polyid/parent
/// fields, so each takes its `*on_p` discriminator too -- always, even when the polyid
/// only ever points at one object.
fn task(
    subject: String,
    owner: Option<Uuid>,
    what: Uuid,
    what_on: &str,
    due_in_days: i64,
    description: String,
) -> error::Result<RecordInput> {
    let mut b = RecordInput::builder()
        .field("subject_p", RecordFieldValue::Text(subject))
        .field("status_p", RecordFieldValue::Picklist("open_p".into()))
        .field("priority_p", RecordFieldValue::Picklist("high_p".into()))
        .field("what_p", RecordFieldValue::PolyidParent(what))
        .field("whaton_p", RecordFieldValue::PicklistObjectRef(what_on.into()))
        .field("due_date_p", RecordFieldValue::Date(today_plus_days(due_in_days)))
        .field("when_p", RecordFieldValue::Datetime(Timestamp::now()))
        .field("description_p", RecordFieldValue::TextLong(description));
    if let Some(oid) = owner {
        b = b
            .field("owner_p", RecordFieldValue::PolyidParent(oid))
            .field("owneron_p", RecordFieldValue::PicklistObjectRef("user_p".into()));
    }
    b.build()
}

// ── 1. before_insert: set a field on the record itself ───────────────────────
// The value lands in the same write, so there is no second update and nothing that can
// re-fire a trigger. Here: default the owner to the acting user when the caller left it
// blank.
//
// Owner fields come in three shapes and the variant must match the field's OWN metadata:
//   account_p, contact_p                     owner_p is id/lookup to team_p -> IdLookup of a TEAM id
//   case_p, lead_p, opportunity_p            owner_p is polyid/lookup       -> PolyidLookup + owneron_p
//   task_p, email_p, meeting_p, activity_p   owner_p is polyid/parent       -> PolyidParent + owneron_p
// Check `type`/`subtype` (and the lookup's target) in the object's compiled JSON; the wrong
// shape is rejected at insert, not at compile.

impl case_owner_default_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        let user = context.services().runtime_context().current_user_id();
        for record in context.batch().iter() {
            // Respect an owner the caller set explicitly.
            if matches!(record.get("owner_p")?, FieldState::Value(_)) {
                continue;
            }
            record.set("owner_p", FieldState::Value(RecordFieldValue::PolyidLookup(user)));
            record.set(
                "owneron_p",
                FieldState::Value(RecordFieldValue::PicklistObjectRef("user_p".into())),
            );
        }
        Ok(())
    }
}

// ── 2. before_insert: set a field from a batched lookup ──────────────────────
// Default a child's team to its parent account's owning team (account_p.owner_p is an
// id/lookup to team_p, not a user). One query per chunk of parents, not one per row.

impl target_team_default_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        let mut wanted: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if matches!(record.get("team_c")?, FieldState::Value(_)) {
                continue;
            }
            if let Some(account) = id_of(record.get("account_c")?)
                && !wanted.contains(&account)
            {
                wanted.push(account);
            }
        }
        if wanted.is_empty() {
            return Ok(());
        }

        let mut teams: HashMap<Uuid, Uuid> = HashMap::new();
        for chunk in wanted.chunks(100) {
            let aql = format!(
                "SELECT id_p, owner_p FROM account_p WHERE id_p IN ({}) LIMIT 100",
                id_list(chunk)
            );
            let query = context.services().query().query(aql).build()?;
            let rows = context.services().query().execute(query)?;
            for row in rows.iter_rows() {
                if let (Some(account), Some(team)) = (cell_id(row, 0), cell_id(row, 1)) {
                    teams.insert(account, team);
                }
            }
        }

        for record in context.batch().iter() {
            if matches!(record.get("team_c")?, FieldState::Value(_)) {
                continue;
            }
            let Some(account) = id_of(record.get("account_c")?) else { continue };
            if let Some(team) = teams.get(&account) {
                // team_c on this object is id/lookup to team_p, hence IdLookup and no *on field.
                record.set("team_c", FieldState::Value(RecordFieldValue::IdLookup(*team)));
            }
        }
        Ok(())
    }
}

// ── 3. before_update + after_update: a transition stamps the record, then creates a task ──
// When status_p becomes closed_won_p and no brief exists yet: stamp brief_status_c and
// create a task. brief_status_c is on the triggering record, so before_update sets it with
// record.set; after_update only writes OTHER records (the task). The batch holds the fields
// the caller sent, possibly unchanged, so the before half reads the stored row to see whether
// this save is the transition, and the after half skips opportunities that already have the
// task (the write-only-on-change guard for a write to other records). Pattern 8 is the general
// shape of this split: insert too, and a stamp the after half reads back from its own batch.

impl opp_won_brief_c for Entrypoints {
    fn before_update(context: &BeforeUpdateContext) -> error::Result<()> {
        let mut won: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if picklist_of(record.get("status_p")?).as_deref() != Some("closed_won_p") {
                continue;
            }
            // id_p is always in an update batch.
            if let Some(id) = id_of(record.get("id_p")?) {
                won.push(id);
            }
        }
        if won.is_empty() {
            return Ok(());
        }

        // The stored row is still the pre-update one here.
        let mut transitions: HashSet<Uuid> = HashSet::new();
        for chunk in won.chunks(100) {
            let q = context.services().query()
                .query(format!("SELECT id_p, status_p, brief_status_c FROM opportunity_p WHERE id_p IN ({}) LIMIT 100", id_list(chunk)))
                .build()?;
            let rows = context.services().query().execute(q)?;
            for row in rows.iter_rows() {
                let already_won = cell_picklist(row, 1).as_deref() == Some("closed_won_p");
                let brief_started = matches!(row.get(2), Some(Some(_)));
                if let Some(id) = cell_id(row, 0)
                    && !already_won
                    && !brief_started
                {
                    transitions.insert(id);
                }
            }
        }

        for record in context.batch().iter() {
            if id_of(record.get("id_p")?).is_some_and(|id| transitions.contains(&id)) {
                record.set(
                    "brief_status_c",
                    FieldState::Value(RecordFieldValue::Picklist("pending_c".into())),
                );
            }
        }
        Ok(())
    }

    fn after_update(context: &AfterUpdateContext) -> error::Result<()> {
        let mut won: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if picklist_of(record.get("status_p")?).as_deref() != Some("closed_won_p") {
                continue;
            }
            if let Some(id) = id_of(record.get("id_p")?) {
                won.push(id);
            }
        }

        let mut tasks: Vec<RecordInput> = Vec::new();
        for chunk in won.chunks(100) {
            // Queries run in the save's transaction, so this sees the brief_status_c just written.
            let q = context.services().query()
                .query(format!("SELECT id_p, name_p, owner_p, brief_status_c FROM opportunity_p WHERE id_p IN ({}) LIMIT 100", id_list(chunk)))
                .build()?;
            let rows = context.services().query().execute(q)?;
            let pending: Vec<(Uuid, String, Option<Uuid>)> = rows
                .iter_rows()
                .filter(|row| cell_picklist(row, 3).as_deref() == Some("pending_c"))
                .filter_map(|row| {
                    let name = cell_text(row, 1).unwrap_or_else(|| "opportunity".into());
                    cell_id(row, 0).map(|id| (id, name, cell_id(row, 2)))
                })
                .collect();
            if pending.is_empty() {
                continue;
            }

            // Guard: one brief task per opportunity, however often the save repeats.
            let ids: Vec<Uuid> = pending.iter().map(|(id, _, _)| *id).collect();
            let q = context.services().query()
                .query(format!("SELECT what_p FROM task_p WHERE what_p IN ({}) AND subject_p LIKE 'Complete deal brief%' LIMIT 1000", id_list(&ids)))
                .build()?;
            let rows = context.services().query().execute(q)?;
            let has_task: HashSet<Uuid> = rows.iter_rows().filter_map(|row| cell_id(row, 0)).collect();

            for (opp_id, opp_name, owner) in pending {
                if has_task.contains(&opp_id) {
                    continue;
                }
                tasks.push(task(
                    format!("Complete deal brief — {opp_name}"),
                    owner,
                    opp_id,
                    "opportunity_p",
                    3,
                    "Deal closed won. Record why the customer bought and what was committed.".into(),
                )?);
            }
        }

        if !tasks.is_empty() {
            let req = InsertRequest::builder("task_p").records(tasks).build()?;
            let result = context.services().record().execute_insert(req)?;
            check_failures(&result, "opp_won_brief_c/task")?;
        }
        Ok(())
    }
}

// ── 4. after_insert + after_update sharing one body, with a query fallback ───
// When an opportunity names an org and is not closed-lost, flip that org's motion_c.
// Two things worth copying: one function serves both events, and a field the caller did
// not send is absent from the batch, so the handler queries for what it needs instead of
// assuming. Deduped with a set so each org is updated once per batch. org_c is another
// object, so this write is allowed from here.

impl opp_motion_sync_c for Entrypoints {
    fn after_insert(context: &AfterInsertContext) -> error::Result<()> {
        motion_sync(context.batch().iter(), context.services())
    }
    fn after_update(context: &AfterUpdateContext) -> error::Result<()> {
        motion_sync(context.batch().iter(), context.services())
    }
}

fn motion_sync(
    records: impl Iterator<Item = ImmutableObjectRecord>,
    services: &PlatformServices<'_>,
) -> error::Result<()> {
    let mut org_ids: HashSet<Uuid> = HashSet::new();

    for record in records {
        let mut status = picklist_of(record.get("status_p")?);
        let mut org = id_of(record.get("org_c")?);
        if status.is_none() || org.is_none() {
            if let Some(opp_id) = id_of(record.get("id_p")?) {
                let q = services.query()
                    .query(format!("SELECT status_p, org_c FROM opportunity_p WHERE id_p = '{opp_id}' LIMIT 1"))
                    .build()?;
                let rows = services.query().execute(q)?;
                if let Some(row) = rows.iter_rows().next() {
                    status = status.or_else(|| cell_picklist(row, 0));
                    org = org.or_else(|| cell_id(row, 1));
                }
            }
        }
        if status.as_deref() == Some("closed_lost_p") {
            continue;
        }
        if let Some(org_id) = org {
            org_ids.insert(org_id);
        }
    }
    if org_ids.is_empty() {
        return Ok(());
    }

    let updates: Vec<(Uuid, RecordInput)> = org_ids
        .into_iter()
        .map(|id| {
            let fields = RecordInput::builder()
                .field("motion_c", RecordFieldValue::Picklist("sales_assisted_c".into()))
                .build()
                .expect("static build");
            (id, fields)
        })
        .collect();
    let req = UpdateRequest::builder("org_c").records(updates).build()?;
    let result = services.record().execute_update(req)?;
    check_failures(&result, "opp_motion_sync_c")?;
    Ok(())
}

// ── 5. before_insert + before_update: derive a value on the record itself ────
// Recompute health_c from the org's own numbers. The value is on the triggering record, so
// it is set with record.set in the before-trigger and lands in the same write: no second
// update, nothing to re-fire. On update, an input the caller did not send is read from the
// stored row; a save that sends none of the inputs (e.g. pattern 4's motion_c, pattern 6's
// health_c) is left alone. Also shows Decimal comparisons: `Decimal::new(35, 2)` is 0.35.

/// seats_licensed_c, seats_active_30d_c, token_commit_annual_c, token_consumed_ttm_c
const HEALTH_INPUTS: [&str; 4] = [
    "seats_licensed_c",
    "seats_active_30d_c",
    "token_commit_annual_c",
    "token_consumed_ttm_c",
];

fn compute_health(adoption: Option<Decimal>, burn: Option<Decimal>) -> (&'static str, String) {
    let pct = |d: Decimal| (d * Decimal::new(100, 0)).round();
    if let Some(a) = adoption && a < Decimal::new(35, 2) {
        return ("red_c", format!("Adoption {}% of licensed seats", pct(a)));
    }
    if let Some(b) = burn && b < Decimal::new(25, 2) {
        return ("red_c", format!("Token burn {}% of commitment", pct(b)));
    }
    if let Some(a) = adoption && a < Decimal::new(60, 2) {
        return ("yellow_c", format!("Adoption {}% of licensed seats", pct(a)));
    }
    ("green_c", "Healthy adoption and consumption".to_string())
}

/// Whether the caller sent any of the inputs (a sent null counts).
fn sends_health_input(record: &MutableObjectRecord) -> error::Result<bool> {
    for field in HEALTH_INPUTS {
        if !matches!(record.get(field)?, FieldState::Absent) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Set health_c/health_reason_c from the sent inputs, falling back to `stored` for any not sent.
fn apply_health(record: &MutableObjectRecord, stored: [Option<Decimal>; 4]) -> error::Result<()> {
    let mut v = stored;
    for (i, field) in HEALTH_INPUTS.iter().enumerate() {
        match record.get(field)? {
            FieldState::Absent => {}
            sent => v[i] = decimal_of(sent),
        }
    }
    let zero = Decimal::new(0, 0);
    let ratio = |part: Option<Decimal>, whole: Option<Decimal>| match (part, whole) {
        (Some(p), Some(w)) if w > zero => Some(p / w),
        _ => None,
    };
    let adoption = ratio(v[1], v[0]);
    let burn = ratio(v[3], v[2]);
    if adoption.is_none() && burn.is_none() {
        return Ok(());
    }
    let (health, reason) = compute_health(adoption, burn);
    record.set("health_c", FieldState::Value(RecordFieldValue::Picklist(health.into())));
    record.set("health_reason_c", FieldState::Value(RecordFieldValue::Text(reason)));
    Ok(())
}

impl org_health_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        for record in context.batch().iter() {
            apply_health(&record, [None; 4])?;
        }
        Ok(())
    }

    fn before_update(context: &BeforeUpdateContext) -> error::Result<()> {
        let mut ids: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if sends_health_input(&record)?
                && let Some(id) = id_of(record.get("id_p")?)
            {
                ids.push(id);
            }
        }
        if ids.is_empty() {
            return Ok(());
        }

        let mut stored: HashMap<Uuid, [Option<Decimal>; 4]> = HashMap::new();
        for chunk in ids.chunks(100) {
            let q = context.services().query()
                .query(format!(
                    "SELECT id_p, {} FROM org_c WHERE id_p IN ({}) LIMIT 100",
                    HEALTH_INPUTS.join(", "),
                    id_list(chunk)
                ))
                .build()?;
            let rows = context.services().query().execute(q)?;
            for row in rows.iter_rows() {
                if let Some(id) = cell_id(row, 0) {
                    stored.insert(id, [1, 2, 3, 4].map(|i| cell_decimal(row, i)));
                }
            }
        }

        for record in context.batch().iter() {
            if !sends_health_input(&record)? {
                continue;
            }
            let Some(id) = id_of(record.get("id_p")?) else { continue };
            apply_health(&record, stored.get(&id).copied().unwrap_or([None; 4]))?;
        }
        Ok(())
    }
}

// ── 6. before_delete: the row still exists to query ──────────────────────────
// Before a contact-role row is deleted, if it was a champion on an account, flag every
// org on that account. before_delete because the row and its fields are still there to
// query; after_delete yields only `id()` and nothing else about the record. Note the
// delete-side record type has `id()` and no `get()`. org_c is another object, so writing
// it from here is allowed.

impl champion_exit_c for Entrypoints {
    fn before_delete(context: &BeforeDeleteContext) -> error::Result<()> {
        let mut account_ids: HashSet<Uuid> = HashSet::new();

        for record in context.batch().iter() {
            let role_id = record.id();
            let q = context.services().query()
                .query(format!("SELECT role_p, whaton_p, what_p FROM contact_role_p WHERE id_p = '{role_id}' LIMIT 1"))
                .build()?;
            let rows = context.services().query().execute(q)?;
            let Some(row) = rows.iter_rows().next() else { continue };
            if cell_picklist(row, 0).as_deref() != Some("champion_p") {
                continue;
            }
            if cell_picklist(row, 1).as_deref() != Some("account_p") {
                continue;
            }
            if let Some(account_id) = cell_id(row, 2) {
                account_ids.insert(account_id);
            }
        }
        if account_ids.is_empty() {
            return Ok(());
        }

        let mut org_updates: Vec<(Uuid, RecordInput)> = Vec::new();
        for account_id in account_ids {
            let q = context.services().query()
                .query(format!("SELECT id_p FROM org_c WHERE account_c = '{account_id}' LIMIT 1000"))
                .build()?;
            let rows = context.services().query().execute(q)?;
            for row in rows.iter_rows() {
                let Some(org_id) = cell_id(row, 0) else { continue };
                org_updates.push((
                    org_id,
                    RecordInput::builder()
                        .field("health_c", RecordFieldValue::Picklist("red_c".into()))
                        .field("health_reason_c", RecordFieldValue::Text("Champion left".into()))
                        .build()?,
                ));
            }
        }
        if !org_updates.is_empty() {
            let req = UpdateRequest::builder("org_c").records(org_updates).build()?;
            let result = context.services().record().execute_update(req)?;
            check_failures(&result, "champion_exit_c")?;
        }
        Ok(())
    }
}

// ── 7. before_insert + before_update: reject the bad rows, commit the rest ────
// Two rules on closing an opportunity. One rejects with a field error, the other with a record
// error, and each rejects only its own row: returning Ok commits every row with no error, where
// an Err would roll back the whole batch, good rows included. error-handling.md has what each
// produces in the form and in the API response; the developer picks (SKILL.md step 1).
//
// before_insert and before_update both hand over a `&MutableBatch`, so one function serves both.
// The batch and record types (`MutableBatch`, `MutableObjectRecord`, `ImmutableBatch`,
// `ImmutableObjectRecord`) are structs, not traits: take them by reference, never as `R: …`.
// An update that sends only status_p or only amount_p is judged against the stored row.

/// The stored status and amount of an opportunity being updated.
#[derive(Default)]
struct StoredClose {
    status: Option<String>,
    amount: Option<Decimal>,
}

impl opp_close_rules_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        check_close_rules(context.batch(), &HashMap::new())
    }

    fn before_update(context: &BeforeUpdateContext) -> error::Result<()> {
        let mut ids: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if sends_close_input(&record)?
                && let Some(id) = id_of(record.get("id_p")?)
            {
                ids.push(id);
            }
        }

        let mut stored: HashMap<Uuid, StoredClose> = HashMap::new();
        for chunk in ids.chunks(100) {
            let q = context.services().query()
                .query(format!("SELECT id_p, status_p, amount_p FROM opportunity_p WHERE id_p IN ({}) LIMIT 100", id_list(chunk)))
                .build()?;
            let rows = context.services().query().execute(q)?;
            for row in rows.iter_rows() {
                if let Some(id) = cell_id(row, 0) {
                    let close = StoredClose { status: cell_picklist(row, 1), amount: cell_currency(row, 2) };
                    stored.insert(id, close);
                }
            }
        }
        check_close_rules(context.batch(), &stored)
    }
}

fn sends_close_input(record: &MutableObjectRecord) -> error::Result<bool> {
    Ok(!matches!(record.get("status_p")?, FieldState::Absent)
        || !matches!(record.get("amount_p")?, FieldState::Absent))
}

fn check_close_rules(
    batch: &MutableBatch<'_>,
    stored: &HashMap<Uuid, StoredClose>,
) -> error::Result<()> {
    let nothing_stored = StoredClose::default();
    for record in batch.iter() {
        if !sends_close_input(&record)? {
            continue;
        }
        // A before_insert record has no id_p yet, so it has nothing stored.
        let before = id_of(record.get("id_p")?)
            .and_then(|id| stored.get(&id))
            .unwrap_or(&nothing_stored);
        let status = match record.get("status_p")? {
            FieldState::Absent => before.status.clone(),
            sent => picklist_of(sent),
        };
        let amount = match record.get("amount_p")? {
            FieldState::Absent => before.amount,
            sent => currency_of(sent),
        };

        let was_closed = before.status.as_deref().is_some_and(|s| s != "open_p");
        if was_closed && status.as_deref() == Some("open_p") {
            // No one field is at fault: a record error, in the form's banner.
            record.add_record_error(RecordError::new(
                "reopen_closed",
                "Closed opportunities can't be reopened. Create a new opportunity instead.",
            ));
            continue;
        }
        if status.as_deref() == Some("closed_won_p") && amount.is_none() {
            // The field the user has to fix: a field error, under amount_p.
            record.add_field_error(FieldError::new(
                "amount_p",
                "amount_required",
                "Enter the amount before closing this opportunity as won.",
            ));
        }
    }
    Ok(())
}

// ── 8. All four events: validate and stamp before the write, act after it ────
// When a save makes a case critical: reject it if the case has no account; otherwise stamp
// escalated_at_c (a custom datetime on case_p) and, once the save commits, give the case owner
// a task. The shape fits any "validate, then create something" rule.
//
// Why both halves. Only a before-trigger can reject a row or set a field on it. The task waits
// for the after-trigger: its batch holds only the rows that passed every check before the write
// (yours and the platform's), and on insert it is the first place the case has an id_p for the
// task to point at.
//
// The stamp is the handshake. The after batch is the batch as the before-trigger left it, so a
// field set there with record.set reads back with record.get. A stamp in the after batch means
// "this save escalated the case" because the before half drops one the caller sent
// (`FieldState::Absent` takes the field out of the batch; an update then leaves the stored value
// alone) and stamps only a case whose stored stamp is empty, which also makes it one task per
// case.

const ESCALATED_AT: &str = "escalated_at_c";

/// What is stored on a case being updated.
#[derive(Default)]
struct StoredCase {
    account: Option<Uuid>,
    escalated: bool,
}

impl case_escalation_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        escalate_before(context.batch(), &HashMap::new())
    }

    fn before_update(context: &BeforeUpdateContext) -> error::Result<()> {
        let mut ids: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if !matches!(record.get("priority_p")?, FieldState::Absent)
                && let Some(id) = id_of(record.get("id_p")?)
            {
                ids.push(id);
            }
        }

        let mut stored: HashMap<Uuid, StoredCase> = HashMap::new();
        for chunk in ids.chunks(100) {
            let q = context.services().query()
                .query(format!("SELECT id_p, account_p, {ESCALATED_AT} FROM case_p WHERE id_p IN ({}) LIMIT 100", id_list(chunk)))
                .build()?;
            let rows = context.services().query().execute(q)?;
            for row in rows.iter_rows() {
                if let Some(id) = cell_id(row, 0) {
                    let escalated = matches!(row.get(2), Some(Some(_)));
                    stored.insert(id, StoredCase { account: cell_id(row, 1), escalated });
                }
            }
        }
        escalate_before(context.batch(), &stored)
    }

    fn after_insert(context: &AfterInsertContext) -> error::Result<()> {
        escalate_after(context.batch(), context.services())
    }

    fn after_update(context: &AfterUpdateContext) -> error::Result<()> {
        escalate_after(context.batch(), context.services())
    }
}

fn escalate_before(
    batch: &MutableBatch<'_>,
    stored: &HashMap<Uuid, StoredCase>,
) -> error::Result<()> {
    let nothing_stored = StoredCase::default();
    for record in batch.iter() {
        // Only this half sets the stamp.
        if !matches!(record.get(ESCALATED_AT)?, FieldState::Absent) {
            record.set(ESCALATED_AT, FieldState::Absent);
        }
        if picklist_of(record.get("priority_p")?).as_deref() != Some("critical_p") {
            continue;
        }
        let before = id_of(record.get("id_p")?)
            .and_then(|id| stored.get(&id))
            .unwrap_or(&nothing_stored);
        if before.escalated {
            continue;
        }
        let account = match record.get("account_p")? {
            FieldState::Absent => before.account,
            sent => id_of(sent),
        };
        if account.is_none() {
            record.add_field_error(FieldError::new(
                "account_p",
                "escalation_needs_account",
                "A critical case needs an account so it can be escalated.",
            ));
            continue;
        }
        record.set(ESCALATED_AT, FieldState::Value(RecordFieldValue::Datetime(Timestamp::now())));
    }
    Ok(())
}

fn escalate_after(batch: &ImmutableBatch<'_>, services: &PlatformServices<'_>) -> error::Result<()> {
    let mut escalated: Vec<Uuid> = Vec::new();
    for record in batch.iter() {
        if matches!(record.get(ESCALATED_AT)?, FieldState::Value(_))
            && let Some(id) = id_of(record.get("id_p")?)
        {
            escalated.push(id);
        }
    }

    let mut tasks: Vec<RecordInput> = Vec::new();
    for chunk in escalated.chunks(100) {
        // The batch holds what the caller sent plus the stamp; read the rest.
        let q = services.query()
            .query(format!("SELECT id_p, subject_p, owner_p FROM case_p WHERE id_p IN ({}) LIMIT 100", id_list(chunk)))
            .build()?;
        let rows = services.query().execute(q)?;
        for row in rows.iter_rows() {
            let Some(case_id) = cell_id(row, 0) else { continue };
            let subject = cell_text(row, 1).unwrap_or_else(|| "case".into());
            tasks.push(task(
                format!("Escalated: {subject}"),
                cell_id(row, 2),
                case_id,
                "case_p",
                1,
                "This case was raised to critical. Contact the account today.".into(),
            )?);
        }
    }

    if !tasks.is_empty() {
        let req = InsertRequest::builder("task_p").records(tasks).build()?;
        let result = services.record().execute_insert(req)?;
        check_failures(&result, "case_escalation_c/task")?;
    }
    Ok(())
}

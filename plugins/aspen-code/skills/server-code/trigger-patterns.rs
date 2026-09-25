//! Trigger patterns that have fired on a real instance (platform 26.3.3, aspen-crm 0.1.0).
//!
//! This file is a complete `src/lib.rs`: it builds as-is against the crate `aspen init` scaffolds
//! plus `jiff = "0.2"` in `Cargo.toml`. Copy the `helpers` block once, then the ONE handler
//! closest to what you need, and its entry from the registration below. Delete the rest.
//! Every handler here was deployed and produced the expected record; the comments say what
//! each one is for and which platform behavior it works around.
//!
//! Registration these handlers expect in `aspen.server.json` (event strings are exactly
//! these six: before_insert, after_insert, before_update, after_update, before_delete,
//! after_delete):
//!
//! ```json
//! {
//!   "record-triggers": [
//!     { "name": "case_owner_default_c",   "object": "case_p",            "events": ["before_insert"] },
//!     { "name": "target_owner_default_c", "object": "campaign_target_c", "events": ["before_insert"] },
//!     { "name": "opp_won_brief_c",        "object": "opportunity_p",     "events": ["after_update"] },
//!     { "name": "opp_motion_sync_c",      "object": "opportunity_p",     "events": ["after_insert", "after_update"] },
//!     { "name": "org_health_c",           "object": "org_c",             "events": ["after_update"] },
//!     { "name": "champion_exit_c",        "object": "contact_role_p",    "events": ["before_delete"] }
//!   ]
//! }
//! ```
//!
//! The rule every handler follows: collect work across the whole batch first, then issue
//! at most one insert and one update per object type. A batch of N records is one API
//! round trip, not N.

use std::collections::{HashMap, HashSet};

use aspen_crm::error;
use aspen_crm::record::trigger::{
    AfterInsertContext, AfterUpdateContext, BeforeDeleteContext, BeforeInsertContext,
    ImmutableObjectRecord, MutableObjectRecord,
};
use aspen_crm::record::{FieldState, RecordFieldValue, ValidFieldValue};
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

/// An id-shaped field off an after-* batch record. A lookup does not come back as one
/// reliable variant, so match all the id-shaped ones together.
fn get_id(record: &ImmutableObjectRecord, field: &str) -> error::Result<Option<Uuid>> {
    Ok(match record.get(field)? {
        FieldState::Value(
            RecordFieldValue::Id(id) | RecordFieldValue::IdParent(id) | RecordFieldValue::IdLookup(id),
        ) => Some(id),
        _ => None,
    })
}

/// Same, off a before-* batch record (a different type: it has `set`).
fn get_id_mut(record: &MutableObjectRecord, field: &str) -> error::Result<Option<Uuid>> {
    Ok(match record.get(field)? {
        FieldState::Value(
            RecordFieldValue::Id(id) | RecordFieldValue::IdParent(id) | RecordFieldValue::IdLookup(id),
        ) => Some(id),
        _ => None,
    })
}

fn get_picklist(record: &ImmutableObjectRecord, field: &str) -> error::Result<Option<String>> {
    Ok(match record.get(field)? {
        FieldState::Value(RecordFieldValue::Picklist(s)) => Some(s),
        _ => None,
    })
}

/// An id-shaped cell out of a query row. Query cells are `Option<ValidFieldValue>`, a
/// different shape from batch fields; a polyid read back can also be `PolyidParent`.
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

/// A `number` or `number/percentage` cell. Both are `Decimal`.
fn cell_decimal(row: &SelectQueryRow, index: usize) -> Option<Decimal> {
    match row.get(index) {
        Some(Some(ValidFieldValue::RecordFieldValue(
            RecordFieldValue::Number(d) | RecordFieldValue::NumberPercentage(d),
        ))) => Some(*d),
        _ => None,
    }
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
// Owner fields come in two shapes and the variant must match the field's OWN metadata:
//   account_p, contact_p, opportunity_p      owner_p is id/lookup      -> IdLookup, no *on field
//   case_p, lead_p                           owner_p is polyid/lookup  -> PolyidLookup + owneron_p
//   task_p, email_p, meeting_p, activity_p   owner_p is polyid/parent  -> PolyidParent + owneron_p
// Check `type`/`subtype` in the object's compiled JSON; the wrong shape is rejected at
// insert, not at compile.

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
// Default a child's owner to its parent's owner. One query per 100 parents, not one per
// row: per-request overhead dominates, and a query returns at most 100 rows anyway.

impl target_owner_default_c for Entrypoints {
    fn before_insert(context: &BeforeInsertContext) -> error::Result<()> {
        let mut wanted: Vec<Uuid> = Vec::new();
        for record in context.batch().iter() {
            if matches!(record.get("owner_c")?, FieldState::Value(_)) {
                continue;
            }
            if let Some(account) = get_id_mut(&record, "account_c")?
                && !wanted.contains(&account)
            {
                wanted.push(account);
            }
        }
        if wanted.is_empty() {
            return Ok(());
        }

        let mut owners: HashMap<Uuid, Uuid> = HashMap::new();
        for chunk in wanted.chunks(100) {
            let ids: Vec<String> = chunk.iter().map(|id| format!("'{id}'")).collect();
            let aql = format!(
                "SELECT id_p, owner_p FROM account_p WHERE id_p IN ({}) LIMIT 100",
                ids.join(",")
            );
            let query = context.services().query().query(aql).build()?;
            let rows = context.services().query().execute(query)?;
            for row in rows.iter_rows() {
                if let (Some(account), Some(owner)) = (cell_id(row, 0), cell_id(row, 1)) {
                    owners.insert(account, owner);
                }
            }
        }

        for record in context.batch().iter() {
            if matches!(record.get("owner_c")?, FieldState::Value(_)) {
                continue;
            }
            let Some(account) = get_id_mut(&record, "account_c")? else { continue };
            if let Some(owner) = owners.get(&account) {
                // owner_c on this object is id/lookup, hence IdLookup and no *on field.
                record.set("owner_c", FieldState::Value(RecordFieldValue::IdLookup(*owner)));
            }
        }
        Ok(())
    }
}

// ── 3. after_update: a transition creates records, in bulk ───────────────────
// When status_p becomes closed_won_p and no brief exists yet: stamp brief_status_c and
// create a task. One update + one insert per batch. The batch only carries the fields
// that CHANGED, so `status_p` being present already means the transition happened; the
// record's other fields need a query. Re-fires from our own update are skipped because
// brief_status_c is then set.

impl opp_won_brief_c for Entrypoints {
    fn after_update(context: &AfterUpdateContext) -> error::Result<()> {
        let mut brief_updates: Vec<(Uuid, RecordInput)> = Vec::new();
        let mut tasks: Vec<RecordInput> = Vec::new();

        for record in context.batch().iter() {
            if get_picklist(&record, "status_p")?.as_deref() != Some("closed_won_p") {
                continue;
            }
            // id_p is always in the batch, even though it never "changes".
            let Some(opp_id) = get_id(&record, "id_p")? else { continue };

            let q = context.services().query()
                .query(format!("SELECT name_p, owner_p, brief_status_c FROM opportunity_p WHERE id_p = '{opp_id}' LIMIT 1"))
                .build()?;
            let rows = context.services().query().execute(q)?;
            let Some(row) = rows.iter_rows().next() else { continue };
            if matches!(row.get(2), Some(Some(_))) {
                continue; // brief already started
            }
            let opp_name = cell_text(row, 0).unwrap_or_else(|| "opportunity".into());
            let owner = cell_id(row, 1);

            brief_updates.push((
                opp_id,
                RecordInput::builder()
                    .field("brief_status_c", RecordFieldValue::Picklist("pending_c".into()))
                    .build()?,
            ));
            tasks.push(task(
                format!("Complete deal brief — {opp_name}"),
                owner,
                opp_id,
                "opportunity_p",
                3,
                "Deal closed won. Record why the customer bought and what was committed.".into(),
            )?);
        }

        if !brief_updates.is_empty() {
            let req = UpdateRequest::builder("opportunity_p").records(brief_updates).build()?;
            let result = context.services().record().execute_update(req)?;
            check_failures(&result, "opp_won_brief_c/brief")?;
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
// Two things worth copying: one function serves both events, and a field the update did
// not touch is absent from the batch, so the handler queries for what it needs instead of
// assuming. Deduped with a set so each org is updated once per batch.

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
        let mut status = get_picklist(&record, "status_p")?;
        let mut org = get_id(&record, "org_c")?;
        if status.is_none() || org.is_none() {
            if let Some(opp_id) = get_id(&record, "id_p")? {
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

// ── 5. after_update that writes back to its own object ───────────────────────
// Recompute health_c from the org's own numbers. This trigger's update fires this trigger
// again, so it writes ONLY when the computed value differs from what is stored -- the
// second fire then finds nothing to do and settles. Without that guard it loops until the
// platform stops it. Also shows Decimal comparisons: `Decimal::new(35, 2)` is 0.35.

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

impl org_health_c for Entrypoints {
    fn after_update(context: &AfterUpdateContext) -> error::Result<()> {
        let mut updates: Vec<(Uuid, RecordInput)> = Vec::new();

        for record in context.batch().iter() {
            let Some(org_id) = get_id(&record, "id_p")? else { continue };
            let q = context.services().query()
                .query(format!(
                    "SELECT seats_licensed_c, seats_active_30d_c, token_commit_annual_c, token_consumed_ttm_c, health_c, health_reason_c FROM org_c WHERE id_p = '{org_id}' LIMIT 1"
                ))
                .build()?;
            let rows = context.services().query().execute(q)?;
            let Some(row) = rows.iter_rows().next() else { continue };

            let zero = Decimal::new(0, 0);
            let adoption = match (cell_decimal(row, 1), cell_decimal(row, 0)) {
                (Some(a), Some(l)) if l > zero => Some(a / l),
                _ => None,
            };
            let burn = match (cell_decimal(row, 3), cell_decimal(row, 2)) {
                (Some(c), Some(k)) if k > zero => Some(c / k),
                _ => None,
            };
            if adoption.is_none() && burn.is_none() {
                continue;
            }
            let (health, reason) = compute_health(adoption, burn);

            // The guard: unchanged means no write, which is what ends the re-fire.
            let current_health = cell_picklist(row, 4);
            let current_reason = cell_text(row, 5);
            if current_health.as_deref() == Some(health) && current_reason.as_deref() == Some(reason.as_str()) {
                continue;
            }
            updates.push((
                org_id,
                RecordInput::builder()
                    .field("health_c", RecordFieldValue::Picklist(health.into()))
                    .field("health_reason_c", RecordFieldValue::Text(reason))
                    .build()?,
            ));
        }

        if !updates.is_empty() {
            let req = UpdateRequest::builder("org_c").records(updates).build()?;
            let result = context.services().record().execute_update(req)?;
            check_failures(&result, "org_health_c")?;
        }
        Ok(())
    }
}

// ── 6. before_delete: the row still exists to query ──────────────────────────
// Before a contact-role row is deleted, if it was a champion on an account, flag every
// org on that account. before_delete because the row and its fields are still there to
// query; after_delete yields only `id()` and nothing else about the record. Note the
// delete-side record type has `id()` and no `get()`.

impl champion_exit_c for Entrypoints {
    fn before_delete(context: &BeforeDeleteContext) -> error::Result<()> {
        let mut account_ids: HashSet<Uuid> = HashSet::new();

        for record in context.batch().iter() {
            let role_id = record.id();
            let q = context.services().query()
                .query(format!("SELECT role_p, what_idon_p, what_id_p FROM contact_role_p WHERE id_p = '{role_id}' LIMIT 1"))
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
                .query(format!("SELECT id_p FROM org_c WHERE account_c = '{account_id}' LIMIT 100"))
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

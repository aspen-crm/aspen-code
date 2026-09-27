# Trigger errors: what the user and the API caller actually get

Read this before asking the developer how a trigger should fail (`SKILL.md` step 1), and when
writing the rejection code. Everything below was traced through the platform source (x-platform,
2026-09-27) and its record-trigger tests. The *Record Triggers* docs page covers the SDK calls; it
does not cover what reaches the caller.

## The three ways to fail, and where each one lands

| In the trigger | Batch | Record form (UI) | Data API (batch create/update) |
|---|---|---|---|
| `record.add_field_error(FieldError::new(field, code, msg))` — before-triggers only | Only that row is rejected; the other rows **commit** | The message under that field. If the field is not editable on the layout (not on it, read-only, locked), it goes to the error banner as `("Label") msg` | HTTP 200, batch `status: FAILURE`; that item: `{status: FAILURE, failures: [{error_type: INVALID_DATA, subtype: UNKNOWN_DATA, detail: msg, context: {field_name: field}}]}` |
| `record.add_record_error(RecordError::new(code, msg))` — before-triggers and `before_delete` | Only that row is rejected; the other rows commit | The error banner above the form | Same as above, with no `context` |
| `Err(..)`, `error::bail!`, or a panic — any trigger | The **whole batch rolls back**, including rows that were fine | An error modal, not the banner | HTTP 200, `{status: FAILURE, failures: [{error_type: INVALID_DATA, subtype: UNKNOWN_DATA, detail: "before trigger error '<msg>'"}]}` (`after trigger error '…'` from an after-trigger), no `data` |

## What does not reach anyone

- **The `code` you pass is dropped**, and so is `RecordError::set_subtype`. Every trigger error
  arrives as `INVALID_DATA` / `UNKNOWN_DATA`. An integration cannot branch on a trigger's error
  code. If it needs a stable identifier, the options are: put it in the message text (e.g. a
  `DISCOUNT_CAP:` prefix, agreed with the developer), or give the integration a Web API endpoint
  whose `ErrorResponse::builder(error_type, detail)` *does* carry the type.
- **`display_detail` is always empty** for trigger errors; UIs fall back to `detail`. The message
  you write is the message the user reads — write it for them, not for a log.
- **An `Err`'s text is wrapped.** From `bail!("x")` the caller sees roughly
  `before trigger error 'record trigger failed: x'`. Fine for "this save cannot happen"; poor as a
  user-facing validation message. Use a field or record error for anything the user can fix.
- **Log lines** (`info!`/`warn!`) reach platform logging only; nothing on the user's or caller's
  side shows them.
- Nothing validates the field name in a `FieldError` — a typo sends the message to the banner with
  no label, or to nowhere useful. Use the field's constant from your model module.

## After-triggers

They cannot attach field or record errors; the write has committed. Their only way to fail is
`Err`/panic, which rolls back the whole batch — every record in it, not just the one that
tripped. Validation belongs in a before-trigger. Use after-trigger failure only for "the follow-on
work failed and the original write must not stand", and agree that with the developer.

## Failures inside the trigger's own work

A write the trigger issues (`execute_insert` / `execute_update`) can fail per row inside
`Ok(BatchProcessed)` — see `.failures()` in `rust-trigger-notes.md`. A query can return `Err`.
For each, the developer chooses: fail the user's save (`bail!`, whole batch), reject just the
affected record (a record error, before-triggers only), or skip and continue (the user's save
succeeds without the follow-on work — say so in the summary).

## The error table

Record the developer's answers before writing code, one row per failure the trigger can detect,
and show it to them:

| Condition | Mechanism | Field | Message the user reads | API caller needs |
|---|---|---|---|---|
| Discount over the rep's cap | field error | `discount_c` | "Discount can't exceed your 15% cap." | message only |
| Quote already approved | record error | — | "Approved quotes can't be edited." | message only |
| Follow-up task insert failed | `bail!` (whole batch) | — | "Couldn't create the follow-up task; nothing was saved." | — |

A row with no answer is a question you have not asked yet.

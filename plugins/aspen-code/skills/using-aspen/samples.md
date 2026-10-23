# The sample instances

[aspen-crm/aspen-samples](https://github.com/aspen-crm/aspen-samples) holds three working
instances, each modelled on a customer segment: `medtech` (capital equipment and its installed
base), `startup` (B2B SaaS, three revenue motions on one pipeline) and `vc` (an early-stage fund,
capital out and capital in). Each has `metadata/custom/`, `rust/src/lib.rs` with its
`rust/aspen.server.json`, and `seed/` (a loader and the data it generates). None has a TypeScript
page.

## When to read one

- This instance's `active/`, `platform/` and `compiled/` have no shape to copy.
- You want a component wired to the rest of a model: an object with its layout, list view, tab
  and tab-collection entry, or a trigger with the fields it reads and the registration it needs.
- Deciding whether a concept earns an object: each sample's `README.md` says what its segment is
  built around, and each custom object's `description` says why it exists.

## How

Clone once per session, outside the instance directory (a stray file in `metadata/custom/`
deploys), and read the files locally:

```sh
git clone --depth 1 https://github.com/aspen-crm/aspen-samples "${TMPDIR:-/tmp}/aspen-samples"
```

For one file, `curl -fsSL https://raw.githubusercontent.com/aspen-crm/aspen-samples/main/<path>`.
Never a web-fetch tool: it summarizes, and a shape needs the exact JSON.

- **Copy the shape, not the file.** Names, labels, picklist items and descriptions are the
  sample's business.
- **This instance's compile is the authority.** The samples track the platform's main line (the
  repo README's last line names the commit), so one can be newer than this instance's release. A
  sample shape the compile rejects is skew: follow the compiler.
- Deploy a whole sample only when the human asks for one; the repo README says how.

## Where to look

Paths are under `<sample>/metadata/custom/` unless they start with `rust/`.

| You need | Look at |
|---|---|
| A custom object: lookups, unique and indexed fields, descriptions | `startup` `object_p/subscription_c.json` and `vc` `object_p/investment_c.json` (both with a currency pair), `medtech` `object_p/installed_asset_c.json` |
| Fields added to a platform object with an overlay | `object_p/opportunity_p.json`, `object_p/account_p.json`, `object_p/case_p.json` in any sample |
| A platform object type listing the new fields | `object_p/object_type_p/opportunity_p.opportunity_p.json` |
| A new record type on a platform object, with its own layout | `vc` `object_p/object_type_p/opportunity_p.commitment_c.json` and `object_p/layout_p/opportunity_p.commitment_lay_c.json` |
| A layout for a custom object; an overlay on a platform layout | `object_p/layout_p/<object>.layout_c.json`; `object_p/layout_p/opportunity_p.layout_p.json` |
| A list view on a custom object; a custom list view on a platform object | `object_p/list_view_p/<object>.list_view_c.json`; `medtech` `object_p/list_view_p/case_p.service_lv_c.json` |
| A tab, and the tab-collection overlay that places it | `object_p/tab_p/<object>.tab_c.json`, `tab_collection_p/aspen_crm_p.json` |
| A global picklist; an object picklist; items added to a platform picklist | `picklist_p/`; `object_p/picklist_p/`; `object_p/picklist_p/case_p.type_p.json` |
| A picklist filter narrowing a platform picklist | `medtech` `picklist_p/picklist_filter_p/product_p.type_filter_c.json` |
| A before-trigger that rejects a save with a field error | `medtech` `rust/src/lib.rs` (a deal in committee review needs its committee date); `vc` (a passed deal needs its reason) |
| A before-trigger that derives a stored value unless the caller set it | `startup` (ARR from contract value and term); `vc` (ownership from check size and post-money) |
| A before + after pair that writes other records once a save commits | `startup` (a closed renewal rolls its subscription forward or churns it); `vc` (a won deal books a position) |

Each trigger is registered in `rust/aspen.server.json`. The `startup` crate adds `jiff = "0.2"`
to `Cargo.toml`.

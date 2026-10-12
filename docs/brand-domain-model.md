# Brand Domain Model — Roznama ERP (Phase 2)

Conceptual domain model, defined ahead of Onfinity discovery so Phase 1
findings can be mapped onto it rather than invented ad hoc. The
**Onfinity Implementation** column is intentionally left as `TBD` — filling
it in before Phase 1 completes would be a guess, not a mapping.

| Entity | Description | Onfinity Implementation |
|---|---|---|
| Organization | Legal entity operating the platform | TBD |
| Business Unit | Sub-division of an Organization | TBD |
| User | A platform user (staff, not customer/supplier) | TBD |
| Role | Named permission set assigned to Users | TBD |
| Customer | Buyer of goods/services | TBD |
| Supplier | Vendor of goods/services | TBD |
| Product | Sellable/purchasable item or service | TBD |
| Category | Classification for Products | TBD |
| Warehouse | Physical/logical stock location | TBD |
| Project | Time-bound body of work with cost/resources | TBD |
| Contract | Legal agreement with a Customer or Supplier | TBD |
| Quotation | Priced offer to a Customer | TBD |
| Sales Order | Confirmed Customer order | TBD |
| Purchase Request | Internal request to buy | TBD |
| RFQ | Request for quotation sent to Suppliers | TBD |
| Supplier Quotation | Supplier's response to an RFQ | TBD |
| Purchase Order | Confirmed order to a Supplier | TBD |
| Receipt | Confirmation of goods/services received | TBD |
| Delivery | Confirmation of goods/services shipped to a Customer | TBD |
| Invoice | Billing document (payable or receivable) | TBD |
| Payment | Money movement against an Invoice | TBD |
| Account | Financial ledger account | TBD |
| Budget | Planned spend/revenue for a period or Project | TBD |
| Document | Any governed file/record | **Implemented** — `DCControlledDocument` / `DCLibrary` in `extensions/ecm-nuxeo-studio` (see `docs/DOCUCENTRAL.md`) |
| Task | Unit of work assigned to a User | TBD |
| Workflow | State machine governing an entity's lifecycle | Pattern **already proven** in the ECM extension's 5-state document lifecycle; reusable as the template for other workflows (Phase 7, `ROADMAP.md`) |
| Approval | A step within a Workflow requiring sign-off | Pattern proven in ECM extension (`DCApprove` permission gate) |
| KPI | Measured indicator against a target | Pattern proven in ECM extension's governance dashboard (cycle time, review backlog, overdue reviews) |

## Notes

- Do not create a new Document/Workflow/Approval implementation elsewhere
  in the platform before checking whether the ECM extension's pattern
  (schema + lifecycle + scripted transition guard + dashboard) already
  covers the need — see `docs/00-master-charter.md` §1 (do not duplicate
  what already works).
- Once `docs/01-system-inventory.md` through `docs/04-module-map.md` are
  complete, every `TBD` above gets replaced with either a concrete
  Onfinity table/module reference, or an explicit "gap — not present in
  Onfinity, needs a new extension" note.

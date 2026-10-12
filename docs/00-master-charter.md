# Roznama ERP — Master Charter

This file is the durable, in-repo record of the governing rules for the
Roznama ERP program (product-branded as **Roznama ERP**, engineered on top
of the existing **Onfinity ERP Community 6.4.1.0** core). It condenses the
full Master Agent brief so any contributor or agent working in this
repository — in any future session — operates under the same rules without
needing the original prompt re-pasted.

## 1. Prime directive

> Do not rebuild what already works. Re-engineer what limits the product.
> Extend what can be extended. Isolate what must change. Modernize the user
> experience. Protect the ERP data. Make everything testable. Make the
> platform upgradeable. Make the product commercial-ready.

Onfinity is the existing ERP **core**. It is not replaced wholesale, not
rewritten from scratch, and never modified destructively. The database is
never altered without a verified backup and a migration script.

## 2. Classification discipline

Every existing component encountered during reverse engineering (Phase 1)
must be classified with evidence, not assumption:

| Label | Meaning |
|---|---|
| **KEEP** | Works, meets the need, no change |
| **EXTEND** | Works, needs additive capability |
| **REFACTOR** | Works, but structure/quality blocks progress |
| **REPLACE** | Does not meet the need and cannot be extended economically |
| **DEPRECATE** | No longer needed |

"Old" is not evidence for REPLACE. A documented limitation is.

## 3. Golden architecture

```
Frontend (Next.js/React/TS)
   |
Roznama API (service layer)
   |
Business Services / Extensions
   |
Onfinity ERP Core
   |
PostgreSQL
```

The frontend never talks to PostgreSQL directly. All access goes through
the API layer, which fronts Onfinity and the business extensions.

## 4. Phase order (do not reorder)

1. **Phase 0 — Environment & safety discovery** (this phase; see
   `scripts/phase0-discovery.ps1` / `.sh`)
2. **Phase 1 — Reverse engineering** of the Onfinity install
   (`docs/01` – `docs/09`)
3. **Phase 2 — Domain model** (`docs/brand-domain-model.md`)
4. **Phase 3 — Re-engineering strategy** (Core/Extensions/Services/
   Integrations/Experience split, `docs/10-reengineering-plan.md`)
5. **Phase 4+ — Core stabilization → API → Brand/Roznama UI → Workflow →
   Business extensions → BI → ECM → AI → SaaS/productization**

Do not start UI or AI work before the core is inventoried and stable. The
one component already ahead of this sequence —
`extensions/ecm-nuxeo-studio/` (the DocuCentral controlled-document MVP on
Nuxeo) — is accepted as pre-existing, audited work that satisfies part of
Phase 7 (ECM) early; it is not a precedent for skipping the sequence
elsewhere.

## 5. Development loop (every task, no exceptions)

Inspect → Understand → Plan → Implement → Test → Review → Fix → Retest →
Document → Commit.

If a test fails: capture the error, identify the component, reproduce,
inspect logs, find the root cause, fix the minimum necessary layer, retest,
run regression tests, document. Never suppress a failing test to get green.

If the current architecture blocks a feature: **stop**, and document what
blocks it, why, the alternatives, the recommended solution, and the
migration impact — before implementing the safest option.

## 6. Definition of Done

A feature is done only when all of the following hold:

- [ ] Requirements documented
- [ ] Architecture reviewed
- [ ] Code implemented
- [ ] Tests implemented and passing
- [ ] Security reviewed
- [ ] UI reviewed (where applicable)
- [ ] Arabic + RTL reviewed (where applicable)
- [ ] API documented (where applicable)
- [ ] Error handling implemented
- [ ] Audit requirements reviewed
- [ ] Documentation updated
- [ ] Git commit created with a message explaining the change
- [ ] Deployment tested

## 7. Autonomous decision rules

When multiple technical solutions exist, prefer, in order: (1) existing
Onfinity capability, (2) open-source tooling, (3) low operational cost,
(4) maintainability, (5) security, (6) upgradeability, (7) performance,
(8) extensibility. Avoid unnecessary enterprise complexity — modular
monolith over microservices, Docker Compose over Kubernetes, until scale
actually demands otherwise.

## 8. Git strategy

Branches: `main`, `develop`, `feature/*`, `fix/*`, `release/*`. Commit
messages explain the *why*. Never commit passwords, API keys, tokens,
certificates, database dumps, or production secrets — see the credential
finding already logged in
`extensions/ecm-nuxeo-studio/docs/AUDIT.md` (A9) as a concrete example of
what this rule exists to prevent.

## 9. MVP scope

Authentication, dashboard, customers, suppliers, products, sales,
procurement, inventory, finance, users/roles, basic workflow, basic
reports, Arabic/French/English with RTL, the Roznama UI shell, the API
layer, backup, and Docker deployment. AI, advanced BI, full ECM, and
government-specific extensions follow once the MVP core is stable.

## 10. Current status (updated as phases complete)

| Phase | Status |
|---|---|
| Phase 0 — Environment discovery | **Blocked** — requires running `scripts/phase0-discovery.ps1` on the machine hosting Onfinity; cannot be executed from this cloud workspace |
| Phase 1 — Reverse engineering | Not started (depends on Phase 0 output) |
| Phase 2 — Domain model | Drafted conceptually, Onfinity entity mapping pending |
| Phase 3 — Re-engineering strategy | Not started |
| Phase 4 — Core stabilization | Not started |
| Phase 7 — ECM (partial, ahead of sequence) | **MVP done** — see `extensions/ecm-nuxeo-studio/docs/DOCUCENTRAL.md` |

See `ROADMAP.md` for the full phase-by-phase plan and `README.md` for the
repository layout.

# Roznama ERP — Roadmap

Status legend: ⛔ Blocked · ⏳ Not started · 🔶 In progress · ✅ Done

| # | Phase | Scope | Status | Notes |
|---|---|---|---|---|
| 0 | Environment & safety discovery | Inventory Onfinity, PostgreSQL, source, config, services, ports on the host machine; create backups | ⛔ | Run `scripts/phase0-discovery.ps1` (Windows) or `.sh` (Linux/Docker host) on the machine where Onfinity actually runs — this cloud workspace has no access to it |
| 1 | Reverse engineering | Architecture, DB schema, business logic, auth, reports, workflows, UI, API — classify KEEP/EXTEND/REFACTOR/REPLACE/DEPRECATE | ⏳ | Depends on Phase 0 output |
| 2 | Domain model | Map Roznama entities to Onfinity implementation, identify gaps | 🔶 | `docs/brand-domain-model.md` drafted conceptually; Onfinity mapping column pending Phase 1 |
| 3 | Re-engineering strategy | Split into Core / Extensions / Services / Integrations / Experience | ⏳ | Depends on Phase 1 |
| 4 | Core stabilization | Stabilize Onfinity core before building on top of it | ⏳ | |
| 5 | API-first layer | `/api/*` surface fronting Onfinity, OpenAPI, auth, audit | ⏳ | |
| 6 | Roznama UI | Next.js/React/TS experience layer, design system, ar/fr/en + RTL | ⏳ | |
| 7 | Workflow | Draft→Review→Approved→Published style state machines, approval matrix, SLA | ⏳ | |
| 7b | ECM (ahead of sequence) | Controlled-document lifecycle on Nuxeo | ✅ | `extensions/ecm-nuxeo-studio` — see `DOCUCENTRAL.md`; MVP audited and structurally verified, runtime smoke test still pending a live Nuxeo server |
| 8 | Business extensions | Sales, Procurement, Inventory, Finance, Projects, Contracts | ⏳ | |
| 9 | BI / Analytics | KPI pipeline, executive/finance/sales/procurement/ops/project dashboards | ⏳ | |
| 10 | AI platform | Assistant → agents, tool-calling through the Roznama API only | ⏳ | |
| 11 | Security hardening | SSO/OIDC (Keycloak), RBAC, secrets management, OWASP review | ⏳ | |
| 12 | Testing | Unit/integration/API/E2E/security/performance suites | ⏳ | |
| 13 | DevOps | Docker Compose, CI/CD pipeline | ⏳ | |
| 14 | Productization | Install wizard, edition tiers (Business/Professional/Enterprise/Government) | ⏳ | |
| 15 | Multi-tenancy | Only after the single-tenant product is stable | ⏳ | |

## Release ladder

Alpha → MVP → Beta → Release Candidate → Production v1.0. Each release
requires: tests, migration verification, backup, rollback plan,
documentation, changelog entry.

## Immediate next action

Run the Phase 0 discovery script on the Windows machine hosting Onfinity
and PostgreSQL (see `README.md` → "Running Phase 0 discovery"), then commit
the reviewed report into `docs/01-system-inventory.md`. Everything from
Phase 1 onward is gated on that.

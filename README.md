# Roznama ERP

Roznama ERP is an enterprise ERP/CRM/BI/AI platform being built by
re-engineering an existing **Onfinity ERP Community 6.4.1.0** installation
into a branded, modernized, commercial-ready product — without rewriting
what already works. See `docs/00-master-charter.md` for the full governing
rules and `ARCHITECTURE.md` / `ROADMAP.md` for the target design and phase
plan.

## Where things stand right now

This repository has just been reorganized into the Roznama ERP workspace
layout. **Phase 0 (environment discovery) is blocked**: Onfinity and
PostgreSQL run on a separate machine that this cloud workspace cannot
reach. One extension is already ahead of the sequence and done:

- **`extensions/ecm-nuxeo-studio/`** — a controlled-document management
  MVP (DocuCentral) built on Nuxeo and the Nuxeo Studio Community
  Cookbook. Content model, 5-state lifecycle, governance dashboard, and
  deploy/validate tooling are complete and structurally verified; see
  `extensions/ecm-nuxeo-studio/docs/DOCUCENTRAL.md`.

Everything else (Onfinity inventory, domain mapping, API, Roznama UI,
workflow, business extensions, BI, AI, security hardening, productization)
is sequenced in `ROADMAP.md` and gated on Phase 0 discovery completing.

## Running Phase 0 discovery

Onfinity and PostgreSQL live on a machine this session cannot reach. To
unblock Phase 1, run the discovery script **on that machine**:

**Windows (PowerShell):**
```powershell
cd path\to\this\repo\scripts
.\phase0-discovery.ps1
```

**Linux/Docker host:**
```bash
cd scripts
./phase0-discovery.sh
```

Both are read-only — they inspect, they never install, start, stop, or
modify anything. Each writes a timestamped report to `docs/discovery/`
(git-ignored). **Review that report for secrets** (passwords, connection
strings, tokens), then transcribe the redacted findings into
`docs/01-system-inventory.md` and commit that file. From there, work
through `docs/02-architecture.md` … `docs/10-reengineering-plan.md` in
order — see `docs/00-master-charter.md` for why the order matters.

## Repository layout

```
docs/          Phase 0-3 deliverables, domain model, master charter
architecture/  Diagrams, ADRs
database/      Schema maps, migrations (never destructive, always backed up first)
source/        Reference material on the Onfinity source, once accessible
frontend/      Roznama Experience layer (Next.js) — scaffolded at Phase 6
backend/       Roznama API / service layer — scaffolded at Phase 5
extensions/    Business + ECM extensions (ecm-nuxeo-studio lives here)
ai/            AI orchestrator, tools, agents — Phase 10
bi/            Analytics pipeline, dashboards — Phase 9
devops/        Docker Compose, CI/CD
tests/         Cross-cutting E2E/security/performance suites
scripts/       Discovery, backup, and operational scripts
backups/       Local backup artifacts (git-ignored)
```

Each folder above has its own `README.md` with its current status. Most
say "not started" by design — see `docs/00-master-charter.md` §7 on
avoiding complexity ahead of need.

## Key documents

| Document | Purpose |
|---|---|
| `docs/00-master-charter.md` | Governing rules for every phase and every contributor/agent |
| `ARCHITECTURE.md` | Target architecture (layers, non-negotiable API-first boundary) |
| `ROADMAP.md` | Full phase plan with status |
| `docs/brand-domain-model.md` | Phase 2 domain entities, mapped to Onfinity as discovery proceeds |
| `extensions/ecm-nuxeo-studio/docs/DOCUCENTRAL.md` | The one extension already built |

## Product naming note

The engineering plan this repo implements was originally drafted under the
working title "Brand Solutions ERP." The product name is **Roznama ERP**;
treat any remaining "Brand Solutions" reference in older material as that
placeholder, not a second product.

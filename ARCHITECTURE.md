# Roznama ERP — Architecture

## Target architecture

```
                    ROZNAMA ERP
                         |
        +----------------+----------------+
        |                                 |
  Experience Layer                  AI Platform
  (Next.js / React / TS)         (orchestrator + tools,
        |                         never touches the DB directly)
        v
  Roznama API / Service Layer  <---->  BI / Data Platform
        |
  Business Extensions (per-domain services)
        |
  ECM Integration  <---->  extensions/ecm-nuxeo-studio (Nuxeo, DocuCentral)
        |
  Onfinity ERP Core
        |
  PostgreSQL
```

Non-negotiable rule: the frontend never queries PostgreSQL or Onfinity
directly. Every read/write goes through the Roznama API, which is the only
component allowed to speak to the Onfinity core.

## Layer responsibilities

| Layer | Responsibility | Status |
|---|---|---|
| Experience | Roznama-branded UI, i18n (ar/fr/en), RTL, design system | Not started |
| Roznama API | REST/OpenAPI surface, auth, validation, audit logging | Not started |
| Business Extensions | Domain logic that doesn't belong in Onfinity core | Not started |
| AI Platform | Assistant + agents, tool-calling into the API only | Not started |
| BI / Data Platform | Pipeline from operational data to dashboards | Not started |
| ECM Integration | Document/records management | **MVP done** via `extensions/ecm-nuxeo-studio` (DocuCentral) |
| Onfinity ERP Core | Existing ERP engine — reverse-engineered, not rewritten | Not yet inventoried (Phase 1 blocked on discovery) |
| PostgreSQL | System of record | Not yet inventoried |

## Current-state vs. target-state

This document tracks the **target**. The **current** state is whatever
`docs/01-system-inventory.md` through `docs/09-technical-debt.md` record
once Phase 0/1 discovery has run against the actual Onfinity installation.
Until that discovery happens, no claim about the current Onfinity
architecture should be treated as established — this file must not be
filled in with assumed detail.

## Repository layout

```
/docs           Phase 0-3 deliverables, domain model, master charter
/architecture   Diagrams, ADRs (architecture decision records)
/database       Schema maps, migration scripts (never destructive, always reviewed)
/source         Reference copies / notes on Onfinity source, once available
/frontend       Roznama Experience layer (Next.js) — scaffolded when Phase 4 starts
/backend        Roznama API / service layer — scaffolded when Phase 5 starts
/extensions     Business + ECM extensions (ecm-nuxeo-studio lives here today)
/ai             AI orchestrator, tools, agents — Phase 9
/bi             Analytics pipeline, dashboards — Phase 8
/devops         Docker Compose, CI/CD pipelines
/tests          Cross-cutting test suites (unit tests live beside their code)
/scripts        Discovery, backup, and operational scripts
/backups        Local backup artifacts (git-ignored; never commit dumps)
```

Each of these has its own `README.md` explaining its current status —
most are placeholders until their phase starts, by design (see
`docs/00-master-charter.md`, section 7: avoid unnecessary complexity ahead
of need).

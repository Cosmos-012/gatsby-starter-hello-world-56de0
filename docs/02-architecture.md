# 02 — Onfinity Architecture Report (current state)

**Status: BLOCKED** on `docs/01-system-inventory.md`. This document
records the *as-built* architecture of the existing Onfinity installation
— not the target architecture (that's `ARCHITECTURE.md` at the repo root).

## To be completed once source/runtime access is available

- Runtime stack (language, framework, application server)
- Deployment topology (single server, services, processes)
- Configuration mechanism (files, environment, database-stored config)
- Authentication mechanism currently in use
- Authorization / permission model
- Session management
- Integration points already present (email, file storage, external APIs)
- Scheduled jobs / background workers
- Logging and monitoring currently in place

## Method

Each finding here must cite its evidence (a file path, a config key, an
observed log line, a running process) — not inference from the product
name or version number alone. This keeps Phase 1 classification
(KEEP/EXTEND/REFACTOR/REPLACE/DEPRECATE, see `docs/00-master-charter.md`)
defensible.

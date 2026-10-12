# ADR 0001 — API-first boundary between the Experience layer and Onfinity

## Status
Accepted

## Context
Roznama ERP re-engineers an existing Onfinity ERP Community 6.4.1.0
installation rather than replacing it. The product needs a modern,
Arabic/French/English, RTL-capable web experience (Next.js/React/TS), but
Onfinity's own data layer (PostgreSQL) and business logic were not
designed with an external frontend in mind.

Two options exist for how the new frontend reaches ERP data:

1. **Direct access** — the frontend (or a thin backend-for-frontend)
   queries PostgreSQL or calls into Onfinity internals directly.
2. **API-first** — all access goes through a dedicated Roznama API layer
   that fronts Onfinity; the frontend never sees the database.

## Decision
Option 2. The frontend talks only to the Roznama API. The Roznama API is
the only component permitted to call Onfinity or query PostgreSQL
directly (see `ARCHITECTURE.md` at the repo root for the layer diagram).

## Rationale
- **Upgradeability**: Onfinity's schema and internals can evolve (or be
  reverse-engineered incrementally) without forcing frontend rewrites, as
  long as the API contract holds.
- **Security**: a single, auditable boundary for authN/authZ, validation,
  and audit logging — not one per UI screen.
- **AI safety**: the planned AI platform (`/ai`) must never touch the
  database directly (see `docs/00-master-charter.md` §"Phase 9"); an
  API-first boundary makes that a structural guarantee, not a policy
  reminder.
- **Reuse across surfaces**: the same API can later serve mobile, partner
  integrations, or the AI orchestrator's tools without duplication.

## Consequences
- Every new Onfinity capability the UI needs must be exposed through the
  API layer first — no "quick" direct DB read from the frontend, even
  temporarily.
- The API layer's shape depends on what `docs/08-api-assessment.md` finds
  Onfinity already exposes; where Onfinity has no native API for a need,
  the Roznama API implements it against the database directly (still
  from inside the API layer, never from the frontend).
- Adds one network hop and one component to build/operate versus direct
  access — accepted as the cost of the upgrade path and security posture.

## Status of implementation
Not yet built — sequenced as Phase 5 in `ROADMAP.md`, after Phase 1
(reverse engineering) establishes what Onfinity actually exposes.

# /backend

The Roznama API / service layer that fronts the Onfinity core — the only
component allowed to talk to Onfinity/PostgreSQL directly (see
`ARCHITECTURE.md`). Covers `/api/auth`, `/api/customers`, `/api/sales`,
etc. (Phase 5 in `ROADMAP.md`).

Not scaffolded yet — its shape depends on what Phase 1 finds Onfinity
already exposes (native API, DB-only access, etc.), tracked in
`docs/08-api-assessment.md`.

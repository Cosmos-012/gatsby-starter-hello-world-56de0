# 10 — Re-engineering Plan

**Status: BLOCKED.** This plan is synthesized from `docs/01` through
`docs/09` once Phase 1 discovery is complete — it cannot be written
credibly before then. Drafting it early with placeholder judgments would
produce a plan not backed by evidence, which `docs/00-master-charter.md`
§2 explicitly rules out.

## What will go here

1. A consolidated KEEP/EXTEND/REFACTOR/REPLACE/DEPRECATE table per
   Onfinity module, each row citing the specific evidence from `docs/04`
   – `docs/09`.
2. The Core / Extensions / Services / Integrations / Experience split
   (`docs/00-master-charter.md` §3) mapped onto the actual Onfinity
   modules found.
3. A prioritized Phase 1 backlog: which modules get touched first and why
   (typically: whatever blocks the API layer and the MVP scope in
   `ROADMAP.md`).
4. Migration/rollback plan for any schema or config change identified as
   necessary.

## Immediate action

Run `scripts/phase0-discovery.ps1` (or `.sh`) against the real Onfinity
host, complete `docs/01-system-inventory.md`, then work through `docs/02`
– `docs/09` before returning to this file.

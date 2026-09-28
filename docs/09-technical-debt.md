# 09 — Technical Debt Inventory

**Status: BLOCKED** on `docs/01-system-inventory.md` for the Onfinity
core. The ECM extension's debt is already logged (from its own audit) and
carried here so Phase 3 planning sees the whole picture in one place.

## Onfinity core

To be completed as Phase 1 proceeds — debt items go here with severity,
impact, and recommended remediation, feeding directly into
`10-reengineering-plan.md`.

## `extensions/ecm-nuxeo-studio/`

All findings from `extensions/ecm-nuxeo-studio/docs/AUDIT.md` (A1–A9) are
now **Fixed**:

| # | Severity | Finding | Status |
|---|---|---|---|
| A8 | Low | `fetch-module.sh` wrote to fixed paths under `/tmp`; concurrent runs could corrupt each other's file lists | **Fixed** — each run now uses its own `mktemp -d` scratch directory |
| A9 | Low | Default admin credentials + placeholder Connect token tracked in git via `config/nuxeo-local.properties` | **Fixed** — split into a tracked `.template` and a git-ignored real file; all four scripts that need it now fail with a clear `cp` instruction if it's missing |

A1–A7 were already fixed in the same change that produced the DocuCentral
MVP — see `AUDIT.md` for detail.

Still open, not a code defect: the DocuCentral smoke test has been
syntax-verified but not run against a live Nuxeo server (none was
reachable from the environment that built it) — treat the MVP as
*structurally* verified, not *runtime* verified, until that test runs
against a real server.

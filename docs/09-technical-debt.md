# 09 — Technical Debt Inventory

**Status: BLOCKED** on `docs/01-system-inventory.md` for the Onfinity
core. The ECM extension's debt is already logged (from its own audit) and
carried here so Phase 3 planning sees the whole picture in one place.

## Onfinity core

To be completed as Phase 1 proceeds — debt items go here with severity,
impact, and recommended remediation, feeding directly into
`10-reengineering-plan.md`.

## `extensions/ecm-nuxeo-studio/`

Open items carried from `extensions/ecm-nuxeo-studio/docs/AUDIT.md`:

| # | Severity | Finding | Status |
|---|---|---|---|
| A8 | Low | `fetch-module.sh` writes to fixed paths under `/tmp`; concurrent runs can corrupt each other's file lists | Open — low impact for single-user local dev. Fix: switch to `mktemp -d` per invocation. |
| A9 | Low | Default admin credentials + placeholder Connect token tracked in git via `config/nuxeo-local.properties` | Open — acceptable for local-only default; must be fixed (`.gitignore` + `.template` + env/secret store) before shared or non-local use. |

All **High** and **Medium** findings from that audit (A1–A7) were already
fixed in the same change that produced the DocuCentral MVP — see
`AUDIT.md` for detail. Also open: the DocuCentral smoke test has been
syntax-verified but not run against a live Nuxeo server (no server was
reachable from the environment that built it) — treat the MVP as
*structurally* verified, not *runtime* verified, until that test runs.

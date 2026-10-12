# 04 — Module Map

Tracks every functional module across both the existing Onfinity core and
the Roznama extensions being built alongside it.

## Onfinity core modules

**Status: BLOCKED** on `docs/01-system-inventory.md` / source access.
To be completed: module name, purpose, entry points, dependencies,
classification (KEEP/EXTEND/REFACTOR/REPLACE/DEPRECATE) with evidence.

| Module | Purpose | Classification | Evidence |
|---|---|---|---|
| _pending discovery_ | | | |

## Roznama extension modules (this repository)

| Module | Path | Purpose | Status |
|---|---|---|---|
| ECM / DocuCentral | `extensions/ecm-nuxeo-studio/` | Controlled-document lifecycle (draft→review→approved→published→obsolete) on Nuxeo, built on the Nuxeo Studio Community Cookbook | **MVP done** — content model, 5-state lifecycle, governance dashboard, deploy/validate tooling. Runtime smoke test (`scripts/docucentral-smoke-test.sh`) verified structurally but not yet against a live Nuxeo server. See `extensions/ecm-nuxeo-studio/docs/DOCUCENTRAL.md` and `AUDIT.md`. |

Do not duplicate a capability already covered by an existing extension
(per `docs/00-master-charter.md` §1) — e.g. document/records management
needs route through the ECM extension above rather than a new bespoke
implementation, unless the extension is explicitly classified REPLACE with
evidence.

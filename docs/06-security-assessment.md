# 06 — Security Assessment (current state)

**Status: BLOCKED** on `docs/01-system-inventory.md` for the Onfinity
core. One finding already exists for the ECM extension and is carried
here so it isn't lost before the full OWASP-guided assessment (Phase 10 in
`ROADMAP.md`) runs.

## Onfinity core

To be completed: authentication mechanism, password policy, session
handling, authorization model, known CVEs for the installed version,
transport security (TLS), secrets storage, audit logging coverage.

## `extensions/ecm-nuxeo-studio/`

| Finding | Severity | Status |
|---|---|---|
| `config/nuxeo-local.properties` carries default admin credentials and a placeholder Connect token, and is tracked in git | Low (acceptable for a local-only default install) | **Open** — before any shared or non-local use: move to `.gitignore`, ship a `.template`, source real values from environment/secret store. See `extensions/ecm-nuxeo-studio/docs/AUDIT.md` (A9). |

This is exactly the class of issue Phase 10 (Security, `ROADMAP.md`) exists
to close before productization — tracked here so it isn't rediscovered
from scratch.

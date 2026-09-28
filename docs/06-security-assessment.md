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
| `config/nuxeo-local.properties` carried default admin credentials and a placeholder Connect token, and was tracked in git | Low (acceptable for a local-only default install) | **Fixed** — split into a tracked `config/nuxeo-local.properties.template` and a git-ignored real `config/nuxeo-local.properties`; all scripts that read it fail with a clear setup instruction if it's missing. See `extensions/ecm-nuxeo-studio/docs/AUDIT.md` (A9). |

This was exactly the class of issue Phase 10 (Security, `ROADMAP.md`)
exists to close before productization — fixed here at low cost rather than
carried forward as debt into that phase.

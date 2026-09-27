# /tests

Cross-cutting test suites (E2E, security, performance) that span more than
one component. Unit and integration tests for a given module live beside
that module's code (e.g. `extensions/ecm-nuxeo-studio/scripts/validate.sh`
and `docucentral-smoke-test.sh` already do this for the ECM extension).

Not started for the platform as a whole; will hold Playwright E2E specs,
k6 performance scripts, and OWASP ZAP configs once there's a running
frontend/API to test against (Phase 11 in `ROADMAP.md`).

# /architecture

Diagrams and architecture decision records (ADRs) — the *why* behind
structural choices, as distinct from `docs/02-architecture.md` (the
*as-found* Onfinity architecture report) and the root `ARCHITECTURE.md`
(the *target* architecture).

| ADR | Decision |
|---|---|
| [0001](./0001-api-first-boundary.md) | API-first boundary — the frontend never talks to Onfinity/PostgreSQL directly, only the Roznama API does |
| [0002](./0002-ecm-extension-pattern.md) | Extension pattern — govern an entity's lifecycle on top of the existing platform (schema + type + state machine + guards) instead of building bespoke infrastructure, as already proven by `extensions/ecm-nuxeo-studio` |

New ADRs use the format `NNNN-short-title.md`.

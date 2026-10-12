# Changelog

All notable changes to the Roznama ERP program are recorded here.

## [Unreleased]

### Added
- `architecture/0001-api-first-boundary.md` and
  `architecture/0002-ecm-extension-pattern.md` — first two ADRs, recording
  the frontend/Onfinity boundary decision and generalizing the
  lifecycle-on-existing-platform pattern already proven by the ECM
  extension.

- Repository reorganized into the Roznama ERP workspace layout: `docs/`,
  `architecture/`, `database/`, `source/`, `frontend/`, `backend/`,
  `extensions/`, `ai/`, `bi/`, `devops/`, `tests/`, `scripts/`, `backups/`.
- `docs/00-master-charter.md` — durable in-repo record of the program's
  governing rules.
- `docs/01-system-inventory.md` through `docs/10-reengineering-plan.md` —
  Phase 0/1 deliverable templates, each stating its blocking dependency.
- `docs/brand-domain-model.md` — Phase 2 conceptual domain model.
- `scripts/phase0-discovery.ps1` and `scripts/phase0-discovery.sh` —
  read-only environment discovery scripts for the Onfinity/PostgreSQL host.
- `ARCHITECTURE.md` and `ROADMAP.md` at the repo root.

### Changed
- Moved `nuxeo-studio/` → `extensions/ecm-nuxeo-studio/` (git history
  preserved via rename) to reflect its place in the target architecture as
  the ECM extension layer.
- Rewrote root `README.md` for the Roznama ERP program.
- Updated `.gitignore` for the new layout (frontend/backend build output,
  local discovery reports, backups).

### Fixed
- `extensions/ecm-nuxeo-studio` — closed both open findings from
  `docs/AUDIT.md`:
  - **A9** (default credentials tracked in git): `config/nuxeo-local.properties`
    is now generated locally via
    `cp config/nuxeo-local.properties.template config/nuxeo-local.properties`
    and is git-ignored; `check-server.sh`, `deploy.sh`,
    `docucentral-seed.sh`, and `docucentral-smoke-test.sh` all fail with a
    clear setup instruction if it's missing, instead of a raw error.
  - **A8** (`/tmp` race condition): `fetch-module.sh` now uses a
    per-invocation `mktemp -d` scratch directory instead of fixed
    `/tmp/nx_*.txt` paths.
  - Verified: `validate.sh` still passes 23/23, `check-server.sh` shows
    the correct behavior both with and without the config file present,
    and `fetch-module.sh --list` runs clean with no `/tmp` leftovers.

## Prior history (carried from before this reorganization)

- Added the DocuCentral controlled-document MVP on the existing Nuxeo
  bundle (content model, 5-state lifecycle, governance dashboard, deploy
  and validation tooling).
- Set up the local Nuxeo Studio environment with Community Cookbook
  integration, including a pre-MVP audit (`extensions/ecm-nuxeo-studio/docs/AUDIT.md`)
  that fixed several build/deploy defects before the MVP was built on top.

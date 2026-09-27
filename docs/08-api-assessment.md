# 08 — API Assessment (current state)

**Status: BLOCKED** on `docs/01-system-inventory.md` / access to the
running Onfinity application for its core API surface.

## Onfinity core

To be completed: existing API surface (if any), protocol (REST/SOAP/RPC),
authentication scheme, versioning, documentation availability,
rate limiting, pagination conventions.

## `extensions/ecm-nuxeo-studio/`

Exposes no new HTTP API of its own — it contributes scripted automation
operations (`javascript.docucentral_*`) reachable through Nuxeo's existing
REST Automation endpoint (`/nuxeo/api/v1/automation/...`), the same
mechanism the base platform already uses. This keeps the extension inside
Nuxeo's existing API surface rather than adding a parallel one, consistent
with `docs/00-master-charter.md` §7 ("prefer existing capabilities").

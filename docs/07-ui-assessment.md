# 07 — UI Assessment (current state)

**Status: BLOCKED** on `docs/01-system-inventory.md` / access to the
running Onfinity application, except for the ECM extension's UI, which is
already built and reviewed.

## Onfinity core UI

To be completed: framework in use, page inventory, navigation structure,
responsiveness, accessibility, current language support, theming
mechanism, any RTL support already present.

## `extensions/ecm-nuxeo-studio/` UI

Polymer-based Web UI elements registered into the Nuxeo Web UI (not a
separate frontend): create/edit/view layouts for controlled documents, an
actions bar gated by `DCApprove` permission, and a governance dashboard
(my queue / in review / overdue). See
`extensions/ecm-nuxeo-studio/src/main/resources/ui/docucentral/`. This UI
is Nuxeo-native and is **not** the Roznama Experience layer — it will need
its own decision (KEEP as an embedded Nuxeo Web UI surface vs. rebuild as
a Roznama-UI panel calling the ECM API) once Phase 6 (Roznama UI) starts.

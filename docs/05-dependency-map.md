# 05 — Dependency Map

**Status: BLOCKED** on `docs/01-system-inventory.md` / source access for
the Onfinity core. The ECM extension's dependencies are already known and
listed below as the template this document follows once discovery data
arrives.

## Onfinity core

To be completed: runtime dependencies, versions, license, known CVEs,
upgrade constraints, and whether each is still maintained upstream.

## `extensions/ecm-nuxeo-studio/`

| Dependency | Version | Scope | Notes |
|---|---|---|---|
| Nuxeo Platform | LTS 2021+/2023 | Runtime (external, not vendored) | Bundle deploys into an existing Nuxeo server |
| Java (build only) | OpenJDK 21 | `provided`/build | No Java source in the bundle — it packages XML/JS/HTML contributions only |
| Maven | 3.9+ | Build | Offline build after the fix logged in `AUDIT.md` (A5) |
| Nuxeo Studio Community Cookbook | modules as fetched | Design-time | `automation-script-utils`, `send-email-from-webui`, `user-group-management`, `workflow-status` currently vendored under `modules/` |

No Nuxeo platform artifacts are bundled at `provided` scope — see
`AUDIT.md` finding A5 for why that was removed (it broke offline builds).

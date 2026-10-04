# Architecture — Phase 0 / 1

## Décisions
| # | Décision | Justification |
|---|---|---|
| 1 | Monolithe modulaire, un seul PostgreSQL | Infra modeste (PMU), Docker Compose sans K8s |
| 2 | Isolation tenant par **RLS PostgreSQL** (`app.tenant_id` posé en `SET LOCAL` par transaction), `FORCE ROW LEVEL SECURITY`, rôle `ned_app` sans BYPASSRLS, FK composites `(tenant_id,id)` | Pas de dépendance au frontend ; une FK ne peut jamais croiser deux tenants |
| 3 | Noms multilingues en `jsonb {fr,ar,en}` | Aucun texte codé en dur ; l'UI utilise des catalogues i18n |
| 4 | Désagrégation en `jsonb dimensions` | Taxonomie démographique jamais imposée |
| 5 | Seuls les actuals `validated/approved/published` comptent dans le statut | Intégrité des données M&E |
| 6 | KoboToolbox intégré par API (AGPL, aucun code copié) | Ne pas reconstruire la collecte offline |
| 7 | Audit par trigger, journal en lecture seule pour `ned_app` | Traçabilité |

## Statut calculé
`achievement = (actual − baseline) / (cible − baseline)` (inversé si direction = decrease). VERT ≥ `green_min` (0,90), AMBRE ≥ `amber_min` (0,60), sinon ROUGE ; GRIS sans donnée validée. Seuils configurables par tenant.

## Feuille de route
Fait : Phase 0 (docs), Phase 1 partielle (modèle, RLS, audit, compose, CI). Suivant : API (modular monolith, Next.js/TypeScript), intégration Keycloak (OIDC → `app.tenant_id`), workflow de validation des valeurs, puis Phases 2–14.

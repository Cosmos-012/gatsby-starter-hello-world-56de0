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

## API (ned-me/api)
Fastify + TypeScript. Auth : jeton OIDC (Keycloak via JWKS en prod ; `DEV_JWT_SECRET` HS256 réservé dev/test). Claims requis : `sub`, `tenant_id` (UUID), rôles (`roles` ou `realm_access.roles`). Chaque requête ouvre une transaction avec `set_config('app.tenant_id'/'app.user_id', …, true)`. `DATABASE_URL` doit désigner un rôle non superuser membre de `ned_app`.
Workflow des valeurs : le graphe est appliqué **en base** (migration 005, avec historique et séparation des tâches : qui soumet ne peut ni valider ni approuver) et les rôles autorisés par transition côté API.

## Feuille de route
Fait : Phase 0, Phase 1 (modèle, RLS, audit, compose, CI, API de base, workflow, recherche arabe). Suivant : Phase 2 (CRUD organisations/programmes/composantes, résultats, indicateurs), frontend Next.js + i18n FR/AR/EN, puis Phases 3–14.

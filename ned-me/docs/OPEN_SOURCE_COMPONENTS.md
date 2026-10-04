# Composants Open Source — NED M&E Control Tower

> Les licences ci-dessous proviennent de ma connaissance des projets et **n'ont pas été re-vérifiées sur les dépôts** (pas d'accès réseau dédié dans cette phase). Colonne « À vérifier » = obligatoire avant toute réutilisation de code. Les versions sont des cibles, à figer au lockfile.

| Projet | Dépôt | Licence (à confirmer) | Fonction | Mode d'intégration | Modifs | Attribution / obligations | Risque sécurité | À vérifier |
|---|---|---|---|---|---|---|---|---|
| PostgreSQL 16 | postgresql.org | PostgreSQL License | Socle données, RLS | Service | Non | Notice de licence | Faible | Non |
| PostGIS 3.4 | postgis/postgis | GPL-2.0+ | SIG | Service/extension (non lié au code applicatif) | Non | Pas de redistribution modifiée | Faible | Oui |
| Keycloak 26 | keycloak/keycloak | Apache-2.0 | SSO, MFA, IAM | Service indépendant (OIDC) | Non | NOTICE | Moyen (patchs fréquents) | Non |
| MinIO | minio/minio | AGPL-3.0 | Stockage des preuves | Service indépendant via API S3 ; **alternative S3-compatible (Garage, SeaweedFS) à évaluer si l'AGPL pose problème** | Non | AGPL : ne pas modifier/redistribuer sans publier | Moyen | Oui (juridique) |
| KoboToolbox | kobotoolbox/kpi, kobocat | AGPL-3.0 | Collecte terrain offline | Service indépendant, intégration **par API uniquement** (aucun code copié) | Non | AGPL | Moyen | Oui (juridique) |
| DHIS2 | dhis2/dhis2-core | BSD-3-Clause | Référence conceptuelle (indicateurs, périodes, org units) | Inspiration ; composants UI éventuels ultérieurement | Non | BSD : conserver copyright si code réutilisé | — | Oui |
| Hikaya Activity / Indicator Library | à localiser | **Inconnue** | Référence projets/activités/KPI | Inspiration uniquement tant que licence non vérifiée | Non | — | — | **Oui, bloquant** |
| Tangerine | Tangerine-Community | GPL-3.0 (probable) | Référence offline | Inspiration uniquement (copyleft fort) | Non | — | — | Oui |
| Open Foris | openforis | Variable selon module | Référence collecte/géo | Inspiration | Non | — | — | Oui |
| Next.js / React | vercel/next.js | MIT | Frontend | Dépendance | Non | Notice MIT | Faible | Non |
| Tailwind / shadcn/ui | — | MIT | UI | Dépendance / code copié (MIT) | Non | Notice MIT | Faible | Non |
| Apache ECharts | apache/echarts | Apache-2.0 | Graphiques | Dépendance | Non | NOTICE | Faible | Non |
| MapLibre GL JS | maplibre/maplibre-gl-js | BSD-3-Clause | Cartes | Dépendance | Non | Notice BSD | Faible | Non |
| AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, presigner) | aws/aws-sdk-js-v3 | Apache-2.0 | Client S3 pour les preuves (MinIO, Garage, SeaweedFS…) | Dépendance (API S3 standard : le stockage reste interchangeable) | Non | NOTICE | Faible | Non |
| Fastify / pg / jose / zod | fastify, node-postgres, panva/jose, colinhacks/zod | MIT | API, accès DB, JWT/OIDC, validation | Dépendances | Non | Notice MIT | Faible | Non (à confirmer au lockfile) |
| Caddy | caddyserver/caddy | Apache-2.0 | Reverse proxy TLS | Service | Non | NOTICE | Faible | Non |

Règle : Hikaya, Tangerine, Open Foris restent en « inspiration » jusqu'à vérification de licence documentée ici.

# Composants Open Source — NED M&E Control Tower

> Les licences ci-dessous proviennent de ma connaissance des projets et **n'ont pas été re-vérifiées sur les dépôts** (pas d'accès réseau dédié dans cette phase). Colonne « À vérifier » = obligatoire avant toute réutilisation de code. Les versions sont des cibles, à figer au lockfile.

| Projet | Dépôt | Licence (à confirmer) | Fonction | Mode d'intégration | Modifs | Attribution / obligations | Risque sécurité | À vérifier |
|---|---|---|---|---|---|---|---|---|
| PostgreSQL 16 | postgresql.org | PostgreSQL License | Socle données, RLS | Service | Non | Notice de licence | Faible | Non |
| PostGIS 3.4 | postgis/postgis | GPL-2.0+ | SIG | Service/extension (non lié au code applicatif) | Non | Pas de redistribution modifiée | Faible | Oui |
| Keycloak 26 | keycloak/keycloak | Apache-2.0 | SSO, MFA, IAM | Service indépendant (OIDC) | Non | NOTICE | Moyen (patchs fréquents) | Non |
| SeaweedFS 4.48 | seaweedfs/seaweedfs | Apache-2.0 | Stockage S3 des preuves (par défaut) | Service indépendant, API S3 standard ; bucket créé par l'API au démarrage | Non | NOTICE Apache | Moyen (service exposé : hôte dédié via Caddy) | Non |
| MinIO | minio/minio | AGPL-3.0 | **Retiré de la pile par défaut** : l'image `minio/minio` n'est plus téléchargeable sur Docker Hub (constaté en CI le 2026-10-04). Reste utilisable comme stockage S3 externe | — | — | AGPL | — | — |
| KoboToolbox | kobotoolbox/kpi, kobocat | AGPL-3.0 | Collecte terrain offline | Service indépendant, intégration **par API uniquement** (aucun code copié) | Non | AGPL | Moyen | Oui (juridique) |
| DHIS2 | dhis2/dhis2-core | BSD-3-Clause | Référence conceptuelle (indicateurs, périodes, org units) | Inspiration ; composants UI éventuels ultérieurement | Non | BSD : conserver copyright si code réutilisé | — | Oui |
| Hikaya Activity / Indicator Library | à localiser | **Inconnue** | Référence projets/activités/KPI | Inspiration uniquement tant que licence non vérifiée | Non | — | — | **Oui, bloquant** |
| Tangerine | Tangerine-Community | GPL-3.0 (probable) | Référence offline | Inspiration uniquement (copyleft fort) | Non | — | — | Oui |
| Open Foris | openforis | Variable selon module | Référence collecte/géo | Inspiration | Non | — | — | Oui |
| Next.js 16 / React 19 | vercel/next.js, facebook/react | MIT | Interface (rendu serveur, sortie autonome) | Dépendance | Non | Notice MIT | Faible | Non |
| Tailwind CSS 4 | tailwindlabs/tailwindcss | MIT | Styles (propriétés logiques pour le RTL) | Dépendance | Non | Notice MIT | Faible | Non |
| Playwright 1.63 | microsoft/playwright | Apache-2.0 | Tests de bout en bout (Chromium) | Dépendance de développement | Non | NOTICE | Faible | Non |
| Tailwind / shadcn/ui | — | MIT | UI | Dépendance / code copié (MIT) | Non | Notice MIT | Faible | Non |
| Apache ECharts | apache/echarts | Apache-2.0 | Graphiques | Dépendance | Non | NOTICE | Faible | Non |
| MapLibre GL JS | maplibre/maplibre-gl-js | BSD-3-Clause | Cartes | Dépendance | Non | Notice BSD | Faible | Non |
| AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, presigner) | aws/aws-sdk-js-v3 | Apache-2.0 | Client S3 pour les preuves (MinIO, Garage, SeaweedFS…) | Dépendance (API S3 standard : le stockage reste interchangeable) | Non | NOTICE | Faible | Non |
| Fastify / pg / jose / zod | fastify, node-postgres, panva/jose, colinhacks/zod | MIT | API, accès DB, JWT/OIDC, validation | Dépendances | Non | Notice MIT | Faible | Non (à confirmer au lockfile) |
| @fastify/helmet, @fastify/rate-limit | fastify/fastify-helmet, fastify/fastify-rate-limit | MIT | En-têtes de sécurité, limitation de débit par IP | Dépendances | Non | Notice MIT | Faible | Non |
| ExcelJS | exceljs/exceljs | MIT | Export Excel des rapports (RTL, bilingue) | Dépendance ; `overrides` uuid ≥ 11.1.1 (avis GHSA-w5hq-g745-h8pq) | Non | Notice MIT | Faible (0 vulnérabilité après override) | Non |
| Apache Superset 6.1.0 | apache/superset | Apache-2.0 | **Optionnel** : analyse libre sur les vues `bi` (voir `docs/BI.md`) | Service indépendant, jamais dans la pile par défaut ; non redistribué | Non | NOTICE Apache | Moyen : installation par défaut cassée (dépendances non déclarées), consommation ≈ 650 Mo, accès SQL à encadrer par la base | Oui : image Docker non testée |
| Caddy | caddyserver/caddy | Apache-2.0 | Reverse proxy TLS | Service | Non | NOTICE | Faible | Non |

Note : le stockage par défaut étant désormais SeaweedFS (Apache-2.0), la question AGPL ne concerne plus que KoboToolbox (intégration par API, sans code copié).

Règle : Hikaya, Tangerine, Open Foris restent en « inspiration » jusqu'à vérification de licence documentée ici.

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

## DQA (migration 006, `api/src/dqa.ts`)
Moteur pur et déterministe (`asOf` fourni) : validité (bornes), exactitude (variation relative), complétude (trous), ponctualité (retards après délai de grâce), cohérence (cible manquante, somme des tranches = total pour les comptages), fiabilité (source, vérification, valeurs répétées). Score = 1 − contrôles échoués / contrôles effectués. `POST /dqa/run` est idempotent : une anomalie réapparue est rouverte, une anomalie disparue est clôturée par `system`, une dérogation humaine (`waived`) est conservée. Clore exige une action corrective (contrainte en base) ; la dérogation est réservée aux managers.

## Preuves (migration 007, `api/src/evidence.ts`, `api/src/storage.ts`)
Fichiers hors base, derrière l'interface `Storage` (API S3). Flux : `POST /evidence` crée la preuve `pending` et renvoie une URL de téléversement présignée ; le client téléverse ; `POST /evidence/:id/complete` vérifie que l'objet existe et que sa taille égale celle déclarée avant de passer à `available`. Clé = `<tenant>/<uuid>/<nom assaini>`, jamais fournie par le client ; types MIME en liste blanche ; 25 Mo max ; pas de suppression (DELETE révoqué). Chaîne : `GET /indicator-values/:id/chain` → preuves → donnée → indicateur → output → outcome → impact → projet. L'adaptateur S3 n'est pas testé contre un vrai serveur (pas de Docker ici).

## Évaluations (migration 008, `api/src/evaluations.ts`)
Évaluation (baseline, mid-term, end-term, impact, outcome, process, thematic, rapid) → questions → constats → recommandations → réponse du management → actions → clôture. Règles **en base** : pas d'action sans réponse ; une recommandation rejetée (motif obligatoire) ne porte aucune action et se clôture directement ; une recommandation acceptée ne se clôture qu'avec au moins une action réalisée et aucune ouverte ; une recommandation close est figée ; une évaluation ne se termine pas sans constat. Une action a un responsable et une échéance obligatoires ; elle est exécutée par le responsable désigné ou un manager (seul un manager peut l'annuler). `GET /recommendations/follow-up` : sans réponse, actions en retard (jours de retard), taux de clôture.

## MEAL (migration 009, `api/src/meal.ts`)
**Accountability** : retours, plaintes, réclamations, suggestions, satisfaction (1–5). Accusé de réception sous 2 jours ; résolution sous 3/7/14/30 jours selon la gravité (critique/haute/moyenne/basse). Workflow `received → acknowledged → investigating ⇄ escalated → resolved → closed`, historique complet des événements, clôture réservée aux managers avec la satisfaction du plaignant pour une plainte. **Confidentialité imposée par PostgreSQL** : les signalements sensibles (protection, abus ; gravité relevée à « high » minimum) sont invisibles aux non-managers via une politique RLS fondée sur `app.roles`, y compris dans les agrégats ; le contact du plaignant est masqué aux non-managers ; un signalement anonyme ne peut pas porter de contact. **Apprentissage** : leçons, bonnes pratiques, difficultés, adaptations (décision obligatoire), draft → validated → published ; l'auteur ne valide pas sa propre leçon (base), publication par manager. `GET /meal/summary` alimente le dashboard MEAL.

## Premier écran (`api/src/dashboard.ts`)
`GET /dashboard/overview?project_id&as_of` : performance globale (moyenne des taux d'atteinte plafonnés à [0,1] sur les indicateurs ayant des données validées ; `null` sans donnée, jamais de zéro inventé) et couverture, statuts, performance par niveau de résultat, qualité des données, évaluations/recommandations, accountability, apprentissage, alertes. Chaque bloc cite l'endpoint source (`source`) pour la traçabilité, et les chiffres réutilisent exactement les fonctions de ces endpoints. Les alertes sont des clés i18n (`type`) + paramètres, triées critique d'abord. Les modules pas encore construits sont listés dans `not_available` (activités, risques, finance, achats). Les compteurs de feedback respectent la RLS : un relecteur ne voit pas les signalements sensibles.

## Rapports (migration 010, `api/src/reports.ts`, `report-content.ts`, `report-render.ts`, `i18n.ts`)
`POST /reports` génère un **instantané immuable** (contenu JSON + empreinte SHA-256 du JSON canonique) à partir des mêmes fonctions que le tableau de bord, du suivi, du DQA et des recommandations : le moteur ne calcule aucun chiffre, il recopie, et chaque chiffre porte son `source` et son `as_of`. Types : mensuel, trimestriel, semestriel, annuel, bailleur, gouvernemental, exécutif, S&E, MEAL, indicateurs, DQA, évaluation (composition par type). La période borne les valeurs réelles prises en compte (`period_end`). Régénérer crée une nouvelle version ; le contenu ne peut pas être modifié (déclencheur) et l'API refuse d'exporter un contenu dont l'empreinte ne correspond plus (`/verify`, export 409). Workflow Draft→…→Archived commun aux valeurs, l'auteur ne valide ni n'approuve son rapport (base), historique en ajout seul ; brouillons visibles des seuls rôles de revue. Exports : JSON, Excel (RTL si arabe, libellé bilingue, source par chiffre, cellules toujours en texte), HTML (échappé, CSP restrictive, `dir=rtl`). Libellés fr/ar/en dans `i18n.ts`. **PDF, Word et PowerPoint ne sont pas encore générés.**
**Journal des événements** : le commentaire d'une transition est transmis au déclencheur via `app.comment` ; les journaux n'ont aucun droit UPDATE.

## Feuille de route
Fait : Phase 0, Phase 1 (modèle, RLS, audit, compose, CI, API de base, workflow, recherche arabe). Suivant : Phase 2 (CRUD organisations/programmes/composantes, résultats, indicateurs), frontend Next.js + i18n FR/AR/EN, puis Phases 3–14.

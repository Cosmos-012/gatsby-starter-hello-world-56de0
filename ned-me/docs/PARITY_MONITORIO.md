# Matrice de correspondance avec Monitorio

**Source et limites.** Cette matrice s'appuie sur *un seul document* : « La structure architecturale adoptée pour la plateforme Monitorio — M&E / MEAL » (analyse écrite dans une session précédente, 20 octobre 2026). Ce document déclare lui-même que le code serveur et les politiques RLS de Monitorio n'ont **pas** été ouverts et que ses chiffres (≈ 67 tables, 25 fonctions, 12 modules, « ≈ 70 % du cycle M&E ») sont des estimations. Je n'ai pas pu consulter `monitorio.fr` (accès réseau refusé depuis l'environnement). Ce qui suit compare donc **NED à ce document**, pas à Monitorio vérifiée. Les captures et la lecture de Grok n'ont pas été reçues.

## 1. Les 12 modules par projet décrits dans le document

| Module décrit | NED aujourd'hui | État |
|---|---|---|
| Pilotage / synthèse exécutive (résumé généré par IA) | Tableau de bord `/dashboard/overview` avec alertes déterministes et sources citées ; **pas de résumé IA** | Partiel |
| Cadre logique | Résultats en arbre (impact › effet › produit › activité) | Fait |
| Chaîne de résultats versionnée (CRI : versions, nœuds, liens, règles d'alerte, journal) | Arbre sans versions, sans liens d'hypothèse/risque par arête, sans règles d'alerte configurables | Prévu |
| Indicateurs (cibles, mesures, ventilations, prévisions) | Fait : cibles/réalisés, ventilations par dimensions, prévision linéaire, statut RAG | Fait |
| Plan S&E / collecte (formulaires, campagnes, Kobo) | Import CSV/XLSX seulement ; ni formulaires, ni campagnes, ni Kobo, ni hors ligne | Partiel |
| Budget | Non construit (module annoncé « pas encore disponible ») | Prévu |
| Documents / analyse IA / chat IA (RAG, embeddings) | Preuves chaînées (stockage S3, empreinte) ; **aucune IA** | Prévu |
| Rapports (blocs, versions, modèles bailleurs) | Rapports en instantanés immuables, versions, workflow, exports JSON/Excel/HTML ; pas de modèles bailleurs, pas de PDF/Word/PPT | Partiel |
| Équipe / permissions | 5 rôles + séparation des tâches imposée par la base | Partiel |
| Superadmin / quotas IA | Aucun (multi-client par RLS, pas de console superadmin) | Prévu |

## 2. Les 10 principes et les lacunes critiques du document

| Point du document | NED | État |
|---|---|---|
| Organisation › Programme › Projet | `organisation`, `program`, `project` | Fait |
| Bailleurs et monnaies (taux de change) | Type d'organisation « bailleur » seulement ; pas de monnaies ni de taux | Prévu |
| Bibliothèque d'indicateurs de référence (fiches PIRS, ODD, IATI) | **Ajouté dans ce lot** : fiches par client, copie instantanée à la création, ODD/IATI, retrait sans effet rétroactif | Fait |
| **Sens de l'indicateur** (exemple cité : chômage 21,6 % pour une cible de 20 % affiché « 108 % — en bonne voie ») | Calcul unique côté serveur avec sens `increase/decrease` ; test : base 25, cible 20, réalisé 21,6 → **68 %, À surveiller** | Fait (testé) |
| Moteur de calcul unique, pas de calcul dans l'interface | Calculs dans l'API/SQL ; l'interface n'affiche que | Fait |
| Redevabilité (CFM) : canaux, délais, cas sensibles isolés | Retours/plaintes, délais d'accusé et de résolution, cas sensibles masqués par RLS ; canaux SMS/WhatsApp : non | Partiel |
| Registre des risques | Fait (+ problèmes, escalade) | Fait |
| Géographie (GIS) | Migration PostGIS écrite ; pas d'interface carte | Prévu |
| Évaluations (critères OCDE-CAD, réponse du management) | Évaluations, constats, recommandations, réponse du management, actions ; **sans notation par critère CAD** | Partiel |
| Apprentissage (leçons, AAR) | Leçons et pratiques | Partiel |
| Qualité des données (5 dimensions USAID) | Règles + scores ; dimensions NED : exactitude, complétude, cohérence, ponctualité, validité, fiabilité | Fait (autre grille) |
| Parcours de validation soumis › vérifié › approuvé | 7 états, rôles par transition, séparation des tâches | Fait |
| Export IATI 2.03, API OpenAPI 3.1 | Aucun des deux | Prévu |
| Hors ligne (PWA, synchronisation différée) | Non | Prévu |
| IA responsable (sources citées, humain dans la boucle, journal) | Non construit ; conçu dans `ROADMAP.md` | Prévu |
| RLS sur toutes les tables, audit non modifiable, MFA, SSO | RLS forcée + tests hostiles, audit en ajout seul, SSO Keycloak ; MFA à activer | Fait |
| Analytique en étoile (fact/dim) pour BI | Vues `bi.*` + Superset ; pas de schéma en étoile | Partiel |
| Événements de domaine / outbox | Non | Prévu |
| Rôles : Org Admin, Programme, Chef de projet, M&E Officer, Enquêteur, Point focal CFM, Bailleur, Évaluateur externe | `admin`, `me_manager`, `data_entry`, `reviewer`, `viewer` : **pas** de bailleur « valeurs approuvées seulement », ni d'évaluateur temporaire, ni de point focal CFM, ni d'enquêteur limité à ses formulaires | Prévu |
| Isolation par client (RLS + projet dédié pour la souveraineté) | RLS ; déploiement dédié possible (Compose) | Fait |

## 3. Où NED est en avance sur ce que décrit le document
- Séparation des tâches, workflow et journal d'audit **imposés par la base**, pas par l'interface.
- Isolation par client testée de façon hostile (y compris un analyste BI avec SQL libre), avec mutations qui doivent faire échouer le test.
- Import en lot « tout ou rien » qui n'entre qu'en brouillon.
- Configuration par projet (modules, widgets, libellés, champs, six modèles).
- Trois langues dont l'arabe en RTL, avec accords de pluriel.

## 4. Ordre de comblement proposé (du plus rentable au plus lourd)
1. Rôles manquants (bailleur lecture publiée, évaluateur temporaire, point focal CFM) : sécurité, petit.
2. Critères OCDE-CAD sur les évaluations ; notation par critère.
3. Bailleurs, monnaies et taux de change, puis budget lié aux résultats.
4. Export IATI 2.03 et spécification OpenAPI.
5. Collecte (formulaires, campagnes, Kobo/ODK), hors ligne.
6. IA (résumé exécutif, questions sur les données) après décision sur la souveraineté.

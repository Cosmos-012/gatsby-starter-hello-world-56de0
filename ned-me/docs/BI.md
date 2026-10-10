# Accès BI (Apache Superset et outils équivalents)

**Verdict.** Superset (Apache-2.0, version 6.1.0 essayée) peut servir d'**option d'analyse libre** pour des analystes, branché sur des vues dédiées. Il ne doit **pas** être le tableau de bord de décision : celui-ci reste l'écran NED (chiffres traçables, workflow, FR/AR/EN). Il n'est **pas** dans la pile Docker par défaut.

## Pourquoi un schéma `bi` et pas un accès aux tables

L'isolation de l'API repose sur un paramètre de session (`app.tenant_id`). **Un rôle qui peut exécuter du SQL libre le modifie lui-même et lit un autre tenant** (démontré : un rôle fixé au tenant A, après `SET app.tenant_id = <B>`, lit les données de B). L'API est sûre car elle n'expose aucun SQL ; l'éditeur SQL d'un outil BI en expose.

Mesure retenue (migration `012_bi_access.sql`) :
- un compte BI **n'a aucun droit sur les tables** ; il lit 11 vues du schéma `bi` (projets, résultats, indicateurs, valeurs **validées**, progression, risques, problèmes, retours **sans texte ni contact ni signalements sensibles**, recommandations, anomalies DQA, leçons **publiées**) ;
- le tenant est lié à l'**identité de connexion** (`session_user`, inchangeable par `SET`) via la table `bi_account` ;
- vues à `security_barrier` (une fonction piégée de l'analyste n'est jamais évaluée sur des lignes d'un autre tenant) ;
- compte sans correspondance de tenant : **0 ligne** (échec fermé) ; lecture seule, requêtes limitées à 30 s, 5 connexions.
- La lecture seule par défaut n'est **pas** une protection (l'utilisateur peut la désactiver) : seuls les privilèges comptent. Le test l'attaque donc en la désactivant d'abord.

## Créer un compte

```
PGDATABASE=ned deploy/bi-account.sh <tenant_uuid> <suffixe>    # rôle bi_<suffixe>, mot de passe aléatoire affiché une fois
```
Un compte = un tenant : une source de données Superset **par tenant**. Supprimer : `SELECT app.drop_bi_account('bi_x')` (retire aussi la correspondance ; une correspondance orpheline serait héritée par un rôle recréé).

## Réglages Superset exigés

`allow_dml` désactivé ; schéma exposé : `bi` uniquement ; pas d'import CSV/Excel ; métadonnées sur **PostgreSQL** (pas SQLite) ; accès administrateur Superset réservé à l'exploitation (un administrateur peut créer une source avec un compte plus privilégié : la protection porte sur le **compte de la source**, pas sur Superset).

## Essai réel (Superset 6.1.0, PostgreSQL 16, Python 3.11)

| Point | Résultat |
|---|---|
| Éditeur SQL, source « tenant A » | voit seulement A ; tables, `bi_account`, usurpation de compte : refusés par PostgreSQL ; `SET app.tenant_id` : sans effet |
| Graphique par jeu de données | A : 2 GRIS + 2 ROUGE ; B : 1 VERT — identique à la vérité terrain |
| Mémoire | 571 Mo au repos, 649 Mo après usage (2 processus de travail, **sans** Redis ni Celery) |
| Disque | environnement Python 824 Mo + 99 Mo de ressources web |
| Latence d'un graphique | 0,10 s (très petites données : **non représentatif**) |
| Arabe | 3 935 / 4 571 libellés traduits (86 %) ; **disposition de gauche à droite, non inversée**, restes d'anglais |

**Défauts d'installation constatés** (à connaître avant tout déploiement) : `pip install apache-superset` donne une installation **inutilisable** : dépendances non déclarées (`rich`, `cachetools`) et `flask-caching` ≥ 2.4 incompatible (il faut `<2.4`). Le message d'erreur est trompeur (« driver introuvable » alors que le driver est présent). Avec SQLite comme base de métadonnées, un nom de table unique « toutes bases confondues » empêche deux sources de définir le même jeu de données.

**Non testé** : intégration par jeton invité / SDK d'intégration, requêtes asynchrones (Redis + Celery), gros volumes, filtres de tableaux de bord, image Docker officielle, haute disponibilité. Aucun service Superset n'est donc fourni dans `docker-compose.yml`.

## Tests

`db/tests/bi_test.sh` (16 groupes, CI) joue un analyste malveillant : changement de tenant, accès direct aux tables, usurpation de rôle, fonction piégée, écriture, création de compte, lecture de **chaque** vue par chaque compte, comparaison de `bi.indicator_progress` à la vue de l'API. `BI_TEST_MUTATION=no_barrier|no_app_usage` retire une protection : le test **doit échouer**, ce que la CI vérifie.

# Feuille de route : de la base actuelle à la plateforme complète

État réel au dernier commit. « Fait » = construit **et** testé ; « Prévu » = conçu, pas construit. Rien ici n'est annoncé comme fonctionnel s'il ne l'est pas.

| Domaine | État | Remarque |
|---|---|---|
| Cadre de résultats, indicateurs, valeurs, workflow à 7 états, séparation des tâches | Fait | imposé par la base |
| Bibliothèque d'indicateurs de référence (fiches PIRS, ODD, IATI) | Fait | créer un indicateur depuis une fiche ; copie instantanée |
| Qualité des données (règles, scores), preuves (stockage S3), évaluations et recommandations, redevabilité (plaintes, SLA), apprentissage, risques et problèmes | Fait | API + tableau de bord |
| Rapports traçables (JSON, Excel, HTML ; instantanés immuables) | Fait | PDF/Word/PPT : prévu |
| Multi-clients (RLS), SSO Keycloak (code + PKCE), audit | Fait | MFA à activer dans Keycloak |
| BI externe (Superset, comptes lecture seule par client) | Fait | |
| Configuration par projet (modules, widgets, libellés, champs, six modèles) | Fait | `CUSTOMIZATION.md` |
| Pages : tableau de bord, indicateurs (liste + fiche + saisie), configuration, **import CSV/XLSX** | Fait | fr / en / ar |
| Import en lot : aperçu sans écriture, tout-ou-rien, brouillons, pas d'écrasement | Fait | |
| Collecte de terrain (Kobo/ODK, formulaires, hors ligne) | Prévu | licence AGPL de KoboToolbox : décision à prendre |
| Intégrations (DHIS2, Kobo, webhooks entrants/sortants, API publique documentée) | Prévu | |
| Temps réel (flux d'événements vers l'interface, notifications) | Prévu | |
| Analyse avancée (anomalies, ventilations, comparaisons, prévisions multi-indicateurs) | Prévu | méthodes statistiques déterministes d'abord, expliquables |
| Assistant IA sur données réelles | Prévu | voir « Décisions » |
| Cartographie (PostGIS + MapLibre) | Prévu | |
| Activités, finance, passation de marchés | Prévu | affichés « pas encore disponibles », jamais en zéros |
| Données de démonstration réalistes | Prévu | jeux **synthétiques**, marqués comme tels |

## Ordre proposé
1. **Analyse avancée déterministe** : détection d'anomalies (écart robuste à la médiane, valeurs hors saison), comparaisons entre périodes et ventilations, fraîcheur des données. Chaque résultat cite sa source et sa méthode. C'est aussi la boîte à outils de l'assistant.
2. **Temps réel** : flux d'événements (valeur soumise, validée, alerte) vers l'interface.
3. **Intégrations** : webhooks signés (entrants/sortants), puis connecteurs DHIS2 et Kobo/ODK.
4. **Assistant IA** : appels d'outils en lecture seule sur l'API (même droits que l'utilisateur, même client), questions → requêtes bornées → réponse avec sources ; aucune écriture, aucune donnée personnelle sensible, journal de chaque appel.
5. Cartographie, rapports PDF/Word/PPT, jeux de démonstration synthétiques par secteur.

## Décisions qui vous reviennent
- **Fournisseur IA et souveraineté des données.** Un modèle hébergé par un tiers reçoit les extraits de données qu'on lui envoie ; pour des projets gouvernementaux c'est souvent inacceptable. Options : (a) modèle ouvert hébergé chez vous (Ollama/vLLM) : données internes, qualité moindre ; (b) API d'un fournisseur avec minimisation (agrégats seulement, jamais de données individuelles) et contrat adapté ; (c) les deux, au choix du client. Recommandation : (c), avec (b) limité aux agrégats.
- **KoboToolbox (AGPL-3.0)** : l'utiliser comme service séparé via son API ne contamine pas notre code ; l'embarquer ou le modifier, si.
- **Données « réelles du terrain »** : la plateforme n'a aucune donnée réelle ; les exemples de démonstration seront synthétiques et étiquetés. Pour des données réelles de projets, il faut les fournir (et leur cadre juridique).

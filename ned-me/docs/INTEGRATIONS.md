# Intégrations : comment en ajouter une

## Le principe
Une intégration (Kobo/ODK, DHIS2, tableur en ligne, ERP…) est un **connecteur** : un objet qui lit une source externe et rend des lignes au format de l'import (`indicator_code, period, period_end, kind, value, comment, dim_*`). Tout le reste est commun et déjà testé (`api/src/connectors/index.ts`, `api/src/imports.ts`) :

| Garantie | Où |
|---|---|
| Chaque ligne est jugée : indicateur connu du projet, date réelle, nombre valide, nature, doublon dans le lot, clé déjà en base | `judge()` |
| Tout ou rien : une ligne en erreur, rien n'est écrit | `runConnector` |
| Les valeurs entrent **en brouillon** ; elles suivent ensuite le workflow normal avec séparation des tâches | `insertDrafts` |
| Jamais d'écrasement d'une valeur existante | clé unique + contrôle |
| Reste dans le client (tenant) de l'appelant, sous RLS | `withTenant` |
| Journal : la source est inscrite (`connector:<id>`) | `insertDrafts` |

Un connecteur ne peut donc ni valider une valeur, ni en écraser une, ni sortir de son client.

## Écrire un connecteur
```ts
import { z } from 'zod';
import { registerConnector } from './connectors/index.ts';

registerConnector({
  id: 'kobo',
  label: { fr: 'KoboToolbox', en: 'KoboToolbox', ar: 'كوبو' },
  config: z.object({ server: z.string().url(), formId: z.string(), token: z.string() }).strict(),
  async pull(cfg, { signal }) {
    const r = await fetch(`${cfg.server}/api/v2/assets/${cfg.formId}/data/?format=json`, { headers: { authorization: `Token ${cfg.token}` }, signal });
    if (!r.ok) throw new Error(`Kobo a répondu ${r.status}`);
    const { results } = await r.json();
    return results.map((s: any, i: number) => ({ line: i + 1, cells: { /* correspondance des champs du formulaire → colonnes d'import */ } }));
  },
});
```
Puis `await runConnector(pool, principal, 'kobo', config, projectId)` rend `ok`, `has_errors` (avec les lignes et leurs erreurs) ou `failed` (source injoignable, configuration invalide, trop de lignes, projet inconnu).

## Règles à respecter pour un vrai connecteur
- **Aucune ligne devinée** : si un champ manque ou n'est pas un nombre, laisser la cellule vide ; le jugement la refusera avec un message précis.
- **Sortie réseau** : n'appeler que l'hôte de la configuration validée, jamais une URL fournie par la source (risque SSRF) ; borner le temps (le signal d'annulation est fourni) et la taille.
- **Secrets** (jetons) : ne pas les écrire en clair dans la base ni dans les journaux.
- **Correspondance** : documenter, par connecteur, comment les champs de la source deviennent `indicator_code`, `period`, `kind`, `dim_*`.
- Écrire un test avec une source simulée, comme `api/test/connectors.test.ts`.

## Ce qui n'existe pas encore (à construire avec le premier vrai connecteur)
- Aucun connecteur réel : Kobo/ODK, DHIS2 et les autres ne sont **pas** livrés ; seul le point d'extension et sa garde de qualité le sont.
- Pas d'interface « Intégrations » (choix du connecteur, saisie de la configuration, lancement, rapport) : `runConnector` n'est pas encore exposé par une route.
- Pas de stockage chiffré des secrets ni de configuration persistée par client.
- Pas de planification (synchronisation périodique) ni de réception en direct (webhooks signés).
- Un connecteur ne remonte que des **valeurs d'indicateurs** ; pas encore de dimensions de ventilation obligatoires, de preuves jointes ni de résultats d'évaluation.
- Décision à prendre : KoboToolbox est sous AGPL-3.0 ; l'appeler par son API comme service séparé n'impose rien à notre code.


## Exécution depuis l'interface
La page `/[locale]/integrations` est générée à partir de `GET /integrations` (descripteurs de formulaire des connecteurs enregistrés) ; l'exécution passe par `POST /integrations/:id/run`. Le jeton saisi ne sert qu'à l'appel : il n'est ni stocké, ni journalisé, ni renvoyé au navigateur (vérifié par test de bout en bout). Le chemin de succès est couvert par les tests d'API avec un serveur Kobo simulé ; il n'a pas encore été essayé contre un vrai serveur KoboToolbox.

## Données de démonstration
`db/seed/demo.sql` crée trois projets entièrement synthétiques (éducation, santé, eau) ; `./preview.sh start` les charge (`PREVIEW_DEMO=0` pour les omettre). Ne jamais charger en production.

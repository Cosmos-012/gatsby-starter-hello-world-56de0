# Adapter la plateforme à la nature d'un projet

Un seul schéma et un seul code pour tous les projets. Ce qui change (santé, éducation, infrastructure, humanitaire, agriculture…) est une **configuration par projet**, enregistrée en base (`project_config`), versionnée et auditée.

| Ce qu'on adapte | Où | Garde-fous |
|---|---|---|
| Modules actifs | page *Configuration* ou `PUT /projects/:id/config` | cadre de résultats et indicateurs toujours actifs ; un module annoncé mais non construit est affiché « pas encore disponible », jamais comme zéro |
| Éléments du tableau de bord (ordre, visibilité) | idem | un élément disparaît avec son module |
| Libellés des niveaux de résultats (fr/en/ar) | idem | vide = libellé standard |
| Champs personnalisés des indicateurs (texte, nombre, liste, date, oui/non) | idem | valeurs validées à la création (type, liste, requis, date réelle, clé inconnue refusée) ; un champ qui contient déjà des valeurs ne peut pas être retiré |
| Modèle de départ | `POST /projects/:id/config/apply-template` | remplace le bloc ; refusé si des valeurs de champs disparaîtraient |

**Modèles livrés** : générique, santé, éducation, infrastructure, humanitaire, agriculture. Ce sont des *structures* (libellés, champs, modules suggérés) : aucun chiffre, aucune cible, aucune donnée d'exemple. À adapter ensuite.

**Concurrence** : chaque enregistrement envoie la version lue ; si quelqu'un a modifié entre-temps, l'API répond 409 et rien n'est écrasé.

**Droits** : lecture pour tous les rôles ; écriture pour `admin` et `me_manager`.

## Pas encore couvert
- Seuils de statut (vert/orange/rouge) configurables par projet (aujourd'hui valeurs communes).
- Workflows de validation personnalisés, formulaires de collecte, modèles de rapports par projet.
- Modèles propres à une organisation (créer un modèle depuis un projet existant) : aujourd'hui les six modèles sont livrés avec le produit.
- Les champs personnalisés ne sont pas encore affichés dans un tableau d'indicateurs (il n'existe pas encore de page Indicateurs) : ils sont stockés, validés et renvoyés par l'API.

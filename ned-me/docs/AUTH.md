# Connexion des utilisateurs (Keycloak / OIDC)

**Flux** : code d'autorisation + PKCE (S256), côté serveur de l'interface web. Le navigateur ne voit jamais le jeton d'accès.

| Élément | Choix | Pourquoi |
|---|---|---|
| Routes web | `/sso/login`, `/sso/callback`, `/sso/logout` (POST) | `/auth/*` est réservé à Keycloak derrière Caddy |
| Session | cookie `ned_s*` httpOnly, SameSite=Lax, `Secure` si `PUBLIC_URL` est en https, chiffré (JWE A256GCM, clé dérivée de `SESSION_SECRET`), découpé en morceaux de 3,5 Ko | un jeton Keycloak chiffré dépasse la limite d'un cookie ; pas de base de sessions à exploiter |
| Vérifications | `state`, `nonce`, PKCE, signature + `iss` + `aud` du jeton d'identité (JWKS), à usage unique | |
| Retour après connexion | seulement un chemin local `/<langue>…` | pas de redirection ouverte |
| Déconnexion | POST avec contrôle de l'en-tête `Origin`, puis fermeture de la session Keycloak | un site tiers ne peut pas déconnecter l'utilisateur |
| Autorisation | l'API vérifie le jeton (JWKS, `iss`), lit `tenant_id` et les rôles du royaume ; la base applique RLS | l'interface ne décide de rien |

## Royaume
`deploy/keycloak/realm-ned.json` : client confidentiel `ned-web` (PKCE obligatoire), mappeur de l'attribut utilisateur `tenant_id` vers la revendication du même nom, rôles `viewer/editor/validator/admin`. **Aucun utilisateur ni mot de passe livré.** Avant la production : changer le secret du client, ajouter l'URL publique dans `redirectUris`, créer les utilisateurs avec leur attribut `tenant_id`.
Un utilisateur sans `tenant_id` valide est refusé par l'API (401).

## Limites connues
- Pas de renouvellement automatique du jeton : à l'expiration (15 min par défaut dans le royaume livré) l'interface propose « Se connecter » ; tant que la session Keycloak est vivante, le retour est immédiat, sans nouvelle saisie.
- Le jeton n'est pas lié au navigateur (pas de DPoP) : quiconque vole le cookie chiffré ET `SESSION_SECRET` peut le rejouer jusqu'à expiration.
- Testé contre Keycloak 26.0.8 lancé depuis le tarball officiel (`web/e2e/run.sh` avec `E2E_OIDC_ISSUER`, en CI). La configuration Compose (`KC_HTTP_RELATIVE_PATH=/auth`, proxy Caddy, `KC_HOSTNAME`) n'a pas été exécutée de bout en bout : le démon Docker n'est pas disponible dans l'environnement de développement.
- MFA : à activer dans Keycloak (flux d'authentification du royaume) ; non configuré par défaut.

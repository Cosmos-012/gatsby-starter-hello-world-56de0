# NED M&E Control Tower
Plateforme S&E/MEAL open source. Voir `docs/ARCHITECTURE.md` et `docs/OPEN_SOURCE_COMPONENTS.md`. Connexion : `docs/AUTH.md`. BI : `docs/BI.md`.

| Dossier | Contenu | Tests |
|---|---|---|
| `db/` | migrations PostgreSQL (RLS multi-tenant), graine e2e | `db/tests/run.sh`, `db/tests/backup_restore.sh` |
| `api/` | API Fastify/TypeScript | `npm test` (`S3_TEST_ENDPOINT` active les tests S3 réels) |
| `web/` | Interface Next.js FR/AR/EN | `npm test`, `e2e/run.sh` (`PW_CHROMIUM` pour un Chromium local) |
| `deploy/` | Docker Compose, Caddy, sauvegarde/restauration, test de fumée | CI : pile réelle |

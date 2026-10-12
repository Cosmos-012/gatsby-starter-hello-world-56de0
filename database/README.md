# /database

Schema maps, ER diagrams, and migration scripts for the Onfinity
PostgreSQL database.

Rules (see `docs/00-master-charter.md` §1):
- No destructive migration is written or run without a verified backup
  referenced in `docs/01-system-inventory.md`.
- Every migration here is reviewed and reversible (a paired down-migration
  or a documented manual rollback).

Empty until Phase 1 discovery (`docs/03-database-map.md`) is complete.

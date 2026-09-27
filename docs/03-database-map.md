# 03 — Database Map (current state)

**Status: BLOCKED** on `docs/01-system-inventory.md` (need the DB name,
user, and connection details first) and read access to the schema.

## To be completed

- Full table list with row-count order of magnitude
- Views
- Functions / stored procedures
- Triggers
- Indexes (especially any missing on foreign keys — common Onfinity pain
  point to verify, not assume)
- Foreign key relationships (ER diagram under `/architecture`)
- Naming conventions in use
- Schemas/namespaces
- Any denormalization or generated/materialized data
- Data volume and growth rate, if determinable

## Safety note

This map is produced by **read-only** inspection
(`information_schema`, `pg_catalog`, `\d+` in `psql`, or a schema-diff
tool). No `ALTER`, `DROP`, or data-modifying statement is run against the
Onfinity database as part of this phase. A verified backup must exist
before any later phase touches the schema (see
`docs/01-system-inventory.md` sign-off).

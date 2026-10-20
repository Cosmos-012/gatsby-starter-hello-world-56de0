import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../db/migrations/', import.meta.url);
/** Toutes les migrations, dans l'ordre, sauf 003 (PostGIS, absent des bases de test locales). Une seule source : plus de liste à tenir à jour. */
export function allMigrations(): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('003_')).sort().map((f) => readFileSync(new URL(f, dir), 'utf8'));
}

import pg from 'pg';
import type { Principal } from './auth.ts';

export function makePool(connectionString: string) {
  // numeric (OID 1700) renvoyé en nombre JS : valeurs M&E (comptages, taux), pas de montants monétaires ici.
  const types = { getTypeParser: (oid: number, fmt?: any) => oid === 1700 ? (v: string) => parseFloat(v) : pg.types.getTypeParser(oid, fmt) };
  return new pg.Pool({ connectionString, max: 10, types: types as never });
}

/** Toute requête métier passe par ici : le tenant est posé en SET LOCAL (set_config(...,true)) pour la RLS. */
export async function withTenant<T>(pool: pg.Pool, p: Principal, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [p.tenantId, p.sub]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

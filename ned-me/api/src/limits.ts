/**
 * Limiteur par utilisateur authentifié (fenêtre fixe), en mémoire : pour les opérations coûteuses (génération de rapports, analyse DQA).
 * Complète la limite globale par IP. En mémoire = par instance ; suffisant pour un déploiement Docker Compose à une instance,
 * à remplacer par un magasin partagé (Redis) en cas de plusieurs instances.
 */
export function userLimit(name: string, max: number, windowMs = 60_000, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (req: any, reply: any) => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);   // purge : pas de croissance sans borne
    const key = `${req.principal.tenantId}:${req.principal.sub}`;
    let e = hits.get(key);
    if (!e || e.reset <= t) { e = { count: 0, reset: t + windowMs }; hits.set(key, e); }
    e.count++;
    reply.header('x-ratelimit-limit-op', `${name}:${max}`);
    if (e.count > max) {
      reply.header('retry-after', Math.max(1, Math.ceil((e.reset - t) / 1000)));
      return reply.code(429).send({ error: 'rate_limited', operation: name });
    }
  };
}

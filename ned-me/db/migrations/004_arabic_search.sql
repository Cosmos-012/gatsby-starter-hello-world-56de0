-- 004 Recherche arabe : normalisation (tashkeel, tatweel, variantes d'alef, ya/alef maqsura, ta marbuta) + index trigramme
CREATE OR REPLACE FUNCTION app.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(translate(
           regexp_replace(COALESCE(t,''), '[ً-ٰٟـ]', '', 'g'),
           'أإآٱىة', 'اااايه'))
$$;
GRANT EXECUTE ON FUNCTION app.norm_text(text) TO ned_app;

-- Texte recherchable multilingue d'un champ jsonb {fr,ar,en}
CREATE OR REPLACE FUNCTION app.search_text(j jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT app.norm_text(concat_ws(' ', j->>'fr', j->>'ar', j->>'en'))
$$;
GRANT EXECUTE ON FUNCTION app.search_text(jsonb) TO ned_app;

CREATE INDEX indicator_name_trgm ON indicator USING gin (app.search_text(name) gin_trgm_ops);
CREATE INDEX result_name_trgm ON result USING gin (app.search_text(name) gin_trgm_ops);

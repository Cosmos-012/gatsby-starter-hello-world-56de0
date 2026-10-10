-- 003 GIS (nécessite PostGIS ; appliqué uniquement sur l'image postgis/postgis)
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE admin_boundary (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  level int NOT NULL,
  code text NOT NULL,
  name jsonb NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, level, code)
);
CREATE INDEX admin_boundary_geom ON admin_boundary USING gist (geom);

CREATE TABLE geo_point (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('activity','beneficiary_group','evidence','site')),
  entity_id uuid,
  geom geometry(Point, 4326) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id)
);
CREATE INDEX geo_point_geom ON geo_point USING gist (geom);

SELECT app.secure_table('admin_boundary', false);
SELECT app.secure_table('geo_point');

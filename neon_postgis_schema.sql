-- ============================================================================
-- Basira (بصيرة) — Neon Serverless PostgreSQL + PostGIS schema
-- ============================================================================
-- Production geospatial storage for the Basira platform:
--   * study_areas        — user-drawn / coordinate / uploaded AOI polygons
--   * training_samples   — drawn & CSV-uploaded training points (class, lon, lat)
--   * classification_runs— every classification / instant-scan run + metrics
--
-- Apply automatically: the app runs these statements on first use (see
--   src/lib/db.ts → ensureSchema()). You can also apply them manually:
--   psql "$DATABASE_URL" -f neon_postgis_schema.sql
-- ============================================================================

-- Spatial extension (Neon supports PostGIS 3.x)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ----------------------------------------------------------------------------
-- Study areas (AOIs): default Borj El Arab is built into the engine; every
-- user-selected area (drawn rectangle, coordinate box, center+radius circle,
-- uploaded GeoJSON) is persisted here with its exact geodesic area.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_areas (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  area_km2      DOUBLE PRECISION,
  area_feddans  DOUBLE PRECISION,
  bbox_coords   JSONB,                       -- {west, south, east, north}
  geom          GEOMETRY(MultiPolygon, 4326) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Training samples: one row per drawn / CSV point (class, longitude, latitude).
-- The PostGIS point geometry is built with ST_SetSRID(ST_MakePoint(lon, lat), 4326).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_samples (
  id            BIGSERIAL PRIMARY KEY,
  set_name      TEXT,                        -- upload/draw batch label
  class_id      INTEGER     NOT NULL,        -- Basira class id (1..12)
  class_name    TEXT        NOT NULL,        -- class English name
  lon           DOUBLE PRECISION NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  geom          GEOMETRY(Point, 4326) NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Classification runs: metrics + per-class statistics for every run
-- (demo engine, live Earth Engine, or instant signature scan).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classification_runs (
  id                BIGSERIAL PRIMARY KEY,
  mode              TEXT    NOT NULL DEFAULT 'demo',   -- 'demo' | 'live' | 'instant'
  algorithm         TEXT    NOT NULL,                  -- rf | gtb | svm | ... | kmeans | signature
  season            TEXT    NOT NULL,                  -- winter | summer | full | custom
  start_date        TEXT,                              -- ISO date
  end_date          TEXT,                              -- ISO date
  duration_days     INTEGER,                           -- exact days covered
  overall_accuracy  DOUBLE PRECISION,                  -- OA (0..1, NULL when not computable)
  kappa             DOUBLE PRECISION,                  -- Cohen's kappa
  area_km2          DOUBLE PRECISION,                  -- Σ classified area
  class_stats       JSONB,                             -- full per-class rows
  aoi_name          TEXT,                              -- AOI label
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Spatial indexes (GiST) + lookup indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_study_areas_geom    ON study_areas       USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_training_samples_geom ON training_samples USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_runs_created_at     ON classification_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_algorithm      ON classification_runs (algorithm);

-- ----------------------------------------------------------------------------
-- Helpful views
-- ----------------------------------------------------------------------------
-- Samples per class (last upload set)
CREATE OR REPLACE VIEW v_samples_per_class AS
SELECT class_id, class_name, COUNT(*) AS n
FROM training_samples
GROUP BY class_id, class_name
ORDER BY class_id;

-- Best algorithm by mean overall accuracy across stored runs
CREATE OR REPLACE VIEW v_algorithm_leaderboard AS
SELECT algorithm,
       COUNT(*)                        AS runs,
       ROUND(AVG(overall_accuracy)::numeric, 4) AS mean_oa,
       ROUND(AVG(kappa)::numeric, 4)            AS mean_kappa
FROM classification_runs
WHERE overall_accuracy IS NOT NULL
GROUP BY algorithm
ORDER BY mean_oa DESC;

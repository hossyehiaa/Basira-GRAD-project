/**
 * Basira — Neon Serverless PostgreSQL (PostGIS) data layer.
 *
 * Replaces the previous Prisma/SQLite scaffold with a production-ready
 * serverless Postgres (Neon) accessed over HTTP through
 * @neondatabase/serverless — no connection pool, no cold-start penalty.
 *
 * Design rules:
 *   1. DATABASE_URL unset  -> every helper degrades to a no-op (demo/local
 *      state only). The API routes keep working and never throw 500s.
 *   2. First use runs neon_postgis_schema.sql statements (idempotent).
 *   3. All helpers swallow DB errors: a storage hiccup must never break a
 *      classification run.
 */
import { neon } from "@neondatabase/serverless";

type NeonSql = ReturnType<typeof neon>;

let sqlSingleton: NeonSql | null = null;
let schemaPromise: Promise<boolean> | null = null;
let healthCache: { ok: boolean; at: number } | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The Neon HTTP query function, or null when not configured. */
export function getSql(): NeonSql | null {
  if (!isDbConfigured()) return null;
  if (!sqlSingleton) {
    try {
      sqlSingleton = neon(process.env.DATABASE_URL as string);
    } catch (e) {
      console.error("[db] neon() init failed:", e);
      return null;
    }
  }
  return sqlSingleton;
}

/* ------------------------------------------------------------------ */
/* Schema init (idempotent — mirrors neon_postgis_schema.sql)          */
/* ------------------------------------------------------------------ */

export async function ensureSchema(): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
        await sql`CREATE TABLE IF NOT EXISTS study_areas (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          area_km2 DOUBLE PRECISION,
          area_feddans DOUBLE PRECISION,
          bbox_coords JSONB,
          geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await sql`CREATE TABLE IF NOT EXISTS training_samples (
          id BIGSERIAL PRIMARY KEY,
          set_name TEXT,
          class_id INTEGER NOT NULL,
          class_name TEXT NOT NULL,
          lon DOUBLE PRECISION NOT NULL,
          lat DOUBLE PRECISION NOT NULL,
          geom GEOMETRY(Point, 4326) NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await sql`CREATE TABLE IF NOT EXISTS classification_runs (
          id BIGSERIAL PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'demo',
          algorithm TEXT NOT NULL,
          season TEXT NOT NULL,
          start_date TEXT,
          end_date TEXT,
          duration_days INTEGER,
          overall_accuracy DOUBLE PRECISION,
          kappa DOUBLE PRECISION,
          area_km2 DOUBLE PRECISION,
          class_stats JSONB,
          aoi_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await sql`CREATE INDEX IF NOT EXISTS idx_study_areas_geom ON study_areas USING GIST (geom)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_training_samples_geom ON training_samples USING GIST (geom)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON classification_runs (created_at DESC)`;
        return true;
      } catch (e) {
        console.error("[db] schema init failed:", e);
        // allow a retry on the next cold start instead of caching failure
        schemaPromise = null;
        return false;
      }
    })();
  }
  return schemaPromise;
}

/** Connection probe (cached for 60 s) — powers the workspace status pill. */
export async function dbHealth(): Promise<boolean> {
  if (healthCache && Date.now() - healthCache.at < 60_000) return healthCache.ok;
  const sql = getSql();
  if (!sql) {
    healthCache = { ok: false, at: Date.now() };
    return false;
  }
  try {
    await ensureSchema();
    const r = (await sql`SELECT 1 AS ok`) as unknown as { ok: number }[];
    healthCache = { ok: Array.isArray(r) && r.length === 1, at: Date.now() };
  } catch (e) {
    console.error("[db] health check failed:", e);
    healthCache = { ok: false, at: Date.now() };
  }
  return healthCache.ok;
}

/* ------------------------------------------------------------------ */
/* classification_runs                                                 */
/* ------------------------------------------------------------------ */

export interface SaveRunInput {
  mode?: "demo" | "live" | "instant";
  algorithm: string;
  season: string;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  oa?: number | null;
  kappa?: number | null;
  areaKm2?: number | null;
  classStats?: unknown;
  aoiName?: string | null;
}

export interface RunHistoryRow {
  id: number;
  mode: string;
  algorithm: string;
  season: string;
  oa: number | null;
  kappa: number | null;
  areaKm2: number | null;
  aoiName: string | null;
  createdAt: string;
}

/** Persist one run; resolves to the new id or null when unavailable. */
export async function saveRun(r: SaveRunInput): Promise<number | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      INSERT INTO classification_runs
        (mode, algorithm, season, start_date, end_date, duration_days,
         overall_accuracy, kappa, area_km2, class_stats, aoi_name)
      VALUES
        (${r.mode ?? "demo"}, ${r.algorithm}, ${r.season},
         ${r.startDate ?? null}, ${r.endDate ?? null}, ${r.durationDays ?? null},
         ${r.oa ?? null}, ${r.kappa ?? null}, ${r.areaKm2 ?? null},
         ${JSON.stringify(r.classStats ?? null)}::jsonb, ${r.aoiName ?? null})
      RETURNING id`) as unknown as { id: number }[];
    return rows[0]?.id ?? null;
  } catch (e) {
    console.error("[db] saveRun failed:", e);
    return null;
  }
}

export async function listRuns(limit = 12): Promise<RunHistoryRow[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    await ensureSchema();
    const rows = (await sql`
      SELECT id, mode, algorithm, season, overall_accuracy AS oa, kappa,
             area_km2 AS "areaKm2", aoi_name AS "aoiName",
             to_char(created_at, 'YYYY-MM-DD HH24:MI') AS "createdAt"
      FROM classification_runs
      ORDER BY created_at DESC
      LIMIT ${limit}`) as unknown as RunHistoryRow[];
    return rows;
  } catch (e) {
    console.error("[db] listRuns failed:", e);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* training_samples                                                    */
/* ------------------------------------------------------------------ */

export interface SampleRow {
  classId: number;
  classEn: string;
  lon: number;
  lat: number;
}

/** Store a batch of training points (chunked, one statement per ~400 rows). */
export async function saveSamples(
  setName: string,
  points: SampleRow[]
): Promise<number> {
  const sql = getSql();
  if (!sql || points.length === 0) return 0;
  try {
    await ensureSchema();
    const CHUNK = 400;
    let saved = 0;
    for (let i = 0; i < points.length; i += CHUNK) {
      const batch = points.slice(i, i + CHUNK);
      const res = (await sql`
        INSERT INTO training_samples (set_name, class_id, class_name, lon, lat, geom)
        SELECT ${setName},
               (p->>'classId')::int,
               p->>'classEn',
               (p->>'lon')::double precision,
               (p->>'lat')::double precision,
               ST_SetSRID(ST_MakePoint((p->>'lon')::double precision,
                                       (p->>'lat')::double precision), 4326)
        FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb) AS p
        RETURNING id`) as unknown as { id: number }[];
      saved += res.length;
    }
    return saved;
  } catch (e) {
    console.error("[db] saveSamples failed:", e);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* study_areas                                                         */
/* ------------------------------------------------------------------ */

export interface SavedArea {
  id: number;
  name: string;
  areaKm2: number | null;
  areaFeddans: number | null;
}

/** Persist a GeoJSON AOI and return its exact PostGIS-computed geodesic area. */
export async function saveStudyArea(
  name: string,
  geojson: { type: string; coordinates: unknown },
  bbox: { west: number; south: number; east: number; north: number }
): Promise<SavedArea | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    await ensureSchema();
    const rows = (await sql`
      INSERT INTO study_areas (name, area_km2, area_feddans, bbox_coords, geom)
      VALUES (
        ${name},
        NULL, NULL,
        ${JSON.stringify(bbox)}::jsonb,
        ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}::jsonb))
      )
      RETURNING id,
                ROUND((ST_Area(geom::geography) / 1e6)::numeric, 3)  AS area_km2,
                ROUND((ST_Area(geom::geography) / 1e6 * 238.095)::numeric, 1) AS area_feddans`) as unknown as {
      id: number;
      area_km2: string | null;
      area_feddans: string | null;
    }[];
    const r = rows[0];
    return {
      id: r.id,
      name,
      areaKm2: r.area_km2 != null ? Number(r.area_km2) : null,
      areaFeddans: r.area_feddans != null ? Number(r.area_feddans) : null,
    };
  } catch (e) {
    console.error("[db] saveStudyArea failed:", e);
    return null;
  }
}

export async function listStudyAreas(limit = 10): Promise<
  { id: number; name: string; areaKm2: number | null; createdAt: string }[]
> {
  const sql = getSql();
  if (!sql) return [];
  try {
    await ensureSchema();
    const rows = (await sql`
      SELECT id, name,
             ROUND((ST_Area(geom::geography) / 1e6)::numeric, 2) AS area_km2,
             to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
      FROM study_areas
      ORDER BY created_at DESC
      LIMIT ${limit}`) as unknown as {
      id: number;
      name: string;
      area_km2: string | null;
      created_at: string;
    }[];
    return rows.map((x) => ({
      id: x.id,
      name: x.name,
      areaKm2: x.area_km2 != null ? Number(x.area_km2) : null,
      createdAt: x.created_at,
    }));
  } catch (e) {
    console.error("[db] listStudyAreas failed:", e);
    return [];
  }
}

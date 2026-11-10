// Basira — areas of interest (default built-in + user selections/uploads)
// v1.3: persisted to Neon PostGIS `study_areas` with ST_GeomFromGeoJSON and
// exact ST_Area(geography) area; graceful fallback when DATABASE_URL unset.
import { NextRequest, NextResponse } from "next/server";
import { saveStudyArea, listStudyAreas } from "@/lib/db";
import { PLATFORM } from "@/lib/basira/constants";
import { FEDDAN_PER_KM2 } from "@/lib/basira/agronomy";

interface GeoPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

function extractPolygons(geo: unknown): { ok: boolean; reason?: string } {
  if (!geo || typeof geo !== "object") return { ok: false, reason: "not_an_object" };
  const g = geo as Record<string, unknown>;
  if (g.type === "FeatureCollection" && Array.isArray(g.features)) {
    for (const f of g.features) {
      const r = extractPolygons(f);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (g.type === "Feature" && g.geometry) return extractPolygons(g.geometry);
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    if (g.type === "MultiPolygon") {
      const polys = g.coordinates as unknown[];
      if (!Array.isArray(polys) || polys.length === 0)
        return { ok: false, reason: "empty_polygon" };
      return { ok: true };
    }
    const coords = g.coordinates as unknown[];
    if (!Array.isArray(coords) || coords.length === 0)
      return { ok: false, reason: "empty_polygon" };
    const ring = coords[0] as unknown[];
    if (!Array.isArray(ring) || ring.length < 4)
      return { ok: false, reason: "ring_too_short" };
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) return { ok: false, reason: "bad_point" };
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90)
        return { ok: false, reason: "point_out_of_range" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "unsupported_type" };
}

/** Bounding box of a GeoJSON polygon/multipolygon (for storage + map fit). */
function bboxOf(geo: GeoPolygon): { west: number; south: number; east: number; north: number } {
  let west = 180, south = 90, east = -180, north = -90;
  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords as [number, number];
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(geo.coordinates);
  return { west, south, east, north };
}

export async function GET() {
  const uploaded = await listStudyAreas(10);
  return NextResponse.json({
    defaultAoi: {
      id: null,
      name: "Borj El Arab",
      nameAr: "برج العرب",
      geojsonUrl: "/borj_el_arab.geojson",
      areaKm2: PLATFORM.aoiAreaKm2,
    },
    uploaded,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const geojson = body?.geojson as GeoPolygon | undefined;
    const check = extractPolygons(geojson);
    if (!check.ok || !geojson) {
      return NextResponse.json(
        { error: "invalid_geojson", reason: check.reason ?? "not_an_object" },
        { status: 400 }
      );
    }
    const name = String(body.name ?? "Custom area").slice(0, 80);
    const bbox = bboxOf(geojson);

    // Persist with PostGIS and get the exact geodesic area back
    const saved = await saveStudyArea(name, geojson, bbox);
    // Client-side estimate is the fallback when the DB is unavailable
    const clientArea =
      typeof body.areaKm2 === "number" && Number.isFinite(body.areaKm2)
        ? body.areaKm2
        : null;

    return NextResponse.json({
      id: saved?.id ?? null,
      name,
      nameAr: String(body.nameAr ?? name).slice(0, 80),
      geojson,
      bbox,
      areaKm2: saved?.areaKm2 ?? clientArea,
      areaFeddans:
        saved?.areaFeddans ??
        (clientArea != null ? +(clientArea * FEDDAN_PER_KM2).toFixed(1) : null),
      persisted: Boolean(saved),
    });
  } catch (e) {
    console.error("aoi error", e);
    return NextResponse.json({ error: "aoi_failed" }, { status: 500 });
  }
}

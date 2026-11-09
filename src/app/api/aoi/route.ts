// Basira — areas of interest (default built-in + user uploads)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
  if (g.type === "Polygon") {
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

export async function GET() {
  let uploaded: unknown[] = [];
  try {
    uploaded = await db.aoi.findMany({
      where: { isDefault: false },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, nameAr: true, isDefault: true, createdAt: true },
    });
  } catch {
    /* serverless host with ephemeral storage — no saved areas */
  }
  return NextResponse.json({
    defaultAoi: {
      id: null,
      name: "Borj El Arab",
      nameAr: "برج العرب",
      geojsonUrl: "/borj_el_arab.geojson",
      areaKm2: 594,
    },
    uploaded,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const geojson = body?.geojson;
    const check = extractPolygons(geojson);
    if (!check.ok) {
      return NextResponse.json(
        { error: "invalid_geojson", reason: check.reason },
        { status: 400 }
      );
    }
    const name = String(body.name ?? "Custom area").slice(0, 80);
    let saved: { id: number } | null = null;
    try {
      const aoi = await db.aoi.create({
        data: { name, nameAr: name, geojson: JSON.stringify(geojson), isDefault: false },
      });
      saved = { id: aoi.id };
    } catch {
      /* ephemeral storage — accept the area for this session anyway */
    }
    return NextResponse.json({
      id: saved?.id ?? null,
      name,
      nameAr: name,
      geojson,
      persisted: Boolean(saved),
    });
  } catch (e) {
    console.error("aoi error", e);
    return NextResponse.json({ error: "aoi_failed" }, { status: 500 });
  }
}

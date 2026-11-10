// Basira — training sample sets (CSV upload is parsed client-side)
// v1.3: persisted to Neon PostGIS `training_samples` (PostGIS points via
// ST_SetSRID(ST_MakePoint(lon, lat), 4326)); graceful fallback when unset.
import { NextRequest, NextResponse } from "next/server";
import { saveSamples, getSql } from "@/lib/db";
import { CLASSES as CLASSES_LIST, CLASS_BY_CODE } from "@/lib/basira/constants";

interface RawPoint {
  class?: string;
  classId?: number;
  lon?: number;
  lat?: number;
  longitude?: number;
  latitude?: number;
}

export async function GET() {
  // Recent upload sets from Neon PostGIS (grouped); empty list when unset.
  const sql = getSql();
  if (!sql) return NextResponse.json({ sets: [] });
  try {
    const rows = await sql`
      SELECT set_name AS name,
             COUNT(*)::int AS count,
             to_char(MAX(uploaded_at), 'YYYY-MM-DD HH24:MI') AS created_at
      FROM training_samples
      GROUP BY set_name
      ORDER BY MAX(uploaded_at) DESC
      LIMIT 10`;
    return NextResponse.json({ sets: rows, connected: true });
  } catch {
    return NextResponse.json({ sets: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "samples").slice(0, 80);
    const raw: RawPoint[] = Array.isArray(body.points) ? body.points : [];

    const points: {
      classId: number;
      classEn: string;
      classAr: string;
      lon: number;
      lat: number;
    }[] = [];
    let skipped = 0;
    for (const p of raw.slice(0, 20000)) {
      const code = String(p.class ?? "").trim().toUpperCase();
      const cls =
        CLASS_BY_CODE[code] ??
        (p.classId ? CLASSES_LIST.find((c) => c.id === Number(p.classId)) : undefined);
      const lon = Number(p.lon ?? p.longitude);
      const lat = Number(p.lat ?? p.latitude);
      if (!cls || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        skipped++;
        continue;
      }
      points.push({ classId: cls.id, classEn: cls.en, classAr: cls.ar, lon, lat });
    }
    if (points.length === 0) {
      return NextResponse.json(
        { error: "no_valid_points", skipped },
        { status: 400 }
      );
    }

    // Neon PostGIS persistence (best-effort — upload succeeds regardless)
    const saved = await saveSamples(
      name,
      points.map((p) => ({ classId: p.classId, classEn: p.classEn, lon: p.lon, lat: p.lat }))
    );
    return NextResponse.json({
      id: saved > 0 ? 1 : null,
      name,
      count: points.length,
      skipped,
      points,
      persisted: saved > 0,
    });
  } catch (e) {
    console.error("samples error", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}

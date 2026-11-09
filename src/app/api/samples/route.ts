// Basira — training sample sets (CSV upload is parsed client-side)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
  // Serverless hosts have ephemeral storage — degrade to an empty list
  // instead of a 500 so the workspace UI keeps working.
  try {
    const sets = await db.sampleSet.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json({
      sets: sets.map((s) => ({
        id: s.id,
        name: s.name,
        source: s.source,
        count: (JSON.parse(s.points) as unknown[]).length,
        createdAt: s.createdAt,
      })),
    });
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

    let persisted: { id: number; name: string } | null = null;
    try {
      const set = await db.sampleSet.create({
        data: { name, source: "csv", points: JSON.stringify(points) },
      });
      persisted = { id: set.id, name: set.name };
    } catch {
      /* ephemeral storage — accept the upload for this session anyway */
    }
    return NextResponse.json({
      id: persisted?.id ?? null,
      name: persisted?.name ?? name,
      count: points.length,
      skipped,
      points,
      persisted: Boolean(persisted),
    });
  } catch (e) {
    console.error("samples error", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}

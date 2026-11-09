// Basira — Sentinel-2 scene tiles (true color / NDVI / NDWI). Light & sync.
import { NextRequest, NextResponse } from "next/server";
import { buildScene, GEEError } from "@/lib/gee/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const layer = ["truecolor", "ndvi", "ndwi"].includes(body.layer)
      ? body.layer
      : "truecolor";
    const scene = await buildScene({
      layer,
      season: body.season ?? "winter",
      year: body.year ? Number(body.year) : undefined,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      cloudMax: body.cloudMax ? Number(body.cloudMax) : 60,
    });
    return NextResponse.json(scene);
  } catch (e) {
    const code = e instanceof GEEError ? e.code : "scene_failed";
    console.error("scene error", code, (e as Error)?.message?.slice(0, 200));
    return NextResponse.json({ error: code }, { status: e instanceof GEEError ? 400 : 500 });
  }
}

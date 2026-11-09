// Basira — NDVI time series at a clicked point. Light & sync.
import { NextRequest, NextResponse } from "next/server";
import { ndviPointSeries, GEEError } from "@/lib/gee/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lon = Number(body.lon), lat = Number(body.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return NextResponse.json({ error: "bad_point" }, { status: 400 });
    }
    const res = await ndviPointSeries({
      lon, lat,
      season: body.season ?? "winter",
      year: body.year ? Number(body.year) : undefined,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      cloudMax: body.cloudMax ? Number(body.cloudMax) : 60,
    });
    return NextResponse.json(res);
  } catch (e) {
    const code = e instanceof GEEError ? e.code : "ndvi_failed";
    console.error("ndvi-point error", code, (e as Error)?.message?.slice(0, 200));
    return NextResponse.json({ error: code }, { status: e instanceof GEEError ? 400 : 500 });
  }
}

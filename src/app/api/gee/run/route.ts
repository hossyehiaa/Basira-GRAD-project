// Basira — synchronous GEE run/compare (used in local dev; production uses
// the background function + result polling because cold EE graphs can take
// longer than the 26s serverless limit).
// v1.3: passes the custom AOI through, and persists finished runs to Neon
// PostGIS (best-effort) when DATABASE_URL is configured.
import { NextRequest, NextResponse } from "next/server";
import { runClassification, compareAll, GEEError, type AoiGeoInput } from "@/lib/gee/engine";
import { saveRun } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseAoi(body: Record<string, unknown>): {
  aoiGeo?: AoiGeoInput;
  aoiName?: string;
} {
  const geo = body.aoiGeo as AoiGeoInput | undefined;
  if (geo && (geo.type === "Polygon" || geo.type === "MultiPolygon")) {
    return { aoiGeo: geo, aoiName: body.aoiName ? String(body.aoiName) : undefined };
  }
  return {};
}

async function persistRun(mode: "live" | "instant", result: {
  algorithm: string; season: string; dateFrom: string; dateTo: string;
  oa: number | null; kappa: number | null; classes: unknown[];
  areaKm2: number; aoiName?: string | null;
}) {
  try {
    await saveRun({
      mode,
      algorithm: result.algorithm,
      season: result.season,
      startDate: result.dateFrom,
      endDate: result.dateTo,
      durationDays: Math.max(
        1,
        Math.round(
          (new Date(result.dateTo).getTime() - new Date(result.dateFrom).getTime()) / 86400000
        )
      ),
      oa: result.oa,
      kappa: result.kappa,
      areaKm2: result.areaKm2,
      classStats: result.classes,
      aoiName: result.aoiName ?? null,
    });
  } catch {
    /* storage must never break a successful run */
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const shared = {
      season: body.season ?? "winter",
      year: body.year ? Number(body.year) : undefined,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      cloudMax: body.cloudMax ? Number(body.cloudMax) : 60,
      rfTrees: body.rfTrees ? Number(body.rfTrees) : 100,
      kClusters: body.kClusters ? Number(body.kClusters) : 8,
      knnK: body.knnK ? Number(body.knnK) : 5,
      mlpHidden: body.mlpHidden ? Number(body.mlpHidden) : undefined,
      mlpEpochs: body.mlpEpochs ? Number(body.mlpEpochs) : undefined,
      samplePoints: Array.isArray(body.samplePoints) ? body.samplePoints : [],
      ...parseAoi(body),
    };
    if (body.kind === "compare") {
      const res = await compareAll(shared);
      return NextResponse.json({ kind: "compare", ...res });
    }
    const result = await runClassification({ ...shared, algorithm: body.algorithm, kind: "run" });
    await persistRun(result.algorithm === "signature" ? "instant" : "live", result);
    return NextResponse.json({ kind: "run", result });
  } catch (e) {
    const code = e instanceof GEEError ? e.code : "run_failed";
    console.error(
      "gee run error", code,
      String((e as Error)?.message ?? e).slice(0, 500)
    );
    return NextResponse.json(
      { error: code, message: String((e as Error)?.message || e || "").slice(0, 300) },
      { status: e instanceof GEEError ? 400 : 500 }
    );
  }
}

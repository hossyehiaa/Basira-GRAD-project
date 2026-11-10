// Basira — synchronous GEE run/compare (used in local dev; production uses
// the background function + result polling because cold EE graphs can take
// longer than the 26s serverless limit).
import { NextRequest, NextResponse } from "next/server";
import { runClassification, compareAll, GEEError } from "@/lib/gee/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    };
    if (body.kind === "compare") {
      const res = await compareAll(shared);
      return NextResponse.json({ kind: "compare", ...res });
    }
    const result = await runClassification({ ...shared, algorithm: body.algorithm, kind: "run" });
    return NextResponse.json({ kind: "run", result });
  } catch (e) {
    const code = e instanceof GEEError ? e.code : "run_failed";
    console.error("gee run error", code, (e as Error)?.message?.slice(0, 300));
    return NextResponse.json(
      { error: code, message: String((e as Error)?.message || "").slice(0, 300) },
      { status: e instanceof GEEError ? 400 : 500 }
    );
  }
}

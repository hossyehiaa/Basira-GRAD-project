// Basira — classification runs (demo engine; live GEE adapter plugs in here)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ALGO_BY_KEY } from "@/lib/basira/constants";
import demoResults from "@/data/demoResults.json";
import type { AlgoKey, SeasonKey } from "@/lib/basira/types";

const SEASONS: SeasonKey[] = ["winter", "summer", "full", "custom"];

export async function GET() {
  // Serverless hosts have ephemeral storage — degrade gracefully.
  try {
    const runs = await db.run.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { stats: true },
    });
    return NextResponse.json({ runs });
  } catch {
    return NextResponse.json({ runs: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const algorithm = String(body.algorithm ?? "") as AlgoKey;
    const season = String(body.season ?? "winter") as SeasonKey;
    if (!ALGO_BY_KEY[algorithm]) {
      return NextResponse.json(
        { error: "unknown_algorithm" },
        { status: 400 }
      );
    }
    if (!SEASONS.includes(season)) {
      return NextResponse.json({ error: "unknown_season" }, { status: 400 });
    }

    const started = Date.now();
    // ---- demo engine: deterministic pre-computed results ----------------
    // (a real deployment swaps this block for the GEE service-account call)
    const dataKey = season === "custom" ? "full" : season;
    const demo = demoResults.seasons[dataKey][algorithm];
    if (!demo) {
      return NextResponse.json({ error: "no_result" }, { status: 500 });
    }
    const durationMs = Math.max(1, Date.now() - started + 700 + (algorithm === "kmeans" ? 400 : 0));

    let saved: { id: number; createdAt: Date } | null = null;
    try {
      const run = await db.run.create({
        data: {
          mode: "demo",
          algorithm,
          season,
          dateFrom: season === "custom" ? (body.dateFrom ?? null) : null,
          dateTo: season === "custom" ? (body.dateTo ?? null) : null,
          oa: demo.oa,
          kappa: demo.kappa,
          mapUrl: demo.mapUrl,
          durationMs,
          stats: {
            create: demo.classes.map((c) => ({
              classId: c.classId,
              code: c.code,
              nameEn: c.en,
              nameAr: c.ar,
              color: c.color,
              areaKm2: c.areaKm2,
              percent: c.percent,
              pa: c.pa,
              ua: c.ua,
              f1: c.f1,
            })),
          },
        },
        include: { stats: true },
      });
      saved = { id: run.id, createdAt: run.createdAt };
    } catch {
      /* ephemeral storage — return the computed result without history */
    }

    return NextResponse.json({
      id: saved?.id ?? null,
      algorithm,
      season,
      dateFrom: season === "custom" ? (body.dateFrom ?? null) : null,
      dateTo: season === "custom" ? (body.dateTo ?? null) : null,
      oa: demo.oa,
      kappa: demo.kappa,
      mapUrl: demo.mapUrl,
      durationMs,
      mode: "demo" as const,
      classes: demo.classes,
      createdAt: saved?.createdAt ?? new Date(),
    });
  } catch (e) {
    console.error("run error", e);
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }
}

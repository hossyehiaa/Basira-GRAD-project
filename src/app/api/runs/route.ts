// Basira — classification runs (demo engine; live GEE runs through /gee-run)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ALGO_BY_KEY } from "@/lib/basira/constants";
import demoResults from "@/data/demoResults.json";
import type { AlgoKey, SeasonKey, ConfusionMatrix, DemoRunResult } from "@/lib/basira/types";

const SEASONS: SeasonKey[] = ["winter", "summer", "full", "custom"];

/**
 * Map a custom date range onto the closest pre-computed benchmark season,
 * based on the midpoint month and the span length (demo mode only — live mode
 * sends the exact dates straight to Earth Engine).
 *   Nov–Apr midpoint -> winter · May–Oct midpoint -> summer · span >= 8 months -> full
 */
export function mapCustomSeason(
  dateFrom: string,
  dateTo: string
): "winter" | "summer" | "full" {
  const a = new Date(dateFrom).getTime();
  const b = new Date(dateTo).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) return "full";
  const spanMonths = (b - a) / (1000 * 60 * 60 * 24 * 30.44);
  if (spanMonths >= 8) return "full";
  const mid = new Date((a + b) / 2).getMonth() + 1; // 1..12
  return mid >= 5 && mid <= 10 ? "summer" : "winter";
}

/** Deterministic 32-bit PRNG — same request always yields the same variation. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Apply a small deterministic variation to a demo result for a custom range. */
function varyDemo(
  demo: DemoRunResult,
  seed: string,
  spanMonths: number
): Pick<DemoRunResult, "oa" | "kappa" | "classes"> {
  const rng = seededRandom(seed);
  // shorter windows see slightly noisier composites: ±0–2% around the base
  const lengthFactor = Math.min(1, spanMonths / 6); // 0..1
  const jitter = (rng() * 0.02 + 0.005) * (1.2 - lengthFactor);
  const dir = rng() < 0.5 ? -1 : 1;
  const oa = Math.min(0.995, +(demo.oa * (1 + dir * jitter)).toFixed(3));
  const kappa = Math.min(0.995, +(demo.kappa * (1 + dir * jitter * 1.1)).toFixed(3));
  const classes = demo.classes.map((c) => {
    const f = 1 + (rng() - 0.5) * 0.06; // ±3% per class, deterministic
    return { ...c, areaKm2: +(c.areaKm2 * f).toFixed(2) };
  });
  // renormalize areas/percent so Σ stays exact (canonical AOI size + 100%)
  const total = classes.reduce((s, c) => s + c.areaKm2, 0);
  const canonical = demoResults.bounds.areaKm2;
  classes.forEach((c) => {
    c.areaKm2 = +((c.areaKm2 / total) * canonical).toFixed(2);
    c.percent = +((c.areaKm2 / canonical) * 100).toFixed(1);
  });
  const driftA = +(canonical - classes.reduce((s, c) => s + c.areaKm2, 0)).toFixed(2);
  classes[0].areaKm2 = +(classes[0].areaKm2 + driftA).toFixed(2);
  const driftP = +(100 - classes.reduce((s, c) => s + c.percent, 0)).toFixed(1);
  classes[0].percent = +(classes[0].percent + driftP).toFixed(1);
  return { oa, kappa, classes };
}

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
    if (season === "custom" && (!body.dateFrom || !body.dateTo)) {
      return NextResponse.json({ error: "bad_date_range" }, { status: 400 });
    }

    const started = Date.now();
    // ---- demo engine: deterministic pre-computed results ----------------
    // (a real deployment swaps this block for the GEE service-account call)
    let dataKey: "winter" | "summer" | "full";
    let demo: DemoRunResult;
    if (season === "custom") {
      dataKey = mapCustomSeason(String(body.dateFrom), String(body.dateTo));
      const base = demoResults.seasons[dataKey][algorithm];
      const spanMonths =
        (new Date(String(body.dateTo)).getTime() -
          new Date(String(body.dateFrom)).getTime()) /
        (1000 * 60 * 60 * 24 * 30.44);
      demo = {
        ...base,
        ...varyDemo(base, `${algorithm}|${body.dateFrom}|${body.dateTo}`, spanMonths),
      };
    } else {
      dataKey = season;
      demo = demoResults.seasons[dataKey][algorithm];
    }
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
      confusion: (demo.matrix ?? null) as ConfusionMatrix | null,
      createdAt: saved?.createdAt ?? new Date(),
    });
  } catch (e) {
    console.error("run error", e);
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }
}

// Basira — classification runs (demo engine; live GEE runs through /gee-run)
//
// v1.3:
//  * Neon PostGIS persistence (graceful fallback when DATABASE_URL unset)
//  * custom date ranges blend the winter/summer reference compositions by
//    exact month coverage (weighted interpolation — any range, never zero)
//  * instant "signature" scan (demo): regional composition scaled to the
//    requested AOI area so any selected area returns a sensible breakdown
//  * dynamic AOI: results rescale to the scanned area (km² + feddans)
import { NextRequest, NextResponse } from "next/server";
import { saveRun, listRuns } from "@/lib/db";
import { ALGO_BY_KEY, PLATFORM } from "@/lib/basira/constants";
import { FEDDAN_PER_KM2 } from "@/lib/basira/agronomy";
import demoResults from "@/data/demoResults.json";
import type {
  AlgoKey,
  SeasonKey,
  ConfusionMatrix,
  DemoRunResult,
} from "@/lib/basira/types";

const SEASONS: SeasonKey[] = ["winter", "summer", "full", "custom"];
/** The composition reference used for instant scans in demo mode. */
const INSTANT_REF: AlgoKey = "rf";

/** Season a calendar month belongs to (Egyptian cropping calendar). */
function seasonOfMonth(month: number): "winter" | "summer" {
  return month >= 5 && month <= 10 ? "summer" : "winter";
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

interface BlendedRun {
  oa: number;
  kappa: number;
  classes: DemoRunResult["classes"];
  matrix: ConfusionMatrix | null;
  referenceSeasons: { winter: number; summer: number };
}

/**
 * Weighted interpolation of the reference (demo) compositions across the
 * exact months covered by [dateFrom, dateTo]:
 *   share(class) = Σ_months  w_m × referenceShare(seasonOf(m), class)
 * where w_m is the fraction of the range's days that fall in month m.
 * Accuracy metrics are blended the same way, with a small deterministic
 * penalty for very short windows (fewer scenes → noisier composite).
 */
export function blendCustomRange(
  algorithm: AlgoKey,
  dateFrom: string,
  dateTo: string,
  aoiAreaKm2?: number | null
): BlendedRun | null {
  const a = new Date(dateFrom);
  const b = new Date(dateTo);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a >= b) return null;

  // ---- month coverage weights ----
  const weights = new Map<string, number>(); // "YYYY-MM" -> days
  const cursor = new Date(a);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(b);
  let totalDays = 0;
  while (cursor < end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    next.setHours(0, 0, 0, 0);
    const days = Math.min(next.getTime(), end.getTime()) - cursor.getTime();
    const d = days / 86400000;
    if (d > 0) {
      weights.set(key, (weights.get(key) ?? 0) + d);
      totalDays += d;
    }
    cursor.setTime(next.getTime());
  }
  if (totalDays <= 0) return null;

  // reference shares per season for this algorithm
  const shares: Record<"winter" | "summer", Map<string, number>> = {
    winter: new Map(),
    summer: new Map(),
  };
  const refs: Record<"winter" | "summer", DemoRunResult | undefined> = {
    winter: demoResults.seasons.winter[algorithm],
    summer: demoResults.seasons.summer[algorithm],
  };
  for (const season of ["winter", "summer"] as const) {
    const ref = refs[season];
    if (!ref) continue;
    const total = ref.classes.reduce((s, c) => s + c.areaKm2, 0) || 1;
    for (const c of ref.classes) shares[season].set(c.code, c.areaKm2 / total);
  }

  // ---- blend ----
  const seasonWeight = { winter: 0, summer: 0 };
  const blended = new Map<string, number>();
  let oa = 0;
  let kappa = 0;
  let haveAcc = false;
  for (const [key, days] of weights) {
    const month = Number(key.slice(5, 7));
    const season = seasonOfMonth(month);
    const w = days / totalDays;
    seasonWeight[season] += w;
    for (const [code, share] of shares[season]) {
      blended.set(code, (blended.get(code) ?? 0) + w * share);
    }
    const ref = refs[season];
    if (ref) {
      oa += w * ref.oa;
      kappa += w * ref.kappa;
      haveAcc = true;
    }
  }

  // deterministic small penalty for short windows (fewer Sentinel-2 scenes)
  const rng = seededRandom(`${algorithm}|${dateFrom}|${dateTo}`);
  const lengthFactor = Math.min(1, totalDays / 120); // saturates at ~4 months
  const penalty = (0.004 + rng() * 0.012) * (1.15 - lengthFactor);
  if (haveAcc) {
    oa = Math.max(0.35, Math.min(0.985, oa - penalty));
    kappa = Math.max(0.3, Math.min(0.985, kappa - penalty * 1.1));
  }

  // ---- materialize rows on the canonical class order ----
  const canonical = demoResults.seasons.full[algorithm]?.classes ??
    demoResults.seasons.full.rf.classes;
  const totalShare = [...blended.values()].reduce((s, v) => s + v, 0) || 1;
  const areaKm2Total = aoiAreaKm2 && aoiAreaKm2 > 0 ? aoiAreaKm2 : PLATFORM.aoiAreaKm2;
  const classes = canonical
    .map((c) => {
      const share = (blended.get(c.code) ?? 0) / totalShare;
      return {
        ...c,
        areaKm2: +(share * areaKm2Total).toFixed(2),
        percent: +(share * 100).toFixed(1),
        pa: null,
        ua: null,
        f1: null,
      };
    })
    .filter((c) => c.areaKm2 > 0.005 || c.percent >= 0.1)
    .sort((x, y) => y.areaKm2 - x.areaKm2);

  // rounding fixup → percentages sum to exactly 100.0
  const drift = +(100 - classes.reduce((s, c) => s + c.percent, 0)).toFixed(1);
  if (drift !== 0 && classes.length > 0) {
    classes[0].percent = +(classes[0].percent + drift).toFixed(1);
  }

  // confusion matrix: use the dominant reference season's matrix
  const domSeason = seasonWeight.winter >= seasonWeight.summer ? "winter" : "summer";
  return {
    oa: haveAcc ? +oa.toFixed(3) : 0,
    kappa: haveAcc ? +kappa.toFixed(3) : 0,
    classes,
    matrix: (refs[domSeason]?.matrix as ConfusionMatrix) ?? null,
    referenceSeasons: seasonWeight,
  };
}

export async function GET() {
  // Neon PostGIS history (falls back to an empty list — never a 500)
  const runs = await listRuns(12);
  return NextResponse.json({ runs, connected: runs != null });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const algorithm = String(body.algorithm ?? "") as AlgoKey;
    const season = String(body.season ?? "winter") as SeasonKey;
    const isInstant = algorithm === "signature";
    if (!ALGO_BY_KEY[algorithm] && !isInstant) {
      return NextResponse.json({ error: "unknown_algorithm" }, { status: 400 });
    }
    if (!SEASONS.includes(season)) {
      return NextResponse.json({ error: "unknown_season" }, { status: 400 });
    }
    if (season === "custom" && (!body.dateFrom || !body.dateTo)) {
      return NextResponse.json({ error: "bad_date_range" }, { status: 400 });
    }

    const started = Date.now();
    // The area the scan is bounded to (custom AOI in km², if the client sent it)
    const aoiAreaKm2 =
      typeof body.aoiAreaKm2 === "number" && Number.isFinite(body.aoiAreaKm2)
        ? body.aoiAreaKm2
        : null;
    const aoiName = typeof body.aoiName === "string" ? body.aoiName.slice(0, 80) : null;
    const algoKey: AlgoKey = isInstant ? INSTANT_REF : algorithm;

    // ---- demo engine: deterministic pre-computed / blended results --------
    let out: {
      oa: number;
      kappa: number;
      classes: DemoRunResult["classes"];
      matrix: ConfusionMatrix | null;
      mapUrl: string | null;
    };
    let refSeasonLabel: string;

    if (season === "custom" || isInstant || aoiAreaKm2 != null) {
      // instant scan or custom area/duration → weighted blend of references
      const from =
        season === "custom"
          ? String(body.dateFrom)
          : season === "summer"
            ? "2025-05-01"
            : season === "full"
              ? "2025-01-01"
              : "2024-11-01";
      const to =
        season === "custom"
          ? String(body.dateTo)
          : season === "summer"
            ? "2025-10-31"
            : season === "full"
              ? "2025-12-31"
              : "2025-04-30";
      const blended = blendCustomRange(algoKey, from, to, aoiAreaKm2);
      const base = demoResults.seasons[season === "custom" ? "full" : season]?.[algoKey];
      if (!blended && !base) {
        return NextResponse.json({ error: "no_result" }, { status: 500 });
      }
      if (blended) {
        out = {
          oa: isInstant ? 0 : blended.oa,
          kappa: isInstant ? 0 : blended.kappa,
          classes: blended.classes,
          matrix: blended.matrix,
          // static PNG overlays only fit the built-in AOI
          mapUrl: aoiAreaKm2 == null ? (base?.mapUrl ?? null) : null,
        };
        refSeasonLabel = "blended";
      } else {
        out = {
          oa: base!.oa,
          kappa: base!.kappa,
          classes: base!.classes,
          matrix: (base!.matrix as ConfusionMatrix) ?? null,
          mapUrl: aoiAreaKm2 == null ? base!.mapUrl : null,
        };
        refSeasonLabel = season;
      }
    } else {
      const base = demoResults.seasons[season][algoKey];
      if (!base) return NextResponse.json({ error: "no_result" }, { status: 500 });
      out = {
        oa: base.oa,
        kappa: base.kappa,
        classes: base.classes,
        matrix: (base.matrix as ConfusionMatrix) ?? null,
        mapUrl: base.mapUrl,
      };
      refSeasonLabel = season;
    }

    const durationDays =
      season === "custom"
        ? Math.max(
            1,
            Math.round(
              (new Date(String(body.dateTo)).getTime() -
                new Date(String(body.dateFrom)).getTime()) /
                86400000
            )
          )
        : season === "winter"
          ? 181
          : season === "summer"
            ? 184
            : 365;
    const durationMs = Math.max(
      1,
      Date.now() - started + 700 + (isInstant ? 300 : 0)
    );

    const id = await saveRun({
      mode: isInstant ? "instant" : "demo",
      algorithm,
      season,
      startDate: season === "custom" ? (body.dateFrom ?? null) : null,
      endDate: season === "custom" ? (body.dateTo ?? null) : null,
      durationDays,
      oa: isInstant ? null : out.oa,
      kappa: isInstant ? null : out.kappa,
      areaKm2: +out.classes.reduce((s, c) => s + c.areaKm2, 0).toFixed(2),
      classStats: out.classes,
      aoiName,
    });

    return NextResponse.json({
      id,
      algorithm,
      season,
      dateFrom: season === "custom" ? (body.dateFrom ?? null) : null,
      dateTo: season === "custom" ? (body.dateTo ?? null) : null,
      oa: isInstant ? null : out.oa,
      kappa: isInstant ? null : out.kappa,
      mapUrl: out.mapUrl,
      durationMs,
      mode: "demo" as const,
      classes: out.classes,
      confusion: out.matrix,
      aoiAreaKm2: aoiAreaKm2 ?? PLATFORM.aoiAreaKm2,
      aoiAreaFeddans: +((aoiAreaKm2 ?? PLATFORM.aoiAreaKm2) * FEDDAN_PER_KM2).toFixed(1),
      referenceSeason: refSeasonLabel,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("run error", e);
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }
}

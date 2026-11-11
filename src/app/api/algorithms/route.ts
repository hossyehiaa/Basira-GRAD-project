// Basira — algorithm metadata + per-season demo comparison.
// FIX (custom-date crash): `season=custom` previously fell through the
// `season in demoResults.seasons` guard (no "custom" benchmark exists) and
// returned the RAW ALGORITHMS array, whose entries carry demoOa/demoKappa
// instead of oa/kappa — AlgorithmsSection then crashed on `kappa.toFixed`.
// Now: custom periods reuse the full-year benchmark, and EVERY response is
// normalized to the render-safe row shape (oa/kappa always finite numbers).
import { NextRequest, NextResponse } from "next/server";
import { ALGORITHMS } from "@/lib/basira/constants";
import demoResults from "@/data/demoResults.json";

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("season");
  // custom periods have no dedicated benchmark — reuse the full-year reference
  const season = raw === "custom" ? "full" : raw;
  const key = season && season in demoResults.seasons ? season : null;

  const rows = ALGORITHMS.map((a) => {
    const r = key ? demoResults.seasons[key][a.key] : null;
    return {
      algorithm: a.key,
      en: a.en,
      ar: a.ar,
      supervised: a.supervised,
      oa: finite(r?.oa) ? r.oa : (finite(a.demoOa) ? a.demoOa : 0),
      kappa: finite(r?.kappa) ? r.kappa : (finite(a.demoKappa) ? a.demoKappa : 0),
      mapUrl: r?.mapUrl ?? null,
    };
  });
  rows.sort((x, y) => y.oa - x.oa);
  return NextResponse.json({ season: key, algorithms: rows });
}

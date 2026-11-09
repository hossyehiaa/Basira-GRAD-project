// Basira — algorithm metadata + optional per-season demo comparison
import { NextRequest, NextResponse } from "next/server";
import { ALGORITHMS } from "@/lib/basira/constants";
import demoResults from "@/data/demoResults.json";

export async function GET(req: NextRequest) {
  const season = req.nextUrl.searchParams.get("season");
  if (season && season in demoResults.seasons) {
    const key = season === "custom" ? "full" : season;
    const rows = ALGORITHMS.map((a) => {
      const r = demoResults.seasons[key][a.key];
      return {
        algorithm: a.key,
        en: a.en,
        ar: a.ar,
        supervised: a.supervised,
        oa: r?.oa ?? 0,
        kappa: r?.kappa ?? 0,
        mapUrl: r?.mapUrl ?? null,
      };
    });
    rows.sort((x, y) => y.oa - x.oa);
    return NextResponse.json({ season: key, algorithms: rows });
  }
  return NextResponse.json({ algorithms: ALGORITHMS });
}

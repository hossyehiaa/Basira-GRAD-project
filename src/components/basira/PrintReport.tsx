"use client";
// Basira — printable comprehensive report (browser Print / Save-as-PDF).
// Always mounted; hidden on screen and shown in print media via globals.css
// (#app-root is hidden, #print-report is shown). window.print() renders it.
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { ALGO_BY_KEY, CLASSES, PLATFORM } from "@/lib/basira/constants";
import { CROP_DSS, FEDDAN_PER_KM2 } from "@/lib/basira/agronomy";
import type { AlgoKey, SeasonKey } from "@/lib/basira/types";

function seasonLabel(lang: "ar" | "en", season: SeasonKey, df?: string | null, dt?: string | null) {
  if (season === "winter") return t(lang, "seasonWinter");
  if (season === "summer") return t(lang, "seasonSummer");
  if (season === "full") return t(lang, "seasonFull");
  return `${df ?? ""} → ${dt ?? ""}`;
}

export function PrintReport() {
  const lang = useBasira((s) => s.lang);
  const runResult = useBasira((s) => s.runResult);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const algoName = (key: AlgoKey | string | undefined) =>
    key ? (lang === "ar" ? ALGO_BY_KEY[key]?.ar ?? key : ALGO_BY_KEY[key]?.en ?? key) : "—";

  const dssRows = (runResult?.classes ?? [])
    .filter((c) => CROP_DSS[c.code] && CROP_DSS[c.code].yieldTFed > 0)
    .map((c) => {
      const dss = CROP_DSS[c.code]!;
      const feddan = c.areaKm2 * FEDDAN_PER_KM2;
      return { ...c, feddan, yieldT: feddan * dss.yieldTFed, waterM3: feddan * dss.waterM3Fed };
    });
  const dssTotals = dssRows.reduce(
    (a, r) => ({ feddan: a.feddan + r.feddan, yieldT: a.yieldT + r.yieldT, waterM3: a.waterM3 + r.waterM3 }),
    { feddan: 0, yieldT: 0, waterM3: 0 }
  );
  const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
  const fmt1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <div
      id="print-report"
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="bg-white p-6 text-[10pt] leading-relaxed text-black"
    >
      <p className="mb-4 text-center text-[9pt] font-semibold text-black/70">
        {t(lang, "printHeaderNote")}
      </p>

      {!runResult ? (
        <p className="text-center">{t(lang, "noResults")}</p>
      ) : (
        <>
          {/* header */}
          <h1 className="text-center text-[16pt] font-extrabold">
            {lang === "ar" ? PLATFORM.nameAr : PLATFORM.nameEn} —{" "}
            {lang === "ar" ? PLATFORM.taglineAr : PLATFORM.taglineEn}
          </h1>
          <p className="mb-3 mt-1 text-center text-[9pt] text-black/70">
            {lang === "ar" ? PLATFORM.regionAr : PLATFORM.regionEn} · {PLATFORM.dataset} ·{" "}
            {t(lang, "statArea")}: {PLATFORM.aoiAreaKm2} km² · v{PLATFORM.version} — {stamp}
          </p>
          <hr className="mb-4 border-black/40" />

          {/* summary */}
          <h2 className="mb-1 text-[12pt] font-extrabold">{t(lang, "resTitle")}</h2>
          <table className="mb-4 w-full border-collapse text-[10pt]">
            <tbody>
              <tr>
                <td className="border border-black/30 p-1.5 font-bold">{t(lang, "ctrlAlgo")}</td>
                <td className="border border-black/30 p-1.5">{algoName(runResult.algorithm)}</td>
                <td className="border border-black/30 p-1.5 font-bold">{t(lang, "ctrlSeason")}</td>
                <td className="border border-black/30 p-1.5">
                  {seasonLabel(lang, runResult.season, runResult.dateFrom, runResult.dateTo)}
                </td>
              </tr>
              <tr>
                <td className="border border-black/30 p-1.5 font-bold">{t(lang, "metricOa")}</td>
                <td className="border border-black/30 p-1.5">
                  {runResult.oa == null ? "—" : `${(runResult.oa * 100).toFixed(1)}%`}
                </td>
                <td className="border border-black/30 p-1.5 font-bold">{t(lang, "metricKappa")}</td>
                <td className="border border-black/30 p-1.5">
                  {runResult.kappa == null ? "—" : runResult.kappa.toFixed(3)}
                </td>
              </tr>
              <tr>
                <td className="border border-black/30 p-1.5 font-bold">{t(lang, "runHistory")}</td>
                <td className="border border-black/30 p-1.5" colSpan={3}>
                  {runResult.mode === "live" ? t(lang, "mapLiveNote") : t(lang, "demoNote")}
                  {runResult.nVal != null && runResult.nVal > 0
                    ? ` · ${t(lang, "compareNVal").replace("{n}", String(runResult.nVal))}`
                    : ""}
                </td>
              </tr>
            </tbody>
          </table>

          {/* class table */}
          <h2 className="mb-1 text-[12pt] font-extrabold">{t(lang, "chartAreaTitle")}</h2>
          <table className="mb-4 w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="bg-black/5">
                <th className="border border-black/30 p-1 text-start">{t(lang, "tableClass")}</th>
                <th className="border border-black/30 p-1">{t(lang, "tableArea")}</th>
                <th className="border border-black/30 p-1">{t(lang, "tablePercent")}</th>
                <th className="border border-black/30 p-1">PA</th>
                <th className="border border-black/30 p-1">UA</th>
                <th className="border border-black/30 p-1">F1</th>
              </tr>
            </thead>
            <tbody>
              {runResult.classes.map((c) => (
                <tr key={c.code}>
                  <td className="border border-black/30 p-1 font-bold">
                    {lang === "ar" ? c.ar : c.en}
                  </td>
                  <td className="border border-black/30 p-1 text-end tabular-nums">
                    {c.areaKm2.toFixed(1)}
                  </td>
                  <td className="border border-black/30 p-1 text-end tabular-nums">
                    {c.percent.toFixed(1)}
                  </td>
                  <td className="border border-black/30 p-1 text-end tabular-nums">
                    {c.pa == null ? "—" : `${(c.pa * 100).toFixed(0)}%`}
                  </td>
                  <td className="border border-black/30 p-1 text-end tabular-nums">
                    {c.ua == null ? "—" : `${(c.ua * 100).toFixed(0)}%`}
                  </td>
                  <td className="border border-black/30 p-1 text-end tabular-nums">
                    {c.f1 == null ? "—" : c.f1.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* DSS table */}
          {dssRows.length > 0 && (
            <>
              <h2 className="mb-1 text-[12pt] font-extrabold">{t(lang, "dssTitle")}</h2>
              <table className="mb-4 w-full border-collapse text-[9.5pt]">
                <thead>
                  <tr className="bg-black/5">
                    <th className="border border-black/30 p-1 text-start">{t(lang, "tableClass")}</th>
                    <th className="border border-black/30 p-1">{t(lang, "dssFeddan")}</th>
                    <th className="border border-black/30 p-1">{t(lang, "dssYield")}</th>
                    <th className="border border-black/30 p-1">{t(lang, "dssWater")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dssRows.map((r) => (
                    <tr key={r.code}>
                      <td className="border border-black/30 p-1 font-bold">
                        {lang === "ar" ? r.ar : r.en}
                      </td>
                      <td className="border border-black/30 p-1 text-end tabular-nums">
                        {fmtInt(r.feddan)}
                      </td>
                      <td className="border border-black/30 p-1 text-end tabular-nums">
                        {fmt1(r.yieldT)}
                      </td>
                      <td className="border border-black/30 p-1 text-end tabular-nums">
                        {fmtInt(r.waterM3)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-black/5 font-extrabold">
                    <td className="border border-black/30 p-1">{t(lang, "dssTotal")}</td>
                    <td className="border border-black/30 p-1 text-end tabular-nums">
                      {fmtInt(dssTotals.feddan)}
                    </td>
                    <td className="border border-black/30 p-1 text-end tabular-nums">
                      {fmt1(dssTotals.yieldT)}
                    </td>
                    <td className="border border-black/30 p-1 text-end tabular-nums">
                      {fmtInt(dssTotals.waterM3)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mb-4 text-[8.5pt] text-black/70">{t(lang, "dssNote")}</p>
            </>
          )}

          {/* confusion matrix */}
          {runResult.confusion && (
            <>
              <h2 className="mb-1 text-[12pt] font-extrabold">{t(lang, "cmTitle")}</h2>
              <p className="mb-1 text-[9pt] text-black/70">{t(lang, "cmNote")}</p>
              <table className="mb-4 w-full border-collapse text-[9pt]">
                <thead>
                  <tr className="bg-black/5">
                    <th className="border border-black/30 p-1 text-start">
                      {t(lang, "cmActual")} \ {t(lang, "cmPredicted")}
                    </th>
                    {runResult.confusion.classIds.map((id) => {
                      const c = CLASSES.find((x) => x.id === id);
                      return (
                        <th key={id} className="border border-black/30 p-1">
                          {c ? (lang === "ar" ? c.ar : c.en) : id}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {runResult.confusion.rows.map((row, i) => {
                    const actual = CLASSES.find((x) => x.id === runResult.confusion!.classIds[i]);
                    return (
                      <tr key={i}>
                        <td className="border border-black/30 p-1 font-bold">
                          {actual ? (lang === "ar" ? actual.ar : actual.en) : "?"}
                        </td>
                        {row.map((n, j) => (
                          <td
                            key={j}
                            className={`border border-black/30 p-1 text-center tabular-nums ${
                              i === j ? "font-extrabold" : ""
                            }`}
                          >
                            {n}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          <hr className="mt-4 border-black/40" />
          <p className="mt-2 text-center text-[8.5pt] text-black/70">
            {lang === "ar" ? PLATFORM.nameAr : PLATFORM.nameEn} ·{" "}
            {lang === "ar" ? PLATFORM.regionAr : PLATFORM.regionEn} ·{" "}
            {runResult.mode === "live" ? t(lang, "mapLiveNote") : t(lang, "demoNote")} — {stamp}
          </p>
        </>
      )}
    </div>
  );
}

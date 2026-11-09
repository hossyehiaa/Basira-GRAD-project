"use client";
// Results panel: headline metrics, class table, area & NDVI charts,
// algorithm comparison chart, CSV export, run history
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Trophy, History, ClipboardList } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import {
  ALGO_BY_KEY,
  MONTHS_AR,
  MONTHS_EN,
  NDVI_PROFILES,
} from "@/lib/basira/constants";

interface HistoryRow {
  id: number;
  algorithm: string;
  season: string;
  oa: number;
  kappa: number;
  createdAt: string;
}

export function ResultsPanel() {
  const lang = useBasira((s) => s.lang);
  const runResult = useBasira((s) => s.runResult);
  const compareResults = useBasira((s) => s.compareResults);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const loadHistory = () => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setHistory(d.runs?.slice(0, 8) ?? []))
      .catch(() => setHistory([]));
  };
  useEffect(loadHistory, [runResult, compareResults]);

  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  function downloadCsv() {
    if (!runResult) return;
    const header = "class_id,class_code,class_en,class_ar,area_km2,percent,pa,ua,f1\n";
    const rows = runResult.classes
      .map(
        (c) =>
          `${c.classId},${c.code},${c.en},"${c.ar}",${c.areaKm2},${c.percent},${c.pa},${c.ua},${c.f1}`
      )
      .join("\n");
    const meta = `# Basira | بصيرة — ${ALGO_BY_KEY[runResult.algorithm]?.[lang === "ar" ? "ar" : "en"] ?? runResult.algorithm} | OA=${runResult.oa} | Kappa=${runResult.kappa}\n`;
    const blob = new Blob([meta + header + rows], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `basira_${runResult.algorithm}_${runResult.season}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!runResult) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center">
        <ClipboardList className="size-10 text-muted-foreground/50" />
        <p className="text-sm font-semibold text-muted-foreground">
          {t(lang, "noResults")}
        </p>
      </div>
    );
  }

  const areaConfig = {
    area: { label: t(lang, "tableArea") },
  } satisfies ChartConfig;
  const areaData = runResult.classes.slice(0, 10).map((c) => ({
    name: lang === "ar" ? c.ar : c.en,
    area: c.areaKm2,
    fill: c.color,
  }));

  const ndviData = MONTHS_AR.map((_, i) => {
    const row: Record<string, number | string> = {
      m: lang === "ar" ? MONTHS_AR[i] : MONTHS_EN[i],
    };
    for (const c of runResult.classes.slice(0, 5)) {
      row[c.code] = NDVI_PROFILES[c.code]?.[i] ?? 0;
    }
    return row;
  });
  const ndviConfig = Object.fromEntries(
    runResult.classes.slice(0, 5).map((c) => [
      c.code,
      { label: lang === "ar" ? c.ar : c.en, color: c.color },
    ])
  ) satisfies ChartConfig;

  const compareConfig = {
    oa: { label: t(lang, "chartOaAxis") },
  } satisfies ChartConfig;
  const compareData = (compareResults ?? [])
    .filter((r) => r.oa != null)
    .map((r) => ({
      name: lang === "ar" ? ALGO_BY_KEY[r.algorithm]?.ar : ALGO_BY_KEY[r.algorithm]?.en,
      oa: +((r.oa ?? 0) * 100).toFixed(1),
      fill: r.algorithm === runResult.algorithm ? "var(--color-chart-1)" : "var(--muted)",
    }));

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-extrabold text-muted-foreground">{t(lang, "resTitle")}</h3>
      {/* headline metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground">{t(lang, "metricOa")}</p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums text-primary">
            {runResult.oa == null ? (
              <span title={t(lang, "metricNoAcc")}>—</span>
            ) : (
              <>
                {(runResult.oa * 100).toFixed(1)}
                <span className="text-xl">%</span>
              </>
            )}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground">{t(lang, "metricKappa")}</p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums text-primary">
            {runResult.kappa == null ? <span title={t(lang, "metricNoAcc")}>—</span> : runResult.kappa.toFixed(3)}
          </p>
        </div>
      </div>

      {/* no-accuracy warning: supervised run with too few validation samples */}
      {runResult.algorithm !== "kmeans" &&
        (runResult.oa == null || (runResult.nVal != null && runResult.nVal < 10)) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 p-3 text-[11px] font-bold leading-relaxed text-amber-700 dark:text-amber-400">
          <span aria-hidden>⚠</span>
          <span>{t(lang, "warnNoAcc")}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary" className="gap-1 text-xs font-bold">
          {lang === "ar" ? ALGO_BY_KEY[runResult.algorithm]?.ar : ALGO_BY_KEY[runResult.algorithm]?.en}
          {" · "}
          {runResult.season === "winter"
            ? t(lang, "seasonWinter")
            : runResult.season === "summer"
              ? t(lang, "seasonSummer")
              : runResult.season === "full"
                ? t(lang, "seasonFull")
                : `${runResult.dateFrom ?? ""} → ${runResult.dateTo ?? ""}`}
        </Badge>
        <Button variant="outline" size="sm" onClick={downloadCsv} className="font-bold">
          <Download className="size-4" />
          {t(lang, "dlCsv")}
        </Button>
      </div>

      {/* class table */}
      <div className="slim-scroll max-h-80 overflow-auto rounded-xl border bg-card">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead className="text-xs">{t(lang, "tableClass")}</TableHead>
              <TableHead className="text-xs text-end">{t(lang, "tableArea")}</TableHead>
              <TableHead className="text-xs text-end">{t(lang, "tablePercent")}</TableHead>
              <TableHead className="text-xs text-end">PA</TableHead>
              <TableHead className="text-xs text-end">UA</TableHead>
              <TableHead className="text-xs text-end">F1</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runResult.classes.map((c) => (
              <TableRow key={c.code}>
                <TableCell className="py-2 text-xs font-bold">
                  <span className="me-1.5 inline-block size-3 rounded-sm border border-black/20 align-middle" style={{ backgroundColor: c.color }} />
                  {lang === "ar" ? c.ar : c.en}
                </TableCell>
                <TableCell className="py-2 text-end text-xs font-semibold tabular-nums">
                  {c.areaKm2.toFixed(1)}
                </TableCell>
                <TableCell className="py-2 text-end text-xs font-semibold tabular-nums">
                  {c.percent.toFixed(1)}
                </TableCell>
                <TableCell className="py-2 text-end text-xs tabular-nums text-muted-foreground">
                  {c.pa == null ? "—" : `${(c.pa * 100).toFixed(0)}%`}
                </TableCell>
                <TableCell className="py-2 text-end text-xs tabular-nums text-muted-foreground">
                  {c.ua == null ? "—" : `${(c.ua * 100).toFixed(0)}%`}
                </TableCell>
                <TableCell className="py-2 text-end text-xs font-bold tabular-nums">
                  {c.f1 == null ? "—" : c.f1.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* area chart */}
      <div className="rounded-xl border bg-card p-3">
        <p className="mb-2 text-xs font-extrabold text-muted-foreground">
          {t(lang, "chartAreaTitle")}
        </p>
        <ChartContainer config={areaConfig} className="h-52 w-full">
          <BarChart data={areaData} margin={{ top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              fontSize={10}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={44}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={10} width={34} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="area" radius={4}>
              {areaData.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>

      {/* NDVI profiles */}
      <div className="rounded-xl border bg-card p-3">
        <p className="mb-2 text-xs font-extrabold text-muted-foreground">
          {t(lang, "chartNdviTitle")}
        </p>
        <ChartContainer config={ndviConfig} className="h-52 w-full">
          <LineChart data={ndviData} margin={{ top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="m" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis domain={[0, 0.8]} tickLine={false} axisLine={false} fontSize={10} width={34} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {runResult.classes.slice(0, 5).map((c) => (
              <Line
                key={c.code}
                type="monotone"
                dataKey={c.code}
                stroke={c.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>

      {/* comparison */}
      {compareResults && compareResults.length > 0 && (
        <div className="rounded-xl border-2 border-primary/40 bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-extrabold text-muted-foreground">
              {t(lang, "chartAccTitle")}
            </p>
            <Badge className="gap-1 bg-primary text-primary-foreground">
              <Trophy className="size-3" />
              {t(lang, "bestAlgo")}:{" "}
              {lang === "ar" ? ALGO_BY_KEY[compareResults[0].algorithm]?.ar : ALGO_BY_KEY[compareResults[0].algorithm]?.en}
            </Badge>
          </div>
          <ChartContainer config={compareConfig} className="h-56 w-full">
            <BarChart data={compareData} margin={{ top: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                fontSize={9}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={52}
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                width={34}
                tickFormatter={(v) => `${v}%`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="oa" radius={4} />
            </BarChart>
          </ChartContainer>
          <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
            {t(lang, "compareNote")}{" "}
            {compareResults[0].oa != null && (
              <span className="text-primary">
                {(compareResults[0].oa * 100).toFixed(1)}% — Kappa{" "}
                {compareResults[0].kappa?.toFixed(3) ?? "—"}
              </span>
            )}
          </p>
          {compareResults[0].nVal != null && (
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {t(lang, "compareNVal").replace("{n}", String(compareResults[0].nVal))}
            </p>
          )}
          {compareResults[0].nVal != null && compareResults[0].nVal < 30 && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2.5 text-[11px] font-bold leading-relaxed text-amber-700 dark:text-amber-400">
              <span aria-hidden>⚠</span>
              <span>{t(lang, "warnSmallVal")}</span>
            </div>
          )}
        </div>
      )}

      {/* history */}
      <div className="rounded-xl border bg-card p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
          <History className="size-3.5" />
          {t(lang, "runHistory")}
        </p>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(lang, "historyEmpty")}</p>
        ) : (
          <ul className="slim-scroll max-h-44 space-y-1 overflow-y-auto">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] font-semibold"
              >
                <span>
                  #{h.id} · {lang === "ar" ? ALGO_BY_KEY[h.algorithm]?.ar : ALGO_BY_KEY[h.algorithm]?.en}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtPct(h.oa)} · κ={h.kappa.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

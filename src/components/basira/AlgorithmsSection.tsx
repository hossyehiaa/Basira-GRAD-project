"use client";
// Algorithms section — benchmark league table.
// v1.3: renders IMMEDIATELY on load from the local pre-computed benchmark
// data (constants.ts) — no "running…" placeholder, no fetch hang. The table
// then refreshes silently if the API provides seasonal demo numbers.
import { useEffect, useMemo, useState } from "react";
import { Trophy, Zap } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { ALGORITHMS } from "@/lib/basira/constants";

interface Row {
  algorithm: string;
  en: string;
  ar: string;
  supervised: boolean;
  oa: number;
  kappa: number;
}

/** Pre-computed benchmark league — instant, offline-safe, never hangs. */
function benchmarkRows(): Row[] {
  return ALGORITHMS.map((a) => ({
    algorithm: a.key,
    en: a.en,
    ar: a.ar,
    supervised: a.supervised,
    oa: a.demoOa,
    kappa: a.demoKappa,
  })).sort((x, y) => y.oa - x.oa);
}

export function AlgorithmsSection() {
  const lang = useBasira((s) => s.lang);
  const season = useBasira((s) => s.season);
  // instant initial render from the local benchmark data
  const [rows, setRows] = useState<Row[]>(benchmarkRows);

  useEffect(() => {
    let cancelled = false;
    // silent refresh with the selected season's demo numbers (if available)
    const load = async () => {
      try {
        const r = await fetch(`/api/algorithms?season=${season}`);
        if (!r.ok) return;
        const d = await r.json();
        const fresh: Row[] = d.algorithms ?? [];
        if (!cancelled && fresh.length > 0) setRows(fresh);
      } catch {
        /* keep the benchmark table — never a blank/hanging state */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [season]);

  const best = useMemo(() => rows[0], [rows]);

  return (
    <section id="algorithms" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "algoTitle")}</h2>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(lang, "algoSubtitle")}
      </p>

      <div className="glass slim-scroll mt-6 overflow-x-auto rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{t(lang, "algoColRank")}</TableHead>
              <TableHead className="text-xs">{t(lang, "algoColName")}</TableHead>
              <TableHead className="text-xs">{lang === "ar" ? "النوع" : "Type"}</TableHead>
              <TableHead className="text-xs">{t(lang, "algoColOa")}</TableHead>
              <TableHead className="hidden text-xs sm:table-cell">
                {t(lang, "algoColKappa")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow
                key={r.algorithm}
                className={`transition-colors hover:bg-primary/5 ${i === 0 ? "bg-primary/5" : ""}`}
              >
                <TableCell className="py-3 font-mono text-sm font-extrabold tabular-nums">
                  {i === 0 ? (
                    <Trophy className="size-4 text-primary" aria-label="best" />
                  ) : (
                    i + 1
                  )}
                </TableCell>
                <TableCell className="py-3">
                  <p className="text-sm font-extrabold">{lang === "ar" ? r.ar : r.en}</p>
                  <p className="mt-0.5 max-w-md text-[11px] leading-snug text-muted-foreground">
                    {lang === "ar"
                      ? ALGORITHMS.find((a) => a.key === r.algorithm)?.noteAr
                      : ALGORITHMS.find((a) => a.key === r.algorithm)?.noteEn}
                  </p>
                </TableCell>
                <TableCell className="py-3">
                  <Badge
                    variant={r.supervised ? "default" : "outline"}
                    className={`text-[10px] font-bold ${
                      r.supervised ? "" : "border-amber-500/60 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {r.supervised ? t(lang, "algoFamilySup") : t(lang, "algoFamilyUnsup")}
                  </Badge>
                </TableCell>
                <TableCell className="min-w-40 py-3">
                  <div className="flex items-center gap-2">
                    <Progress value={r.oa * 100} className="h-2 w-24" />
                    <span className="font-mono text-sm font-extrabold tabular-nums">
                      {(r.oa * 100).toFixed(1)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden py-3 font-mono text-sm font-bold tabular-nums sm:table-cell">
                  {r.kappa.toFixed(3)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {best && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Zap className="size-3.5 text-primary" />
          {t(lang, "compareNote")}{" "}
          <span className="text-primary">
            {lang === "ar" ? best.ar : best.en} — {(best.oa * 100).toFixed(1)}%
          </span>
        </p>
      )}
    </section>
  );
}

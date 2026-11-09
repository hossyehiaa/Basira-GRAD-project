"use client";
// Algorithms section — comparison table from the selected season's demo data
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
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

export function AlgorithmsSection() {
  const lang = useBasira((s) => s.lang);
  const season = useBasira((s) => s.season);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/algorithms?season=${season}`);
        const d = await r.json();
        if (!cancelled) setRows(d.algorithms ?? []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [season]);

  return (
    <section id="algorithms" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "algoTitle")}</h2>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(lang, "algoSubtitle")}
      </p>

      <div className="slim-scroll mt-6 overflow-x-auto rounded-xl border bg-card">
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t(lang, "running")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={r.algorithm} className={i === 0 ? "bg-primary/5" : ""}>
                  <TableCell className="py-3 text-sm font-extrabold tabular-nums">
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
                      className="text-[10px] font-bold"
                    >
                      {r.supervised ? t(lang, "algoFamilySup") : t(lang, "algoFamilyUnsup")}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-40 py-3">
                    <div className="flex items-center gap-2">
                      <Progress value={r.oa * 100} className="h-2 w-24" />
                      <span className="text-sm font-extrabold tabular-nums">
                        {(r.oa * 100).toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden py-3 text-sm font-bold tabular-nums sm:table-cell">
                    {r.kappa.toFixed(3)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

"use client";
/**
 * Basira — classification / instant-scan runner hook.
 * Shared by the ControlPanel (buttons) and the MapPanel (auto-scan after
 * drawing an area) so every entry point follows the same pipeline:
 *   live mode  -> background Earth Engine job (or sync in dev)
 *   demo mode  -> /api/runs (pre-computed / blended reference data)
 */
import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { ALGORITHMS } from "@/lib/basira/constants";
import {
  getGeeHealth,
  geeErrorMessage,
  submitGeeJob,
  type AoiGeoPayload,
} from "@/lib/gee/client";
import type { RunResult, CompareSummaryRow } from "@/lib/gee/engineTypes";
import type { AlgoKey, RunPayload } from "@/lib/basira/types";

/** Map a live engine result to the store payload shape. */
export function liveToPayload(r: RunResult): RunPayload {
  return {
    mode: "live",
    algorithm: r.algorithm,
    season: r.season,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    oa: r.oa,
    kappa: r.kappa,
    mapUrl: r.tileUrl,
    classes: r.classes.map((c) => ({
      classId: c.classId,
      code: c.code,
      en: c.en,
      ar: c.ar,
      color: c.color,
      areaKm2: c.areaKm2,
      percent: c.percent,
      pa: c.pa,
      ua: c.ua,
      f1: c.f1,
    })),
    confusion: r.confusion ?? null,
    nImages: r.nImages,
    durationMs: r.durationMs,
    downloadUrl: r.downloadUrl,
    nVal: r.nVal,
    aoiAreaKm2: r.areaKm2 ?? null,
    aoiName: r.aoiName ?? null,
  };
}

export function useScanRunner() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"run" | "compare" | null>(null);
  const [phase, setPhase] = useState<"submitted" | "running" | null>(null);

  /** Run one classification. `algorithmOverride` lets the instant scan run
   *  regardless of the algorithm selected in the panel. */
  const runOne = useCallback(
    async (algorithmOverride?: AlgoKey) => {
      const store = useBasira.getState();
      const lang = store.lang;
      const algorithm = algorithmOverride ?? store.algorithm;
      setBusy("run");
      setPhase(null);
      store.setCompareResults(null);
      useBasira.getState().setScanning(true);
      try {
        const aoiGeo = (!store.aoi.isDefault && store.aoi.geojson
          ? (store.aoi.geojson as AoiGeoPayload)
          : undefined);
        const aoiName = store.aoi.isDefault ? undefined : store.aoi.name;
        const aoiAreaKm2 =
          !store.aoi.isDefault && store.aoi.areaKm2 != null
            ? store.aoi.areaKm2
            : undefined;

        const health = await getGeeHealth();
        if (health.mode === "live") {
          const res = await submitGeeJob(
            {
              kind: "run",
              algorithm,
              season: store.season,
              dateFrom: store.season === "custom" ? store.dateFrom : undefined,
              dateTo: store.season === "custom" ? store.dateTo : undefined,
              rfTrees: store.rfTrees,
              kClusters: store.kClusters,
              knnK: store.knnK,
              mlpHidden: store.mlpHidden,
              mlpEpochs: store.mlpEpochs,
              samplePoints: store.samplePoints,
              aoiGeo,
              aoiName,
            },
            setPhase
          );
          if (res.kind !== "run") throw new Error("bad_kind");
          const run = liveToPayload(res.result);
          store.setRunResult(run);
          toast({
            title: t(lang, "toastRunOk"),
            description:
              run.oa == null
                ? `${t(lang, "metricImages")}: ${run.nImages ?? "—"}`
                : `${t(lang, "metricOa")}: ${(run.oa * 100).toFixed(1)}% · ${t(lang, "metricImages")}: ${run.nImages ?? "—"}`,
          });
        } else {
          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              algorithm,
              season: store.season,
              dateFrom: store.season === "custom" ? store.dateFrom : undefined,
              dateTo: store.season === "custom" ? store.dateTo : undefined,
              rfTrees: store.rfTrees,
              kClusters: store.kClusters,
              sampleSetId: store.sampleSetId,
              aoiAreaKm2,
              aoiName,
            }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({ error: "run_failed" }));
            throw Object.assign(new Error(d.error || "run failed"), { code: d.error });
          }
          const run: RunPayload = await res.json();
          store.setRunResult(run);
          toast({
            title: t(lang, "toastRunOk"),
            description:
              run.oa == null
                ? `${t(lang, "metricImages")}: ${run.nImages ?? "—"}`
                : `${t(lang, "metricOa")}: ${((run.oa ?? 0) * 100).toFixed(1)}%`,
          });
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        toast({
          variant: "destructive",
          title: t(lang, "toastRunErr"),
          description: geeErrorMessage(lang, code),
        });
      } finally {
        useBasira.getState().setScanning(false);
        setBusy(null);
        setPhase(null);
      }
    },
    [toast]
  );

  /** Compare all algorithms. With no training samples (instant scan mode)
   *  this falls back to the pre-computed benchmark league table. */
  const compareAll = useCallback(async () => {
    const store = useBasira.getState();
    const lang = store.lang;
    setBusy("compare");
    setPhase(null);
    useBasira.getState().setScanning(true);
    try {
      const aoiGeo = (!store.aoi.isDefault && store.aoi.geojson
        ? (store.aoi.geojson as AoiGeoPayload)
        : undefined);
      const aoiName = store.aoi.isDefault ? undefined : store.aoi.name;
      const aoiAreaKm2 =
        !store.aoi.isDefault && store.aoi.areaKm2 != null ? store.aoi.areaKm2 : undefined;
      const hasSamples = store.samplePoints.length >= 20;

      const health = await getGeeHealth();
      if (health.mode === "live" && hasSamples) {
        const res = await submitGeeJob(
          {
            kind: "compare",
            season: store.season,
            dateFrom: store.season === "custom" ? store.dateFrom : undefined,
            dateTo: store.season === "custom" ? store.dateTo : undefined,
            rfTrees: store.rfTrees,
            kClusters: store.kClusters,
            knnK: store.knnK,
            mlpHidden: store.mlpHidden,
            mlpEpochs: store.mlpEpochs,
            samplePoints: store.samplePoints,
            aoiGeo,
            aoiName,
          },
          setPhase
        );
        if (res.kind !== "compare") throw new Error("bad_kind");
        const best = liveToPayload(res.best);
        const byAlgo = new Map(res.summary.map((s: CompareSummaryRow) => [s.algorithm, s]));
        const rows: RunPayload[] = Array.from(byAlgo.entries()).map(([algo, s]) =>
          algo === best.algorithm
            ? { ...best, oa: s.oa ?? best.oa, kappa: s.kappa ?? best.kappa, nVal: s.nVal }
            : {
                mode: "live" as const,
                algorithm: algo as AlgoKey,
                season: store.season,
                oa: s.oa,
                kappa: s.kappa,
                nVal: s.nVal,
                classes: [],
              }
        );
        rows.sort((a, b) => {
          if (a.algorithm === best.algorithm) return -1;
          if (b.algorithm === best.algorithm) return 1;
          return (b.oa ?? -1) - (a.oa ?? -1);
        });
        store.setCompareResults(rows);
        store.setRunResult(rows[0] ?? best);
        const done = res.summary.filter((s: CompareSummaryRow) => s.oa != null).length;
        toast({
          title: t(lang, "toastCompareOk"),
          description: t(lang, "compareDoneCount")
            .replace("{n}", String(done))
            .replace("{total}", String(res.summary.length)),
        });
      } else {
        // instant-scan mode (no samples): reference benchmark comparison
        const results: RunPayload[] = [];
        for (const algo of ALGORITHMS) {
          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              algorithm: algo.key,
              season: store.season,
              dateFrom: store.season === "custom" ? store.dateFrom : undefined,
              dateTo: store.season === "custom" ? store.dateTo : undefined,
              aoiAreaKm2,
              aoiName,
            }),
          });
          if (res.ok) results.push(await res.json());
        }
        results.sort((a, b) => (b.oa ?? 0) - (a.oa ?? 0));
        store.setCompareResults(results);
        if (results[0]) store.setRunResult(results[0]);
        toast({
          title: t(lang, "toastCompareOk"),
          description: t(lang, "compareBenchmarkNote"),
        });
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast({
        variant: "destructive",
        title: t(lang, "toastRunErr"),
        description: geeErrorMessage(lang, code),
      });
    } finally {
      useBasira.getState().setScanning(false);
      setBusy(null);
      setPhase(null);
    }
  }, [toast]);

  return { busy, phase, runOne, compareAll };
}

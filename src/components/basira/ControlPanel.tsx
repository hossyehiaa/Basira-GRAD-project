"use client";
// Workspace control panel: AOI, season/period, algorithm, params, run/compare.
// Live mode (GEE key configured) submits real Earth Engine jobs — heavy ones
// through the background function — falling back to the demo engine otherwise.
import { useState } from "react";
import { Play, Swords, Loader2, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { ALGORITHMS } from "@/lib/basira/constants";
import {
  getGeeHealth,
  geeErrorMessage,
  submitGeeJob,
} from "@/lib/gee/client";
import type { RunResult, CompareSummaryRow } from "@/lib/gee/engineTypes";
import type { AlgoKey, RunPayload, SeasonKey } from "@/lib/basira/types";

/** Map a live engine result to the store payload shape. */
function liveToPayload(r: RunResult): RunPayload {
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
    nImages: r.nImages,
    durationMs: r.durationMs,
    downloadUrl: r.downloadUrl,
  };
}

export function ControlPanel() {
  const lang = useBasira((s) => s.lang);
  const store = useBasira();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"run" | "compare" | null>(null);
  const [phase, setPhase] = useState<"submitted" | "running" | null>(null);

  async function runOne() {
    setBusy("run");
    setPhase(null);
    store.setCompareResults(null);
    try {
      const health = await getGeeHealth();
      if (health.mode === "live") {
        const res = await submitGeeJob(
          {
            kind: "run",
            algorithm: store.algorithm,
            season: store.season,
            dateFrom: store.season === "custom" ? store.dateFrom : undefined,
            dateTo: store.season === "custom" ? store.dateTo : undefined,
            rfTrees: store.rfTrees,
            kClusters: store.kClusters,
            samplePoints: store.samplePoints,
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
            algorithm: store.algorithm,
            season: store.season,
            dateFrom: store.season === "custom" ? store.dateFrom : undefined,
            dateTo: store.season === "custom" ? store.dateTo : undefined,
            rfTrees: store.rfTrees,
            kClusters: store.kClusters,
            sampleSetId: store.sampleSetId,
            aoiId: store.aoi.id,
          }),
        });
        if (!res.ok) throw new Error("run failed");
        const run: RunPayload = await res.json();
        store.setRunResult(run);
        toast({
          title: t(lang, "toastRunOk"),
          description: `${t(lang, "metricOa")}: ${((run.oa ?? 0) * 100).toFixed(1)}%`,
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
      setBusy(null);
      setPhase(null);
    }
  }

  async function compareAll() {
    setBusy("compare");
    setPhase(null);
    try {
      const health = await getGeeHealth();
      if (health.mode === "live") {
        const res = await submitGeeJob(
          {
            kind: "compare",
            season: store.season,
            dateFrom: store.season === "custom" ? store.dateFrom : undefined,
            dateTo: store.season === "custom" ? store.dateTo : undefined,
            rfTrees: store.rfTrees,
            kClusters: store.kClusters,
            samplePoints: store.samplePoints,
          },
          setPhase
        );
        if (res.kind !== "compare") throw new Error("bad_kind");
        const best = liveToPayload(res.best);
        const byAlgo = new Map(res.summary.map((s: CompareSummaryRow) => [s.algorithm, s]));
        const rows: RunPayload[] = Array.from(byAlgo.entries()).map(([algo, s]) =>
          algo === best.algorithm
            ? // keep the summary accuracy so the ranking/badge stay consistent
              // even when the full run skipped accuracy (small validation set)
              { ...best, oa: s.oa ?? best.oa, kappa: s.kappa ?? best.kappa, nVal: s.nVal }
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
        // the engine-declared best always stays on top, the rest by accuracy
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
          description: t(lang, "compareDoneCount").replace("{n}", String(done)),
        });
      } else {
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
            }),
          });
          if (res.ok) results.push(await res.json());
        }
        results.sort((a, b) => (b.oa ?? 0) - (a.oa ?? 0));
        store.setCompareResults(results);
        if (results[0]) store.setRunResult(results[0]);
        toast({ title: t(lang, "toastCompareOk") });
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast({
        variant: "destructive",
        title: t(lang, "toastRunErr"),
        description: geeErrorMessage(lang, code),
      });
    } finally {
      setBusy(null);
      setPhase(null);
    }
  }

  const seasons: { key: SeasonKey; label: string }[] = [
    { key: "winter", label: t(lang, "seasonWinter") },
    { key: "summer", label: t(lang, "seasonSummer") },
    { key: "full", label: t(lang, "seasonFull") },
    { key: "custom", label: t(lang, "seasonCustom") },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* AOI */}
      <section className="rounded-xl border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold">
          <MapPinned className="size-4 text-primary" />
          {t(lang, "ctrlAoi")}
        </h3>
        <p className="text-sm font-bold text-primary">
          {store.aoi.isDefault
            ? t(lang, "aoiCurrent")
            : `${t(lang, "aoiCustom")}: ${lang === "ar" ? store.aoi.nameAr : store.aoi.name}`}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(lang, "aoiNote")}
        </p>
      </section>

      {/* Season */}
      <section className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-extrabold">{t(lang, "ctrlSeason")}</h3>
        <RadioGroup
          value={store.season}
          onValueChange={(v) => store.setSeason(v as SeasonKey)}
          className="grid grid-cols-1 gap-2"
        >
          {seasons.map((s) => (
            <Label
              key={s.key}
              htmlFor={`season-${s.key}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm font-semibold transition-colors has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/10"
            >
              <RadioGroupItem id={`season-${s.key}`} value={s.key} />
              {s.label}
            </Label>
          ))}
        </RadioGroup>
        {store.season === "custom" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
                {t(lang, "lblFrom")}
              </Label>
              <Input
                id="dateFrom"
                type="date"
                value={store.dateFrom}
                onChange={(e) => store.setDate(e.target.value, store.dateTo)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
                {t(lang, "lblTo")}
              </Label>
              <Input
                id="dateTo"
                type="date"
                value={store.dateTo}
                onChange={(e) => store.setDate(store.dateFrom, e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        )}
      </section>

      {/* Algorithm */}
      <section className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-extrabold">{t(lang, "ctrlAlgo")}</h3>
        <Select
          value={store.algorithm}
          onValueChange={(v) => store.setAlgorithm(v as AlgoKey)}
        >
          <SelectTrigger className="w-full font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t(lang, "algoFamilySup")}</SelectLabel>
              {ALGORITHMS.filter((a) => a.supervised).map((a) => (
                <SelectItem key={a.key} value={a.key} className="font-semibold">
                  {lang === "ar" ? a.ar : a.en}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{t(lang, "algoFamilyUnsup")}</SelectLabel>
              {ALGORITHMS.filter((a) => !a.supervised).map((a) => (
                <SelectItem key={a.key} value={a.key} className="font-semibold">
                  {lang === "ar" ? a.ar : a.en}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="mt-4">
          <h4 className="mb-2 text-xs font-bold text-muted-foreground">
            {t(lang, "ctrlParams")}
          </h4>
          {store.algorithm === "rf" && (
            <div>
              <Label htmlFor="rf-trees" className="text-xs">
                {t(lang, "lblTrees")}: <span className="font-extrabold tabular-nums">{store.rfTrees}</span>
              </Label>
              <Slider
                id="rf-trees"
                value={[store.rfTrees]}
                min={10}
                max={500}
                step={10}
                onValueChange={(v) => store.setRfTrees(v[0])}
                className="mt-2"
              />
            </div>
          )}
          {store.algorithm === "kmeans" && (
            <div>
              <Label htmlFor="k-clusters" className="text-xs">
                {t(lang, "lblK")}: <span className="font-extrabold tabular-nums">{store.kClusters}</span>
              </Label>
              <Slider
                id="k-clusters"
                value={[store.kClusters]}
                min={4}
                max={30}
                step={1}
                onValueChange={(v) => store.setKClusters(v[0])}
                className="mt-2"
              />
            </div>
          )}
          {store.algorithm !== "rf" && store.algorithm !== "kmeans" && (
            <p className="text-xs text-muted-foreground">
              {lang === "ar"
                ? "هذه الخوارزمية تعمل بالمعاملات الافتراضية المُثبّتة في المحرك."
                : "This algorithm runs with engine-tuned default parameters."}
            </p>
          )}
        </div>

        <div className="mt-4 rounded-lg bg-muted p-2.5">
          <p className="text-xs font-bold">
            {t(lang, "lblSamples")}:{" "}
            <span className="font-extrabold text-primary">
              {store.sampleSetId
                ? `${t(lang, "samplesCustom")} (${store.samplePoints.length} ${t(lang, "upPointsCount")})`
                : t(lang, "samplesDefault")}
            </span>
          </p>
        </div>
      </section>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button size="lg" className="text-base font-extrabold" onClick={runOne} disabled={busy !== null}>
          {busy === "run" ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
          {busy === "run"
            ? phase
              ? t(lang, phase === "submitted" ? "jobQueued" : "jobRunning")
              : t(lang, "running")
            : t(lang, "btnRun")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="text-sm font-extrabold"
          onClick={compareAll}
          disabled={busy !== null}
        >
          {busy === "compare" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Swords className="size-4" />
          )}
          {busy === "compare"
            ? phase
              ? t(lang, phase === "submitted" ? "jobQueued" : "jobRunning")
              : t(lang, "running")
            : t(lang, "btnCompare")}
        </Button>
      </div>
    </div>
  );
}

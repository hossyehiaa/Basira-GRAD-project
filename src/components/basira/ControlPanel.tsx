"use client";
// Workspace control panel: AOI (draw + direct coordinates), season/duration,
// algorithm, params, run/compare.
// Live mode (GEE key configured) submits real Earth Engine jobs — heavy ones
// through the background function — falling back to the demo engine otherwise.
import { useMemo, useState } from "react";
import { Play, Swords, Loader2, MapPinned, Crosshair, RotateCcw, PenLine, CalendarClock } from "lucide-react";
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
import { useScanRunner } from "@/hooks/use-scan";
import { useBasira, type AoiState } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { ALGORITHMS, SIGNATURE_ALGO } from "@/lib/basira/constants";
import { FEDDAN_PER_KM2 as FEDDAN } from "@/lib/basira/agronomy";
import {
  circleRing,
  bboxRing,
  bboxOfRing,
  validateScanArea,
  type LonLat,
} from "@/lib/basira/geo";
import type { AlgoKey, SeasonKey } from "@/lib/basira/types";

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function ControlPanel() {
  const lang = useBasira((s) => s.lang);
  const store = useBasira();
  const { toast } = useToast();
  const { busy, phase, runOne, compareAll } = useScanRunner();

  /* ---------------- coordinate input widget state ---------------- */
  const [coordMode, setCoordMode] = useState<"center" | "bbox">("center");
  const [cLat, setCLat] = useState("30.90");
  const [cLon, setCLon] = useState("29.60");
  const [cRadiusKm, setCRadiusKm] = useState("1.33"); // ≈ 500 feddans
  const [bboxN, setBboxN] = useState("30.90");
  const [bboxS, setBboxS] = useState("30.80");
  const [bboxE, setBboxE] = useState("29.65");
  const [bboxW, setBboxW] = useState("29.50");
  const [coordErr, setCoordErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  /* ---------------- duration selector state ---------------- */
  const [customDays, setCustomDays] = useState("120");

  // custom-range validation: end date must be strictly after the start date
  const customInvalid =
    store.season === "custom" &&
    (!store.dateFrom || !store.dateTo || store.dateFrom >= store.dateTo);

  /** Build the candidate polygon for the current coordinate inputs. */
  const candidateRing = useMemo<LonLat[] | null>(() => {
    if (coordMode === "center") {
      const lat = num(cLat), lon = num(cLon), r = num(cRadiusKm);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(r) || r <= 0) return null;
      return circleRing(lon, lat, r);
    }
    const n = num(bboxN), s = num(bboxS), e = num(bboxE), w = num(bboxW);
    if (![n, s, e, w].every(Number.isFinite) || n <= s || e <= w) return null;
    return bboxRing(w, s, e, n);
  }, [coordMode, cLat, cLon, cRadiusKm, bboxN, bboxS, bboxE, bboxW]);

  const candidateAreaKm2 = useMemo(
    () => (candidateRing ? validateScanArea(candidateRing) : null),
    [candidateRing]
  );

  /** Resolved period in days/months for the live duration badge. */
  const durationBadge = useMemo(() => {
    let days = 0;
    if (store.season === "custom") {
      if (!store.dateFrom || !store.dateTo || store.dateFrom >= store.dateTo) return null;
      const ms =
        new Date(store.dateTo).getTime() - new Date(store.dateFrom).getTime();
      // malformed ISO strings parse to NaN — never let that reach the badge
      if (!Number.isFinite(ms)) return null;
      days = Math.round(ms / 86400000) + 1;
    } else if (store.season === "winter") days = 181;
    else if (store.season === "summer") days = 184;
    else days = 365;
    const months = Math.max(1, Math.round(days / 30.44));
    return t(lang, "durationBadge")
      .replace("{d}", String(days))
      .replace("{m}", String(months));
  }, [store.season, store.dateFrom, store.dateTo, lang]);

  /** Apply the typed coordinates: build the polygon, persist to PostGIS,
   *  fly the map there, then run the instant scan immediately. */
  async function applyCoordinatesAndScan() {
    setCoordErr(null);
    if (!candidateRing) {
      setCoordErr(t(lang, "coordErrValues"));
      return;
    }
    const check = validateScanArea(candidateRing);
    if (!check.ok) {
      setCoordErr(t(lang, check.reason === "outside" ? "coordErrOutside" : check.reason === "size" ? "coordErrSize" : "coordErrValues"));
      return;
    }
    setApplying(true);
    try {
      const bbox = bboxOfRing(candidateRing);
      const name =
        coordMode === "center"
          ? `${(+cLat).toFixed(3)}°N ${(+cLon).toFixed(3)}°E · r=${(+cRadiusKm).toFixed(2)}km`
          : `BBox ${bbox.west.toFixed(3)}–${bbox.east.toFixed(3)}E / ${bbox.south.toFixed(3)}–${bbox.north.toFixed(3)}N`;
      const geojson = { type: "Polygon" as const, coordinates: [candidateRing] };

      // best-effort PostGIS persistence + exact ST_Area (non-blocking on failure)
      let areaKm2 = check.areaKm2;
      let id: number | null = null;
      try {
        const res = await fetch("/api/aoi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, geojson, areaKm2 }),
        });
        if (res.ok) {
          const d = await res.json();
          if (typeof d.areaKm2 === "number") areaKm2 = d.areaKm2;
          id = d.id ?? null;
        }
      } catch {
        /* offline/demo — the client estimate is enough */
      }

      const aoi: AoiState = {
        id,
        name,
        nameAr: name,
        geojson,
        isDefault: false,
        areaKm2,
        bbox,
      };
      store.setAoi(aoi);
      store.triggerScanTour(); // space-to-field camera dive
      toast({ title: t(lang, "aoiDrawnToast") });
      // immediate real-time scan of the selected area
      await runOne("signature");
    } finally {
      setApplying(false);
    }
  }

  /** Quick duration presets — computed from today. */
  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    store.setSeason("custom");
    store.setDate(iso(from), iso(to));
  }

  const seasons: { key: SeasonKey; label: string }[] = [
    { key: "winter", label: t(lang, "seasonWinter") },
    { key: "summer", label: t(lang, "seasonSummer") },
    { key: "full", label: t(lang, "seasonFull") },
    { key: "custom", label: t(lang, "seasonCustom") },
  ];

  const runLabel =
    store.algorithm === "signature" ? t(lang, "btnRunScan") : t(lang, "btnRun");

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------- AOI: draw + direct coordinates ---------------- */}
      <section className="glass rounded-xl p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold">
          <MapPinned className="size-4 text-primary" />
          {t(lang, "ctrlAoi")}
        </h3>
        <p className="text-sm font-bold text-primary">
          {store.aoi.isDefault
            ? t(lang, "aoiCurrent")
            : `${t(lang, "aoiCustom")}: ${store.aoi.name}`}
        </p>
        {!store.aoi.isDefault && store.aoi.areaKm2 != null && (
          <p className="mt-1 font-mono text-xs font-semibold text-muted-foreground">
            {t(lang, "aoiAreaLabel")}: {store.aoi.areaKm2.toFixed(2)} {t(lang, "km2Unit")} ·{" "}
            {Math.round(store.aoi.areaKm2 * FEDDAN).toLocaleString("en-US")}{" "}
            {t(lang, "feddanUnit")}
          </p>
        )}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(lang, "aoiNote")}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={store.areaDrawMode ? "default" : "outline"}
            className="h-8 gap-1.5 px-3 text-xs font-bold"
            onClick={() => {
              store.setAreaDrawMode(!store.areaDrawMode);
              if (!store.areaDrawMode) store.setDrawMode(false);
            }}
            title={t(lang, "aoiDrawHint")}
          >
            <PenLine className="size-3.5" />
            {t(lang, "aoiDrawToggle")}
          </Button>
          {!store.aoi.isDefault && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-3 text-xs font-bold"
              onClick={() => {
                store.resetAoi();
                toast({ title: t(lang, "toastAoiReset") });
              }}
            >
              <RotateCcw className="size-3.5" />
              {t(lang, "aoiResetBtn")}
            </Button>
          )}
        </div>
        {store.areaDrawMode && (
          <p className="mt-2 rounded-lg border border-primary/40 bg-primary/10 p-2 text-[11px] font-semibold leading-relaxed text-primary">
            {t(lang, "aoiDrawHint")}
          </p>
        )}

        {/* ---- direct coordinate & area input ---- */}
        <div className="mt-4 rounded-xl border bg-muted/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
            <Crosshair className="size-3.5 text-primary" />
            {t(lang, "coordTitle")}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant={coordMode === "center" ? "default" : "outline"}
              className="h-7 text-[11px] font-bold"
              onClick={() => setCoordMode("center")}
            >
              {t(lang, "coordModeCenter")}
            </Button>
            <Button
              size="sm"
              variant={coordMode === "bbox" ? "default" : "outline"}
              className="h-7 text-[11px] font-bold"
              onClick={() => setCoordMode("bbox")}
            >
              {t(lang, "coordModeBbox")}
            </Button>
          </div>

          {coordMode === "center" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordLat")}</Label>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={cLat}
                  onChange={(e) => setCLat(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordLon")}</Label>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={cLon}
                  onChange={(e) => setCLon(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordRadiusKm")}</Label>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={cRadiusKm}
                  onChange={(e) => setCRadiusKm(e.target.value)}
                  className="mt-1 h-8 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordAreaFeddans")}</Label>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={
                    Number.isFinite(num(cRadiusKm)) && num(cRadiusKm) > 0
                      ? Math.round(Math.PI * num(cRadiusKm) ** 2 * FEDDAN).toLocaleString("en-US")
                      : "—"
                  }
                  readOnly
                  className="mt-1 h-8 bg-muted font-mono text-xs text-muted-foreground"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordNorth")}</Label>
                <Input dir="ltr" inputMode="decimal" value={bboxN} onChange={(e) => setBboxN(e.target.value)} className="mt-1 h-8 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordSouth")}</Label>
                <Input dir="ltr" inputMode="decimal" value={bboxS} onChange={(e) => setBboxS(e.target.value)} className="mt-1 h-8 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordEast")}</Label>
                <Input dir="ltr" inputMode="decimal" value={bboxE} onChange={(e) => setBboxE(e.target.value)} className="mt-1 h-8 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t(lang, "coordWest")}</Label>
                <Input dir="ltr" inputMode="decimal" value={bboxW} onChange={(e) => setBboxW(e.target.value)} className="mt-1 h-8 font-mono text-xs" />
              </div>
            </div>
          )}

          {candidateAreaKm2?.ok && (
            <p className="mt-2 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              {t(lang, "aoiAreaLabel")}: {candidateAreaKm2.areaKm2.toFixed(2)} {t(lang, "km2Unit")} ·{" "}
              {Math.round(candidateAreaKm2.areaKm2 * FEDDAN).toLocaleString("en-US")} {t(lang, "feddanUnit")}
            </p>
          )}
          {coordErr && (
            <p className="mt-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-[11px] font-bold leading-relaxed text-destructive">
              {coordErr}
            </p>
          )}

          <Button
            size="sm"
            className="mt-3 w-full gap-1.5 text-xs font-extrabold"
            onClick={applyCoordinatesAndScan}
            disabled={applying || busy !== null}
          >
            {applying || busy === "run" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Crosshair className="size-3.5" />
            )}
            {t(lang, "coordApplyScan")}
          </Button>
        </div>
      </section>

      {/* ---------------- Season + duration ---------------- */}
      <section className="glass rounded-xl p-4">
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
          <>
            {/* date range — LTR inputs so dd/mm/yyyy renders consistently in
                both RTL & LTR; dark color-scheme keeps the picker dark */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
                  {t(lang, "lblFrom")}
                </Label>
                <Input
                  id="dateFrom"
                  type="date"
                  dir="ltr"
                  value={store.dateFrom}
                  onChange={(e) => store.setDate(e.target.value, store.dateTo)}
                  className="mt-1 font-mono text-xs dark:[color-scheme:dark]"
                />
              </div>
              <div>
                <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
                  {t(lang, "lblTo")}
                </Label>
                <Input
                  id="dateTo"
                  type="date"
                  dir="ltr"
                  value={store.dateTo}
                  onChange={(e) => store.setDate(store.dateFrom, e.target.value)}
                  className="mt-1 font-mono text-xs dark:[color-scheme:dark]"
                />
              </div>
            </div>
            {customInvalid ? (
              <p className="mt-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-[11px] font-bold leading-relaxed text-destructive">
                {t(lang, "errDateRange")}
              </p>
            ) : (
              <p className="mt-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
                {t(lang, "customMappedNote")}
              </p>
            )}
          </>
        )}

        {/* ---- flexible duration selector ---- */}
        <div className="mt-4 rounded-xl border bg-muted/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
            <CalendarClock className="size-3.5 text-primary" />
            {t(lang, "durationTitle")}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                [30, "durPreset30"],
                [60, "durPreset60"],
                [90, "durPreset90"],
                [180, "durPreset180"],
                [365, "durPreset365"],
              ] as const
            ).map(([days, key]) => (
              <Button
                key={days}
                size="sm"
                variant="outline"
                className="h-7 px-1 text-[10px] font-bold"
                onClick={() => applyPreset(days)}
              >
                {t(lang, key)}
              </Button>
            ))}
            <div className="col-span-3 flex items-center gap-1.5">
              <Input
                dir="ltr"
                inputMode="numeric"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className="h-7 w-20 font-mono text-[11px]"
                aria-label={t(lang, "durCustomDays")}
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-7 flex-1 text-[10px] font-bold"
                disabled={!Number.isFinite(num(customDays)) || num(customDays) < 2 || num(customDays) > 3650}
                onClick={() => applyPreset(Math.round(num(customDays)))}
              >
                {t(lang, "durCustomApply")}
              </Button>
            </div>
          </div>
        </div>

        {durationBadge && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-bold text-primary">
            <CalendarClock className="size-3" />
            {durationBadge}
          </p>
        )}
      </section>

      {/* ---------------- Algorithm ---------------- */}
      <section className="glass rounded-xl p-4">
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
              <SelectLabel>{t(lang, "algoFamilyInstant")}</SelectLabel>
              <SelectItem value={SIGNATURE_ALGO.key} className="font-semibold">
                {lang === "ar" ? SIGNATURE_ALGO.ar : SIGNATURE_ALGO.en}
              </SelectItem>
            </SelectGroup>
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

        {store.algorithm === "signature" && (
          <p className="mt-2 rounded-lg border border-primary/30 bg-primary/10 p-2 text-[11px] font-semibold leading-relaxed text-primary">
            {t(lang, "instantScanNote")}
          </p>
        )}
        {store.algorithm === "kmeans" && (
          <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
            {t(lang, "kmeansInfo")}
          </p>
        )}

        <div className="mt-4">
          <h4 className="mb-2 text-xs font-bold text-muted-foreground">
            {t(lang, "ctrlParams")}
          </h4>
          {store.algorithm === "rf" && (
            <div>
              <Label htmlFor="rf-trees" className="text-xs">
                {t(lang, "lblTrees")}: <span className="font-mono font-extrabold tabular-nums">{store.rfTrees}</span>
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
                {t(lang, "lblK")}: <span className="font-mono font-extrabold tabular-nums">{store.kClusters}</span>
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
          {store.algorithm === "knn" && (
            <div>
              <Label htmlFor="knn-k" className="text-xs">
                {t(lang, "lblKnnK")}: <span className="font-mono font-extrabold tabular-nums">{store.knnK}</span>
              </Label>
              <Slider
                id="knn-k"
                value={[store.knnK]}
                min={1}
                max={15}
                step={2}
                onValueChange={(v) => store.setKnnK(Math.max(1, v[0]))}
                className="mt-2"
              />
              <p className="mt-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
                {lang === "ar"
                  ? "قيم فردية (١، ٣، ٥…) تفضّل التصويت بلا تعادل."
                  : "Odd values (1, 3, 5…) avoid tied votes."}
              </p>
            </div>
          )}
          {store.algorithm === "mlp" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="mlp-hidden" className="text-xs">
                  {t(lang, "lblMlpHidden")}:{" "}
                  <span className="font-mono font-extrabold tabular-nums">{store.mlpHidden}</span>
                </Label>
                <Slider
                  id="mlp-hidden"
                  value={[store.mlpHidden]}
                  min={8}
                  max={64}
                  step={4}
                  onValueChange={(v) => store.setMlpHidden(v[0])}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="mlp-epochs" className="text-xs">
                  {t(lang, "lblMlpEpochs")}:{" "}
                  <span className="font-mono font-extrabold tabular-nums">{store.mlpEpochs}</span>
                </Label>
                <Slider
                  id="mlp-epochs"
                  value={[store.mlpEpochs]}
                  min={100}
                  max={1000}
                  step={50}
                  onValueChange={(v) => store.setMlpEpochs(v[0])}
                  className="mt-2"
                />
              </div>
              <p className="rounded-lg bg-muted p-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
                {t(lang, "mlpNote")}
              </p>
            </div>
          )}
          {!["rf", "kmeans", "knn", "mlp", "signature"].includes(store.algorithm) && (
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

      {/* ---------------- Actions ---------------- */}
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="text-base font-extrabold"
          onClick={() => runOne()}
          disabled={busy !== null || customInvalid}
        >
          {busy === "run" ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
          {busy === "run"
            ? phase
              ? t(lang, phase === "submitted" ? "jobQueued" : "jobRunning")
              : store.algorithm === "signature"
                ? t(lang, "scanning")
                : t(lang, "running")
            : runLabel}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="text-sm font-extrabold"
          onClick={compareAll}
          disabled={busy !== null || customInvalid}
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

"use client";
// Basira — interactive map (Leaflet): satellite basemap, AOI boundary,
// classification overlay, sample points, legend, opacity control,
// A/B split-view comparison with a draggable divider.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageOverlay as LImageOverlay, TileLayer as LTileLayer } from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  ImageOverlay,
  CircleMarker,
  LayersControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useTheme } from "next-themes";
import {
  Layers,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
  Eraser,
  Columns2,
  Loader2,
  ChevronsLeftRight,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import {
  ALGORITHMS,
  ALGO_BY_KEY,
  AOI_BOUNDS,
  AOI_CENTER,
  CLASSES,
  ESRI_ATTRIBUTION,
} from "@/lib/basira/constants";
import { getGeeHealth, submitGeeJob } from "@/lib/gee/client";
import { liveToPayload } from "./ControlPanel";
import type { AlgoKey, RunPayload, SeasonKey } from "@/lib/basira/types";

function getBounds(geo: unknown): [[number, number], [number, number]] | null {
  let minLat = 90,
    maxLat = -90,
    minLon = 180,
    maxLon = -180;
  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords as [number, number];
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      return;
    }
    for (const c of coords) walk(c);
  };
  const walkFeature = (f: unknown) => {
    if (!f || typeof f !== "object") return;
    const o = f as Record<string, unknown>;
    if (o.type === "FeatureCollection" && Array.isArray(o.features))
      o.features.forEach(walkFeature);
    else if (o.type === "Feature" && o.geometry) walkFeature(o.geometry);
    else if (o.coordinates) walk(o.coordinates);
  };
  walkFeature(geo);
  if (minLat > maxLat) return null;
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

function FitAoi({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, bounds]);
  return null;
}

/** Adds a training sample at each map click while draw mode is on. */
function DrawHandler() {
  const drawMode = useBasira((s) => s.drawMode);
  const drawClassId = useBasira((s) => s.drawClassId);
  const addSample = useBasira((s) => s.addSample);
  useMapEvents({
    click(e) {
      if (!drawMode) return;
      const cls = CLASSES.find((c) => c.id === drawClassId) ?? CLASSES[0];
      addSample({
        classId: cls.id,
        classEn: cls.en,
        classAr: cls.ar,
        lon: e.latlng.lng,
        lat: e.latlng.lat,
      });
    },
  });
  return null;
}

export default function MapPanel() {
  const lang = useBasira((s) => s.lang);
  const aoi = useBasira((s) => s.aoi);
  const runResult = useBasira((s) => s.runResult);
  const samplePoints = useBasira((s) => s.samplePoints);
  const drawMode = useBasira((s) => s.drawMode);
  const setDrawMode = useBasira((s) => s.setDrawMode);
  const drawClassId = useBasira((s) => s.drawClassId);
  const setDrawClassId = useBasira((s) => s.setDrawClassId);
  const clearSamples = useBasira((s) => s.clearSamples);
  const opacity = useBasira((s) => s.overlayOpacity);
  const setOpacity = useBasira((s) => s.setOverlayOpacity);
  const [defaultGeo, setDefaultGeo] = useState<unknown>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const { resolvedTheme } = useTheme();

  // ---- split-view (A/B comparison) state ----
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aTileRef = useRef<LTileLayer | null>(null);
  const aImgRef = useRef<LImageOverlay | null>(null);
  const bTileRef = useRef<LTileLayer | null>(null);
  const bImgRef = useRef<LImageOverlay | null>(null);
  const [splitOn, setSplitOn] = useState(false);
  const [sideB, setSideB] = useState<RunPayload | null>(null);
  const [pickAlgo, setPickAlgo] = useState<AlgoKey>("rf");
  const [pickSeason, setPickSeason] = useState<SeasonKey>("winter");
  const [loadingB, setLoadingB] = useState(false);
  const [bErr, setBErr] = useState(false);
  const [pos, setPos] = useState(50);

  const algoName = (k: string | undefined) =>
    k ? (lang === "ar" ? ALGO_BY_KEY[k]?.ar ?? k : ALGO_BY_KEY[k]?.en ?? k) : "—";
  const seasonShort = (s: SeasonKey, df?: string | null, dt?: string | null) =>
    s === "winter"
      ? t(lang, "seasonWinter")
      : s === "summer"
        ? t(lang, "seasonSummer")
        : s === "full"
          ? t(lang, "seasonFull")
          : `${(df ?? "").slice(0, 7)}→${(dt ?? "").slice(0, 7)}`;

  /** Load the B side of the comparison with the picked algorithm × season. */
  async function loadSideB() {
    if (!runResult) return;
    setLoadingB(true);
    setBErr(false);
    try {
      const health = await getGeeHealth();
      if (health.mode === "live") {
        const s = useBasira.getState();
        const res = await submitGeeJob({
          kind: "run",
          algorithm: pickAlgo,
          season: pickSeason,
          rfTrees: s.rfTrees,
          kClusters: s.kClusters,
          knnK: s.knnK,
          mlpHidden: s.mlpHidden,
          mlpEpochs: s.mlpEpochs,
          samplePoints: s.samplePoints,
        });
        if (res.kind !== "run") throw new Error("bad_kind");
        setSideB(liveToPayload(res.result));
      } else {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ algorithm: pickAlgo, season: pickSeason }),
        });
        if (!res.ok) throw new Error("sideB failed");
        setSideB((await res.json()) as RunPayload);
      }
    } catch {
      setSideB(null);
      setBErr(true);
    } finally {
      setLoadingB(false);
    }
  }

  /** Keep the two overlay layers clipped to the divider position. */
  useEffect(() => {
    const aEl =
      aTileRef.current?.getContainer?.() ?? aImgRef.current?.getElement?.() ?? null;
    const bEl =
      bTileRef.current?.getContainer?.() ?? bImgRef.current?.getElement?.() ?? null;
    if (!splitOn || !sideB?.mapUrl) {
      aEl?.style.removeProperty("clip-path");
      bEl?.style.removeProperty("clip-path");
      return;
    }
    if (aEl) aEl.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    if (bEl) bEl.style.clipPath = `inset(0 0 0 ${pos}%)`;
  }, [splitOn, sideB, pos, runResult, opacity]);

  /** Drag the divider: pointer events on the handle, move/up on window. */
  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const p = ((ev.clientX - rect.left) / rect.width) * 100;
      setPos(Math.min(98, Math.max(2, p)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  useEffect(() => {
    fetch("/borj_el_arab.geojson")
      .then((r) => r.json())
      .then(setDefaultGeo)
      .catch(() => setDefaultGeo(null));
  }, []);

  const activeGeo = aoi.isDefault ? defaultGeo : aoi.geojson;
  const fitBounds = useMemo(
    () => (aoi.isDefault ? AOI_BOUNDS : getBounds(aoi.geojson)),
    [aoi, activeGeo]
  );

  const showOverlay = Boolean(runResult?.mapUrl) && aoi.isDefault;
  // Live Earth Engine results are XYZ tile templates ({z}/{x}/{y});
  // demo results are static PNG overlays stretched over the AOI bounds.
  const isTileService = Boolean(runResult?.mapUrl?.includes("{z}"));

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border md:h-[620px]"
    >
      <MapContainer
        center={AOI_CENTER}
        zoom={10}
        minZoom={8}
        maxZoom={17}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <LayersControl position="topleft">
          <LayersControl.BaseLayer checked name={t(lang, "layerSat")}>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution={ESRI_ATTRIBUTION}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {showOverlay && isTileService && (
          <TileLayer
            ref={aTileRef}
            url={runResult!.mapUrl!}
            opacity={opacity}
            minZoom={8}
            maxZoom={17}
            attribution="Google Earth Engine · Copernicus Sentinel-2"
          />
        )}

        {showOverlay && !isTileService && (
          <ImageOverlay
            ref={aImgRef}
            url={runResult!.mapUrl!}
            bounds={AOI_BOUNDS}
            opacity={opacity}
          />
        )}

        {/* split-view B side (above A) */}
        {splitOn && sideB?.mapUrl && aoi.isDefault && sideB.mapUrl.includes("{z}") && (
          <TileLayer
            ref={bTileRef}
            url={sideB.mapUrl}
            opacity={opacity}
            minZoom={8}
            maxZoom={17}
            zIndex={250}
            attribution="Google Earth Engine · Copernicus Sentinel-2"
          />
        )}
        {splitOn && sideB?.mapUrl && aoi.isDefault && !sideB.mapUrl.includes("{z}") && (
          <ImageOverlay
            ref={bImgRef}
            url={sideB.mapUrl}
            bounds={AOI_BOUNDS}
            opacity={opacity}
          />
        )}

        {activeGeo ? (
          <GeoJSON
            key={aoi.isDefault ? "default" : `custom-${aoi.id}`}
            data={activeGeo as never}
            style={{
              color: resolvedTheme === "dark" ? "#4ade80" : "#166534",
              weight: 2.5,
              fill: false,
              dashArray: "6 4",
            }}
          />
        ) : null}

        {samplePoints.map((p, i) => (
          <CircleMarker
            key={`${p.classId}-${i}`}
            center={[p.lat, p.lon]}
            radius={5}
            pathOptions={{
              color: "#ffffff",
              weight: 1.5,
              fillColor: CLASSES.find((c) => c.id === p.classId)?.color ?? "#888888",
              fillOpacity: 0.95,
            }}
          />
        ))}

        <FitAoi bounds={fitBounds} />
        <DrawHandler />
      </MapContainer>

      {/* Sample drawing toolbar */}
      <div
        className={`absolute bottom-3 z-[2] flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur end-3 ${
          drawMode ? "border-primary" : ""
        }`}
      >
        <Button
          size="sm"
          variant={drawMode ? "default" : "outline"}
          className="h-7 gap-1 px-2 text-[11px] font-bold"
          onClick={() => setDrawMode(!drawMode)}
          title={t(lang, "drawHint")}
        >
          <MousePointerClick className="size-3.5" />
          {t(lang, "drawToggle")}
        </Button>
        <Select value={String(drawClassId)} onValueChange={(v) => setDrawClassId(Number(v))}>
          <SelectTrigger className="h-7 w-36 border text-[11px] font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASSES.map((c) => (
              <SelectItem key={c.id} value={String(c.id)} className="text-xs font-semibold">
                <span
                  className="me-1.5 inline-block size-2.5 rounded-sm border border-black/20"
                  style={{ backgroundColor: c.color }}
                />
                {lang === "ar" ? c.ar : c.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] font-bold text-muted-foreground tabular-nums">
          {samplePoints.length} {t(lang, "upPointsCount")}
        </span>
        {samplePoints.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] font-bold text-destructive hover:text-destructive"
            onClick={clearSamples}
            title={t(lang, "drawClear")}
          >
            <Eraser className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Legend */}
      <div className="absolute top-3 z-[2] max-w-[190px] rounded-lg border bg-background/95 p-2.5 shadow-lg backdrop-blur end-3">
        <button
          className="flex w-full items-center justify-between gap-2 text-xs font-bold"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
        >
          <span className="flex items-center gap-1.5">
            <Layers className="size-3.5" />
            {t(lang, "legendTitle")}
          </span>
          {legendOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {legendOpen && (
          <ul className="slim-scroll mt-2 grid max-h-64 grid-cols-1 gap-1 overflow-y-auto">
            {/* show only the classes present in the current result (fallback: all) */}
            {(runResult?.classes?.length
              ? runResult.classes.filter((c, i, arr) =>
                  arr.findIndex((x) => x.code === c.code) === i)
              : CLASSES
            ).map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-[11px] font-semibold">
                <span
                  className="size-3 shrink-0 rounded-sm border border-black/20"
                  style={{ backgroundColor: c.color }}
                />
                {lang === "ar" ? c.ar : c.en}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Opacity slider (visible with overlay) */}
      {showOverlay && (
        <div className="absolute bottom-3 z-[2] rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur start-3">
          <label className="mb-1 block text-[11px] font-bold text-muted-foreground">
            {t(lang, "opacity")}: {Math.round(opacity * 100)}%
          </label>
          <Slider
            value={[opacity * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => setOpacity(v[0] / 100)}
            className="w-36"
            aria-label={t(lang, "opacity")}
          />
        </div>
      )}

      {/* Status badge — reflects the overlay currently on the map */}
      {showOverlay && (
        <div
          className={`absolute top-3 z-[2] rounded-full border px-2.5 py-1 text-[10px] font-bold backdrop-blur start-3 ${
            runResult?.mode === "live"
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
          }`}
        >
          {t(lang, runResult?.mode === "live" ? "mapLiveNote" : "demoNote")}
        </div>
      )}

      {/* ---- split-view controls (top center) ---- */}
      <div className="absolute top-3 left-1/2 z-[5] flex -translate-x-1/2 flex-col items-center gap-1.5">
        <Button
          size="sm"
          variant={splitOn ? "default" : "outline"}
          className="h-7 gap-1 px-2 text-[11px] font-bold shadow-lg"
          onClick={() => setSplitOn(!splitOn)}
          disabled={!runResult}
          title={t(lang, "splitHint")}
        >
          <Columns2 className="size-3.5" />
          {t(lang, "splitToggle")}
        </Button>
        {splitOn && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
            <Select value={pickAlgo} onValueChange={(v) => setPickAlgo(v as AlgoKey)}>
              <SelectTrigger className="h-7 w-32 border text-[11px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t(lang, "algoFamilySup")}</SelectLabel>
                  {ALGORITHMS.filter((a) => a.supervised).map((a) => (
                    <SelectItem key={a.key} value={a.key} className="text-xs font-semibold">
                      {lang === "ar" ? a.ar : a.en}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t(lang, "algoFamilyUnsup")}</SelectLabel>
                  {ALGORITHMS.filter((a) => !a.supervised).map((a) => (
                    <SelectItem key={a.key} value={a.key} className="text-xs font-semibold">
                      {lang === "ar" ? a.ar : a.en}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={pickSeason} onValueChange={(v) => setPickSeason(v as SeasonKey)}>
              <SelectTrigger className="h-7 w-28 border text-[11px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="winter" className="text-xs font-semibold">
                  {t(lang, "seasonWinter")}
                </SelectItem>
                <SelectItem value="summer" className="text-xs font-semibold">
                  {t(lang, "seasonSummer")}
                </SelectItem>
                <SelectItem value="full" className="text-xs font-semibold">
                  {t(lang, "seasonFull")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] font-bold"
              onClick={loadSideB}
              disabled={loadingB}
            >
              {loadingB ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <span aria-hidden>⇄</span>
              )}
              {t(lang, "splitLoad")}
            </Button>
            {bErr && (
              <span className="text-[10px] font-bold text-destructive">{t(lang, "toastRunErr")}</span>
            )}
          </div>
        )}
      </div>

      {/* ---- divider + A/B labels (only with both sides loaded) ---- */}
      {splitOn && sideB?.mapUrl && showOverlay && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-[6]"
            style={{ left: `${pos}%` }}
          >
            <div className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
          </div>
          <button
            type="button"
            onPointerDown={onHandleDown}
            title={t(lang, "splitHint")}
            aria-label={t(lang, "splitHint")}
            className="absolute top-1/2 z-[7] flex size-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur"
            style={{ left: `${pos}%` }}
          >
            <ChevronsLeftRight className="size-4" />
          </button>
          <div
            className="absolute top-1/2 z-[5] -translate-y-1/2 whitespace-nowrap rounded-md border bg-background/95 px-1.5 py-1 text-[10px] font-extrabold shadow-lg backdrop-blur"
            style={{ left: `${Math.max(3, pos - 46)}%` }}
          >
            {t(lang, "splitALabel")} · {algoName(runResult?.algorithm)} · {" "}
            {seasonShort(runResult?.season ?? "winter", runResult?.dateFrom, runResult?.dateTo)}
          </div>
          <div
            className="absolute top-1/2 z-[5] -translate-y-1/2 whitespace-nowrap rounded-md border bg-primary/95 px-1.5 py-1 text-[10px] font-extrabold text-primary-foreground shadow-lg"
            style={{ left: `${Math.min(97, pos + 4)}%` }}
          >
            {t(lang, "splitBLabel")} · {algoName(sideB.algorithm)} · {" "}
            {seasonShort(sideB.season, sideB.dateFrom, sideB.dateTo)}
          </div>
          <p className="pointer-events-none absolute bottom-14 left-1/2 z-[5] -translate-x-1/2 rounded-full bg-background/85 px-2.5 py-1 text-[10px] font-bold text-muted-foreground shadow backdrop-blur">
            {t(lang, "splitHint")}
          </p>
        </>
      )}
    </div>
  );
}

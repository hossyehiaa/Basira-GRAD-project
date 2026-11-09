"use client";
// Basira — interactive map (Leaflet): satellite basemap, AOI boundary,
// classification overlay, sample points, legend, opacity control
import { useEffect, useMemo, useState } from "react";
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
import { Layers, ChevronDown, ChevronUp, MousePointerClick, Eraser } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import {
  AOI_BOUNDS,
  AOI_CENTER,
  CLASSES,
  ESRI_ATTRIBUTION,
} from "@/lib/basira/constants";

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
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border md:h-[620px]">
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
            url={runResult!.mapUrl!}
            opacity={opacity}
            minZoom={8}
            maxZoom={17}
            attribution="Google Earth Engine · Copernicus Sentinel-2"
          />
        )}

        {showOverlay && !isTileService && (
          <ImageOverlay
            url={runResult!.mapUrl!}
            bounds={AOI_BOUNDS}
            opacity={opacity}
          />
        )}

        {activeGeo && (
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
        )}

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
            {CLASSES.map((c) => (
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
    </div>
  );
}

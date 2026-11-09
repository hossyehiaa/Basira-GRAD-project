"use client";
// Data upload section — training samples CSV + custom AOI GeoJSON
import { useEffect, useRef, useState } from "react";
import { FileUp, CheckCircle2, XCircle, MapPinned, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { CLASSES } from "@/lib/basira/constants";
import { getGeeHealth } from "@/lib/gee/client";
import type { SamplePoint } from "@/lib/basira/types";

function parseCsv(text: string): SamplePoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iClass = header.indexOf("class");
  const iLon = header.findIndex((h) => h === "longitude" || h === "lon" || h === "x");
  const iLat = header.findIndex((h) => h === "latitude" || h === "lat" || h === "y");
  if (iClass < 0 || iLon < 0 || iLat < 0) return [];
  const byCode = new Map(CLASSES.map((c) => [c.code.toUpperCase(), c]));
  const byId = new Map(CLASSES.map((c) => [c.id, c]));
  const byAr = new Map(CLASSES.map((c) => [c.ar, c]));
  const byEn = new Map(CLASSES.map((c) => [c.en.toLowerCase(), c]));
  const pts: SamplePoint[] = [];
  for (const line of lines.slice(1, 20001)) {
    const cols = line.split(",").map((c) => c.trim());
    const clsRaw = cols[iClass];
    const cls =
      byCode.get(clsRaw.toUpperCase()) ??
      byId.get(Number(clsRaw)) ??
      byAr.get(clsRaw) ??
      byEn.get(clsRaw.toLowerCase());
    const lon = Number(cols[iLon]);
    const lat = Number(cols[iLat]);
    if (!cls || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    pts.push({ classId: cls.id, classEn: cls.en, classAr: cls.ar, lon, lat });
  }
  return pts;
}

function downloadTemplate() {
  const rows = ["class,class_en,class_ar,longitude,latitude"];
  for (const c of CLASSES) {
    for (let i = 0; i < 2; i++) {
      const j = i * 0.012;
      rows.push(
        `${c.code},${c.en},${c.ar},${(29.5 + j).toFixed(5)},${(30.85 + j).toFixed(5)}`
      );
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "basira_sample_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function UploadSection() {
  const lang = useBasira((s) => s.lang);
  const setSamples = useBasira((s) => s.setSamples);
  const setAoi = useBasira((s) => s.setAoi);
  const aoi = useBasira((s) => s.aoi);
  const { toast } = useToast();
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getGeeHealth()
      .then((h) => alive && setLive(h.mode === "live"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const csvRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<
    { kind: "ok" | "err"; msg: string } | null
  >(null);

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setUploadState(null);
    if (!file) return;
    try {
      const text = await file.text();
      const points = parseCsv(text);
      if (points.length === 0) {
        setUploadState({ kind: "err", msg: t(lang, "upResultBad") });
        toast({ variant: "destructive", title: t(lang, "upResultBad") });
        return;
      }
      const res = await fetch("/api/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, points }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSamples(data.id, data.points as SamplePoint[]);
      setUploadState({
        kind: "ok",
        msg: `${t(lang, "upResultOk")}: ${data.count} ${t(lang, "upPointsCount")}`,
      });
      toast({
        title: t(lang, "upResultOk"),
        description: `${data.count} ${t(lang, "upPointsCount")}${
          data.skipped ? ` · skipped: ${data.skipped}` : ""
        }`,
      });
    } catch {
      setUploadState({ kind: "err", msg: t(lang, "upResultBad") });
      toast({ variant: "destructive", title: t(lang, "upResultBad") });
    } finally {
      if (csvRef.current) csvRef.current.value = "";
    }
  }

  async function onGeo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setUploadState(null);
    if (!file) return;
    try {
      const text = await file.text();
      const geojson = JSON.parse(text);
      const res = await fetch("/api/aoi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name.replace(/\.geojson$/i, ""), geojson }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAoi({
        id: data.id,
        name: data.name,
        nameAr: data.nameAr,
        geojson: data.geojson,
        isDefault: false,
      });
      setUploadState({ kind: "ok", msg: t(lang, "toastAoiOk") });
      toast({ title: t(lang, "toastAoiOk"), description: data.name });
    } catch {
      setUploadState({ kind: "err", msg: t(lang, "upResultBad") });
      toast({ variant: "destructive", title: t(lang, "upResultBad") });
    } finally {
      if (geoRef.current) geoRef.current.value = "";
    }
  }

  const samplePoints = useBasira((s) => s.samplePoints);
  const counts = new Map<number, number>();
  for (const p of samplePoints) counts.set(p.classId, (counts.get(p.classId) ?? 0) + 1);

  return (
    <section id="upload" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "upTitle")}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(lang, "upSubtitle")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* samples CSV */}
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-1 flex items-center gap-2 text-base font-extrabold">
            <FileSpreadsheet className="size-5 text-primary" />
            {t(lang, "upSamplesTitle")}
          </h3>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {t(lang, "upSamplesHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={csvRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onCsv}
              className="max-w-xs text-xs"
              aria-label={t(lang, "upChooseFile")}
            />
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="font-bold">
              <FileUp className="size-4" />
              {t(lang, "upTemplate")}
            </Button>
          </div>
          {samplePoints.length > 0 && (
            <div className="mt-4 rounded-lg bg-muted/70 p-3">
              <p className="text-xs font-extrabold">
                {samplePoints.length} {t(lang, "upPointsCount")}
              </p>
              <div className="slim-scroll mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {CLASSES.filter((c) => counts.get(c.id)).map((c) => (
                  <span
                    key={c.code}
                    className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] font-bold"
                  >
                    <span className="size-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                    {lang === "ar" ? c.ar : c.en}: {counts.get(c.id)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {live ? t(lang, "upLiveNote") : t(lang, "demoNote")}
              </p>
            </div>
          )}
        </div>

        {/* AOI GeoJSON */}
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-1 flex items-center gap-2 text-base font-extrabold">
            <MapPinned className="size-5 text-primary" />
            {t(lang, "upAoiTitle")}
          </h3>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {t(lang, "upAoiHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={geoRef}
              type="file"
              accept=".geojson,.json,application/geo+json"
              onChange={onGeo}
              className="max-w-xs text-xs"
              aria-label={t(lang, "upAoiTitle")}
            />
            {!aoi.isDefault && (
              <Button
                variant="secondary"
                size="sm"
                className="font-bold"
                onClick={() => {
                  setAoi({
                    id: null,
                    name: "Borj El Arab",
                    nameAr: "برج العرب",
                    geojson: null,
                    isDefault: true,
                  });
                  toast({ title: t(lang, "toastAoiReset") });
                }}
              >
                {t(lang, "upAoiDefaultBtn")}
              </Button>
            )}
          </div>
          <p className="mt-4 rounded-lg bg-muted/70 p-3 text-xs font-bold">
            {t(lang, "upActiveAoi")}:{" "}
            <span className="text-primary">
              {aoi.isDefault ? t(lang, "aoiCurrent") : aoi.name}
            </span>
          </p>
        </div>
      </div>

      {uploadState && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl border p-3 text-sm font-bold ${
            uploadState.kind === "ok"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
          role="status"
        >
          {uploadState.kind === "ok" ? (
            <CheckCircle2 className="size-5 shrink-0" />
          ) : (
            <XCircle className="size-5 shrink-0" />
          )}
          {uploadState.msg}
        </div>
      )}
    </section>
  );
}

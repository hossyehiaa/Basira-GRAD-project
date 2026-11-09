"use client";
/**
 * Basira — client-side GEE job helper.
 * Production (Netlify): submit to the background function /gee-run and poll
 *   /api/gee/result/{jobId} (cold EE graphs can run for minutes).
 * Local dev: call the synchronous /api/gee/run route directly.
 */
import type { AlgoKey, SeasonKey, SamplePoint } from "@/lib/basira/types";
import type { RunResult, CompareSummaryRow } from "./engineTypes";

export interface GeeJobPayload {
  kind: "run" | "compare";
  algorithm?: AlgoKey;
  season: SeasonKey;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  cloudMax?: number;
  rfTrees?: number;
  kClusters?: number;
  samplePoints?: SamplePoint[];
}

export interface GeeHealth {
  ok: boolean;
  mode: "live" | "demo";
  jobs: "background" | "sync";
}

export type GeeJobResult =
  | { kind: "run"; result: RunResult }
  | { kind: "compare"; summary: CompareSummaryRow[]; best: RunResult };

let healthCache: GeeHealth | null = null;
export async function getGeeHealth(): Promise<GeeHealth> {
  if (healthCache) return healthCache;
  try {
    const r = await fetch("/api/gee/health", { cache: "no-store" });
    const d = await r.json();
    healthCache = {
      ok: Boolean(d.ok),
      mode: d.mode === "live" ? "live" : "demo",
      jobs: d.jobs === "background" ? "background" : "sync",
    };
  } catch {
    healthCache = { ok: false, mode: "demo", jobs: "sync" };
  }
  return healthCache;
}

function makeJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit a heavy GEE job with automatic progress callbacks.
 * onProgress(phase) lets the UI show what is happening.
 */
export async function submitGeeJob(
  payload: GeeJobPayload,
  onProgress?: (phase: "submitted" | "running") => void
): Promise<GeeJobResult> {
  const health = await getGeeHealth();
  if (health.mode !== "live") throw new Error("gee_demo_mode");

  if (health.jobs === "sync") {
    const res = await fetch("/api/gee/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || "run_failed"), { code: data.error });
    return data as GeeJobResult;
  }

  // background path
  const jobId = makeJobId();
  const res = await fetch("/gee-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ...payload }),
  });
  if (!res.ok && res.status !== 202) throw new Error("submit_failed");
  onProgress?.("submitted");

  const deadline = Date.now() + 7 * 60 * 1000; // 7 minutes max
  let unavailable = 0;
  while (Date.now() < deadline) {
    await sleep(3000);
    try {
      const r = await fetch(`/api/gee/result/${jobId}`, { cache: "no-store" });
      const d = await r.json();
      if (d.status === "done") return d as GeeJobResult;
      if (d.status === "error") {
        throw Object.assign(new Error(d.error || "job_failed"), { code: d.error, message: d.message });
      }
      if (d.unavailable) {
        unavailable++;
        if (unavailable >= 3) break; // blobs down -> fall back to sync
      } else {
        onProgress?.("running");
      }
    } catch (e) {
      if ((e as Error).message === "gee_demo_mode") throw e;
      const code = (e as { code?: string }).code;
      if (code) throw e; // real job error (already thrown above)
      // network hiccup — keep polling
    }
  }
  // fallback: synchronous attempt (works when EE cache is warm)
  const res2 = await fetch("/api/gee/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data2 = await res2.json();
  if (!res2.ok) throw Object.assign(new Error(data2.error || "run_failed"), { code: data2.error });
  return data2 as GeeJobResult;
}

/** Light scene tiles (true color / NDVI / NDWI). */
export async function fetchScene(payload: {
  layer: "truecolor" | "ndvi" | "ndwi";
  season: SeasonKey; year?: number; dateFrom?: string; dateTo?: string; cloudMax?: number;
}): Promise<{ tileUrl: string; nImages: number; dateFrom: string; dateTo: string; layer: string }> {
  const res = await fetch("/api/gee/scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "scene_failed"), { code: data.error });
  return data;
}

/** NDVI time series at a point (map click). */
export async function fetchNdviPoint(payload: {
  lon: number; lat: number;
  season: SeasonKey; year?: number; dateFrom?: string; dateTo?: string; cloudMax?: number;
}): Promise<{ series: { d: string; v: number }[] }> {
  const res = await fetch("/api/gee/ndvi-point", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "ndvi_failed"), { code: data.error });
  return data;
}

/** Map engine error codes to a bilingual message. */
export function geeErrorMessage(lang: "ar" | "en", code?: string): string {
  const M: Record<string, [string, string]> = {
    no_images: [
      "لا توجد صور Sentinel-2 لهذه الفترة/المنطقة — جرّب فترة أطول أو رفع نسبة السحب المسموحة.",
      "No Sentinel-2 images for this period/area — try a longer period or a higher cloud limit.",
    ],
    too_few_samples: [
      "العينات قليلة جدًا — الحد الأدنى ٢٠ نقطة، ويُنصح بـ ٣٠ نقطة لكل فئة على الأقل للحصول على نتائج موثوقة (ارسمها على الخريطة أو ارفع ملف CSV).",
      "Too few samples — the minimum is 20 points; 30+ per class is recommended for reliable results (draw on the map or upload a CSV).",
    ],
    need_two_classes: [
      "أدخل عينات لفئتين مختلفتين على الأقل قبل التصنيف الموجّه.",
      "Sample at least two different classes before supervised classification.",
    ],
    samples_outside_aoi: [
      "لم يُغطِّ أي من نقاط العينات بكسلًا صالحًا — تأكد أن العينات داخل حدود برج العرب وعلى أرض ظاهرة (ليست تحت سحاب كثيف).",
      "None of the sample points covered a valid pixel — make sure the samples are inside the Borj El Arab boundary and on cloud-free ground.",
    ],
    bad_date_range: [
      "نطاق التواريخ غير صالح — تأكد أن تاريخ البداية قبل النهاية.",
      "Invalid date range — the start date must be before the end date.",
    ],
    gee_not_configured: [
      "مفتاح Google Earth Engine غير مُعد على الخادم — المنصة تعمل بالوضع التجريبي.",
      "The Google Earth Engine key is not configured server-side — running in demo mode.",
    ],
    mahalanobis_needs_samples: [
      "خوارزمية «المسافة الدنيا — ماهالانوبيس» تحتاج عينات كثيرة لكل فئة (أكثر من عدد النطاقات الترددية ≈ ٣٠–٤٥ نقطة لكل فئة) لحساب مصفوفة التغاير — أضف المزيد من النقاط أو اختر خوارزمية أخرى.",
      "The Mahalanobis minimum-distance algorithm needs many samples per class (more than the number of feature bands, roughly 30–45 points per class) to invert the covariance matrix — add more points or pick another algorithm.",
    ],
    all_algorithms_failed: [
      "فشلت جميع الخوارزميات في التدريب على هذه العينات — تأكد أن النقاط داخل حدود منطقة الدراسة وموزعة على فئات مختلفة، ثم أعد المحاولة.",
      "All algorithms failed to train on these samples — make sure the points are inside the study area and spread across different classes, then retry.",
    ],
    job_failed: [
      "تعذّر تنفيذ المهمة على خوادم جوجل — حاول مرة أخرى.",
      "The job failed on Google servers — please try again.",
    ],
    run_failed: [
      "تعذّر تشغيل التصنيف — حاول مرة أخرى.",
      "Classification failed — please try again.",
    ],
    scene_failed: [
      "تعذّر تحميل الطبقة الفضائية.",
      "Failed to load the satellite layer.",
    ],
    ndvi_failed: [
      "تعذّر حساب منحنى NDVI عند هذه النقطة.",
      "Failed to compute the NDVI curve at this point.",
    ],
  };
  const pair = M[code ?? ""];
  if (!pair) return lang === "ar" ? "حدث خطأ غير متوقع." : "An unexpected error occurred.";
  return lang === "ar" ? pair[0] : pair[1];
}

/**
 * Basira — GEE server engine (shared by Next API routes & the Netlify
 * background function). Relative imports only, so the Netlify functions
 * bundler (esbuild) can trace it without tsconfig path aliases.
 *
 * Pipeline ported 1:1 from the phase-1 GEE Code Editor app:
 *   S2_SR_HARMONIZED -> SCL cloud mask -> indices -> monthly median stack +
 *   seasonal NDVI percentiles -> classifier (9 supervised incl. MLP hybrid +
 *   k-NN, plus KMeans) ->
 *   tiles via getMapId + accuracy (70/30 split, seed 42) + area@100m.
 *
 * IMPORTANT: no ee.* object may be created at module load time — the ee
 * client initializes lazily via getEE().
 */
import ee from "@google/earthengine";
import * as fs from "fs";

export const DATASET = "COPERNICUS/S2_SR_HARMONIZED";
export const EXPORT_CRS = "EPSG:32635"; // UTM 35N — correct zone for Borj El Arab

export interface CropClassDef {
  id: number; code: string; en: string; ar: string; color: string;
}
export const CLASSES: CropClassDef[] = [
  { id: 1, code: "WHT", en: "Wheat", ar: "قمح", color: "#ffff00" },
  { id: 2, code: "MZE", en: "Maize", ar: "ذرة", color: "#00ff00" },
  { id: 3, code: "RIC", en: "Rice", ar: "أرز", color: "#00ffff" },
  { id: 4, code: "CLV", en: "Clover", ar: "برسيم", color: "#008000" },
  { id: 5, code: "POT", en: "Potato", ar: "بطاطس", color: "#b5651d" },
  { id: 6, code: "BET", en: "Sugar Beet", ar: "بنجر السكر", color: "#ff69b4" },
  { id: 7, code: "FBA", en: "Faba Bean", ar: "فول", color: "#800080" },
  { id: 8, code: "SUN", en: "Sunflower", ar: "عباد الشمس", color: "#ff8c00" },
  { id: 9, code: "ORC", en: "Orchards", ar: "بساتين", color: "#808000" },
  { id: 10, code: "FLW", en: "Fallow", ar: "أرض بور", color: "#808080" },
  { id: 11, code: "URB", en: "Urban", ar: "عمران", color: "#ff0000" },
  { id: 12, code: "WTR", en: "Water", ar: "مياه", color: "#0000ff" },
];
const PALETTE = CLASSES.map((c) => c.color); // hex with #
const PALETTE_CSV = PALETTE.map((c) => c.slice(1)).join(",");
const NDVI_PALETTE = "d73027,f46d43,fdae61,fee08b,d9ef8b,a6d96a,66bd63,1a9850";
const NDWI_PALETTE = "8c510a,d8b365,f6e8c3,c7eae5,5ab4ac,01665e";

// Simplified Borj El Arab boundary — same polygon as the phase-1 app
import { BORJ_COORDS } from "./aoi";
// Turf-style geodesic polygon area — the IDENTICAL formula the client (geo.ts)
// uses and PostGIS ST_Area(geography) cross-checks, so the total area shown in
// every panel is the same number (single source of truth).
import { polygonAreaKm2, type LonLat } from "../basira/geo";

export type SeasonKey = "winter" | "summer" | "full" | "custom";
export type PeriodInput = {
  season: SeasonKey;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
};
export type AlgoKey =
  | "rf" | "svm" | "cart" | "gtb" | "nb" | "mlp" | "knn"
  | "mindist_e" | "mindist_m" | "kmeans" | "signature";
export const SUPERVISED_KEYS: AlgoKey[] = [
  "rf", "svm", "cart", "gtb", "nb", "mlp", "knn", "mindist_e", "mindist_m",
];
/** every algorithm that can execute a run (supervised + unsupervised + instant) */
export const RUNNABLE_KEYS: AlgoKey[] = [...SUPERVISED_KEYS, "kmeans", "signature"];

export interface MlpParams {
  /** hidden-layer units (default 24) */
  hidden?: number;
  /** training epochs (default 400) */
  epochs?: number;
}

/** Filled by the MLP hybrid trainer — the forward pass is then applied
 *  per-pixel inside Earth Engine as band math (see mlpClassifyImage). */
export interface MlpModel {
  bandNames: string[];
  /** sorted distinct class ids the model predicts (output order) */
  classIds: number[];
  mean: number[];
  std: number[];
  /** hidden weights [H][F] + biases [H] */
  w1: number[][];
  b1: number[];
  /** output weights [C][H] + biases [C] */
  w2: number[][];
  b2: number[];
}

export interface SampleInput { classId: number; lon: number; lat: number }

/** GeoJSON polygon AOI (user-drawn box / coordinate area / upload). */
export interface AoiGeoInput {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

export interface RunInput extends PeriodInput {
  kind?: "run" | "compare";
  algorithm: AlgoKey;
  cloudMax?: number;
  rfTrees?: number;
  kClusters?: number;
  /** k-NN neighbours (default 5) */
  knnK?: number;
  /** MLP hyper-parameters */
  mlpHidden?: number;
  mlpEpochs?: number;
  samplePoints?: SampleInput[];
  /** custom AOI (defaults to the built-in Borj El Arab polygon) */
  aoiGeo?: AoiGeoInput;
  aoiName?: string;
}

export interface ClassRow {
  classId: number; code: string; en: string; ar: string; color: string;
  areaKm2: number; percent: number;
  pa: number | null; ua: number | null; f1: number | null; support: number;
}

export interface RunResult {
  mode: "live";
  algorithm: AlgoKey;
  season: SeasonKey;
  dateFrom: string;
  dateTo: string;
  tileUrl: string | null;
  oa: number | null;
  kappa: number | null;
  classes: ClassRow[];
  /** confusion matrix (rows = actual, cols = predicted) when accuracy was computed */
  confusion?: { classIds: number[]; rows: number[][] } | null;
  nImages: number;
  nTrain: number;
  nVal: number;
  durationMs: number;
  downloadUrl: string | null;
  noteCode?: string; // no_accuracy | kmeans_no_accuracy | instant_estimate | ...
  /** total classified area (km²) of the exact AOI polygon */
  areaKm2: number;
  /** label of the AOI the run was executed on */
  aoiName?: string | null;
  /** how the training set was built: user points ("manual") or zero-click
   *  stratified spectral anchors ("auto" = الاستخراج التلقائي للعينات) */
  sampleSource?: "manual" | "auto";
  /** per-class anchor pixel counts behind an auto-sampled run */
  sampleClassCounts?: Record<string, number>;
}

export interface CompareSummaryRow {
  algorithm: AlgoKey; oa: number | null; kappa: number | null; nVal: number;
}

export class GEEError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Auth singleton                                                      */
/* ------------------------------------------------------------------ */
let eeReady: Promise<void> | null = null;

function readKey(): unknown {
  const path = process.env.GEE_KEY_FILE;
  if (path) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  }
  const raw = process.env.GEE_PRIVATE_KEY_JSON;
  if (!raw) throw new GEEError("gee_not_configured", "GEE service account key is not configured");
  return JSON.parse(raw);
}

export function isGEEConfigured(): boolean {
  return Boolean(process.env.GEE_PRIVATE_KEY_JSON || process.env.GEE_KEY_FILE);
}

export function getEE(): Promise<void> {
  if (!eeReady) {
    eeReady = new Promise<void>((resolve, reject) => {
      let key: unknown;
      try { key = readKey(); } catch (e) { eeReady = null; reject(e); return; }
      ee.data.authenticateViaPrivateKey(
        key,
        () => ee.initialize(null, null, () => resolve(), (err: unknown) => { eeReady = null; reject(err); }),
        (err: unknown) => { eeReady = null; reject(err); }
      );
    });
  }
  return eeReady;
}

// canonical promise wrapper — the ee client callbacks are cb(result, error)
function p<T>(callWithCb: (cb: (result: T, error: unknown) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    callWithCb((result, error) => (error ? reject(error) : resolve(result)));
  });
}

/* ------------------------------------------------------------------ */
/* Pipeline (identical to the phase-1 Code Editor app)                 */
/* ------------------------------------------------------------------ */
function maskClouds(img: any) {
  const scl = img.select("SCL");
  const clean = scl.neq(1).and(scl.neq(3)).and(scl.neq(8))
    .and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  // copyProperties keeps system:time_start so monthly filterDate works
  return img.updateMask(clean)
    .select(["B2", "B3", "B4", "B8", "B11", "B12"]).divide(10000)
    .copyProperties(img, ["system:time_start", "system:index"]);
}
function addIndices(img: any) {
  return img
    .addBands(img.normalizedDifference(["B8", "B4"]).rename("NDVI"))
    .addBands(img.normalizedDifference(["B3", "B8"]).rename("NDWI"))
    .addBands(img.normalizedDifference(["B8", "B11"]).rename("NDMI"));
}
function rawCollection(aoi: any, startISO: string, endISO: string, maxCloud: number) {
  return ee.ImageCollection(DATASET)
    .filterBounds(aoi).filterDate(startISO, endISO)
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", maxCloud));
}
function getS2(aoi: any, startISO: string, endISO: string, maxCloud: number) {
  return rawCollection(aoi, startISO, endISO, maxCloud).map(maskClouds).map(addIndices);
}
function monthDiff(a: string, b: string) {
  const d1 = new Date(a), d2 = new Date(b);
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}
function buildFeatures(s2: any, startISO: string, endISO: string) {
  const months = ee.List.sequence(0, Math.round(monthDiff(startISO, endISO)));
  const monthly = ee.ImageCollection.fromImages(months.map((n: any) => {
    const d = ee.Date(startISO).advance(n, "month");
    const m = s2.filterDate(d, d.advance(1, "month")).median();
    const mSel = ee.Image(ee.Algorithms.If(
      m.bandNames().size().gt(0),
      m.select(["NDVI", "NDWI", "NDMI"]),
      ee.Image.constant([-0.5, -0.5, -0.5]).rename(["NDVI", "NDWI", "NDMI"])
    ));
    return mSel.set("system:index", d.format("YYYY_MM")).set("system:time_start", d.millis());
  }));
  const ndvi = s2.select("NDVI");
  const stats = ndvi.reduce(ee.Reducer.percentile([10, 50, 90]))
    .addBands(ndvi.reduce(ee.Reducer.mean()).rename("NDVI_mean"))
    .addBands(ndvi.reduce(ee.Reducer.stdDev()).rename("NDVI_stdDev"));
  const med = s2.select(["B4", "B8", "B11", "B12"]).median();
  return monthly.toBands().addBands(stats).addBands(med);
}
function makeClassifier(key: AlgoKey, rfTrees: number, knnK: number) {
  if (key === "rf") return ee.Classifier.smileRandomForest(rfTrees || 100);
  if (key === "svm") return ee.Classifier.libsvm();
  if (key === "cart") return ee.Classifier.smileCart();
  if (key === "gtb") return ee.Classifier.smileGradientTreeBoost(60);
  if (key === "nb") return ee.Classifier.smileNaiveBayes();
  if (key === "knn") return ee.Classifier.smileKNN(Math.min(Math.max(knnK || 5, 1), 15));
  if (key === "mindist_e") return ee.Classifier.minimumDistance("euclidean");
  if (key === "mindist_m") return ee.Classifier.minimumDistance("mahalanobis");
  if (key === "mlp") return null; // hybrid — handled by trainMlp/mlpClassifyImage
  throw new GEEError("unknown_algorithm", key);
}

export function resolvePeriod(input: PeriodInput): { start: string; end: string } {
  const y = input.year ?? 2025;
  if (input.season === "winter") return { start: `${y - 1}-11-01`, end: `${y}-04-30` };
  if (input.season === "summer") return { start: `${y}-05-01`, end: `${y}-10-31` };
  if (input.season === "full") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (!input.dateFrom || !input.dateTo || input.dateFrom >= input.dateTo) {
    throw new GEEError("bad_date_range");
  }
  return { start: input.dateFrom, end: input.dateTo };
}

/* ------------------------------------------------------------------ */
/* AOI handling — built-in Borj El Arab or any user polygon            */
/* ------------------------------------------------------------------ */

/** Build the EE geometry for a run: the custom GeoJSON polygon when given,
 *  otherwise the built-in Borj El Arab boundary. */
export function makeAoi(aoiGeo?: AoiGeoInput): any {
  if (aoiGeo?.type === "MultiPolygon") {
    return ee.Geometry.MultiPolygon(aoiGeo.coordinates);
  }
  if (aoiGeo?.type === "Polygon") {
    return ee.Geometry.Polygon(aoiGeo.coordinates);
  }
  return ee.Geometry.Polygon([BORJ_COORDS]);
}

/** Exact AOI area in m² — Turf-style geodesic ring sum (the same formula as
 *  the client's geo.ts), so the AOI chip, the results chip and PostGIS all
 *  agree on one number. */
export function aoiGeoAreaM2(aoiGeo?: AoiGeoInput): number {
  if (aoiGeo?.type === "Polygon") {
    return polygonAreaKm2((aoiGeo.coordinates as number[][][]) as unknown as LonLat[][]) * 1e6;
  }
  if (aoiGeo?.type === "MultiPolygon") {
    return (aoiGeo.coordinates as number[][][][]).reduce(
      (s, rings) => s + polygonAreaKm2(rings as unknown as LonLat[][]) * 1e6,
      0
    );
  }
  return polygonAreaKm2([BORJ_COORDS as unknown as LonLat[]]) * 1e6;
}

/* ------------------------------------------------------------------ */
/* Instant scan — reference spectral signature library                 */
/*                                                                    */
/* Knowledge-based centroid classifier (no training samples needed):   */
/* each class is represented by a reference signature over 9 seasonal  */
/* features derived from Egyptian crop calendars (see the methodology  */
/* section). Pixels are assigned to the nearest class in scaled        */
/* feature space — an instant estimate, clearly labelled as such.      */
/* ------------------------------------------------------------------ */

export const SIG_FEATURES = [
  "NDVI_mean", "NDVI_p10", "NDVI_p90",
  "NDWI_mean", "NDMI_mean",
  "B4_median", "B8_median", "B11_median", "B12_median",
] as const;

/** per-feature normalization scales (typical between-class spread), tuned to
 *  the measured Borj El Arab winter/summer feature space (probe script). */
export const SIG_SCALES = [0.18, 0.2, 0.22, 0.22, 0.15, 0.1, 0.07, 0.12, 0.11];

/** Reference signatures per class id — [NDVI_mean, p10, p90, NDWI, NDMI, B4, B8, B11, B12].
 *  Calibrated against measured Sentinel-2 feature distributions over Borj El
 *  Arab (scripts/probe_signatures.ts + probe_october.cjs): bright sandy bare
 *  fields (B4≈0.30, B11≈0.44) are الفلاح/fallow, while real towns are darker
 *  in red/SWIR with tree-driven NDVI≈0.22 (B4≈0.24, B11≈0.37). Winter =
 *  Nov–Apr, Summer = May–Oct. */
export const SIGNATURES: Record<"winter" | "summer", Record<number, number[]>> = {
  winter: {
    1:  [0.52, 0.20, 0.80, -0.54, 0.21, 0.11, 0.40, 0.24, 0.155], // WHT peaks Feb–Mar
    2:  [0.14, 0.07, 0.25, -0.30, 0.01, 0.22, 0.37, 0.35, 0.28], // MZE off-season (inactive)
    3:  [0.15, 0.08, 0.26, -0.28, 0.01, 0.21, 0.37, 0.34, 0.27], // RIC off-season (inactive)
    4:  [0.57, 0.33, 0.78, -0.57, 0.25, 0.10, 0.42, 0.245, 0.155], // CLV multi-cut, dense
    5:  [0.40, 0.22, 0.62, -0.50, 0.15, 0.135, 0.38, 0.275, 0.185], // POT
    6:  [0.50, 0.28, 0.72, -0.53, 0.21, 0.12, 0.39, 0.26, 0.17], // BET dense canopy
    7:  [0.46, 0.23, 0.70, -0.51, 0.17, 0.135, 0.37, 0.265, 0.18], // FBA
    8:  [0.15, 0.08, 0.24, -0.31, 0.01, 0.22, 0.37, 0.35, 0.28], // SUN off-season (inactive)
    9:  [0.60, 0.47, 0.75, -0.58, 0.26, 0.095, 0.43, 0.245, 0.15], // ORC evergreen, stable
    10: [0.11, 0.08, 0.16, -0.25, -0.06, 0.30, 0.37, 0.44, 0.36], // FLW bright/dry bare sand (measured)
    11: [0.22, 0.16, 0.28, -0.32, -0.01, 0.25, 0.36, 0.38, 0.31], // URB towns — brighter B4/B8/B12 than dark bare fields (measured)
    12: [-0.30, -0.45, -0.12, 0.45, -0.03, 0.07, 0.04, 0.03, 0.02], // WTR dark NIR, +NDWI
  },
  summer: {
    1:  [0.14, 0.07, 0.24, -0.29, 0.00, 0.23, 0.38, 0.36, 0.29], // WHT harvested (inactive)
    2:  [0.48, 0.24, 0.76, -0.53, 0.22, 0.11, 0.41, 0.25, 0.16], // MZE
    3:  [0.52, 0.26, 0.78, -0.50, 0.25, 0.10, 0.41, 0.24, 0.155], // RIC flooded, wet
    4:  [0.40, 0.22, 0.60, -0.55, 0.18, 0.12, 0.40, 0.26, 0.17], // CLV minor summer
    5:  [0.40, 0.22, 0.62, -0.52, 0.17, 0.13, 0.38, 0.27, 0.18], // POT late summer
    6:  [0.18, 0.10, 0.30, -0.34, 0.04, 0.20, 0.38, 0.34, 0.27], // BET autumn sowing (inactive)
    7:  [0.13, 0.07, 0.22, -0.30, 0.00, 0.23, 0.38, 0.36, 0.29], // FBA off-season (inactive)
    8:  [0.44, 0.22, 0.72, -0.52, 0.19, 0.12, 0.39, 0.26, 0.17], // SUN
    9:  [0.60, 0.47, 0.75, -0.58, 0.26, 0.095, 0.43, 0.245, 0.15], // ORC
    10: [0.11, 0.08, 0.16, -0.25, -0.06, 0.30, 0.37, 0.44, 0.36], // FLW bright/dry bare sand (measured)
    11: [0.22, 0.16, 0.28, -0.32, -0.01, 0.25, 0.36, 0.38, 0.31], // URB towns — brighter B4/B8/B12 than dark bare fields (measured)
    12: [-0.30, -0.45, -0.12, 0.45, -0.03, 0.07, 0.04, 0.03, 0.02], // WTR
  },
};

/** Additional per-class signature VARIANTS — bare agricultural land is
 *  spectrally bimodal: bright dry sand fields vs dark wet/harvested-stubble
 *  fields. Class 10 (بور) competes with BOTH signatures, so a pixel is
 *  labelled fallow when EITHER is nearest — this stops dark bare fields
 *  from collapsing into the urban class in transition windows.
 *  Dark-variant values measured Oct 2026 over Borj El Arab farms
 *  (scripts/probe_october.mjs + ESA WorldCover cross-check). */
export const SIGNATURE_VARIANTS: Record<"winter" | "summer", Record<number, number[][]>> = {
  winter: {
    10: [[0.19, 0.14, 0.26, -0.30, -0.04, 0.22, 0.34, 0.36, 0.29]], // dark wet/stubble bare fields
  },
  summer: {
    10: [[0.19, 0.14, 0.26, -0.30, -0.04, 0.22, 0.34, 0.36, 0.29]], // dark wet/stubble bare fields
  },
};

/** Classes the instant scan competes per season — the crop calendar decides:
 *  off-season crops (e.g. maize in winter) never win, so their labels can't
 *  appear with misleading shares. */
export const ACTIVE_SIGNATURE_CLASSES: Record<"winter" | "summer" | "full", number[]> = {
  winter: [1, 4, 5, 6, 7, 9, 10, 11, 12],
  summer: [2, 3, 4, 5, 8, 9, 10, 11, 12],
  full: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

/** Regional prevalence prior per class (Egyptian cropping-statistics weight,
 *  0..1). Applied as a MAP-style distance bonus so the instant estimate does
 *  not scatter the spectrally similar crop mass into minor classes. */
export const SIG_PRIORS: Record<"winter" | "summer", Record<number, number>> = {
  winter: { 1: 0.95, 4: 0.85, 5: 0.3, 6: 0.55, 7: 0.35, 9: 0.65, 10: 0.85, 11: 0.5, 12: 0.45 },
  summer: { 2: 0.9, 3: 0.6, 4: 0.3, 5: 0.35, 8: 0.5, 9: 0.65, 10: 0.85, 11: 0.5, 12: 0.45 },
};
/** prior bonus strength (squared-distance units) */
export const SIG_PRIOR_LAMBDA = 1.2;

function priorOf(classId: number, season: "winter" | "summer" | "full"): number {
  if (season === "full") {
    const w = SIG_PRIORS.winter[classId] ?? 0.3;
    const s = SIG_PRIORS.summer[classId] ?? 0.3;
    return (w + s) / 2;
  }
  return SIG_PRIORS[season][classId] ?? 0.3;
}

/** Signature for a class in a given season ("full" = mean of both). */
function seasonalSignature(classId: number, season: "winter" | "summer" | "full"): number[] {
  const w = SIGNATURES.winter[classId];
  const s = SIGNATURES.summer[classId];
  if (season === "winter") return w;
  if (season === "summer") return s;
  return w.map((v, i) => (v + s[i]) / 2);
}

/** All competing signatures for a class in a season: the primary plus any
 *  bimodal variants ("full" season averages the seasonal variants). */
function variantsOf(classId: number, season: "winter" | "summer" | "full"): number[][] {
  const primary = seasonalSignature(classId, season);
  if (season === "full") {
    const w = SIGNATURE_VARIANTS.winter[classId] ?? [];
    const s = SIGNATURE_VARIANTS.summer[classId] ?? [];
    if (!w.length || !s.length) return [primary];
    const out: number[][] = [];
    const n = Math.max(w.length, s.length);
    for (let i = 0; i < n; i++) {
      const a = w[i % w.length];
      const b = s[i % s.length];
      out.push(a.map((v, k) => (v + b[k]) / 2));
    }
    return [primary, ...out];
  }
  return [primary, ...(SIGNATURE_VARIANTS[season][classId] ?? [])];
}

/** Which reference season fits a date range (≥10 months → full-year). */
export function signatureSeason(start: string, end: string): "winter" | "summer" | "full" {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isFinite(a) && Number.isFinite(b) && b - a >= 300 * 86400000) return "full";
  const mid = new Date((a + b) / 2).getMonth() + 1;
  return mid >= 5 && mid <= 10 ? "summer" : "winter";
}

/** Reduced 9-feature seasonal stack the signature classifier works on. */
export function signatureFeatures(s2: any): any {
  const ndvi = s2.select("NDVI");
  const stats = ndvi.reduce(ee.Reducer.percentile([10, 90]))
    .addBands(ndvi.reduce(ee.Reducer.mean()).rename("NDVI_mean"));
  return ee.Image.cat([
    stats,
    s2.select("NDWI").mean().rename("NDWI_mean"),
    s2.select("NDMI").mean().rename("NDMI_mean"),
    s2.select(["B4", "B8", "B11", "B12"]).median()
      .rename(["B4_median", "B8_median", "B11_median", "B12_median"]),
  ]);
}

/** Nearest-reference-signature classification (instant scan, no samples).
 *  Only the season's active classes (crop calendar) compete for pixels.
 *  Each class competes through one OR MORE signature variants (bimodal
 *  bare land); the winning band's owning class labels the pixel. */
export function signatureClassifyImage(sigFeats: any, season: "winter" | "summer" | "full"): any {
  const x = sigFeats.select(SIG_FEATURES as unknown as string[]);
  const scales = ee.Image.constant(SIG_SCALES);
  const active = ACTIVE_SIGNATURE_CLASSES[season];
  // one distance band per (class, variant); band → owning class
  const owner: number[] = [];
  const dists: any[] = [];
  for (const classId of active) {
    for (const sig of variantsOf(classId, season)) {
      dists.push(
        x
          .subtract(ee.Image.constant(sig))
          .divide(scales)
          .pow(2)
          .reduce(ee.Reducer.sum())
          // MAP-style prevalence bonus: dominant regional classes win spectral ties
          .subtract(SIG_PRIOR_LAMBDA * priorOf(classId, season))
          .rename(`d${classId}_${owner.length}`)
      );
      owner.push(classId);
    }
  }
  let distImg = dists[0];
  for (let i = 1; i < dists.length; i++) distImg = distImg.addBands(dists[i]);
  // argmin over all candidate bands (first index wins ties)
  let arg = ee.Image(0).rename("argmin");
  let best = distImg.select(0);
  for (let k = 1; k < dists.length; k++) {
    const cur = distImg.select(k);
    arg = arg.where(cur.lt(best), ee.Image.constant(k));
    best = best.min(cur);
  }
  let out = ee.Image.constant(owner[0]).rename("classification");
  for (let k = 1; k < owner.length; k++) {
    out = out.where(arg.eq(k), ee.Image.constant(owner[k]));
  }
  return out;
}

function tileTemplate(mapId: any): string {
  // sample tile at 0/0/0 then swap to Leaflet {z}/{x}/{y}
  const url: string = ee.data.getTileUrl(mapId, 0, 0, 0);
  return url.replace(/\/tiles\/0\/0\/0$/, "/tiles/{z}/{x}/{y}");
}

/* ------------------------------------------------------------------ */
/* Light operations (sync routes)                                      */
/* ------------------------------------------------------------------ */
export interface SceneResult {
  tileUrl: string; nImages: number; dateFrom: string; dateTo: string;
  layer: "truecolor" | "ndvi" | "ndwi";
}

export async function buildScene(params: PeriodInput & {
  layer: "truecolor" | "ndvi" | "ndwi";
  cloudMax?: number;
}): Promise<SceneResult> {
  await getEE();
  const aoi = ee.Geometry.Polygon([BORJ_COORDS]);
  const { start, end } = resolvePeriod(params);
  const cloud = params.cloudMax ?? 60;
  const s2 = getS2(aoi, start, end, cloud);
  const nImages = await p<number>((cb) => rawCollection(aoi, start, end, cloud).size().getInfo(cb));
  if (!nImages) throw new GEEError("no_images");
  const median = s2.median();
  const vis =
    params.layer === "truecolor"
      ? { bands: "B4,B3,B2", min: "0", max: "0.3" }
      : params.layer === "ndvi"
        ? { bands: "NDVI", min: "0", max: "0.8", palette: NDVI_PALETTE }
        : { bands: "NDWI", min: "-0.5", max: "0.5", palette: NDWI_PALETTE };
  const mapId = await p<any>((cb) => ee.data.getMapId({ image: median, ...vis }, cb));
  return { tileUrl: tileTemplate(mapId), nImages, dateFrom: start, dateTo: end, layer: params.layer };
}

export async function ndviPointSeries(params: PeriodInput & {
  lon: number; lat: number; cloudMax?: number;
}): Promise<{ series: { d: string; v: number | null }[] }> {
  await getEE();
  const aoi = ee.Geometry.Polygon([BORJ_COORDS]);
  const { start, end } = resolvePeriod(params);
  const s2 = getS2(aoi, start, end, params.cloudMax ?? 60);
  const pt = ee.Geometry.Point([params.lon, params.lat]);
  const fc = s2.select("NDVI").map((img: any) => ee.Feature(null, {
    d: img.date().format("YYYY-MM-dd"),
    v: img.reduceRegion(ee.Reducer.mean(), pt, 10).get("NDVI"),
  }));
  const res = await p<any>((cb) => fc.getInfo(cb));
  const series = (res.features || [])
    .map((f: any) => f.properties as { d: string; v: number | null })
    .filter((r: { v: number | null }) => r.v !== null && r.v !== undefined)
    .sort((a: { d: string }, b: { d: string }) => (a.d < b.d ? -1 : 1));
  return { series };
}

/* ------------------------------------------------------------------ */
/* Heavy operations (background jobs)                                  */
/* ------------------------------------------------------------------ */
function validateSamples(points: SampleInput[] | undefined) {
  const pts = (points || []).filter((s) =>
    Number.isFinite(s.lon) && Number.isFinite(s.lat) && CLASSES.some((c) => c.id === s.classId));
  const byClass = new Map<number, number>();
  for (const s of pts) byClass.set(s.classId, (byClass.get(s.classId) ?? 0) + 1);
  if (pts.length < 20) throw new GEEError("too_few_samples");
  if (byClass.size < 2) throw new GEEError("need_two_classes");
  return { pts, byClass };
}

/* ------------------------------------------------------------------ */
/* Zero-click auto-sampling — stratified spectral anchor extraction    */
/*                                                                    */
/* No manual points? The engine extracts high-confidence anchor pixels */
/* from the user's own AOI instead of blocking the run:                */
/*  1. every pixel is scored against the calibrated reference          */
/*     signatures (NDVI/NDWI/NDMI + red/NIR/SWIR1/SWIR2 medians — the  */
/*     same library that powers the instant scan, including the        */
/*     bimodal bare-soil variants);                                   */
/*  2. a pixel becomes an anchor of class c when c wins by a clear     */
/*     spectral MARGIN (unambiguous pixels only — no prevalence bonus, */
/*     so anchors are pure spectral evidence);                        */
/*  3. urban anchors additionally must pass the strict built-up rule   */
/*     (positive NDBI + dry NDWI + very low NDVI — see below);         */
/*  4. 30–50+ anchor pixels per detected class are sampled at 20 m and */
/*     fed into the standard 70/30 split, so OA, Kappa, PA/UA/F1 and   */
/*     the confusion matrix are REAL measurements on the withheld 30%. */
/* ------------------------------------------------------------------ */

/** minimum winning margin over the runner-up class, in squared
 *  SIG_SCALES-normalized units (≈0.6 scale-units of separation) */
const ANCHOR_MARGIN = 0.35;

/** Strict built-up (عمران) anchor rule — a hard gate ON TOP of the signature
 *  margin, calibrated against the measured Borj El Arab probes
 *  (scripts/probe_signatures.ts + probe_october.mjs + ESA WorldCover check):
 *   - NDBI > -0.02 : built/material signature (crops ≈ -0.25, water ≈ -0.14).
 *     NOT the generic NDBI > 0.05 floor: the measured town signature sits at
 *     NDBI ≈ 0.03 while bright bare sand reaches 0.09, so a hard 0.05 floor
 *     would reject the real town and admit sand. The multivariate signature
 *     margin (B4/B8/B11/B12 brightness included) is what separates عمران
 *     from bright بور — NDBI alone cannot at this site.
 *   - NDWI < 0     : built-up is dry (measured towns ≈ -0.32).
 *   - NDVI < 0.25  : very low vegetation. The ceiling is 0.25 rather than the
 *     generic 0.15 because real Egyptian town blocks measure NDVI ≈ 0.22
 *     (street trees); 0.15 would push the actual town out of its own class
 *     and re-create the “missing urban” failure. */
function urbanAnchorRule(x: any): any {
  const b8 = x.select("B8_median");
  const b11 = x.select("B11_median");
  const ndbi = b11.subtract(b8).divide(b11.add(b8));
  return ndbi.gt(-0.02)
    .and(x.select("NDWI_mean").lt(0))
    .and(x.select("NDVI_mean").lt(0.25));
}

/** Winner-class anchor image: the per-pixel winning class id (raw spectral
 *  distance over all signature variants — no prevalence bonus), masked to
 *  unambiguous pixels only (margin ≥ ANCHOR_MARGIN over the runner-up) and
 *  gated by the strict عمران rule where the winner is urban. This band feeds
 *  balanced stratified sampling. */
export function anchorWinnerImage(sigFeats: any, season: "winter" | "summer" | "full"): any {
  const x = sigFeats.select(SIG_FEATURES as unknown as string[]);
  const scales = ee.Image.constant(SIG_SCALES);
  const active = ACTIVE_SIGNATURE_CLASSES[season];

  // best raw distance per class (variants compete within a class)
  const perClass = new Map<number, any>();
  for (const classId of active) {
    for (const sig of variantsOf(classId, season)) {
      const d = x.subtract(ee.Image.constant(sig)).divide(scales).pow(2)
        .reduce(ee.Reducer.sum());
      perClass.set(
        classId,
        perClass.has(classId) ? (perClass.get(classId) as any).min(d) : d
      );
    }
  }

  // winner + runner-up across classes → margin image
  const ids = [...perClass.keys()];
  let arg = ee.Image(0).rename("argmin");
  let best = perClass.get(ids[0]) as any;
  let second = ee.Image.constant(1e6);
  let winner = ee.Image.constant(ids[0]).rename("class").toByte();
  for (let k = 1; k < ids.length; k++) {
    const cur = perClass.get(ids[k]) as any;
    const better = cur.lt(best);
    second = second.where(better, best); // demoted champion
    best = best.where(better, cur); // new champion
    arg = arg.where(better, ee.Image.constant(k));
    winner = winner.where(better, ee.Image.constant(ids[k]));
    second = second.where(cur.lt(second).and(better.not()), cur); // near-miss
  }
  const margin = second.subtract(best);

  // high-confidence anchors only
  let out = winner.updateMask(margin.gte(ANCHOR_MARGIN));
  // strict built-up gate — applies only where the winner is عمران
  const urbOk = urbanAnchorRule(x);
  return out.updateMask(out.neq(11).or(urbOk));
}

export interface AutoSampleResult {
  /** merged anchor FC (class property + split column) ready for 70/30 */
  training: any;
  /** anchor pixel counts per class id that passed the minimum filter */
  counts: Record<string, number>;
}

/** Extract stratified spectral anchors inside the AOI: balanced sampling of
 *  `numPixels` anchor pixels per DETECTED class (ee.Image.stratifiedSample —
 *  Image.sample() draws with a probability computed against the whole region,
 *  so rare classes come back nearly empty and are unusable for training).
 *  Returns null when fewer than 2 classes gather `minPerClass` confident
 *  pixels (e.g. a fully clouded window) — callers then fall back to the
 *  instant estimate. */
async function autoSampleTraining(
  feats: any,
  sigFeats: any,
  aoi: any,
  season: "winter" | "summer" | "full",
  numPixels: number,
  minPerClass: number
): Promise<AutoSampleResult | null> {
  try {
    const winner = anchorWinnerImage(sigFeats, season);
    const sampled = feats
      .addBands(winner) // winner band is already named "class"
      .stratifiedSample({
        numPoints: numPixels,
        classBand: "class",
        region: aoi,
        scale: 20,
        seed: 42,
        tileScale: 4,
      });

    const hist = await p<Record<string, number>>((cb) =>
      sampled.aggregate_histogram("class").getInfo(cb));
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(hist || {})) {
      const id = Number(k);
      const n = Number(v);
      if (Number.isFinite(id) && Number.isFinite(n) && n >= minPerClass && id > 0) {
        counts[k] = n;
        total += n;
      }
    }
    const classes = Object.keys(counts).map(Number);
    if (classes.length < 2 || total < 20) return null;

    // keep only classes that cleared the minimum (eq/or — basic filter ops,
    // ee.Filter.inCollection is not available in every client build)
    const keepFilter = classes
      .map((id) => ee.Filter.eq("class", id))
      .reduce((a, b) => ee.Filter.or(a, b));
    const training = sampled
      .filter(keepFilter)
      .randomColumn("split", 42);
    return { training, counts };
  } catch (e) {
    // best-effort by design — degrade to the instant estimate, never a 500
    console.error("autoSampleTraining failed:", String((e as Error)?.message ?? e).slice(0, 300));
    return null;
  }
}

/** Prepared training sets for the supervised pipeline. */
type PreparedTraining =
  | { kind: "manual"; training: any }
  | { kind: "auto"; training: any; counts: Record<string, number> }
  | { kind: "instant_fallback" };

/** Manual sample points are usable when at least 20 valid points across ≥ 2
 *  classes were provided. Fewer or none → the run switches to Auto-Sampling
 *  Mode (الاستخراج التلقائي للعينات) instead of failing the request. */
function manualSampleState(points: SampleInput[] | undefined) {
  const pts = (points || []).filter((s) =>
    Number.isFinite(s.lon) && Number.isFinite(s.lat) && CLASSES.some((c) => c.id === s.classId));
  const byClass = new Map<number, number>();
  for (const s of pts) byClass.set(s.classId, (byClass.get(s.classId) ?? 0) + 1);
  return { pts, byClass, ok: pts.length >= 20 && byClass.size >= 2 };
}

/** Build the training FC for a supervised run: the user's manual points when
 *  they are sufficient, otherwise zero-click auto-sampling. `needMahalanobis`
 *  sizes the anchor counts so every class clears the covariance requirement
 *  (train pixels > feature bands). */
async function prepareSupervisedTraining(opts: {
  samplePoints: SampleInput[] | undefined;
  feats: any;
  s2: any;
  aoi: any;
  start: string;
  end: string;
  needMahalanobis: boolean;
}): Promise<PreparedTraining> {
  const { pts, ok } = manualSampleState(opts.samplePoints);
  if (ok) {
    const fc = ee.FeatureCollection(
      pts.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { class: s.classId },
      }))
    );
    return { kind: "manual", training: sampleTraining(opts.feats, fc) };
  }
  // ---- Auto-Sampling Mode (الاستخراج التلقائي للعينات) ----
  const season = signatureSeason(opts.start, opts.end);
  const sig = signatureFeatures(opts.s2);
  // monthly NDVI/NDWI/NDMI bands (3 × months) + NDVI stats (5) + B4/B8/B11/B12 (4)
  const nBands = 3 * (Math.round(monthDiff(opts.start, opts.end)) + 1) + 9;
  // Mahalanobis inverts a per-class covariance over all feature bands — the
  // homogeneous anchor sets need a generous sample budget (≈140/class) or the
  // inversion fails with "not enough data".
  const numPixels = opts.needMahalanobis ? 140 : 50;
  const minPerClass = opts.needMahalanobis ? Math.ceil(nBands / 0.7) + 4 : 25;
  const auto = await autoSampleTraining(
    opts.feats, sig, opts.aoi, season, numPixels, minPerClass
  );
  if (!auto) return { kind: "instant_fallback" };
  return { kind: "auto", training: auto.training, counts: auto.counts };
}

/**
 * Sample training pixels under the sample points, dropping points that fall
 * outside the feature stack extent or on fully-masked (cloud) pixels — such
 * points yield null band values that would otherwise crash classifier
 * training with an opaque EE error.
 */
function sampleTraining(feats: any, fc: any) {
  return feats
    .sampleRegions({ collection: fc, properties: ["class"], scale: 10 })
    .filter(ee.Filter.notNull(feats.bandNames()))
    .randomColumn("split", 42);
}

// per-class PA/UA/F1 from a confusion matrix (rows = actual, cols = predicted);
// classIds[i] is the real class id of row/col i (matrix axes are sorted class values)
function perClassMetrics(matrix: number[][], classIds: number[]) {
  const n = matrix.length;
  const colSums: number[] = [];
  for (let j = 0; j < n; j++) {
    colSums[j] = 0;
    for (let i = 0; i < n; i++) colSums[j] += matrix[i][j] || 0;
  }
  const out = new Map<number, { pa: number; ua: number; f1: number; support: number }>();
  for (let i = 0; i < n; i++) {
    const cls = CLASSES.find((c) => c.id === classIds[i]);
    if (!cls) continue;
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += matrix[i][j] || 0;
    if (rowSum === 0) continue;
    const correct = matrix[i][i] || 0;
    const pa = rowSum ? correct / rowSum : 0;
    const ua = colSums[i] ? correct / colSums[i] : 0;
    const f1 = pa + ua > 0 ? (2 * pa * ua) / (pa + ua) : 0;
    out.set(cls.id, { pa, ua, f1, support: rowSum });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* MLP hybrid — trained in Node, applied per-pixel on Earth Engine      */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32) — the same inputs always produce the
 *  same network, so results are reproducible for the thesis. */
function mlpRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng: () => number): number {
  // Box–Muller
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface MlpRow { classId: number; x: number[] }

/** Standardize + train a 1-hidden-layer softmax network (full-batch GD with
 *  momentum). Returns the model together with the per-feature mean/std so the
 *  identical transform can be replayed as Earth Engine band math. */
export function mlpTrain(
  rows: MlpRow[],
  bandNames: string[],
  params: MlpParams
): MlpModel {
  const F = bandNames.length;
  const classIds = [...new Set(rows.map((r) => r.classId))].sort((a, b) => a - b);
  const C = classIds.length;
  const n = rows.length;
  if (C < 2) throw new GEEError("mlp_needs_classes", "MLP needs ≥ 2 classes in the training split");
  if (F < 1 || n < 2) throw new GEEError("mlp_needs_classes", "MLP needs ≥ 2 training pixels");

  // ---- feature standardization (train statistics only) ----
  const mean = new Array(F).fill(0);
  const std = new Array(F).fill(1);
  for (let f = 0; f < F; f++) {
    let s = 0;
    for (const r of rows) s += r.x[f];
    mean[f] = s / n;
    let v = 0;
    for (const r of rows) v += (r.x[f] - mean[f]) ** 2;
    std[f] = Math.max(1e-6, Math.sqrt(v / Math.max(1, n - 1)));
  }
  const X: number[][] = rows.map((r) => r.x.map((v, f) => (v - mean[f]) / std[f]));
  const yIdx = rows.map((r) => classIds.indexOf(r.classId));

  // ---- architecture ----
  const H = Math.min(Math.max(params.hidden ?? 24, 4), 128);
  const epochs = Math.min(Math.max(params.epochs ?? 400, 50), 2000);
  const rng = mlpRng(0xba51da);
  const he1 = Math.sqrt(2 / F);
  const he2 = Math.sqrt(2 / H);
  const w1: number[][] = Array.from({ length: H }, () =>
    Array.from({ length: F }, () => gauss(rng) * he1));
  const b1: number[] = new Array(H).fill(0);
  const w2: number[][] = Array.from({ length: C }, () =>
    Array.from({ length: H }, () => gauss(rng) * he2));
  const b2: number[] = new Array(C).fill(0);

  // ---- full-batch gradient descent with momentum ----
  // Each epoch: forward ALL samples, accumulate the mean gradients, then apply
  // a single momentum step — standard, deterministic, reproducible.
  const lr0 = 0.25;
  const mom = 0.9;
  const gW1 = w1.map((r) => r.map(() => 0));
  const gB1 = new Array(H).fill(0);
  const gW2 = w2.map((r) => r.map(() => 0));
  const gB2 = new Array(C).fill(0);
  const vw1 = w1.map((r) => r.map(() => 0));
  const vb1 = new Array(H).fill(0);
  const vw2 = w2.map((r) => r.map(() => 0));
  const vb2 = new Array(C).fill(0);
  const hidden = new Array(H);
  const probs = new Array(C);

  const zeroGrad = () => {
    for (const row of gW1) row.fill(0);
    gB1.fill(0);
    for (const row of gW2) row.fill(0);
    gB2.fill(0);
  };

  for (let ep = 0; ep < epochs; ep++) {
    const lr = lr0 * Math.pow(0.995, ep);
    zeroGrad();
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      // ---- forward ----
      for (let j = 0; j < H; j++) {
        let s = b1[j];
        const wj = w1[j];
        for (let f = 0; f < F; f++) s += wj[f] * xi[f];
        hidden[j] = s > 0 ? s : 0; // ReLU (store pre-activation openness via hidden>0)
      }
      let maxL = -Infinity;
      const logits = new Array(C);
      for (let k = 0; k < C; k++) {
        let s = b2[k];
        const wk = w2[k];
        for (let j = 0; j < H; j++) s += wk[j] * hidden[j];
        logits[k] = s;
        if (s > maxL) maxL = s;
      }
      let sumP = 0;
      for (let k = 0; k < C; k++) { probs[k] = Math.exp(logits[k] - maxL); sumP += probs[k]; }
      for (let k = 0; k < C; k++) probs[k] /= sumP;
      // ---- backward: accumulate mean cross-entropy gradients ----
      const yi = yIdx[i];
      for (let k = 0; k < C; k++) {
        const dOut = (probs[k] - (k === yi ? 1 : 0)) / n;
        if (dOut === 0) continue;
        const gk = gW2[k];
        const wk = w2[k];
        for (let j = 0; j < H; j++) {
          if (hidden[j] > 0) gk[j] += dOut * hidden[j];
        }
        gB2[k] += dOut;
        // hidden-layer gradient via current (pre-update) output weights
        for (let j = 0; j < H; j++) {
          if (hidden[j] > 0) {
            const dh = dOut * wk[j];
            if (dh === 0) continue;
            const gj = gW1[j];
            for (let f = 0; f < F; f++) gj[f] += dh * xi[f];
            gB1[j] += dh;
          }
        }
      }
    }
    // ---- single momentum step per epoch ----
    for (let j = 0; j < H; j++) {
      const wj = w1[j];
      const vj = vw1[j];
      const gj = gW1[j];
      for (let f = 0; f < F; f++) {
        vj[f] = mom * vj[f] - lr * gj[f];
        wj[f] += vj[f];
      }
      vb1[j] = mom * vb1[j] - lr * gB1[j];
      b1[j] += vb1[j];
    }
    for (let k = 0; k < C; k++) {
      const wk = w2[k];
      const vwk = vw2[k];
      const gk = gW2[k];
      for (let j = 0; j < H; j++) {
        vwk[j] = mom * vwk[j] - lr * gk[j];
        wk[j] += vwk[j];
      }
      vb2[k] = mom * vb2[k] - lr * gB2[k];
      b2[k] += vb2[k];
    }
  }
  for (const v of [...w1.flat(), ...w2.flat(), ...b1, ...b2]) {
    if (!Number.isFinite(v)) throw new GEEError("mlp_training_failed", "non-finite MLP weights");
  }
  return { bandNames, classIds, mean, std, w1, b1, w2, b2 };
}

/** Forward pass of a trained model on a feature vector (JS side). */
export function mlpPredict(model: MlpModel, x: number[]): number {
  const F = model.bandNames.length;
  const H = model.b1.length;
  const C = model.classIds.length;
  const hidden = new Array(H);
  for (let j = 0; j < H; j++) {
    let s = model.b1[j];
    const wj = model.w1[j];
    for (let f = 0; f < F; f++) s += wj[f] * ((x[f] - model.mean[f]) / model.std[f]);
    hidden[j] = s > 0 ? s : 0;
  }
  let bestK = 0;
  let bestV = -Infinity;
  for (let k = 0; k < C; k++) {
    let s = model.b2[k];
    const wk = model.w2[k];
    for (let j = 0; j < H; j++) s += wk[j] * hidden[j];
    if (s > bestV) { bestV = s; bestK = k; }
  }
  return model.classIds[bestK];
}

/** Replay the trained network per-pixel inside Earth Engine: the standardized
 *  feature stack is multiplied by the hidden weights (band-wise dot products via
 *  reduce(sum)), passed through ReLU, then the output logits argmax maps each
 *  pixel to its class id — mathematically identical to mlpPredict. */
export function mlpClassifyImage(feats: any, model: MlpModel): any {
  const F = model.bandNames.length;
  const H = model.b1.length;
  const C = model.classIds.length;
  // standardized feature stack (same transform as JS training)
  const z = feats
    .select(model.bandNames)
    .subtract(ee.Image.constant(model.mean))
    .divide(ee.Image.constant(model.std));
  // hidden layer: H single-band images h0..h{H-1}
  const hiddenBands: any[] = [];
  for (let j = 0; j < H; j++) {
    hiddenBands.push(
      z.multiply(ee.Image.constant(model.w1[j])).reduce(ee.Reducer.sum())
        .add(model.b1[j]).max(0).rename(`h${j}`)
    );
  }
  let hid = hiddenBands[0];
  for (let j = 1; j < H; j++) hid = hid.addBands(hiddenBands[j]);
  // output logits l0..l{C-1}
  const logitBands: any[] = [];
  for (let k = 0; k < C; k++) {
    logitBands.push(
      hid.multiply(ee.Image.constant(model.w2[k])).reduce(ee.Reducer.sum())
        .add(model.b2[k]).rename(`l${k}`)
    );
  }
  let lg = logitBands[0];
  for (let k = 1; k < C; k++) lg = lg.addBands(logitBands[k]);
  // argmax over logit bands; first index wins ties (deterministic)
  let arg = ee.Image(0).rename("argmax");
  let best = lg.select("l0");
  for (let k = 1; k < C; k++) {
    const cur = lg.select(`l${k}`);
    arg = arg.where(cur.gt(best), ee.Image.constant(k));
    best = best.max(cur);
  }
  // band index -> real class id -> single "classification" band
  let out = ee.Image.constant(model.classIds[0]).rename("classification");
  for (let k = 1; k < C; k++) {
    out = out.where(arg.eq(k), ee.Image.constant(model.classIds[k]));
  }
  return out;
}

/** Build the confusion matrix of JS-side predictions on validation rows.
 *  Axes cover the union of actual and predicted classes (ascending). */
export function mlpConfusion(
  model: MlpModel,
  valRows: MlpRow[]
): { classIds: number[]; rows: number[][]; oa: number; kappa: number } {
  const ids = [...new Set([...model.classIds, ...valRows.map((r) => r.classId)])]
    .sort((a, b) => a - b);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const m = ids.map(() => ids.map(() => 0));
  for (const r of valRows) {
    const pred = mlpPredict(model, r.x);
    m[idx.get(r.classId)!][idx.get(pred)!] += 1;
  }
  const total = valRows.length;
  const rowSums = m.map((row) => row.reduce((s, v) => s + v, 0));
  const colSums = ids.map((_, j) => m.reduce((s, row) => s + row[j], 0));
  const diag = ids.reduce((s, _, i) => s + m[i][i], 0);
  const oa = total ? diag / total : 0;
  const pe = total ? rowSums.reduce((s, r, i) => s + r * colSums[i], 0) / (total * total) : 0;
  const kappa = pe < 1 ? (oa - pe) / (1 - pe) : 0;
  return { classIds: ids, rows: m, oa, kappa };
}

/** getInfo() a sampled FC into plain rows for the MLP trainer/evaluator. */
async function fcToMlpRows(fc: any, bandNames: string[]): Promise<MlpRow[]> {
  const info = await p<any>((cb) => fc.getInfo(cb));
  const out: MlpRow[] = [];
  for (const f of info?.features ?? []) {
    const props = (f?.properties ?? {}) as Record<string, unknown>;
    const classId = Number(props["class"]);
    const x = bandNames.map((b) => Number(props[b]));
    if (!Number.isFinite(classId) || x.some((v) => !Number.isFinite(v))) continue;
    out.push({ classId, x });
  }
  return out;
}

export async function runClassification(input: RunInput): Promise<RunResult> {
  const t0 = Date.now();
  await getEE();
  const aoi = makeAoi(input.aoiGeo);
  const { start, end } = resolvePeriod(input);
  const cloud = input.cloudMax ?? 60;
  const rfTrees = input.rfTrees ?? 100;
  const knnK = input.knnK ?? 5;
  const kClusters = Math.min(Math.max(input.kClusters ?? 8, 2), 30);

  const nImages = await p<number>((cb) =>
    rawCollection(aoi, start, end, cloud).size().getInfo(cb));
  if (!nImages) throw new GEEError("no_images");
  const s2 = getS2(aoi, start, end, cloud);
  const feats = buildFeatures(s2, start, end);

  let classified: any;
  let oa: number | null = null;
  let kappa: number | null = null;
  let perClass: Map<number, { pa: number; ua: number; f1: number; support: number }> | null = null;
  let confusion: { classIds: number[]; rows: number[][] } | null = null;
  let nTrain = 0, nVal = 0;
  let noteCode: string | undefined;
  let vis: { min: string; max: string; palette: string };

  // ---- supervised training prep: manual points, or zero-click anchors ----
  let training: any = null;
  let sampleSource: "manual" | "auto" | undefined;
  let autoCounts: Record<string, number> | undefined;
  let autoFallback = false;
  if (input.algorithm !== "signature" && input.algorithm !== "kmeans") {
    const prep = await prepareSupervisedTraining({
      samplePoints: input.samplePoints,
      feats, s2, aoi, start, end,
      needMahalanobis: input.algorithm === "mindist_m",
    });
    if (prep.kind === "instant_fallback") {
      autoFallback = true;
    } else {
      training = prep.training;
      sampleSource = prep.kind;
      if (prep.kind === "auto") autoCounts = prep.counts;
    }
  }

  /** Degrade a failing supervised run to the instant estimate — used when the
   *  auto-sampled anchors cannot support an algorithm (e.g. the Mahalanobis
   *  covariance inversion on very homogeneous anchor sets). */
  const applyInstantFallback = () => {
    const sig = signatureFeatures(s2);
    classified = signatureClassifyImage(sig, signatureSeason(start, end)).clip(aoi);
    vis = { min: "1", max: "12", palette: PALETTE_CSV };
    noteCode = "auto_sample_failed";
    nTrain = 0;
    nVal = 0;
    oa = null;
    kappa = null;
    perClass = null;
    confusion = null;
    sampleSource = undefined;
    autoCounts = undefined;
  };

  if (input.algorithm === "signature" || autoFallback) {
    // ---- instant scan: nearest reference spectral signature (no samples) ----
    // (the explicit instant scan, or the graceful fallback when a supervised
    //  run could not gather enough high-confidence anchor pixels)
    const sig = signatureFeatures(s2);
    const season = signatureSeason(start, end);
    classified = signatureClassifyImage(sig, season).clip(aoi);
    vis = { min: "1", max: "12", palette: PALETTE_CSV };
    noteCode = autoFallback ? "auto_sample_failed" : "instant_estimate";
    nTrain = 0;
    nVal = 0;
  } else if (input.algorithm === "kmeans") {
    const ktrain = feats.sample({ region: aoi, scale: 100, numPixels: 2500, seed: 1 });
    const clusterer = ee.Clusterer.wekaKMeans(kClusters).train(ktrain);
    classified = feats.cluster(clusterer).clip(aoi);
    vis = {
      min: "0", max: String(kClusters - 1),
      palette: PALETTE.slice(0, kClusters).map((c) => c.slice(1)).join(","),
    };
    noteCode = "kmeans_no_accuracy";
  } else {
    const train = training.filter(ee.Filter.lt("split", 0.7));
    const val = training.filter(ee.Filter.gte("split", 0.7));

    // fail fast with a friendly error when no sample point yielded a pixel
    [nTrain, nVal] = await Promise.all([
      p<number>((cb) => train.size().getInfo(cb)),
      p<number>((cb) => val.size().getInfo(cb)),
    ]);
    if (nTrain === 0) throw new GEEError("samples_outside_aoi");

    const classifier = input.algorithm === "mlp"
      ? null // hybrid: trained in Node below, applied via mlpClassifyImage
      : makeClassifier(input.algorithm, rfTrees, knnK).train({
          features: train, classProperty: "class", inputProperties: feats.bandNames(),
        });
    classified = input.algorithm === "mlp"
      ? null // assigned after training
      : feats.classify(classifier!).clip(aoi);
    vis = { min: "1", max: "12", palette: PALETTE_CSV };

    // Mahalanobis inverts a per-class covariance matrix over ~27-45 feature
    // bands: if any class has fewer training pixels than bands it always
    // fails server-side with an opaque error — pre-check and fail friendly.
    if (input.algorithm === "mindist_m") {
      const [hist, nBands] = await Promise.all([
        p<Record<string, number>>((cb) => train.aggregate_histogram("class").getInfo(cb)),
        p<number>((cb) => feats.bandNames().size().getInfo(cb)),
      ]);
      const counts = Object.values(hist || {});
      const minCount = counts.length ? Math.min(...counts) : 0;
      if (minCount <= nBands) {
        throw new GEEError("mahalanobis_needs_samples",
          `Mahalanobis needs more than ${nBands} training pixels per class (smallest class: ${minCount})`);
      }
    }

    if (input.algorithm === "mlp") {
      // ---- hybrid MLP: train on this Node process, replay on EE per pixel ----
      const bandNames: string[] = await p<any>((cb) => feats.bandNames().getInfo(cb));
      const [trainRows, valRows] = await Promise.all([
        fcToMlpRows(train, bandNames),
        fcToMlpRows(val, bandNames),
      ]);
      const model = mlpTrain(trainRows, bandNames, {
        hidden: input.mlpHidden, epochs: input.mlpEpochs,
      });
      classified = mlpClassifyImage(feats, model).clip(aoi);
      if (nVal >= 10 && valRows.length > 0) {
        const cm = mlpConfusion(model, valRows);
        oa = cm.oa;
        kappa = cm.kappa;
        perClass = perClassMetrics(cm.rows, cm.classIds);
        confusion = { classIds: cm.classIds, rows: cm.rows };
      } else {
        noteCode = "no_accuracy";
      }
    } else if (nVal >= 10) {
      const cm = val.classify(classifier!).errorMatrix("class", "classification");
      let acc: any;
      try {
        acc = await p<any>((cb) => ee.Dictionary({
          oa: cm.accuracy(), kappa: cm.kappa(), matrix: cm.array().toList(),
          classes: val.aggregate_array("class").distinct().sort(),
        }).getInfo(cb));
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (/covariance/i.test(msg)) {
          // auto anchors too homogeneous to invert the covariance — degrade
          // to the instant estimate instead of failing the zero-click run
          if (sampleSource === "auto") {
            applyInstantFallback();
            acc = null;
          } else {
            throw new GEEError("mahalanobis_needs_samples", msg);
          }
        } else {
          throw err;
        }
      }
      if (acc) {
        oa = Number(acc.oa); kappa = Number(acc.kappa);
        const valClasses: number[] = (acc.classes || []).map((x: unknown) => Number(x));
        const raw: number[][] = (acc.matrix || []).map((row: unknown[]) =>
          (row as unknown[]).map((x) => Number(x)));
        // EE error matrices are indexed by class VALUE (0..maxValue), so they
        // arrive with empty rows/cols for unsampled ids. Compact them to the
        // axes actually present: validation classes + predicted classes.
        const colTotal = (idx: number) => raw.reduce((s, row) => s + (row[idx] || 0), 0);
        const predClasses = raw.map((_, idx) => idx).filter((idx) => colTotal(idx) > 0);
        const axes = Array.from(new Set([...valClasses, ...predClasses]))
          .filter((v) => v > 0)
          .sort((a, b) => a - b);
        if (axes.length > 1 && Math.max(...axes) < raw.length) {
          const compact = axes.map((a) => axes.map((p2) => raw[a]?.[p2] || 0));
          perClass = perClassMetrics(compact, axes);
          confusion = { classIds: axes, rows: compact };
        }
      }
    } else {
      noteCode = "no_accuracy";
    }
  }

  // tiles + area stats in parallel
  const fetchTilesArea = () =>
    Promise.all([
      p<any>((cb) => ee.data.getMapId({ image: classified, ...vis }, cb)),
      p<any>((cb) => ee.Image.pixelArea().addBands(classified).reduceRegion({
        reducer: ee.Reducer.sum().group({ groupField: 1, groupName: "class" }),
        geometry: aoi, scale: 100, maxPixels: 1e13,
      }).getInfo(cb)),
    ]);
  let mapId: any;
  let areaRes: any;
  try {
    [mapId, areaRes] = await fetchTilesArea();
  } catch (e) {
    // map known server errors to friendly codes (e.g. singular covariance);
    // auto-sampled runs degrade to the instant estimate instead of erroring
    const msg = String((e as Error)?.message ?? e);
    if (/covariance/i.test(msg)) {
      if (sampleSource === "auto") {
        applyInstantFallback();
        [mapId, areaRes] = await fetchTilesArea();
      } else {
        throw new GEEError("mahalanobis_needs_samples", msg);
      }
    } else {
      throw e;
    }
  }

  const groups: { class: number; sum: number }[] = areaRes.groups || [];
  const totalM2 = groups.reduce((s, g) => s + g.sum, 0);
  // Single source of truth for the TOTAL area: the exact geodesic polygon
  // area (same formula as the client's geo.ts / PostGIS ST_Area). Class pixel
  // areas are measured at 100 m, so they are rescaled proportionally to sum
  // exactly to it — every panel then shows identical strings.
  const aoiM2 = aoiGeoAreaM2(input.aoiGeo);
  const areaScale = totalM2 > 0 ? aoiM2 / totalM2 : 1;

  // rounding fixup: displayed percentages must sum to exactly 100.0
  const percentOf = (m2: number) => (totalM2 ? +((m2 / totalM2) * 100).toFixed(1) : 0);
  const percentSum = groups.reduce((s, g) => s + percentOf(g.sum), 0);
  const percentDrift = +(100 - percentSum).toFixed(1);
  const biggest = groups.reduce((a, b) => (b.sum > (a?.sum ?? -1) ? b : a), groups[0]);
  const fixedPercent = new Map<number, number>();
  if (biggest && percentDrift !== 0) fixedPercent.set(
    biggest.class, +(percentOf(biggest.sum) + percentDrift).toFixed(1)
  );

  // merge area + accuracy into class rows
  const rowsMap = new Map<number, ClassRow>();
  for (const g of groups) {
    // kmeans groups are 0-based; supervised are class ids
    const id = input.algorithm === "kmeans" ? g.class + 1 : g.class;
    const base = input.algorithm === "kmeans"
      ? { id, code: `C${g.class + 1}`, en: `Cluster ${g.class + 1}`, ar: `عنقود ${g.class + 1}`, color: PALETTE[g.class % PALETTE.length] }
      : CLASSES.find((c) => c.id === id) || CLASSES[0];
    rowsMap.set(id, {
      classId: id, code: base.code, en: base.en, ar: base.ar, color: base.color,
      areaKm2: +((g.sum * areaScale) / 1e6).toFixed(2),
      percent: fixedPercent.get(g.class) ?? percentOf(g.sum),
      pa: null, ua: null, f1: null, support: 0,
    });
  }
  if (perClass) {
    for (const [id, m] of perClass) {
      const cls = CLASSES.find((c) => c.id === id);
      if (!cls) continue;
      const existing = rowsMap.get(id);
      const row: ClassRow = existing ?? {
        classId: id, code: cls.code, en: cls.en, ar: cls.ar, color: cls.color,
        areaKm2: 0, percent: 0, pa: null, ua: null, f1: null, support: 0,
      };
      row.pa = +m.pa.toFixed(3); row.ua = +m.ua.toFixed(3); row.f1 = +m.f1.toFixed(3);
      row.support = m.support;
      rowsMap.set(id, row);
    }
  }
  const classes = [...rowsMap.values()].sort((a, b) => b.areaKm2 - a.areaKm2);

  // GeoTIFF download URL (10 m, EPSG:32635)
  let downloadUrl: string | null = null;
  try {
    downloadUrl = await p<string>((cb) => classified.toByte().getDownloadURL({
      name: `basira_${input.algorithm}_${start}_${end}.tif`.replace(/-/g, ""),
      scale: 10, region: aoi, crs: EXPORT_CRS, format: "GeoTIFF",
    }, cb));
  } catch { downloadUrl = null; }

  return {
    mode: "live",
    algorithm: input.algorithm,
    season: input.season,
    dateFrom: start,
    dateTo: end,
    tileUrl: tileTemplate(mapId),
    oa, kappa, classes,
    confusion,
    nImages, nTrain, nVal,
    durationMs: Date.now() - t0,
    downloadUrl,
    noteCode,
    areaKm2: +(aoiM2 / 1e6).toFixed(2),
    aoiName: input.aoiName ?? null,
    sampleSource,
    sampleClassCounts: autoCounts,
  };
}

/** Compare all supervised algorithms; returns summary + full result of the best. */
export async function compareAll(input: PeriodInput & {
  cloudMax?: number; rfTrees?: number; knnK?: number;
  mlpHidden?: number; mlpEpochs?: number;
  samplePoints?: SampleInput[];
  aoiGeo?: AoiGeoInput;
  aoiName?: string;
}): Promise<{
  summary: CompareSummaryRow[];
  best: RunResult;
}> {
  await getEE();
  const aoi = makeAoi(input.aoiGeo);
  const { start, end } = resolvePeriod(input);
  const cloud = input.cloudMax ?? 60;
  const rfTrees = input.rfTrees ?? 100;
  const knnK = input.knnK ?? 5;

  const nImages = await p<number>((cb) =>
    rawCollection(aoi, start, end, cloud).size().getInfo(cb));
  if (!nImages) throw new GEEError("no_images");
  const s2 = getS2(aoi, start, end, cloud);
  const feats = buildFeatures(s2, start, end);

  // training set: the user's manual points when provided, zero-click
  // stratified spectral anchors otherwise (sized for mindist_m — the league
  // includes the Mahalanobis covariance requirement)
  const prep = await prepareSupervisedTraining({
    samplePoints: input.samplePoints, feats, s2, aoi, start, end,
    needMahalanobis: true,
  });
  if (prep.kind === "instant_fallback") {
    throw new GEEError("auto_sample_failed",
      "not enough high-confidence anchor classes for auto-sampling in this window");
  }
  const training = prep.training;
  const nSampled = await p<number>((cb) => training.size().getInfo(cb));
  if (!nSampled) throw new GEEError("samples_outside_aoi");
  const train = training.filter(ee.Filter.lt("split", 0.7));
  const val = training.filter(ee.Filter.gte("split", 0.7));

  // MLP trains on this Node process — fetch its feature tables once up front
  // and reuse them for training + validation (same split as the GEE path).
  let mlpData: { bandNames: string[]; trainRows: MlpRow[]; valRows: MlpRow[] } | null = null;
  if (SUPERVISED_KEYS.includes("mlp")) {
    const bandNames: string[] = await p<any>((cb) => feats.bandNames().getInfo(cb));
    const [trainRows, valRows] = await Promise.all([
      fcToMlpRows(train, bandNames),
      fcToMlpRows(val, bandNames),
    ]);
    mlpData = { bandNames, trainRows, valRows };
  }

  const summary: CompareSummaryRow[] = [];
  for (const key of SUPERVISED_KEYS) {
    try {
      let oa: number | null;
      let kappa: number | null;
      if (key === "mlp") {
        if (!mlpData || mlpData.valRows.length === 0) {
          throw new GEEError("mlp_needs_classes", "no validation rows for MLP");
        }
        const model = mlpTrain(mlpData.trainRows, mlpData.bandNames, {
          hidden: input.mlpHidden, epochs: input.mlpEpochs,
        });
        const cm = mlpConfusion(model, mlpData.valRows);
        oa = cm.oa; kappa = cm.kappa;
      } else {
        const classifier = makeClassifier(key, rfTrees, knnK).train({
          features: train, classProperty: "class", inputProperties: feats.bandNames(),
        });
        const cm = val.classify(classifier).errorMatrix("class", "classification");
        const acc = await p<any>((cb) => ee.Dictionary({
          oa: cm.accuracy(), kappa: cm.kappa(),
        }).getInfo(cb));
        oa = Number(acc.oa); kappa = Number(acc.kappa);
      }
      summary.push({ algorithm: key, oa, kappa, nVal: 0 });
    } catch (err) {
      // one algorithm failing (e.g. Mahalanobis with few samples per class)
      // must not kill the whole comparison — mark it as failed and continue.
      console.error(`compareAll: algorithm ${key} failed:`,
        String((err as Error)?.message ?? err).slice(0, 200));
      summary.push({ algorithm: key, oa: null, kappa: null, nVal: 0 });
    }
  }
  if (!summary.some((s) => s.oa != null)) {
    throw new GEEError("all_algorithms_failed", "every supervised algorithm failed to train");
  }
  summary.sort((a, b) => (b.oa ?? -1) - (a.oa ?? -1));
  const best = await runClassification({
    ...input, algorithm: summary[0].algorithm, kind: "run",
    knnK, mlpHidden: input.mlpHidden, mlpEpochs: input.mlpEpochs,
  });
  for (const row of summary) row.nVal = best.nVal;
  return { summary, best };
}

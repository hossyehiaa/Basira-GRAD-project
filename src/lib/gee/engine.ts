/**
 * Basira — GEE server engine (shared by Next API routes & the Netlify
 * background function). Relative imports only, so the Netlify functions
 * bundler (esbuild) can trace it without tsconfig path aliases.
 *
 * Pipeline ported 1:1 from the phase-1 GEE Code Editor app:
 *   S2_SR_HARMONIZED -> SCL cloud mask -> indices -> monthly median stack +
 *   seasonal NDVI percentiles -> classifier (7 supervised + KMeans) ->
 *   tiles via getMapId + accuracy (70/30 split, seed 42) + area@100m.
 *
 * IMPORTANT: no ee.* object may be created at module load time — the ee
 * client initializes lazily via getEE().
 */
import ee from "@google/earthengine";

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

export type SeasonKey = "winter" | "summer" | "full" | "custom";
export type PeriodInput = {
  season: SeasonKey;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
};
export type AlgoKey =
  | "rf" | "svm" | "cart" | "gtb" | "nb" | "mindist_e" | "mindist_m" | "kmeans";
export const SUPERVISED_KEYS: AlgoKey[] = ["rf", "svm", "cart", "gtb", "nb", "mindist_e", "mindist_m"];

export interface SampleInput { classId: number; lon: number; lat: number }

export interface RunInput extends PeriodInput {
  kind?: "run" | "compare";
  algorithm: AlgoKey;
  cloudMax?: number;
  rfTrees?: number;
  kClusters?: number;
  samplePoints?: SampleInput[];
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
  nImages: number;
  nTrain: number;
  nVal: number;
  durationMs: number;
  downloadUrl: string | null;
  noteCode?: string; // no_accuracy | kmeans_no_accuracy | ...
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
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
function makeClassifier(key: AlgoKey, rfTrees: number) {
  if (key === "rf") return ee.Classifier.smileRandomForest(rfTrees || 100);
  if (key === "svm") return ee.Classifier.libsvm();
  if (key === "cart") return ee.Classifier.smileCart();
  if (key === "gtb") return ee.Classifier.smileGradientTreeBoost(60);
  if (key === "nb") return ee.Classifier.smileNaiveBayes();
  if (key === "mindist_e") return ee.Classifier.minimumDistance("euclidean");
  if (key === "mindist_m") return ee.Classifier.minimumDistance("mahalanobis");
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

// per-class PA/UA/F1 from a confusion matrix (rows = actual, cols = predicted)
function perClassMetrics(matrix: number[][]) {
  const n = matrix.length;
  const colSums: number[] = [];
  for (let j = 0; j < n; j++) {
    colSums[j] = 0;
    for (let i = 0; i < n; i++) colSums[j] += matrix[i][j] || 0;
  }
  const out = new Map<number, { pa: number; ua: number; f1: number; support: number }>();
  for (let i = 0; i < n; i++) {
    const cls = CLASSES.find((c) => c.id === i + 1) || CLASSES.find((c) => c.id === i);
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

export async function runClassification(input: RunInput): Promise<RunResult> {
  const t0 = Date.now();
  await getEE();
  const aoi = ee.Geometry.Polygon([BORJ_COORDS]);
  const { start, end } = resolvePeriod(input);
  const cloud = input.cloudMax ?? 60;
  const rfTrees = input.rfTrees ?? 100;
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
  let nTrain = 0, nVal = 0;
  let noteCode: string | undefined;
  let vis: { min: string; max: string; palette: string };

  if (input.algorithm === "kmeans") {
    const ktrain = feats.sample({ region: aoi, scale: 100, numPixels: 2500, seed: 1 });
    const clusterer = ee.Clusterer.wekaKMeans(kClusters).train(ktrain);
    classified = feats.cluster(clusterer).clip(aoi);
    vis = {
      min: "0", max: String(kClusters - 1),
      palette: PALETTE.slice(0, kClusters).map((c) => c.slice(1)).join(","),
    };
    noteCode = "kmeans_no_accuracy";
  } else {
    const { pts } = validateSamples(input.samplePoints);
    const fc = ee.FeatureCollection(pts.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { class: s.classId },
    })));
    const training = sampleTraining(feats, fc);
    const train = training.filter(ee.Filter.lt("split", 0.7));
    const val = training.filter(ee.Filter.gte("split", 0.7));

    // fail fast with a friendly error when no sample point yielded a pixel
    [nTrain, nVal] = await Promise.all([
      p<number>((cb) => train.size().getInfo(cb)),
      p<number>((cb) => val.size().getInfo(cb)),
    ]);
    if (nTrain === 0) throw new GEEError("samples_outside_aoi");

    const classifier = makeClassifier(input.algorithm, rfTrees).train({
      features: train, classProperty: "class", inputProperties: feats.bandNames(),
    });
    classified = feats.classify(classifier).clip(aoi);
    vis = { min: "1", max: "12", palette: PALETTE_CSV };

    if (nVal >= 10) {
      const cm = val.classify(classifier).errorMatrix("class", "classification");
      const acc = await p<any>((cb) => ee.Dictionary({
        oa: cm.accuracy(), kappa: cm.kappa(), matrix: cm.array().toList(),
      }).getInfo(cb));
      oa = Number(acc.oa); kappa = Number(acc.kappa);
      perClass = perClassMetrics(acc.matrix || []);
    } else {
      noteCode = "no_accuracy";
    }
  }

  // tiles + area stats in parallel
  const [mapId, areaRes] = await Promise.all([
    p<any>((cb) => ee.data.getMapId({ image: classified, ...vis }, cb)),
    p<any>((cb) => ee.Image.pixelArea().addBands(classified).reduceRegion({
      reducer: ee.Reducer.sum().group({ groupField: 1, groupName: "class" }),
      geometry: aoi, scale: 100, maxPixels: 1e13,
    }).getInfo(cb)),
  ]);

  const groups: { class: number; sum: number }[] = areaRes.groups || [];
  const totalM2 = groups.reduce((s, g) => s + g.sum, 0);

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
      areaKm2: +(g.sum / 1e6).toFixed(2),
      percent: totalM2 ? +((g.sum / totalM2) * 100).toFixed(1) : 0,
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
    nImages, nTrain, nVal,
    durationMs: Date.now() - t0,
    downloadUrl,
    noteCode,
  };
}

/** Compare all 7 supervised algorithms; returns summary + full result of the best. */
export async function compareAll(input: PeriodInput & {
  cloudMax?: number; rfTrees?: number; samplePoints?: SampleInput[];
}): Promise<{
  summary: CompareSummaryRow[];
  best: RunResult;
}> {
  await getEE();
  const aoi = ee.Geometry.Polygon([BORJ_COORDS]);
  const { start, end } = resolvePeriod(input);
  const cloud = input.cloudMax ?? 60;
  const rfTrees = input.rfTrees ?? 100;
  validateSamples(input.samplePoints);

  const nImages = await p<number>((cb) =>
    rawCollection(aoi, start, end, cloud).size().getInfo(cb));
  if (!nImages) throw new GEEError("no_images");
  const s2 = getS2(aoi, start, end, cloud);
  const feats = buildFeatures(s2, start, end);
  const fc = ee.FeatureCollection((input.samplePoints || []).map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { class: s.classId },
  })));
  const training = sampleTraining(feats, fc);
  const nSampled = await p<number>((cb) => training.size().getInfo(cb));
  if (!nSampled) throw new GEEError("samples_outside_aoi");
  const train = training.filter(ee.Filter.lt("split", 0.7));
  const val = training.filter(ee.Filter.gte("split", 0.7));

  const summary: CompareSummaryRow[] = [];
  for (const key of SUPERVISED_KEYS) {
    const classifier = makeClassifier(key, rfTrees).train({
      features: train, classProperty: "class", inputProperties: feats.bandNames(),
    });
    const cm = val.classify(classifier).errorMatrix("class", "classification");
    const acc = await p<any>((cb) => ee.Dictionary({
      oa: cm.accuracy(), kappa: cm.kappa(),
    }).getInfo(cb));
    summary.push({ algorithm: key, oa: Number(acc.oa), kappa: Number(acc.kappa), nVal: 0 });
  }
  summary.sort((a, b) => (b.oa ?? 0) - (a.oa ?? 0));
  const best = await runClassification({ ...input, algorithm: summary[0].algorithm, kind: "run" });
  for (const row of summary) row.nVal = best.nVal;
  return { summary, best };
}

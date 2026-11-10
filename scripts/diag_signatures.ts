// Diagnostic: run the signature classifier over Borj El Arab (winter) and
// report the mean feature values of the pixels each class captured, so the
// reference library can be tuned against what the classes actually grabbed.
//   GEE_KEY_FILE=... esbuild scripts/diag_signatures.ts --bundle ... && node
import * as fs from "fs";
import ee from "@google/earthengine";
import { BORJ_COORDS } from "../src/lib/gee/aoi";

const KEY =
  process.env.GEE_KEY_FILE ||
  "/home/z/my-project/upload/gen-lang-client-0103893868-7b694beb06e7.json";

function p<T>(callWithCb: (cb: (result: T, error: unknown) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    callWithCb((result, error) => (error ? reject(error) : resolve(result)));
  });
}
function maskClouds(img: any) {
  const scl = img.select("SCL");
  const clean = scl.neq(1).and(scl.neq(3)).and(scl.neq(8))
    .and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
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

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, "utf8"));
  await new Promise<void>((resolve, reject) =>
    ee.data.authenticateViaPrivateKey(
      key,
      () => ee.initialize(null, null, () => resolve(), reject),
      reject
    )
  );

  const aoi = ee.Geometry.Polygon([BORJ_COORDS]);
  const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(aoi).filterDate("2024-11-01", "2025-04-30")
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
    .map(maskClouds).map(addIndices);

  const ndvi = s2.select("NDVI");
  const sig = ee.Image.cat([
    ndvi.reduce(ee.Reducer.percentile([10, 90])),
    ndvi.reduce(ee.Reducer.mean()).rename("NDVI_mean"),
    s2.select("NDWI").mean().rename("NDWI_mean"),
    s2.select("NDMI").mean().rename("NDMI_mean"),
    s2.select(["B4", "B8", "B11", "B12"]).median()
      .rename(["B4_median", "B8_median", "B11_median", "B12_median"]),
  ]).rename([
    "NDVI_p10", "NDVI_p90", "NDVI_mean", "NDWI_mean", "NDMI_mean",
    "B4_median", "B8_median", "B11_median", "B12_median",
  ]);

  const FEATS = ["NDVI_mean", "NDVI_p10", "NDVI_p90", "NDWI_mean", "NDMI_mean",
    "B4_median", "B8_median", "B11_median", "B12_median"];
  const SCALES = [0.18, 0.2, 0.22, 0.22, 0.15, 0.1, 0.07, 0.12, 0.11];
  const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // current engine signature table (keep in sync!)
  const SIG: Record<number, number[]> = {
    1:  [0.45, 0.25, 0.75, -0.50, 0.20, 0.115, 0.40, 0.25, 0.165],
    2:  [0.14, 0.07, 0.25, -0.30, 0.01, 0.22, 0.37, 0.35, 0.28],
    3:  [0.15, 0.08, 0.26, -0.28, 0.01, 0.21, 0.37, 0.34, 0.27],
    4:  [0.50, 0.35, 0.72, -0.47, 0.21, 0.11, 0.40, 0.25, 0.16],
    5:  [0.38, 0.20, 0.64, -0.51, 0.16, 0.13, 0.37, 0.27, 0.18],
    6:  [0.48, 0.28, 0.70, -0.50, 0.22, 0.115, 0.39, 0.26, 0.17],
    7:  [0.42, 0.24, 0.68, -0.52, 0.18, 0.125, 0.38, 0.26, 0.17],
    8:  [0.15, 0.08, 0.24, -0.31, 0.01, 0.22, 0.37, 0.35, 0.28],
    9:  [0.52, 0.42, 0.62, -0.46, 0.22, 0.10, 0.41, 0.24, 0.155],
    10: [0.12, 0.06, 0.20, -0.28, -0.01, 0.24, 0.38, 0.36, 0.29],
    11: [0.10, 0.05, 0.16, -0.30, -0.05, 0.28, 0.40, 0.38, 0.31],
    12: [-0.15, -0.19, -0.08, 0.30, -0.12, 0.08, 0.05, 0.03, 0.02],
  };

  const x = sig.select(FEATS);
  const scales = ee.Image.constant(SCALES);
  const dists = IDS.map((id) =>
    x.subtract(ee.Image.constant(SIG[id])).divide(scales).pow(2)
      .reduce(ee.Reducer.sum()).rename(`d${id}`));
  let distImg = dists[0];
  for (let i = 1; i < dists.length; i++) distImg = distImg.addBands(dists[i]);
  let arg = ee.Image(0).rename("argmin");
  let best = distImg.select(0);
  for (let k = 1; k < dists.length; k++) {
    const cur = distImg.select(k);
    arg = arg.where(cur.lt(best), ee.Image.constant(k));
    best = best.min(cur);
  }
  let out = ee.Image.constant(IDS[0]).rename("classification");
  for (let k = 1; k < IDS.length; k++) out = out.where(arg.eq(k), IDS[k]);

  // sample classified + features, aggregate per class in JS (robust)
  const sampled = await p<any>((cb) =>
    sig.select(FEATS).addBands(out.rename("cls")).sample({
      region: aoi, scale: 100, numPixels: 4500, seed: 11,
    }).getInfo(cb));
  const rows: { cls: number; f: number[] }[] = (sampled.features ?? [])
    .map((ft: any) => ({
      cls: Number(ft.properties.cls),
      f: FEATS.map((k) => Number(ft.properties[k])),
    }))
    .filter((r: any) => Number.isFinite(r.cls) && r.f.every(Number.isFinite));

  const byClass = new Map<number, number[][]>();
  for (const r of rows) {
    if (!byClass.has(r.cls)) byClass.set(r.cls, []);
    byClass.get(r.cls)!.push(r.f);
  }
  const n = rows.length || 1;

  console.log("\nclass | share% | mean of captured pixels (n): NDVI_mean p10 p90 NDWI NDMI B4 B8 B11 B12");
  for (const id of IDS) {
    const arr = byClass.get(id);
    if (!arr || arr.length === 0) { console.log(`${String(id).padStart(2)} | none`); continue; }
    const mean = FEATS.map((_, j) => arr.reduce((s, v) => s + v[j], 0) / arr.length);
    console.log(
      `${String(id).padStart(2)} | ${((arr.length / n) * 100).toFixed(1).padStart(5)}% (n=${String(arr.length).padStart(4)}) | ${mean.map((v) => v.toFixed(3)).join(" ")}`
    );
  }
  console.log(`\nsampled total: ${rows.length}`);
}

main().catch((e) => {
  console.error("diag failed:", e);
  process.exit(1);
});

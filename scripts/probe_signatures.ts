// Probe the actual 9-feature signature space over Borj El Arab (winter),
// so the reference signature library can be calibrated to real pixel values.
// Server-side reduceRegion (percentiles) — light and reliable.
//   GEE_KEY_FILE=... ./node_modules/.bin/esbuild scripts/probe_signatures.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/ps.cjs && node /tmp/ps.cjs
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

  const feats: string[] = sig.bandNames().getInfo();
  console.log("bands:", feats.join(", "));

  const reduce = (img: any) =>
    img.reduceRegion({
      reducer: ee.Reducer.percentile([10, 25, 50, 75, 90]).combine(
        ee.Reducer.mean(), "", true
      ),
      geometry: aoi,
      scale: 100,
      maxPixels: 1e13,
    });

  console.log("\n=== ALL pixels (percentiles + mean) ===");
  const all = await p<any>((cb) => reduce(sig).getInfo(cb));
  for (const f of feats) {
    const g = (suffix: string) => (all[`${f}_${suffix}`] ?? all[`${f}${suffix}`]);
    console.log(
      `${f.padEnd(11)} p10=${g("p10").toFixed(3)} p25=${g("p25").toFixed(3)} p50=${g("p50").toFixed(3)} p75=${g("p75").toFixed(3)} p90=${g("p90").toFixed(3)} mean=${g("mean").toFixed(3)}`
    );
  }

  console.log("\n=== VEGETATION only (NDVI_mean > 0.35) ===");
  const vegImg = sig.updateMask(sig.select("NDVI_mean").gt(0.35));
  const veg = await p<any>((cb) => reduce(vegImg).getInfo(cb));
  for (const f of feats) {
    const g = (suffix: string) => (veg[`${f}_${suffix}`] ?? veg[`${f}${suffix}`]);
    console.log(
      `${f.padEnd(11)} p10=${g("p10").toFixed(3)} p25=${g("p25").toFixed(3)} p50=${g("p50").toFixed(3)} p75=${g("p75").toFixed(3)} p90=${g("p90").toFixed(3)}`
    );
  }

  // NDVI_mean band shares (histogram server-side via masked reductions)
  console.log("\nNDVI_mean band shares:");
  const edges = [0, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 1.0];
  const areas = await p<any>((cb) =>
    ee.Image.pixelArea()
      .addBands(sig.select("NDVI_mean"))
      .reduceRegion({
        reducer: ee.Reducer.sum().group({ groupField: 1, groupName: "b" }),
        geometry: aoi,
        scale: 100,
        maxPixels: 1e13,
      }).getInfo(cb)
  );
  // group by 0.05 bins
  const bins = new Map<number, number>();
  let total = 0;
  for (const g of areas.groups ?? []) {
    const bin = Math.floor(Number(g.b) / 0.05) * 0.05;
    bins.set(bin, (bins.get(bin) ?? 0) + g.sum);
    total += g.sum;
  }
  for (const [lo, hi] of edges.slice(0, -1).map((e, i) => [e, edges[i + 1]])) {
    let share = 0;
    for (const [bin, sum] of bins) if (bin >= lo && bin < hi) share += sum;
    console.log(`  NDVI_mean ${lo.toFixed(2)}–${hi.toFixed(2)}: ${((share / total) * 100).toFixed(1)}%`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});

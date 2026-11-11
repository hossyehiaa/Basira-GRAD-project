// Probe: measure REAL 9-feature signatures in a given window (default
// 2026-10-13 → 2026-11-11) at known land-cover locations around Borg El
// Arab — used to recalibrate the FLW/URB reference signatures (v1.3.1).
// Run: GEE_KEY_FILE=... node scripts/probe_october.mjs
import fs from "fs";
import ee from "@google/earthengine";

const KEY = "/home/z/my-project/upload/gen-lang-client-0103893868-7b694beb06e7.json";
const START = "2026-10-13";
const END = "2026-11-11";

function p(call) {
  return new Promise((res, rej) => call((r, e) => (e ? rej(e) : res(r))));
}
function maskClouds(img) {
  const scl = img.select("SCL");
  const clean = scl.neq(1).and(scl.neq(3)).and(scl.neq(8))
    .and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(clean)
    .select(["B2", "B3", "B4", "B8", "B11", "B12"]).divide(10000)
    .copyProperties(img, ["system:time_start", "system:index"]);
}
function addIndices(img) {
  return img
    .addBands(img.normalizedDifference(["B8", "B4"]).rename("NDVI"))
    .addBands(img.normalizedDifference(["B3", "B8"]).rename("NDWI"))
    .addBands(img.normalizedDifference(["B8", "B11"]).rename("NDMI"));
}
// same feature stack as engine.signatureFeatures()
function sigFeatures(s2) {
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
const FEATS = ["NDVI_mean", "NDVI_p10", "NDVI_p90", "NDWI_mean", "NDMI_mean",
  "B4_median", "B8_median", "B11_median", "B12_median"];

function circle(lat, lon, rKm) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const th = (2 * Math.PI * i) / 64;
    const dlat = (rKm * Math.cos(th)) / 111.32;
    const dlon = (rKm * Math.sin(th)) / (111.32 * Math.cos((lat * Math.PI) / 180));
    pts.push([lon + dlon, lat + dlat]);
  }
  return ee.Geometry.Polygon([pts]);
}

async function regionStats(name, geom, extraMask) {
  const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(geom).filterDate(START, END)
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
    .map(maskClouds).map(addIndices);
  const n = await p((cb) => s2.size().getInfo(cb));
  let img = sigFeatures(s2);
  if (extraMask) img = img.updateMask(extraMask(s2));
  const means = await p((cb) => img.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: geom,
    scale: 20,
    maxPixels: 1e9,
  }).getInfo(cb));
  console.log(`\n=== ${name} (nImages=${n}) ===`);
  const row = FEATS.map((f) => means[f]);
  console.log("  [NDVI_m, p10, p90, NDWI, NDMI, B4, B8, B11, B12] =");
  console.log("  [" + row.map((v) => (v == null ? "null" : v.toFixed(3))).join(", ") + "]");
  return row;
}

async function ndviFractions(name, geom) {
  const s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(geom).filterDate(START, END)
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
    .map(maskClouds).map(addIndices);
  const ndviMean = s2.select("NDVI").mean();
  const frac = await p((cb) => ndviMean.expression(
    "b(0) < 0.2 ? 0 : (b(0) < 0.35 ? 1 : 2)"
  ).multiply(ee.Image.pixelArea().divide(1e6))
    .reduceRegion({
      reducer: ee.Reducer.sum().group({ band: "first", rename: "zone" }),
      geometry: geom, scale: 60, maxPixels: 1e9,
    }).getInfo(cb));
  const areas = { 0: 0, 1: 0, 2: 0 };
  for (const g of frac.groups ?? []) areas[g.zone] = g.sum;
  const tt = Object.values(areas).reduce((a, b) => a + b, 0) || 1;
  console.log(`\n=== ${name}: NDVI_mean cover fractions ===`);
  console.log(`  bare NDVI<0.20  : ${(areas[0] / tt * 100).toFixed(1)}%`);
  console.log(`  sparse 0.20-0.35: ${(areas[1] / tt * 100).toFixed(1)}%`);
  console.log(`  active NDVI>0.35: ${(areas[2] / tt * 100).toFixed(1)}%`);
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, "utf8"));
  await new Promise((res, rej) => ee.data.authenticateViaPrivateKey(key,
    () => ee.initialize(null, null, res, rej), rej));

  // 1) true urban: Borg El Arab town centre
  await regionStats("URBAN: Borg El Arab town (30.918N 29.576E, r=1.2km)", circle(30.918, 29.576, 1.2));
  // 2) urban 2: another dense district
  await regionStats("URBAN2: town district (30.925N 29.560E, r=0.8km)", circle(30.925, 29.560, 0.8));
  // 3) bright desert sand W of the city
  await regionStats("DESERT bright sand (30.880N 29.470E, r=1.5km)", circle(30.880, 29.470, 1.5));
  // 4) the user's whole AOI
  await regionStats("USER AOI all (30.836N 29.648E, r=3.91km)", circle(30.836, 29.648, 3.91));
  // 5) user AOI bare subset only (NDVI_mean < 0.2)
  await regionStats("USER AOI bare only (NDVI<0.2)", circle(30.836, 29.648, 3.91),
    (s2) => s2.select("NDVI").mean().lt(0.2));
  // 6) user AOI vegetated subset (NDVI_mean > 0.35)
  await regionStats("USER AOI active veg only (NDVI>0.35)", circle(30.836, 29.648, 3.91),
    (s2) => s2.select("NDVI").mean().gt(0.35));
  // 7) NDVI cover fractions of user AOI
  await ndviFractions("USER AOI", circle(30.836, 29.648, 3.91));
  console.log("\nprobe done");
}

main().catch((e) => { console.error("PROBE FAILED:", e?.message || e); process.exit(1); });

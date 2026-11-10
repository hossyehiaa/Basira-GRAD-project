// v1.3 live GEE regression:
//   1. signature instant scan over the default AOI (winter)
//   2. signature instant scan over a small custom AOI (circle ~500 feddans)
//   3. k-NN run with 48 training samples
//   4. compare-all (9 supervised incl. MLP hybrid + native k-NN)
// Usage:
//   GEE_KEY_FILE=... ./node_modules/.bin/esbuild scripts/test_v13.ts --bundle \
//     --platform=node --format=cjs --outfile=/tmp/t13.cjs && node /tmp/t13.cjs
import {
  runClassification,
  compareAll,
  type SampleInput,
  type AoiGeoInput,
} from "../src/lib/gee/engine";

const KEY =
  process.env.GEE_KEY_FILE ||
  "/home/z/my-project/upload/gen-lang-client-0103893868-7b694beb06e7.json";
process.env.GEE_KEY_FILE = KEY;

/** 4 classes × 12 points (small 3×4 grids) inside the Borj El Arab polygon. */
function fixture(): SampleInput[] {
  const mk = (classId: number, clon: number, clat: number): SampleInput[] => {
    const out: SampleInput[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++)
        out.push({ classId, lon: +(clon + c * 0.004).toFixed(5), lat: +(clat + r * 0.004).toFixed(5) });
    return out;
  };
  return [
    ...mk(1, 29.5, 30.845),   // WHT
    ...mk(4, 29.58, 30.88),   // CLV
    ...mk(10, 29.66, 30.8),   // FLW
    ...mk(11, 29.62, 30.93),  // URB
  ];
}

/** 36-gon circle around a center (equirectangular, matches the UI). */
function circleAoi(lon: number, lat: number, radiusKm: number): AoiGeoInput {
  const ring: [number, number][] = [];
  const latR = radiusKm / 110.574;
  const lonR = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * 2 * Math.PI;
    ring.push([
      +(lon + Math.cos(a) * lonR).toFixed(6),
      +(lat + Math.sin(a) * latR).toFixed(6),
    ]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

async function main() {
  const t0 = Date.now();

  console.log("=== 1) signature scan — default AOI (winter) ===");
  const sig = await runClassification({ algorithm: "signature", season: "winter", kind: "run" });
  console.log(
    `note=${sig.noteCode} oa=${sig.oa} tileUrl=${sig.tileUrl ? "OK" : "MISSING"} areaKm2=${sig.areaKm2} nImages=${sig.nImages} in ${sig.durationMs}ms`
  );
  console.log("top classes:", sig.classes.slice(0, 5).map((c) => `${c.ar}=${c.areaKm2}km²(${c.percent}%)`).join(" · "));
  const sumPct = +sig.classes.reduce((s, c) => s + c.percent, 0).toFixed(1);
  console.log(`Σpercent=${sumPct} (must be ~100.0)`);

  console.log("\n=== 2) signature scan — custom AOI (500-feddan circle) ===");
  const farm = circleAoi(29.58, 30.85, 1.33);
  const sig2 = await runClassification({
    algorithm: "signature",
    season: "winter",
    kind: "run",
    aoiGeo: farm,
    aoiName: "500-feddan farm",
  });
  console.log(
    `note=${sig2.noteCode} areaKm2=${sig2.areaKm2} (expect ~5.5±0.3) aoiName=${sig2.aoiName} in ${sig2.durationMs}ms`
  );
  console.log("classes:", sig2.classes.slice(0, 6).map((c) => `${c.ar}=${c.areaKm2}km²`).join(" · "));

  console.log("\n=== 3) k-NN with 48 samples ===");
  const samplePoints = fixture();
  const knn = await runClassification({
    algorithm: "knn",
    season: "winter",
    kind: "run",
    knnK: 5,
    samplePoints,
  });
  console.log(
    `oa=${knn.oa} kappa=${knn.kappa} nTrain=${knn.nTrain} nVal=${knn.nVal} tileUrl=${knn.tileUrl ? "OK" : "MISSING"} in ${knn.durationMs}ms`
  );

  console.log("\n=== 4) compare-all (9 supervised + MLP + k-NN) ===");
  const cmp = await compareAll({ season: "winter", samplePoints, knnK: 5 });
  for (const row of cmp.summary) {
    console.log(
      `  ${row.algorithm.padEnd(10)} oa=${row.oa == null ? "FAILED" : row.oa.toFixed(3)} kappa=${row.kappa == null ? "-" : row.kappa.toFixed(3)}`
    );
  }
  console.log(`best=${cmp.best.algorithm} oa=${cmp.best.oa}`);

  console.log(`\nALL DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error("REGRESSION FAILED:", e);
  process.exit(1);
});

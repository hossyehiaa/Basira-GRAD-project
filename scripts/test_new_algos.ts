// Live GEE regression for the new algorithms (knn native + mlp hybrid) and
// the extended compareAll. Pattern:
//   GEE_KEY_FILE=... ./node_modules/.bin/esbuild scripts/test_new_algos.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/t.cjs && node /tmp/t.cjs
import { runClassification, compareAll, type SampleInput } from "../src/lib/gee/engine";

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

async function main() {
  const samplePoints = fixture();
  console.log(`fixture: ${samplePoints.length} points`);

  // ---- 1. kNN (native smileKNN) ----
  const knn = await runClassification({
    algorithm: "knn", season: "winter", knnK: 5,
    samplePoints, kind: "run",
  });
  console.log("knn   :", JSON.stringify({
    oa: knn.oa, kappa: knn.kappa, nTrain: knn.nTrain, nVal: knn.nVal,
    confusion: Boolean(knn.confusion),
    matrixDims: knn.confusion ? `${knn.confusion.rows.length}x${knn.confusion.rows[0]?.length}` : null,
    classes: knn.classes.length,
    areas: +knn.classes.reduce((s, c) => s + c.areaKm2, 0).toFixed(2),
    pctSum: +knn.classes.reduce((s, c) => s + c.percent, 0).toFixed(1),
    tile: knn.tileUrl ? knn.tileUrl.slice(0, 48) + "…" : null,
  }));

  // ---- 2. MLP (hybrid) ----
  const mlp = await runClassification({
    algorithm: "mlp", season: "winter", mlpHidden: 24, mlpEpochs: 400,
    samplePoints, kind: "run",
  });
  console.log("mlp   :", JSON.stringify({
    oa: mlp.oa, kappa: mlp.kappa, nTrain: mlp.nTrain, nVal: mlp.nVal,
    confusion: Boolean(mlp.confusion),
    matrixDims: mlp.confusion ? `${mlp.confusion.rows.length}x${mlp.confusion.rows[0]?.length}` : null,
    perClass: mlp.classes.filter((c) => c.support > 0)
      .map((c) => `${c.code}:PA=${c.pa?.toFixed(2)}/UA=${c.ua?.toFixed(2)}`).join(" "),
    classes: mlp.classes.length,
    areas: +mlp.classes.reduce((s, c) => s + c.areaKm2, 0).toFixed(2),
    pctSum: +mlp.classes.reduce((s, c) => s + c.percent, 0).toFixed(1),
    tile: mlp.tileUrl ? mlp.tileUrl.slice(0, 48) + "…" : null,
  }));

  // ---- 3. MLP determinism (same inputs -> identical outputs) ----
  const mlp2 = await runClassification({
    algorithm: "mlp", season: "winter", mlpHidden: 24, mlpEpochs: 400,
    samplePoints, kind: "run",
  });
  const det = mlp.oa === mlp2.oa && mlp.kappa === mlp2.kappa &&
    JSON.stringify(mlp.confusion) === JSON.stringify(mlp2.confusion) &&
    JSON.stringify(mlp.classes.map((c) => c.areaKm2)) ===
      JSON.stringify(mlp2.classes.map((c) => c.areaKm2));
  console.log("mlp deterministic:", det ? "YES ✅" : "NO ❌",
    `(oa ${mlp.oa?.toFixed(4)} vs ${mlp2.oa?.toFixed(4)})`);

  // ---- 4. compareAll (9 supervised incl. mlp + knn) ----
  const cmp = await compareAll({
    season: "winter", samplePoints,
    knnK: 5, mlpHidden: 24, mlpEpochs: 400,
  });
  console.log("compare:", cmp.summary
    .map((s) => `${s.algorithm}=${s.oa == null ? "FAIL" : s.oa.toFixed(3)}`)
    .join("  "));
  console.log("best   :", cmp.best.algorithm, "oa=", cmp.best.oa, "nVal=", cmp.best.nVal);
  const done = cmp.summary.filter((s) => s.oa != null).length;
  console.log(`done   : ${done}/${cmp.summary.length}`);
  if (done < cmp.summary.length) {
    console.log("FAILED ALGOS:", cmp.summary.filter((s) => s.oa == null).map((s) => s.algorithm));
  }
  console.log("\nALL NEW-ALGO TESTS DONE");
}

main().catch((e) => {
  console.error("TEST FAILED:", (e as { code?: string })?.code ?? e?.message ?? e);
  process.exit(1);
});

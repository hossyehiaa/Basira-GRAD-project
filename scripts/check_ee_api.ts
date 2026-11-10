// Quick check: does this @google/earthengine build expose Classifier.smileKNN?
// Usage: npx tsx scripts/check_ee_api.ts   (or esbuild+node pattern)
import * as ee from "@google/earthengine";

const E = ee as unknown as { Classifier: Record<string, unknown>; Clusterer: Record<string, unknown>; data: { getAlgorithms?: () => Record<string, unknown> } };

console.log("Classifier keys with KNN/knn:");
for (const k of Object.keys(E.Classifier ?? {})) {
  if (/knn/i.test(k)) console.log("  ", k, typeof E.Classifier[k]);
}
console.log("Clusterer keys with kmeans:");
for (const k of Object.keys(E.Clusterer ?? {})) {
  if (/kmeans/i.test(k)) console.log("  ", k);
}
try {
  const algos = E.data.getAlgorithms?.() ?? {};
  const names = Object.keys(algos).filter((n) => /knn/i.test(n));
  console.log("Server algorithm catalog KNN entries:", names);
} catch (e) {
  console.log("getAlgorithms requires auth (expected without key):", String(e).slice(0, 80));
}

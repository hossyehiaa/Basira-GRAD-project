// Probe the GEE algorithm catalog for this service account:
// lists every ee.Classifier.* / ee.Clusterer.* function with its signature args.
// Usage (from repo root, local test pattern):
//   GEE_KEY_FILE=/home/z/my-project/upload/gen-lang-client-0103893868-7b694beb06e7.json \
//   ./node_modules/.bin/esbuild scripts/probe_classifiers.ts --bundle --platform=node \
//     --format=cjs --outfile=/tmp/probe_classifiers.cjs && node /tmp/probe_classifiers.cjs
import * as fs from "fs";
import * as ee from "@google/earthengine";

// The npm package ships no type declarations for the dynamic algorithm
// catalog — access it through an untyped alias.
const EE = ee as unknown as {
  data: {
    authenticateViaPrivateKey: (k: unknown, ok: () => void, err?: (e: unknown) => void) => void;
    getAlgorithms?: () => Record<string, { name: string; args: unknown[] }>;
  };
  initialize: (
    a: null, b: null, ok: () => void, err?: (e: unknown) => void
  ) => void;
};

const KEY_PATH =
  process.env.GEE_KEY_FILE ||
  "/home/z/my-project/upload/gen-lang-client-0103893868-7b694beb06e7.json";

function main() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  EE.data.authenticateViaPrivateKey(key, () => {
    EE.initialize(null, null, () => {
      const algos: Record<string, { name: string; args: unknown[] }> =
        EE.data.getAlgorithms ? EE.data.getAlgorithms() : {};
      const names = Object.keys(algos)
        .filter((n) => /^(ee\.)?(Classifier|Clusterer)\./.test(n))
        .sort();
      console.log("=== Classifier / Clusterer catalog (" + names.length + ") ===");
      for (const n of names) {
        const a = algos[n];
        const args = Array.isArray(a?.args)
          ? a.args
              .map((x: any) =>
                typeof x === "string" ? x : `${x?.name ?? "?"}:${x?.type ?? "?"}${x?.optional ? "?" : ""}`
              )
              .join(", ")
          : "";
        console.log(`${n}(${args})`);
      }
      // also probe direct constructors that may exist even if catalog omits them
      const probes: [string, () => unknown][] = [
        ["smileKNN", () => (ee as any).Classifier.smileKNN(5)],
        ["smileNeuralNetwork", () => (ee as any).Classifier.smileNeuralNetwork({})],
        ["smileGradientTreeBoost", () => (ee as any).Classifier.smileGradientTreeBoost(60)],
        ["decisionTree", () => (ee as any).Classifier.decisionTree("")],
        ["smileKMeans(clusterer)", () => (ee as any).Clusterer.smileKMeans(8)],
        ["wekaKMeans(clusterer)", () => (ee as any).Clusterer.wekaKMeans(8)],
      ];
      console.log("\n=== direct constructor probes ===");
      for (const [label, fn] of probes) {
        try {
          fn();
          console.log(`${label}: AVAILABLE`);
        } catch (e: any) {
          console.log(`${label}: ${String(e?.message ?? e).split("\n")[0]}`);
        }
      }
      process.exit(0);
    }, (e: any) => { console.error("initialize failed:", e); process.exit(1); });
  });
}

main();

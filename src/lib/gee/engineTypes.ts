// Client-safe type re-exports from the GEE engine (type-only — erased at
// build time, so the client bundle never pulls in @google/earthengine).
// NOTE: AlgoKey/SeasonKey live in @/lib/basira/types (structurally identical).
export type {
  RunResult,
  CompareSummaryRow,
  ClassRow,
  SceneResult,
} from "./engine";

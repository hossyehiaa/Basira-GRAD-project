// Basira — shared types

export type Lang = "ar" | "en";
export type SeasonKey = "winter" | "summer" | "full" | "custom";
export type AlgoKey =
  | "rf"
  | "gtb"
  | "svm"
  | "cart"
  | "nb"
  | "mlp"
  | "knn"
  | "mindist_e"
  | "mindist_m"
  | "kmeans"
  | "signature";

export interface CropClass {
  id: number;
  code: string;
  en: string;
  ar: string;
  color: string;
}

export interface AlgorithmMeta {
  key: AlgoKey;
  en: string;
  ar: string;
  family: "supervised" | "unsupervised";
  supervised: boolean;
  demoOa: number; // demo-mode baseline overall accuracy
  demoKappa: number;
  noteEn: string;
  noteAr: string;
}

export interface DemoClassRow {
  classId: number;
  code: string;
  en: string;
  ar: string;
  color: string;
  pixels?: number;
  areaKm2: number;
  percent: number;
  pa: number | null;
  ua: number | null;
  f1: number | null;
}

export interface ConfusionMatrix {
  /** class ids of the matrix rows/columns, ascending (matrix order) */
  classIds: number[];
  /** rows = actual class, cols = predicted class (counts) */
  rows: number[][];
}

export interface DemoRunResult {
  oa: number;
  kappa: number;
  mapUrl: string;
  classes: DemoClassRow[];
  matrix?: ConfusionMatrix;
}

export interface DemoResults {
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
    pxW: number;
    pxH: number;
    areaKm2: number;
  };
  seasons: Record<string, Record<string, DemoRunResult>>;
}

export interface RunPayload {
  id?: number;
  /** "live" = real Earth Engine run; "demo" = pre-computed showcase data */
  mode?: "live" | "demo";
  algorithm: AlgoKey;
  season: SeasonKey;
  dateFrom?: string | null;
  dateTo?: string | null;
  oa: number | null;
  kappa: number | null;
  mapUrl?: string | null;
  classes: DemoClassRow[];
  createdAt?: string;
  nImages?: number;
  durationMs?: number;
  downloadUrl?: string | null;
  /** number of validation samples behind the accuracy figures (compare flow) */
  nVal?: number;
  /** confusion matrix (available when accuracy was computed) */
  confusion?: ConfusionMatrix | null;
  /** total scanned area (km²) — exact AOI polygon for live runs */
  aoiAreaKm2?: number | null;
  /** total scanned area in feddans */
  aoiAreaFeddans?: number | null;
  /** label of the scanned AOI */
  aoiName?: string | null;
  /** how the training set was built ("auto" = zero-click spectral anchors) */
  sampleSource?: "manual" | "auto" | null;
  /** engine note codes: instant_estimate | auto_sample_failed | ... */
  noteCode?: string | null;
  /** anchor pixel count behind an auto-sampled run */
  autoSampleN?: number | null;
  /** number of classes the anchors covered */
  autoSampleClasses?: number | null;
}

export interface SamplePoint {
  classId: number;
  classEn: string;
  classAr: string;
  lon: number;
  lat: number;
}

export interface SampleSetInfo {
  id: number;
  name: string;
  source: string;
  count: number;
  createdAt: string;
  points?: SamplePoint[];
}

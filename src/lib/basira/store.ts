"use client";
// Basira — global client state (language + workspace state)
import { create } from "zustand";
import type { AlgoKey, Lang, RunPayload, SamplePoint, SeasonKey } from "./types";

export interface AoiState {
  id: number | null; // null = built-in Borj El Arab
  name: string;
  nameAr: string;
  geojson: unknown; // GeoJSON geometry object
  isDefault: boolean;
  /** exact area in km² (client estimate; refined by PostGIS when available) */
  areaKm2?: number | null;
  /** bounding box {west, south, east, north} */
  bbox?: { west: number; south: number; east: number; north: number } | null;
}

interface BasiraStore {
  lang: Lang;
  setLang: (l: Lang) => void;

  season: SeasonKey;
  setSeason: (s: SeasonKey) => void;
  dateFrom: string;
  dateTo: string;
  setDate: (from: string, to: string) => void;

  algorithm: AlgoKey;
  setAlgorithm: (a: AlgoKey) => void;
  rfTrees: number;
  setRfTrees: (n: number) => void;
  kClusters: number;
  setKClusters: (n: number) => void;
  knnK: number;
  setKnnK: (n: number) => void;
  mlpHidden: number;
  setMlpHidden: (n: number) => void;
  mlpEpochs: number;
  setMlpEpochs: (n: number) => void;

  sampleSetId: number | null; // null = built-in demo samples
  samplePoints: SamplePoint[]; // drawn / uploaded points
  setSamples: (id: number | null, points: SamplePoint[]) => void;
  addSample: (p: SamplePoint) => void;
  clearSamples: () => void;

  // click-to-draw training samples on the map
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  drawClassId: number;
  setDrawClassId: (id: number) => void;

  // rectangle area drawing ("select scan area on the map")
  areaDrawMode: boolean;
  setAreaDrawMode: (v: boolean) => void;

  aoi: AoiState;
  setAoi: (a: AoiState) => void;
  resetAoi: () => void;

  // a classification/scan job is executing (drives the radar animation)
  isScanning: boolean;
  setScanning: (v: boolean) => void;

  // increments to trigger the space-to-field camera fly-in on the map
  scanTourNonce: number;
  triggerScanTour: () => void;

  runResult: RunPayload | null;
  setRunResult: (r: RunPayload | null) => void;

  compareResults: RunPayload[] | null;
  setCompareResults: (rs: RunPayload[] | null) => void;

  overlayOpacity: number;
  setOverlayOpacity: (v: number) => void;
}

const DEFAULT_AOI: AoiState = {
  id: null,
  name: "Borj El Arab",
  nameAr: "برج العرب",
  geojson: null,
  isDefault: true,
  areaKm2: null,
  bbox: null,
};

/** Safe custom-period defaults — a complete, real-data winter season. */
export const DEFAULT_DATE_FROM = "2025-11-01";
export const DEFAULT_DATE_TO = "2026-04-30";

/** A date range is usable only when both ends are valid ISO days in order. */
export function isValidRange(
  from: unknown,
  to: unknown
): from is string {
  return (
    typeof from === "string" &&
    typeof to === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from < to &&
    !Number.isNaN(new Date(from).getTime()) &&
    !Number.isNaN(new Date(to).getTime())
  );
}

export const useBasira = create<BasiraStore>((set) => ({
  lang: "ar",
  setLang: (l) => set({ lang: l }),

  season: "winter",
  // Entering "custom" always finds a valid range: if the stored dates were
  // cleared or corrupted, the safe defaults are restored on the switch.
  setSeason: (s) =>
    set((st) => ({
      season: s,
      ...(s === "custom" && !isValidRange(st.dateFrom, st.dateTo)
        ? { dateFrom: DEFAULT_DATE_FROM, dateTo: DEFAULT_DATE_TO }
        : {}),
    })),
  dateFrom: DEFAULT_DATE_FROM,
  dateTo: DEFAULT_DATE_TO,
  setDate: (from, to) =>
    set({
      // never persist null/undefined — fall back to the previous safe value
      dateFrom: from || DEFAULT_DATE_FROM,
      dateTo: to || DEFAULT_DATE_TO,
    }),

  // signature (instant scan) by default: works immediately with zero samples.
  // Supervised algorithms become available once samples are drawn/uploaded.
  algorithm: "signature",
  setAlgorithm: (a) => set({ algorithm: a }),
  rfTrees: 100,
  setRfTrees: (n) => set({ rfTrees: n }),
  kClusters: 12,
  setKClusters: (n) => set({ kClusters: n }),
  knnK: 5,
  setKnnK: (n) => set({ knnK: n }),
  mlpHidden: 24,
  setMlpHidden: (n) => set({ mlpHidden: n }),
  mlpEpochs: 400,
  setMlpEpochs: (n) => set({ mlpEpochs: n }),

  sampleSetId: null,
  samplePoints: [],
  setSamples: (id, points) => set({ sampleSetId: id, samplePoints: points }),
  addSample: (p) =>
    set((s) => ({
      // drawn points form a local set (id 0 marks "drawn on map")
      sampleSetId: s.sampleSetId ?? 0,
      samplePoints: [...s.samplePoints, p],
    })),
  clearSamples: () => set({ sampleSetId: null, samplePoints: [] }),

  drawMode: false,
  setDrawMode: (v) => set({ drawMode: v }),
  drawClassId: 1,
  setDrawClassId: (id) => set({ drawClassId: id }),

  areaDrawMode: false,
  setAreaDrawMode: (v) => set({ areaDrawMode: v }),

  aoi: DEFAULT_AOI,
  setAoi: (a) => set({ aoi: a }),
  resetAoi: () => set({ aoi: DEFAULT_AOI, scanTourNonce: Date.now() }),

  isScanning: false,
  setScanning: (v) => set({ isScanning: v }),

  scanTourNonce: 0,
  triggerScanTour: () => set({ scanTourNonce: Date.now() }),

  runResult: null,
  setRunResult: (r) => set({ runResult: r }),

  compareResults: null,
  setCompareResults: (rs) => set({ compareResults: rs }),

  overlayOpacity: 0.75,
  setOverlayOpacity: (v) => set({ overlayOpacity: v }),
}));

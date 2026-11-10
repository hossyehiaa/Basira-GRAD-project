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

  aoi: AoiState;
  setAoi: (a: AoiState) => void;

  runResult: RunPayload | null;
  setRunResult: (r: RunPayload | null) => void;

  compareResults: RunPayload[] | null;
  setCompareResults: (rs: RunPayload[] | null) => void;

  overlayOpacity: number;
  setOverlayOpacity: (v: number) => void;
}

export const useBasira = create<BasiraStore>((set) => ({
  lang: "ar",
  setLang: (l) => set({ lang: l }),

  season: "winter",
  setSeason: (s) => set({ season: s }),
  dateFrom: "2024-11-01",
  dateTo: "2025-04-30",
  setDate: (from, to) => set({ dateFrom: from, dateTo: to }),

  // kmeans by default: unsupervised, runs live with zero training samples.
  // Supervised algorithms become available once samples are drawn/uploaded.
  algorithm: "kmeans",
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

  aoi: {
    id: null,
    name: "Borj El Arab",
    nameAr: "برج العرب",
    geojson: null,
    isDefault: true,
  },
  setAoi: (a) => set({ aoi: a }),

  runResult: null,
  setRunResult: (r) => set({ runResult: r }),

  compareResults: null,
  setCompareResults: (rs) => set({ compareResults: rs }),

  overlayOpacity: 0.75,
  setOverlayOpacity: (v) => set({ overlayOpacity: v }),
}));

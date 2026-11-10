/**
 * Basira — client-side geodesic helpers for custom scan areas.
 * Used by the coordinate-input widget and the map rectangle-draw tool to
 * build GeoJSON polygons and estimate their area before the PostGIS-exact
 * value arrives from the server (ST_Area on the geography).
 */

export type LonLat = [number, number];

const R_EARTH = 6371008.8; // mean Earth radius (m), same as Turf.js
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Approximate polygon area on the sphere (m²) — Turf-style ring sum. */
export function ringAreaM2(ring: LonLat[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [l1, p1] = ring[i];
    const [l2, p2] = ring[(i + 1) % n];
    total += (rad(l2) - rad(l1)) * (2 + Math.sin(rad(p1)) + Math.sin(rad(p2)));
  }
  return Math.abs((total * R_EARTH * R_EARTH) / 2);
}

export function polygonAreaKm2(rings: LonLat[][]): number {
  let area = 0;
  for (let i = 0; i < rings.length; i++) {
    area += i === 0 ? ringAreaM2(rings[i]) : -ringAreaM2(rings[i]); // holes subtract
  }
  return area / 1e6;
}

/** Circle as an n-gon (equirectangular radii — accurate enough at these sizes). */
export function circleRing(lon: number, lat: number, radiusKm: number, n = 36): LonLat[] {
  const latR = radiusKm / 110.574;
  const lonR = radiusKm / (111.32 * Math.max(0.05, Math.cos(rad(lat))));
  const ring: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([+(lon + Math.cos(a) * lonR).toFixed(6), +(lat + Math.sin(a) * latR).toFixed(6)]);
  }
  ring.push(ring[0]); // close the ring
  return ring;
}

/** Rectangle ring from a bounding box. */
export function bboxRing(
  west: number,
  south: number,
  east: number,
  north: number
): LonLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south], // closed
  ];
}

export function bboxOfRing(ring: LonLat[]): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  let west = 180, south = 90, east = -180, north = -90;
  for (const [lon, lat] of ring) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

/** Egyptian coverage envelope (the reference library is Egypt-tuned). */
export const EGYPT_BOUNDS = { west: 24.5, east: 37.5, south: 21.5, north: 32.5 };

export function ringInsideEgypt(ring: LonLat[]): boolean {
  return ring.every(
    ([lon, lat]) =>
      lon >= EGYPT_BOUNDS.west &&
      lon <= EGYPT_BOUNDS.east &&
      lat >= EGYPT_BOUNDS.south &&
      lat <= EGYPT_BOUNDS.north
  );
}

/** Validate a candidate scan polygon: location + size window. */
export function validateScanArea(
  ring: LonLat[]
): { ok: true; areaKm2: number } | { ok: false; reason: "outside" | "size" | "values" } {
  if (!ring || ring.length < 4 || ring.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat))) {
    return { ok: false, reason: "values" };
  }
  if (!ringInsideEgypt(ring)) return { ok: false, reason: "outside" };
  const areaKm2 = polygonAreaKm2([ring]);
  if (areaKm2 < 0.05 || areaKm2 > 20000) return { ok: false, reason: "size" };
  return { ok: true, areaKm2 };
}

/**
 * Basira — single source of truth for area formatting (km² ⇄ feddan).
 *
 * Every widget, panel and toast that shows an area string goes through these
 * helpers, so the SAME number renders identically everywhere on screen
 * (AOI chip, results header, coordinate preview, DSS table…).
 *
 * Conversion: the Egyptian feddan = 4,200 m² exactly
 *   -> 1 km² = 1,000,000 / 4,200 = 238.095 feddans (FEDDAN_PER_KM2).
 */
import { FEDDAN_PER_KM2 } from "./agronomy";
import { t } from "./i18n";
import type { Lang } from "./types";

export { FEDDAN_PER_KM2 };

/** feddans for a km² value (1 km² = 238.095 feddan exactly) */
export const km2ToFeddans = (km2: number): number =>
  Number.isFinite(km2) ? km2 * FEDDAN_PER_KM2 : NaN;

/** "32,441" — feddan count, thousands-separated, identical rounding everywhere */
export const fmtFeddans = (km2: number): string =>
  Number.isFinite(km2) ? Math.round(km2ToFeddans(km2)).toLocaleString("en-US") : "—";

/** "136.25" — km² with two decimals, identical everywhere */
export const fmtKm2 = (km2: number): string =>
  Number.isFinite(km2) ? km2.toFixed(2) : "—";

/** "136.25 كم² · 32,441 فدان" — THE total-area chip string used by all panels */
export const fmtAreaTotal = (km2: number, lang: Lang): string =>
  `${fmtKm2(km2)} ${t(lang, "km2Unit")} · ${fmtFeddans(km2)} ${t(lang, "feddanUnit")}`;

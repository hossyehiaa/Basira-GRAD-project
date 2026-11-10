// Basira — agronomic decision-support constants (Yield & Water estimator)
//
// Typical Egyptian agronomic figures for the northern Nile Delta / coastal
// belt (Borj El Arab). Values are indicative planning estimates compiled from
// common Egyptian Ministry of Agriculture / FAO ranges — good for a
// decision-support card, NOT a substitute for field survey.
//
// Area conversion: the Egyptian feddan = 4,200 m² exactly
//   -> 1 km² = 1,000,000 / 4,200 = 238.095 feddans.

export const FEDDAN_PER_KM2 = 238.095;

export interface CropDss {
  /** average fresh yield, tons per feddan per season (0 = not a crop) */
  yieldTFed: number;
  /** gross seasonal water requirement, m³ per feddan (surface irrigation) */
  waterM3Fed: number;
}

export const CROP_DSS: Record<string, CropDss> = {
  WHT: { yieldTFed: 2.8, waterM3Fed: 1900 },   // قمح — winter wheat
  MZE: { yieldTFed: 3.2, waterM3Fed: 3100 },   // ذرة — maize (grain)
  RIC: { yieldTFed: 4.2, waterM3Fed: 7200 },   // أرز — rice (flooded)
  CLV: { yieldTFed: 25, waterM3Fed: 3600 },    // برسيم — berseem, multi-cut fresh
  POT: { yieldTFed: 11, waterM3Fed: 3000 },    // بطاطس — potato
  BET: { yieldTFed: 20, waterM3Fed: 3300 },    // بنجر السكر — sugar beet (roots)
  FBA: { yieldTFed: 1.2, waterM3Fed: 1900 },   // فول — faba bean (dry)
  SUN: { yieldTFed: 1.4, waterM3Fed: 2600 },   // عباد الشمس — sunflower (seed)
  ORC: { yieldTFed: 8.5, waterM3Fed: 6500 },   // بساتين — mixed orchards (fruit)
  FLW: { yieldTFed: 0, waterM3Fed: 0 },        // أرض بور — fallow
  URB: { yieldTFed: 0, waterM3Fed: 0 },        // عمران — urban
  WTR: { yieldTFed: 0, waterM3Fed: 0 },        // مياه — water
};

export const isCrop = (code: string) =>
  CROP_DSS[code] != null && CROP_DSS[code].yieldTFed > 0;

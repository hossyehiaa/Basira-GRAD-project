// Basira — platform constants (mirrors the GEE engine scripts)
import type { AlgorithmMeta, CropClass } from "./types";

export const PLATFORM = {
  nameEn: "Basira",
  nameAr: "بصيرة",
  taglineEn: "Satellite Crop Intelligence",
  taglineAr: "ذكاء الأقمار الصناعية للمحاصيل",
  version: "1.0.0",
  regionEn: "Borj El Arab · Alexandria · Egypt",
  regionAr: "برج العرب · الإسكندرية · مصر",
  aoiAreaKm2: 596,
  dataset: "Sentinel-2 L2A (10 m)",
};

export const CLASSES: CropClass[] = [
  { id: 1, code: "WHT", en: "Wheat", ar: "قمح", color: "#ffff00" },
  { id: 2, code: "MZE", en: "Maize", ar: "ذرة", color: "#00ff00" },
  { id: 3, code: "RIC", en: "Rice", ar: "أرز", color: "#00ffff" },
  { id: 4, code: "CLV", en: "Clover", ar: "برسيم", color: "#008000" },
  { id: 5, code: "POT", en: "Potato", ar: "بطاطس", color: "#b5651d" },
  { id: 6, code: "BET", en: "Sugar Beet", ar: "بنجر السكر", color: "#ff69b4" },
  { id: 7, code: "FBA", en: "Faba Bean", ar: "فول", color: "#800080" },
  { id: 8, code: "SUN", en: "Sunflower", ar: "عباد الشمس", color: "#ff8c00" },
  { id: 9, code: "ORC", en: "Orchards", ar: "بساتين", color: "#808000" },
  { id: 10, code: "FLW", en: "Fallow", ar: "أرض بور", color: "#808080" },
  { id: 11, code: "URB", en: "Urban", ar: "عمران", color: "#ff0000" },
  { id: 12, code: "WTR", en: "Water", ar: "مياه", color: "#0000ff" },
];

export const CLASS_BY_CODE: Record<string, CropClass> = Object.fromEntries(
  CLASSES.map((c) => [c.code, c])
);

export const ALGORITHMS: AlgorithmMeta[] = [
  {
    key: "rf",
    en: "Random Forest",
    ar: "الغابة العشوائية",
    family: "supervised",
    supervised: true,
    demoOa: 0.91,
    demoKappa: 0.893,
    noteEn: "Ensemble of decision trees; usually the top performer for crop mapping.",
    noteAr: "مجموعة أشجار قرار؛ عادةً الأفضل في رسم خرائط المحاصيل.",
  },
  {
    key: "gtb",
    en: "Gradient Tree Boost",
    ar: "التعزيز التدرجي للأشجار",
    family: "supervised",
    supervised: true,
    demoOa: 0.9,
    demoKappa: 0.879,
    noteEn: "Boosted trees; strong accuracy with careful tuning.",
    noteAr: "أشجار معزّزة؛ دقة عالية مع ضبط جيد للمعاملات.",
  },
  {
    key: "svm",
    en: "Support Vector Machine",
    ar: "آلة المتجهات الداعمة",
    family: "supervised",
    supervised: true,
    demoOa: 0.888,
    demoKappa: 0.867,
    noteEn: "Margin-based classifier; robust in high dimensions.",
    noteAr: "مصنّف قائم على الهوامش؛ قوي مع الأبعاد الكثيرة.",
  },
  {
    key: "cart",
    en: "CART Decision Tree",
    ar: "شجرة قرار CART",
    family: "supervised",
    supervised: true,
    demoOa: 0.84,
    demoKappa: 0.81,
    noteEn: "Single interpretable tree; fast but prones to overfitting.",
    noteAr: "شجرة واحدة قابلة للتفسير؛ سريعة لكنها عرضة للإفراط في التعلّم.",
  },
  {
    key: "nb",
    en: "Naive Bayes",
    ar: "بايز الساذج",
    family: "supervised",
    supervised: true,
    demoOa: 0.782,
    demoKappa: 0.744,
    noteEn: "Probabilistic; assumes feature independence.",
    noteAr: "احتمالي؛ يفترض استقلال الخصائص.",
  },
  {
    key: "mindist_e",
    en: "Minimum Distance (Euclidean)",
    ar: "أقل مسافة (إقليدية)",
    family: "supervised",
    supervised: true,
    demoOa: 0.718,
    demoKappa: 0.67,
    noteEn: "Assigns to the nearest class mean in feature space.",
    noteAr: "يُسند البكسل لأقرب متوسط فئة في فضاء الخصائص.",
  },
  {
    key: "mindist_m",
    en: "Mahalanobis Distance",
    ar: "مسافة ماهالانوبيس",
    family: "supervised",
    supervised: true,
    demoOa: 0.756,
    demoKappa: 0.712,
    noteEn: "Distance weighted by class covariance.",
    noteAr: "مسافة مرجّحة بتغاير الفئة.",
  },
  {
    key: "kmeans",
    en: "KMeans (unsupervised)",
    ar: "K-Means (غير موجّه)",
    family: "unsupervised",
    supervised: false,
    demoOa: 0.617,
    demoKappa: 0.548,
    noteEn: "Clusters pixels without labels; useful for exploring new areas.",
    noteAr: "يجمّع البكسلات بدون عينات؛ مفيد لاستكشاف مناطق جديدة.",
  },
];

export const ALGO_BY_KEY: Record<string, AlgorithmMeta> = Object.fromEntries(
  ALGORITHMS.map((a) => [a.key, a])
);

// Simulated NDVI temporal profiles per class (demo mode) — month → NDVI
export const NDVI_PROFILES: Record<string, number[]> = {
  WHT: [0.25, 0.33, 0.45, 0.58, 0.66, 0.55, 0.3, 0.2, 0.18, 0.17, 0.19, 0.22],
  MZE: [0.2, 0.18, 0.17, 0.18, 0.22, 0.3, 0.45, 0.62, 0.71, 0.68, 0.5, 0.3],
  RIC: [0.18, 0.16, 0.16, 0.18, 0.25, 0.4, 0.55, 0.68, 0.75, 0.72, 0.55, 0.3],
  CLV: [0.6, 0.62, 0.58, 0.55, 0.5, 0.45, 0.4, 0.38, 0.42, 0.5, 0.55, 0.58],
  POT: [0.22, 0.28, 0.42, 0.55, 0.6, 0.5, 0.35, 0.25, 0.24, 0.3, 0.42, 0.5],
  BET: [0.2, 0.26, 0.38, 0.5, 0.58, 0.62, 0.6, 0.5, 0.35, 0.25, 0.2, 0.18],
  FBA: [0.3, 0.4, 0.52, 0.6, 0.58, 0.45, 0.3, 0.22, 0.19, 0.18, 0.2, 0.25],
  SUN: [0.2, 0.18, 0.17, 0.19, 0.24, 0.35, 0.5, 0.64, 0.7, 0.62, 0.4, 0.25],
  ORC: [0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.61, 0.6, 0.58, 0.56, 0.53, 0.51],
  FLW: [0.16, 0.15, 0.16, 0.18, 0.2, 0.21, 0.22, 0.21, 0.19, 0.18, 0.16, 0.15],
  URB: [0.12, 0.12, 0.13, 0.13, 0.14, 0.14, 0.15, 0.15, 0.14, 0.14, 0.13, 0.12],
  WTR: [0.05, 0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.07, 0.06, 0.05, 0.05],
};

export const MONTHS_AR = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
export const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Borj El Arab geographic envelope (matches demo overlays)
// Leaflet convention: [[south, west], [north, east]]
export const AOI_BOUNDS: [[number, number], [number, number]] = [
  [30.6998, 29.3864],
  [31.0222, 29.7636],
];
export const AOI_CENTER: [number, number] = [30.861, 29.575];
export const ESRI_ATTRIBUTION =
  "Esri, Maxar, Earthstar Geographics, and the GIS User Community";

// Basira — platform constants (mirrors the GEE engine scripts)
import type { AlgorithmMeta, CropClass } from "./types";

export const PLATFORM = {
  nameEn: "Basira",
  nameAr: "بصيرة",
  taglineEn: "Satellite Crop Intelligence",
  taglineAr: "ذكاء الأقمار الصناعية للمحاصيل",
  version: "1.2.0",
  regionEn: "Borj El Arab · Alexandria · Egypt",
  regionAr: "برج العرب · الإسكندرية · مصر",
  /** Canonical study-area size — exact UTM 35N area of the analysis polygon
   *  (scripts/calibrate_demo.py keeps Σ class areas equal to this value). */
  aoiAreaKm2: 596.9,
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
    demoOa: 0.928,
    demoKappa: 0.916,
    noteEn: "Ensemble of decision trees; usually the top performer for crop mapping.",
    noteAr: "مجموعة أشجار قرار؛ عادةً الأفضل في رسم خرائط المحاصيل.",
  },
  {
    key: "gtb",
    en: "Gradient Tree Boost",
    ar: "التعزيز التدرجي للأشجار",
    family: "supervised",
    supervised: true,
    demoOa: 0.913,
    demoKappa: 0.899,
    noteEn: "Boosted trees; strong accuracy with careful tuning.",
    noteAr: "أشجار معزّزة؛ دقة عالية مع ضبط جيد للمعاملات.",
  },
  {
    key: "svm",
    en: "Support Vector Machine",
    ar: "آلة المتجهات الداعمة",
    family: "supervised",
    supervised: true,
    demoOa: 0.876,
    demoKappa: 0.857,
    noteEn: "Margin-based classifier; robust in high dimensions.",
    noteAr: "مصنّف قائم على الهوامش؛ قوي مع الأبعاد الكثيرة.",
  },
  {
    key: "cart",
    en: "CART Decision Tree",
    ar: "شجرة قرار CART",
    family: "supervised",
    supervised: true,
    demoOa: 0.832,
    demoKappa: 0.805,
    noteEn: "Single interpretable tree; fast but prones to overfitting.",
    noteAr: "شجرة واحدة قابلة للتفسير؛ سريعة لكنها عرضة للإفراط في التعلّم.",
  },
  {
    key: "nb",
    en: "Naive Bayes",
    ar: "بايز الساذج",
    family: "supervised",
    supervised: true,
    demoOa: 0.757,
    demoKappa: 0.719,
    noteEn: "Probabilistic; assumes feature independence.",
    noteAr: "احتمالي؛ يفترض استقلال الخصائص.",
  },
  {
    key: "mindist_e",
    en: "Minimum Distance (Euclidean)",
    ar: "أقل مسافة (إقليدية)",
    family: "supervised",
    supervised: true,
    demoOa: 0.731,
    demoKappa: 0.691,
    noteEn: "Assigns to the nearest class mean in feature space.",
    noteAr: "يُسند البكسل لأقرب متوسط فئة في فضاء الخصائص.",
  },
  {
    key: "mindist_m",
    en: "Mahalanobis Distance",
    ar: "مسافة ماهالانوبيس",
    family: "supervised",
    supervised: true,
    demoOa: 0.748,
    demoKappa: 0.71,
    noteEn: "Distance weighted by class covariance; needs many samples per class.",
    noteAr: "مسافة مرجّحة بتغاير الفئة؛ تحتاج عينات كثيرة لكل فئة.",
  },
  {
    key: "mlp",
    en: "MLP Neural Network",
    ar: "شبكة عصبية MLP",
    family: "supervised",
    supervised: true,
    demoOa: 0.885,
    demoKappa: 0.867,
    noteEn: "One-hidden-layer network, trained in the platform's compute layer then applied per-pixel on Earth Engine.",
    noteAr: "شبكة بطبقة مخفية واحدة، تتدرّب في طبقة الحساب بالمنصة ثم تُطبّق على كل بكسل في Earth Engine.",
  },
  {
    key: "knn",
    en: "k-Nearest Neighbours",
    ar: "الجيران الأقرب k-NN",
    family: "supervised",
    supervised: true,
    demoOa: 0.798,
    demoKappa: 0.768,
    noteEn: "Votes among the k spectrally closest training pixels; simple and robust.",
    noteAr: "يصوّت بين أقرب k بكسلات تدريب طيفيًا؛ بسيط وفعّال.",
  },
  {
    key: "kmeans",
    en: "KMeans (unsupervised)",
    ar: "K-Means (غير موجّه)",
    family: "unsupervised",
    supervised: false,
    demoOa: 0.644,
    demoKappa: 0.601,
    noteEn: "Clusters pixels without labels; useful for exploring new areas.",
    noteAr: "يجمّع البكسلات بدون عينات؛ مفيد لاستكشاف مناطق جديدة.",
  },
];

export const ALGO_BY_KEY: Record<string, AlgorithmMeta> = Object.fromEntries(
  ALGORITHMS.map((a) => [a.key, a])
);

// Realistic Sentinel-2 NDVI phenology profiles per class (Jan–Dec), tuned to
// Egyptian cropping calendars in northern Egypt:
//   winter wheat peaks Feb–Mar (~0.78) and drops by May; maize/sunflower peak
//   Jul–Sep (~0.72–0.75); berseem is multi-cut Oct–Apr; orchards stay high;
//   fallow/urban stay flat below ~0.18; water is slightly negative.
export const NDVI_PROFILES: Record<string, number[]> = {
  WHT: [0.32, 0.48, 0.75, 0.78, 0.62, 0.28, 0.14, 0.13, 0.13, 0.14, 0.18, 0.26],
  MZE: [0.14, 0.13, 0.14, 0.15, 0.22, 0.38, 0.62, 0.75, 0.68, 0.42, 0.24, 0.16],
  RIC: [0.14, 0.13, 0.14, 0.16, 0.25, 0.42, 0.63, 0.74, 0.76, 0.62, 0.30, 0.16],
  CLV: [0.58, 0.62, 0.66, 0.60, 0.50, 0.30, 0.18, 0.16, 0.17, 0.22, 0.38, 0.55],
  POT: [0.42, 0.55, 0.64, 0.58, 0.40, 0.24, 0.22, 0.24, 0.26, 0.30, 0.36, 0.44],
  BET: [0.55, 0.62, 0.68, 0.70, 0.64, 0.50, 0.28, 0.20, 0.18, 0.20, 0.28, 0.42],
  FBA: [0.34, 0.46, 0.60, 0.66, 0.55, 0.30, 0.16, 0.14, 0.14, 0.15, 0.18, 0.26],
  SUN: [0.14, 0.13, 0.14, 0.15, 0.20, 0.32, 0.52, 0.68, 0.72, 0.58, 0.30, 0.17],
  ORC: [0.55, 0.56, 0.58, 0.60, 0.62, 0.64, 0.65, 0.64, 0.62, 0.60, 0.57, 0.55],
  FLW: [0.14, 0.13, 0.15, 0.16, 0.17, 0.18, 0.18, 0.17, 0.16, 0.15, 0.14, 0.13],
  URB: [0.10, 0.10, 0.11, 0.11, 0.12, 0.12, 0.13, 0.13, 0.12, 0.12, 0.11, 0.10],
  WTR: [-0.18, -0.19, -0.18, -0.17, -0.16, -0.15, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19],
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

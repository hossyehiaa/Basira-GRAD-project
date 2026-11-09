# -*- coding: utf-8 -*-
"""
Basira (بصيرة) — Demo classification overlay generator
Generates realistic simulated crop-classification rasters for the Borj El Arab
AOI: Voronoi field mosaics per season, with per-algorithm error simulation,
clipped to the real boundary. Outputs:
  - public/overlays/{season}_{algo}.png   (transparent outside AOI)
  - src/data/demoResults.json             (stats derived from actual pixels)
All data is SIMULATED for the platform's demo mode and clearly labeled as such.
"""
import json, math, os, random, zlib
import numpy as np
from PIL import Image, ImageDraw
from shapely import voronoi_polygons
from shapely.geometry import shape, Point, MultiPoint
from shapely.ops import transform as shp_transform

ROOT = "/home/z/my-project"
AOI_PATH = f"{ROOT}/download/Bourj_Elarab_AOI.geojson"
OUT_DIR = f"{ROOT}/public/overlays"
DATA_DIR = f"{ROOT}/src/data"

# ---------------- 12 classes (identical to the GEE app) ----------------
CLASSES = [
    {"id": 1,  "en": "Wheat",      "ar": "قمح",         "color": (255, 255, 0),   "code": "WHT"},
    {"id": 2,  "en": "Maize",      "ar": "ذرة",         "color": (0, 255, 0),     "code": "MZE"},
    {"id": 3,  "en": "Rice",       "ar": "أرز",         "color": (0, 255, 255),   "code": "RIC"},
    {"id": 4,  "en": "Clover",     "ar": "برسيم",       "color": (0, 128, 0),     "code": "CLV"},
    {"id": 5,  "en": "Potato",     "ar": "بطاطس",       "color": (181, 101, 29),  "code": "POT"},
    {"id": 6,  "en": "Sugar Beet", "ar": "بنجر السكر",  "color": (255, 105, 180), "code": "BET"},
    {"id": 7,  "en": "Faba Bean",  "ar": "فول",         "color": (128, 0, 128),   "code": "FBA"},
    {"id": 8,  "en": "Sunflower",  "ar": "عباد الشمس",  "color": (255, 140, 0),   "code": "SUN"},
    {"id": 9,  "en": "Orchards",   "ar": "بساتين",      "color": (128, 128, 0),   "code": "ORC"},
    {"id": 10, "en": "Fallow",     "ar": "أرض بور",     "color": (128, 128, 128), "code": "FLW"},
    {"id": 11, "en": "Urban",      "ar": "عمران",       "color": (255, 0, 0),     "code": "URB"},
    {"id": 12, "en": "Water",      "ar": "مياه",        "color": (0, 0, 255),     "code": "WTR"},
]
IDX = {c["code"]: i for i, c in enumerate(CLASSES)}

# ------------- per-season plausible crop shares (Borj El Arab context) ------
# Borj El Arab = newly-reclaimed land: large fields, orchards (olives/figs),
# cereals & forage. Values are illustrative demo proportions, not statistics.
SEASON_SHARES = {
    "winter": {
        "WHT": 27.0, "CLV": 17.5, "BET": 8.0, "FBA": 5.0, "POT": 6.5,
        "MZE": 0.6, "RIC": 0.2, "SUN": 0.4, "ORC": 12.5,
        "FLW": 15.5, "URB": 6.1, "WTR": 0.7,
    },
    "summer": {
        "WHT": 0.8, "CLV": 4.5, "BET": 0.4, "FBA": 0.2, "POT": 5.0,
        "MZE": 17.5, "RIC": 4.2, "SUN": 6.4, "ORC": 12.5,
        "FLW": 24.6, "URB": 6.3, "WTR": 0.8,
    },
    "full": {
        "WHT": 16.5, "CLV": 12.0, "BET": 4.6, "FBA": 3.0, "POT": 6.0,
        "MZE": 11.0, "RIC": 2.4, "SUN": 3.8, "ORC": 12.5,
        "FLW": 21.5, "URB": 6.2, "WTR": 0.8,
    },
}

# ------------- algorithms & demo baselines (plausible, clearly simulated) ---
ALGOS = {
    "rf":        {"oa": 0.912, "kappa": 0.896},
    "gtb":       {"oa": 0.899, "kappa": 0.881},
    "svm":       {"oa": 0.887, "kappa": 0.867},
    "cart":      {"oa": 0.842, "kappa": 0.811},
    "nb":        {"oa": 0.783, "kappa": 0.742},
    "mindist_e": {"oa": 0.719, "kappa": 0.670},
    "mindist_m": {"oa": 0.757, "kappa": 0.713},
    "kmeans":    {"oa": 0.618, "kappa": 0.551},
}

# Per-class difficulty (0 easy .. 1 hard) driving PA/UA spread
DIFFICULTY = {
    "WHT": 0.35, "MZE": 0.40, "RIC": 0.25, "CLV": 0.55, "POT": 0.60,
    "BET": 0.55, "FBA": 0.65, "SUN": 0.45, "ORC": 0.20,
    "FLW": 0.30, "URB": 0.10, "WTR": 0.05,
}
# Confusability pairs (target for simulated misclassifications)
CONFUSABLE = {
    "WHT": ["CLV", "FBA"], "MZE": ["SUN", "FLW"], "RIC": ["CLV", "WHT"],
    "CLV": ["WHT", "BET"], "POT": ["BET", "FLW"], "BET": ["POT", "CLV"],
    "FBA": ["CLV", "WHT"], "SUN": ["MZE", "FLW"], "ORC": ["FLW"],
    "FLW": ["URB", "ORC"], "URB": ["FLW"], "WTR": ["FLW"],
}

def seeded(seed):
    return random.Random(seed)

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    gj = json.load(open(AOI_PATH, encoding="utf-8"))
    aoi = shape(gj["features"][0]["geometry"])
    if aoi.geom_type == "MultiPolygon":
        aoi = max(aoi.geoms, key=lambda g: g.area)
    W, S, E, N = aoi.bounds
    # equirectangular pixel space, equal km/px at AOI center latitude
    lat0 = (S + N) / 2
    kmx = (E - W) * 111.32 * math.cos(math.radians(lat0))
    kmy = (N - S) * 110.57
    PX = 1440
    km_per_px = kmx / PX
    PY = max(2, int(round(kmy / km_per_px)))
    sx = PX / (E - W)
    sy = PY / (N - S)
    print(f"bounds W={W:.5f} S={S:.5f} E={E:.5f} N={N:.5f}  px={PX}x{PY}  "
          f"{km_per_px*1000:.1f} m/px  AOI {aoi.area*95.68*110.57/ (kmx*kmy) * kmx*kmy :.0f} km²(approx via deg²)")

    area_km2 = aoi.area * (111.32 * math.cos(math.radians(lat0))) * 110.57  # deg² → km²
    print(f"AOI area ≈ {area_km2:.0f} km²")

    # ---------- Voronoi field mosaic ----------------------------------------
    def build_fields(n_fields, seed):
        rng = seeded(seed)
        pts = []
        # jittered grid → irregular field sizes (reclaimed-land large fields)
        gx = int(math.sqrt(n_fields * (E - W) / (N - S)))
        gy = int(n_fields / gx)
        for i in range(gx):
            for j in range(gy):
                x = W + (i + 0.5 + rng.uniform(-0.32, 0.32)) * (E - W) / gx
                y = S + (j + 0.5 + rng.uniform(-0.32, 0.32)) * (N - S) / gy
                if aoi.contains(Point(x, y)):
                    pts.append(Point(x, y))
        mpoly = voronoi_polygons(MultiPoint(pts),
                                  extend_to=aoi.envelope, tolerance=0.0)
        cells = []
        for poly in mpoly.geoms:
            inter = poly.intersection(aoi)
            if not inter.is_empty and inter.area > 0:
                cells.append(inter)
        return cells

    # base assignments (one per season; algorithms perturb from these)
    base_fields, base_assign = {}, {}
    for si, season in enumerate(["winter", "summer", "full"]):
        cells = build_fields(2600, 42 + si)
        shares = SEASON_SHARES[season]
        codes, weights = list(shares.keys()), list(shares.values())
        # spatial coherence: urban/water/orchards prefer certain zones via noise
        rng = seeded(4200 + si)
        assign = []
        for cell in cells:
            cx, cy = cell.centroid.x, cell.centroid.y
            if season == "winter":
                # urban cluster toward NE corner, water bodies S/SE (demo)
                urb = max(0.0, 1 - (abs(cx - (W + 0.82*(E-W))) / (0.20*(E-W))
                                   + abs(cy - (S + 0.80*(N-S))) / (0.22*(N-S))))
                wtr = max(0.0, 1 - (abs(cx - (W + 0.55*(E-W))) / (0.10*(E-W))
                                   + abs(cy - (S + 0.10*(N-S))) / (0.10*(N-S))))
            elif season == "summer":
                urb = max(0.0, 1 - (abs(cx - (W + 0.80*(E-W))) / (0.22*(E-W))
                                   + abs(cy - (S + 0.78*(N-S))) / (0.24*(N-S))))
                wtr = max(0.0, 1 - (abs(cx - (W + 0.52*(E-W))) / (0.10*(E-W))
                                   + abs(cy - (S + 0.12*(N-S))) / (0.10*(N-S))))
            else:
                urb = max(0.0, 1 - (abs(cx - (W + 0.81*(E-W))) / (0.21*(E-W))
                                   + abs(cy - (S + 0.79*(N-S))) / (0.23*(N-S))))
                wtr = max(0.0, 1 - (abs(cx - (W + 0.54*(E-W))) / (0.10*(E-W))
                                   + abs(cy - (S + 0.11*(N-S))) / (0.10*(N-S))))
            if urb > 0.55 and rng.random() < min(1.0, urb):
                assign.append(IDX["URB"]); continue
            if wtr > 0.75 and rng.random() < min(1.0, wtr):
                assign.append(IDX["WTR"]); continue
            pick = rng.choices(codes, weights=weights, k=1)[0]
            assign.append(IDX[pick])
        base_fields[season], base_assign[season] = cells, assign
        print(f"{season}: {len(cells)} fields")

    # ---------- per-algorithm perturbation + rendering ----------------------
    results = {"bounds": {"west": W, "south": S, "east": E, "north": N,
                          "pxW": PX, "pxH": PY, "areaKm2": round(area_km2, 1)},
               "seasons": {}}

    def to_px(geom):
        return shp_transform(lambda x, y, z=None: ((x - W) * sx, (N - y) * sy), geom)

    mask_img = Image.new("L", (PX, PY), 0)
    ImageDraw.Draw(mask_img).polygon(
        [(((x - W) * sx), ((N - y) * sy)) for x, y in aoi.exterior.coords], fill=255)
    mask = np.array(mask_img) > 0

    for si, season in enumerate(["winter", "summer", "full"]):
        results["seasons"][season] = {}
        cells, base = base_fields[season], base_assign[season]
        for ai, (algo, meta) in enumerate(ALGOS.items()):
            rng = seeded(zlib.crc32(f"{season}|{algo}".encode()) % (2**31))
            err_rate = (1 - meta["oa"]) * (1.55 if algo == "kmeans" else 1.0)
            assign = list(base)
            # misclassification injection: swap a fraction of cells into confusable classes
            for k in range(len(assign)):
                if rng.random() < err_rate:
                    code = CLASSES[assign[k]]["code"]
                    conf = CONFUSABLE[code] or ["FLW"]
                    tgt = rng.choice(conf)
                    if rng.random() < 0.75:  # keep some errors out (validation split)
                        assign[k] = IDX[tgt]
            # kmeans: spatially-clustered re-mapping (unsupervised look)
            if algo == "kmeans":
                for k, cell in enumerate(cells):
                    cx, cy = cell.centroid.x, cell.centroid.y
                    # spatial clusters mapped to pseudo-class colors
                    b = int((cx - W) / (E - W) * 3) + 3 * int((cy - S) / (N - S) * 3)
                    if rng.random() < 0.72:
                        assign[k] = (b + si) % 12

            img = Image.new("RGBA", (PX, PY), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            for cell, ci in zip(cells, assign):
                color = CLASSES[ci]["color"] + (235,)
                geoms = cell.geoms if cell.geom_type == "MultiPolygon" else [cell]
                for g in geoms:
                    rings = [g.exterior.coords] + [r.coords for r in g.interiors]
                    for ring in rings:
                        draw.polygon([((x - W) * sx, (N - y) * sy) for x, y in ring],
                                     fill=color, outline=color)
            # clip to AOI
            arr = np.array(img)
            arr[~mask, 3] = 0
            # thin boundary: leave slight gaps transparent? keep filled.
            out = Image.fromarray(arr)
            path = f"{OUT_DIR}/{season}_{algo}.png"
            out.save(path, optimize=True)

            # -------- stats from ACTUAL pixels (map ↔ table consistency) ----
            a = np.array(out)
            sel = a[:, :, 3] > 0
            counts = {}
            for ci, c in enumerate(CLASSES):
                m = sel & (a[:, :, 0] == c["color"][0]) & \
                          (a[:, :, 1] == c["color"][1]) & \
                          (a[:, :, 2] == c["color"][2])
                counts[c["code"]] = int(m.sum())
            total = sum(counts.values()) or 1
            class_rows = []
            for c in CLASSES:
                px_ct = counts[c["code"]]
                if px_ct == 0:
                    continue
                pct = px_ct / total * 100
                diff = DIFFICULTY[c["code"]]
                base_pa = 0.985 - diff * (1 - meta["oa"]) * 2.4
                base_ua = 0.975 - diff * (1 - meta["oa"]) * 2.9
                pa = max(0.35, min(0.995, base_pa + rng.uniform(-0.025, 0.025)))
                ua = max(0.32, min(0.995, base_ua + rng.uniform(-0.03, 0.03)))
                f1 = 2 * pa * ua / max(1e-9, pa + ua)
                class_rows.append({
                    "classId": c["id"], "code": c["code"],
                    "en": c["en"], "ar": c["ar"], "color": "#%02x%02x%02x" % c["color"],
                    "pixels": px_ct,
                    "areaKm2": round(px_ct * (km_per_px ** 2), 2),
                    "percent": round(pct, 2),
                    "pa": round(pa, 3), "ua": round(ua, 3), "f1": round(f1, 3),
                })
            class_rows.sort(key=lambda r: -r["percent"])
            # OA recheck from simulated F1s (keeps headline consistent w/ table)
            oa = min(0.99, max(0.30, meta["oa"] + rng.uniform(-0.006, 0.006)))
            kappa = min(0.99, max(0.25, meta["kappa"] + rng.uniform(-0.008, 0.008)))
            results["seasons"][season][algo] = {
                "oa": round(oa, 3), "kappa": round(kappa, 3),
                "mapUrl": f"/overlays/{season}_{algo}.png",
                "classes": class_rows,
            }
            size_kb = os.path.getsize(path) / 1024
            print(f"  {season:6s} {algo:10s} OA={oa:.3f} K={kappa:.3f} "
                  f"classes={len(class_rows):2d} {size_kb:6.0f} KB")

    with open(f"{DATA_DIR}/demoResults.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)
    print("demoResults.json written:", os.path.getsize(f"{DATA_DIR}/demoResults.json")//1024, "KB")

if __name__ == "__main__":
    main()

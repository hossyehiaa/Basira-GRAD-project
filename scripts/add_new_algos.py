#!/usr/bin/env python3
"""
Basira — add the mlp & knn demo entries (maps + class areas) for all seasons.

For each season the new algorithm's demo map is a deterministic per-pixel blend
of its two accuracy neighbours' overlays (mlp: gtb+svm · knn: cart+nb), weighted
by where its target OA sits between them. Class areas get the same weighting,
so the map, the areas and (after calibrate_demo.py) the accuracy/matrix stay
consistent. calibrate_demo.py is run afterwards to derive OA/kappa/PA/UA/F1
from a generated confusion matrix.
"""
import json
import random

REPO = "/home/z/my-project/basira"
OVERLAYS = f"{REPO}/public/overlays"
DATA = f"{REPO}/src/data/demoResults.json"

from PIL import Image

# target OA per season (must match calibrate_demo.py TARGET_OA)
TARGET = {
    "winter": {"rf": .928, "gtb": .913, "svm": .876, "cart": .832, "nb": .757,
               "mindist_m": .748, "mindist_e": .731, "kmeans": .644,
               "mlp": .885, "knn": .800},
    "summer": {"rf": .921, "gtb": .905, "svm": .871, "cart": .826, "nb": .749,
               "mindist_m": .741, "mindist_e": .725, "kmeans": .628,
               "mlp": .880, "knn": .793},
    "full":   {"rf": .936, "gtb": .918, "svm": .886, "cart": .841, "nb": .762,
               "mindist_m": .754, "mindist_e": .738, "kmeans": .651,
               "mlp": .894, "knn": .805},
}
# new algo -> (high-accuracy neighbour, low-accuracy neighbour)
PAIRS = {"mlp": ("gtb", "svm"), "knn": ("cart", "nb")}

def blend_class_rows(hi, lo, w):
    """Weighted average of two algorithms' class rows (matched by class code)."""
    lo_by_code = {c["code"]: c for c in lo}
    out = []
    for c in hi:
        other = lo_by_code.get(c["code"])
        area = c["areaKm2"] * w + (other["areaKm2"] if other else c["areaKm2"]) * (1 - w)
        row = dict(c)
        row["areaKm2"] = round(area, 2)
        row["percent"] = 0.0  # recalibrated by calibrate_demo.py
        row["pa"] = row["ua"] = row["f1"] = None
        row["support"] = 0
        out.append(row)
    return out

def blend_pngs(season, hi_key, lo_key, w, seed):
    """Per-pixel blend: with probability w take the hi overlay's pixel."""
    hi = Image.open(f"{OVERLAYS}/{season}_{hi_key}.png").convert("RGBA")
    lo = Image.open(f"{OVERLAYS}/{season}_{lo_key}.png").convert("RGBA")
    a, b = hi.load(), lo.load()
    rng = random.Random(seed)
    W, H = hi.size
    for y in range(H):
        for x in range(W):
            if rng.random() < w:
                continue
            p = b[x, y]
            if p != a[x, y]:
                a[x, y] = p
    return hi

def main():
    data = json.load(open(DATA, encoding="utf-8"))
    report = []
    for season in ["winter", "summer", "full"]:
        for new_key, (hi_key, lo_key) in PAIRS.items():
            t = TARGET[season]
            w = (t[new_key] - t[lo_key]) / (t[hi_key] - t[lo_key])
            w = max(0.05, min(0.95, w))
            hi = data["seasons"][season][hi_key]
            lo = data["seasons"][season][lo_key]
            entry = {
                "oa": t[new_key],          # placeholder, recalibrated below
                "kappa": 0.0,
                "mapUrl": f"/overlays/{season}_{new_key}.png",
                "classes": blend_class_rows(hi["classes"], lo["classes"], w),
            }
            data["seasons"][season][new_key] = entry
            png = blend_pngs(season, hi_key, lo_key, w, f"basira-{season}-{new_key}-v1")
            png.save(f"{OVERLAYS}/{season}_{new_key}.png")
            report.append((season, new_key, round(w, 3),
                           round(sum(c["areaKm2"] for c in entry["classes"]), 2)))
    json.dump(data, open(DATA, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{'season':7} {'new':5} {'w':>5} {'Σarea':>7}")
    for s, k, w, a in report:
        print(f"{s:7} {k:5} {w:5.2f} {a:7.2f}")
    print("OK — now run calibrate_demo.py")

if __name__ == "__main__":
    main()

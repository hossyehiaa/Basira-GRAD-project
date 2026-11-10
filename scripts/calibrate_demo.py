#!/usr/bin/env python3
"""
Basira — demo benchmark recalibration.

Rewrites src/data/demoResults.json so that for every season × algorithm:
  1. Σ class areas  == CANONICAL_AREA_KM2 exactly (596.9 — true UTM-35N area
     of the BORJ_COORDS analysis polygon).
  2. Σ class percentages == exactly 100.0 % (largest-remainder fixup).
  3. OA / Kappa / PA / UA / F1 are all DERIVED from one generated confusion
     matrix -> mathematically consistent, no contradictory numbers.
  4. Algorithm ranking follows realistic Sentinel-2 crop-mapping performance:
     RF > GTB > SVM > CART > NB > Mahalanobis > Euclidean > KMeans.
  5. A `matrix` block (classIds + rows) is stored for the UI heatmap.

Deterministic: seeded RNG per (season, algorithm).
"""
import json, random, copy, math

PATH = "/home/z/my-project/basira/src/data/demoResults.json"
CANONICAL_AREA_KM2 = 596.9          # true UTM 35N area of the GEE AOI polygon
VAL_TOTAL = 1200                    # plausible validation point count

# target overall accuracy per season (winter, summer, full) — realistic
# Sentinel-2 crop-mapping ranges for Borj El Arab
TARGET_OA = {
    "winter": {"rf": 0.928, "gtb": 0.913, "mlp": 0.885, "svm": 0.876, "cart": 0.832,
               "knn": 0.800, "nb": 0.757, "mindist_m": 0.748, "mindist_e": 0.731, "kmeans": 0.644},
    "summer": {"rf": 0.921, "gtb": 0.905, "mlp": 0.880, "svm": 0.871, "cart": 0.826,
               "knn": 0.793, "nb": 0.749, "mindist_m": 0.741, "mindist_e": 0.725, "kmeans": 0.628},
    "full":   {"rf": 0.936, "gtb": 0.918, "mlp": 0.894, "svm": 0.886, "cart": 0.841,
               "knn": 0.805, "nb": 0.762, "mindist_m": 0.754, "mindist_e": 0.738, "kmeans": 0.651},
}

# spectrally-similar class pairs -> realistic confusion directions
CONFUSE = {
    "WHT": ["CLV", "FBA"],
    "CLV": ["WHT", "ORC"],
    "MZE": ["SUN", "FLW"],
    "RIC": ["MZE", "CLV"],
    "POT": ["BET", "CLV"],
    "BET": ["POT", "FBA"],
    "FBA": ["WHT", "BET"],
    "SUN": ["MZE", "FLW"],
    "ORC": ["CLV", "URB"],
    "FLW": ["URB", "SUN"],
    "URB": ["FLW", "ORC"],
    "WTR": ["URB"],
}

def scale_pa(pas, supports, target_oa, caps=(0.55, 0.995)):
    """Scale per-class PA so the resulting matrix OA converges on the target."""
    pas = dict(pas)
    for _ in range(60):
        total = sum(supports[c] for c in pas)
        correct = sum(pas[c] * supports[c] for c in pas)
        oa = correct / total
        if abs(oa - target_oa) < 0.0008:
            break
        factor = target_oa / oa if oa > 0 else 1.2
        for c in pas:
            pas[c] = min(caps[1], max(caps[0], pas[c] * factor))
    return pas

def build_matrix(classes, supports, pas, rng):
    """Confusion matrix: rows=actual, cols=predicted. Errors go mainly to the
    spectrally-closest partners, remainder spread by class support."""
    ids = [c["classId"] for c in classes]
    n = len(ids)
    by_code = {c["code"]: c["classId"] for c in classes}
    id_to_code = {c["classId"]: c["code"] for c in classes}
    m = [[0] * n for _ in range(n)]
    for i, c in enumerate(classes):
        sup = supports[c["code"]]
        diag = round(pas[c["code"]] * sup)
        err = max(0, sup - diag)
        m[i][i] = diag
        if err == 0:
            continue
        partners = [by_code[p] for p in CONFUSE.get(c["code"], []) if p in by_code]
        weights = {}
        for pid in partners:
            weights[pid] = 5.0
        for pid in ids:
            if pid != c["classId"] and pid not in weights:
                weights[pid] = max(0.3, supports[id_to_code[pid]] / VAL_TOTAL)
        # deterministic jitter on weights
        wj = {pid: w * (0.7 + rng.random() * 0.6) for pid, w in weights.items()}
        wsum = sum(wj.values())
        assigned = 0
        pids = [p for p in wj if p in ids]
        for k, pid in enumerate(pids):
            j = ids.index(pid)
            if k == len(pids) - 1:
                m[i][j] += err - assigned
            else:
                share = round(err * wj[pid] / wsum)
                m[i][j] += share
                assigned += share
    return ids, m

def metrics_from_matrix(ids, m, code_by_id):
    n = len(ids)
    total = sum(sum(r) for r in m)
    diag = sum(m[i][i] for i in range(n))
    oa = diag / total if total else 0
    # kappa
    row_sums = [sum(m[i]) for i in range(n)]
    col_sums = [sum(m[i][j] for i in range(n)) for j in range(n)]
    pe = sum(row_sums[i] * col_sums[i] for i in range(n)) / (total * total) if total else 0
    kappa = (oa - pe) / (1 - pe) if pe < 1 else 0
    per = {}
    for i, cid in enumerate(ids):
        pa = m[i][i] / row_sums[i] if row_sums[i] else 0
        ua = m[i][i] / col_sums[i] if col_sums[i] else 0
        f1 = 2 * pa * ua / (pa + ua) if (pa + ua) else 0
        per[cid] = {"pa": round(pa, 3), "ua": round(ua, 3), "f1": round(f1, 3),
                    "support": row_sums[i]}
    return oa, kappa, per

def main():
    data = json.load(open(PATH, encoding="utf-8"))
    data["bounds"]["areaKm2"] = CANONICAL_AREA_KM2
    report = []
    for season in ["winter", "summer", "full"]:
        for algo, res in data["seasons"][season].items():
            rng = random.Random(f"basira-{season}-{algo}-v2")
            classes = res["classes"]
            # 1) scale areas to the canonical AOI total
            cur_total = sum(c["areaKm2"] for c in classes)
            scale = CANONICAL_AREA_KM2 / cur_total
            for c in classes:
                c["areaKm2"] = round(c["areaKm2"] * scale, 2)
            # fix rounding drift on the largest class
            drift = round(CANONICAL_AREA_KM2 - sum(c["areaKm2"] for c in classes), 2)
            classes[0]["areaKm2"] = round(classes[0]["areaKm2"] + drift, 2)
            # 2) percentages summing to exactly 100.0
            total = sum(c["areaKm2"] for c in classes)
            for c in classes:
                c["percent"] = round(c["areaKm2"] / total * 100, 1)
            pdrift = round(100.0 - sum(c["percent"] for c in classes), 1)
            classes[0]["percent"] = round(classes[0]["percent"] + pdrift, 1)
            # sort by area desc
            classes.sort(key=lambda c: c["areaKm2"], reverse=True)
            # 3) supports proportional to area (min 18 per class)
            for c in classes:
                c["support"] = max(18, round(c["percent"] / 100 * VAL_TOTAL))
            # 4) scale PA to hit the target OA
            pas0 = {c["code"]: c.get("pa") or 0.8 for c in classes}
            pas = scale_pa(pas0, {c["code"]: c["support"] for c in classes},
                           TARGET_OA[season][algo])
            # 5) build the confusion matrix, derive ALL metrics from it
            ids, m = build_matrix(classes, {c["code"]: c["support"] for c in classes}, pas, rng)
            code_by_id = {c["classId"]: c["code"] for c in classes}
            oa, kappa, per = metrics_from_matrix(ids, m, code_by_id)
            res["oa"] = round(oa, 3)
            res["kappa"] = round(kappa, 3)
            res["matrix"] = {"classIds": ids, "rows": m}
            for c in classes:
                mm = per[c["classId"]]
                c["pa"], c["ua"], c["f1"], c["support"] = mm["pa"], mm["ua"], mm["f1"], mm["support"]
            report.append((season, algo, res["oa"], res["kappa"],
                           round(sum(c["areaKm2"] for c in classes), 2),
                           round(sum(c["percent"] for c in classes), 1)))
    json.dump(data, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # verification table
    print(f"{'season':7} {'algo':10} {'OA':>6} {'kappa':>7} {'Σarea':>7} {'Σ%':>6}")
    ok = True
    prev_oa = {}
    for season, algo, oa, ka, a, p in report:
        flag = ""
        if abs(a - CANONICAL_AREA_KM2) > 0.011 or abs(p - 100.0) > 0.001:
            flag = "  <-- INCONSISTENT"; ok = False
        print(f"{season:7} {algo:10} {oa:6.3f} {ka:7.3f} {a:7.1f} {p:6.1f}{flag}")
    for season in ["winter", "summer", "full"]:
        oas = [(algo, oa) for s, algo, oa, *_ in report if s == season]
        order = [a for a, _ in sorted(oas, key=lambda x: -x[1])]
        expect = ["rf", "gtb", "mlp", "svm", "cart", "knn", "nb",
                  "mindist_m", "mindist_e", "kmeans"]
        status = "OK" if order == expect else f"ORDER MISMATCH: {order}"
        print(f"ranking {season}: {status}")
    print("\nALL CONSISTENT ✅" if ok else "\nFIX NEEDED ❌")

if __name__ == "__main__":
    main()

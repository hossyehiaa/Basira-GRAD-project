#!/usr/bin/env python3
"""Basira v1.3 demo calibration:
  * canonical AOI area 596.9 -> 596.0 km² (MASTER PROMPT spec)
  * GTB benchmark 0.913 -> 0.914 OA, KMeans 0.644 -> 0.642 OA
  * rescale every season x algorithm class-area vector so Σ areas = 596.0
    and percentages still sum to exactly 100.0
"""
import json
from collections import OrderedDict

PATH = "src/data/demoResults.json"
CANONICAL = 596.0

with open(PATH, encoding="utf-8") as f:
    data = json.load(f, object_pairs_hook=OrderedDict)

old_area = data["bounds"]["areaKm2"]
scale = CANONICAL / old_area
data["bounds"]["areaKm2"] = CANONICAL

bumps = {"gtb": +0.001, "kmeans": -0.002}  # -> 0.914 / 0.642 (winter anchor)

for season, algos in data["seasons"].items():
    for algo, res in algos.items():
        if algo in bumps:
            res["oa"] = round(res["oa"] + bumps[algo], 3)
            res["kappa"] = round(min(res["kappa"] + bumps[algo] * 0.8, res["oa"] - 0.005), 3)
        # rescale class areas to the canonical total
        total = sum(c["areaKm2"] for c in res["classes"])
        if total <= 0:
            continue
        for c in res["classes"]:
            c["areaKm2"] = round(c["areaKm2"] / total * CANONICAL, 2)
        # fix rounding drift on the largest class
        drift = round(CANONICAL - sum(c["areaKm2"] for c in res["classes"]), 2)
        if abs(drift) >= 0.01:
            biggest = max(res["classes"], key=lambda c: c["areaKm2"])
            biggest["areaKm2"] = round(biggest["areaKm2"] + drift, 2)
        # percentages sum to exactly 100.0
        for c in res["classes"]:
            c["percent"] = round(c["areaKm2"] / CANONICAL * 100, 1)
        pdrift = round(100.0 - sum(c["percent"] for c in res["classes"]), 1)
        if abs(pdrift) >= 0.1:
            biggest = max(res["classes"], key=lambda c: c["areaKm2"])
            biggest["percent"] = round(biggest["percent"] + pdrift, 1)

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

# verify
with open(PATH, encoding="utf-8") as f:
    check = json.load(f)
print(f"bounds.areaKm2: {old_area} -> {check['bounds']['areaKm2']}")
for season in ("winter", "summer", "full"):
    for algo in ("gtb", "kmeans", "rf"):
        r = check["seasons"][season][algo]
        s = round(sum(c["areaKm2"] for c in r["classes"]), 2)
        p = round(sum(c["percent"] for c in r["classes"]), 1)
        print(f"{season}/{algo}: oa={r['oa']} kappa={r['kappa']} sumArea={s} sumPct={p}")

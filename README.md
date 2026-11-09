# Basira · بصيرة

<p align="center">
  <b>منصة زراعية مستقلة لمراقبة الأراضي الزراعية في برج العرب — الإسكندرية، مصر</b><br/>
  An independent agricultural remote-sensing platform for Borj El Arab, Alexandria, Egypt<br/>
  <i>Graduation project · مشروع تخرج</i>
</p>

<p align="center" dir="rtl">
  <b>بصيرة</b> منصة ويب مستقلة تمامًا (خارج Google Earth Engine Apps) لرصد الغطاء الزراعي
  في مدينة برج العرب (~596 كم²) باستخدام صور Sentinel-2 والذكاء الاصطناعي، بواجهة عربية/إنجليزية
  كاملة تدعم الاتجاه من اليمين لليسار، مع تصنيف موجّه بسبعة خوارزميات، وتصنيف غير موجّه بـ KMeans،
  ومقارنة دقة فورية، ورسم عينات تدريب على الخريطة أو رفعها كملف CSV.
</p>

---

## ✨ Features

| | |
|---|---|
| 🛰 **Sentinel-2 L2A** | `COPERNICUS/S2_SR_HARMONIZED`, SCL cloud masking (excludes classes 1, 3, 8, 9, 10, 11), reflectance ÷ 10 000 |
| 🌿 **Spectral indices** | NDVI, NDWI, NDMI, EVI + monthly median composites + seasonal NDVI percentiles (p10/p50/p90) |
| 🤖 **7 supervised classifiers** | Random Forest, SVM, CART, Gradient Tree Boosting, Naive Bayes, Min-Distance (Euclidean), Min-Distance (Mahalanobis) |
| 🔍 **Unsupervised** | K-Means with adjustable cluster count |
| ⚖️ **One-click accuracy comparison** | Runs all algorithms, 70/30 split (seed 42), overall accuracy, Kappa, per-class PA / UA / F1 |
| 🗺 **Interactive map** | Leaflet with farm-plot base layers, true-color / NDVI / NDWI scene tiles, class overlays, click for an NDVI time series |
| ✏️ **Training samples** | Draw points per crop class on the map, or upload a CSV (`class,lon,lat`) — template included |
| 🌐 **Bilingual UI** | Full Arabic (RTL) ⇄ English switch, Arabic-first content |
| 📊 **Area statistics** | Per-class area in km² at 100 m scale, correct projection EPSG:32635 (UTM 35N) |

12 land-cover classes: wheat, maize, rice, clover, potato, sugar beet, faba bean, sunflower, orchards, fallow, urban, water.

## 🏗 Architecture

```
Browser (Next.js + React-Leaflet, AR/EN)
        │
        ├── /api/gee/scene, /api/gee/ndvi-point   ← light synchronous jobs
        ├── /gee-run  (background function)       ← heavy jobs ≤ 15 min
        │        └── results stored in Netlify Blobs, polled by the client
        │
        └── Netlify Functions (Node 20)
                 └── Google Earth Engine via service account
                         └── COPERNICUS/S2_SR_HARMONIZED
```

- **No Google login needed** — the platform authenticates to Earth Engine with a service-account key held server-side only.
- **`src/lib/gee/engine.ts`** contains the whole classification pipeline, ported 1:1 from the original GEE Code Editor app (phase 1 of the project).
- If no key is configured, the site runs in **demo mode** with pre-computed example results.

## 🚀 Quick start (local)

```bash
# Node 20+
npm install

# Option A — live Earth Engine mode
export GEE_PRIVATE_KEY_JSON="$(cat /path/to/service-account-key.json)"
# Option B — demo mode (no key): just skip the export

npm run dev          # http://localhost:3000
```

Optional local persistence (SQLite via Prisma):

```bash
export DATABASE_URL="file:./db/custom.db"
npx prisma db push
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEE_PRIVATE_KEY_JSON` | for live mode | Full JSON content of the GEE service-account key |
| `GEE_KEY_FILE` | alternative to the above | Path to the key file on disk |
| `DATABASE_URL` | no | Local SQLite file for saved samples / run history (serverless deploys degrade gracefully without it) |

## ☁️ Deploy on Netlify

1. Push this repository to GitHub.
2. In Netlify: *Add new site → Import an existing project* → pick the repo.
3. Add the environment variable `GEE_PRIVATE_KEY_JSON` (site settings → Environment variables) — never commit the key.
4. Deploy. `netlify.toml` already configures the build, the Next.js runtime and the background-function directory.

## 📁 Project structure

```
src/
  app/                    # Next.js App Router (pages + API routes)
    api/gee/              # health · scene · ndvi-point · run · result/[id]
  components/basira/      # UI: map panel, control panel, results, guide…
  lib/
    basira/               # i18n dictionary, constants, state store
    gee/                  # engine.ts (full GEE pipeline), client, AOI
netlify/functions/
  gee-run.mts             # background function for heavy GEE jobs
prisma/                   # optional local history (SQLite)
public/
  borj_el_arab.geojson    # official boundary (simplified, WGS84)
  overlays/               # demo classification overlays
```

## 📄 Credits

- Satellite data: **Copernicus Sentinel-2** (ESA) via Google Earth Engine
- Boundary: Borj El Arab city boundary (CAPMAS shapefile, projected to EPSG:32635 for area statistics)
- Built as a graduation project, Faculty of Agriculture — Alexandria, Egypt

## ⚠️ Security note

The Earth Engine service-account key and all deploy tokens are kept in environment variables only. This repository must never contain credentials.

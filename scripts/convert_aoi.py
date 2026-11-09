# -*- coding: utf-8 -*-
"""Convert Bourj_Elarab shapefile (UTM 35N) to WGS84 GeoJSON + simplified JS literal."""
import json
import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform
import pyproj

BASE = '/home/z/my-project/scripts/aoi'
OUT = '/home/z/my-project/download'

# 1) Read shapefile
r = shapefile.Reader(f'{BASE}/Bourj_Elarab.shp')
shp = shape(r.shape(0))
rec = r.record(0)
print('Record:', rec.as_dict())

# 2) Reproject UTM35N -> WGS84
proj = pyproj.Transformer.from_crs(32635, 4326, always_xy=True).transform
geom_wgs = shp_transform(proj, shp)
print('Full vertices:', sum(len(g.exterior.coords) + sum(len(i.coords) for i in g.interiors)
                            for g in ([geom_wgs] if geom_wgs.geom_type == 'Polygon'
                                      else geom_wgs.geoms)))

area_km2 = geom_wgs.area  # rough in degrees; compute geodesic area separately
from pyproj import Geod
geod = Geod(ellps='WGS84')
area_m2 = abs(geod.geometry_area_perimeter(geom_wgs)[0])
print(f'Geodesic area: {area_m2/1e6:.2f} km2')
print('Bounds (lon/lat):', [round(x, 5) for x in geom_wgs.bounds])
c = geom_wgs.centroid
print('Centroid:', round(c.x, 5), round(c.y, 5))

# 3) Full-resolution GeoJSON (for GEE asset upload)
fc = {
    'type': 'FeatureCollection',
    'name': 'Bourj_Elarab',
    'features': [{
        'type': 'Feature',
        'properties': {
            'gov_name': str(rec.gov_name), 'gov_code': str(rec.gov_code),
            'qesm_name': str(rec.qesm_name), 'qesm_code': str(rec.qesm_code),
            'area_km2': round(area_m2 / 1e6, 2),
        },
        'geometry': mapping(geom_wgs),
    }],
}
with open(f'{OUT}/Bourj_Elarab_AOI.geojson', 'w', encoding='utf-8') as f:
    json.dump(fc, f, ensure_ascii=False)
print('Full GeoJSON size:', len(json.dumps(fc, ensure_ascii=False)), 'bytes')

# 4) Simplified polygon for embedding in JS (tolerance in degrees ~150 m)
for tol_deg, tag in [(0.0015, '150m'), (0.0008, '80m')]:
    simp = geom_wgs.simplify(tol_deg, preserve_topology=True)
    n = sum(len(g.exterior.coords) for g in ([simp] if simp.geom_type == 'Polygon' else simp.geoms))
    print(f'Simplified @{tag}: {n} vertices, valid={simp.is_valid}, '
          f'area_delta={100 * (area_m2 - abs(geod.geometry_area_perimeter(simp)[0])) / area_m2:.3f}%')

simp = geom_wgs.simplify(0.0015, preserve_topology=True)

def rings(geom):
    polys = [geom] if geom.geom_type == 'Polygon' else list(geom.geoms)
    out = []
    for p in polys:
        out.append([[round(x, 6), round(y, 6)] for x, y in p.exterior.coords])
    return out

coords = rings(simp)
js_literal = json.dumps(coords, separators=(',', ':'))
print('JS literal size:', len(js_literal), 'bytes')
with open(f'{BASE}/aoi_coords.json', 'w') as f:
    f.write(js_literal)
with open(f'{BASE}/aoi_meta.json', 'w') as f:
    json.dump({'bounds': list(geom_wgs.bounds), 'centroid': [c.x, c.y],
               'area_km2': round(area_m2 / 1e6, 2),
               'utm_epsg': 32635}, f, indent=1)
print('DONE')

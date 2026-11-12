#!/usr/bin/env python3
"""EMODnet Bathymetry (mean depth) → web/public/data/depth.json, a 0.05° grid over the Baltic box.

The WCS refuses one large scaled request, so this fetches 2°×1° tiles (40×20 px each) and stitches them.
Values are metres relative to sea level (negative = below sea level). Requires Pillow + numpy.
Usage: python3 scripts/fetch_bathymetry.py
"""
import io, json, time, urllib.request
import numpy as np
from PIL import Image

W, S, E, N, RES = 9.0, 53.5, 31.0, 66.5, 0.05
TW, TH = 2.0, 1.0
URL = ("https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=emodnet__mean"
       "&subset=Lat({s},{n})&subset=Long({w},{e})&format=image/tiff"
       "&scalesize=http://www.opengis.net/def/axis/OGC/1/i({i}),http://www.opengis.net/def/axis/OGC/1/j({j})")

cols, rows = round((E - W) / RES), round((N - S) / RES)
grid = np.full((rows, cols), np.nan)
ti, tj = round(TW / RES), round(TH / RES)
lat = S
while lat < N - 1e-9:
    lon = W
    while lon < E - 1e-9:
        url = URL.format(s=lat, n=lat + TH, w=lon, e=lon + TW, i=ti, j=tj)
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "baltic-seabed-watch/0.1"})
                data = urllib.request.urlopen(req, timeout=60).read()
                a = np.array(Image.open(io.BytesIO(data)), dtype=float)
                break
            except Exception as e:  # noqa: BLE001
                a = None; time.sleep(2)
        if a is not None:
            a[(a < -1000) | (a > 3000)] = np.nan  # nodata
            r0 = rows - round((lat - S) / RES) - tj   # row 0 = north
            c0 = round((lon - W) / RES)
            grid[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a[: rows - r0, : cols - c0]
        lon += TW
    lat += TH
    print(f"lat {lat:.1f} done", flush=True)

out = {
    "source": "EMODnet Bathymetry DTM (emodnet__mean), https://emodnet.ec.europa.eu/en/bathymetry",
    "bbox": [W, S, E, N], "res": RES, "cols": cols, "rows": rows, "rowOrder": "north-to-south",
    "units": "m relative to sea level; negative = depth; null = no data",
    "values": [[None if np.isnan(v) else int(round(v)) for v in row] for row in grid],
}
json.dump(out, open("web/public/data/depth.json", "w"), separators=(",", ":"))
valid = ~np.isnan(grid)
print(f"depth.json: {cols}x{rows}, {valid.mean()*100:.0f}% cells with data, min {np.nanmin(grid):.0f} m")

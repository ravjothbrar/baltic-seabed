// Builds public/geo/coast.json (coastlines + borders) from Natural Earth via world-atlas.
// Usage: node scripts/build-coast.mjs public/geo/coast.json  (needs devDeps world-atlas, topojson-client)
import fs from 'node:fs';
import * as topo from 'topojson-client';
const out = process.argv[2];
const box = [5, 52, 33, 67.5];
const inBox = ([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(dx, dy) || 1e-9);
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
  return [a, b];
}
function lines(geom) {
  const g = geom.type === 'GeometryCollection' ? geom.geometries : [geom];
  const out = [];
  for (const x of g) {
    if (x.type === 'MultiLineString') out.push(...x.coordinates);
    else if (x.type === 'LineString') out.push(x.coordinates);
    else if (x.type === 'Polygon') out.push(...x.coordinates);
    else if (x.type === 'MultiPolygon') x.coordinates.forEach((p) => out.push(...p));
  }
  return out;
}
function split(ls, keep) { // keep runs of points where keep(p)
  const res = [];
  for (const l of ls) { let cur = []; for (const p of l) { if (keep(p)) cur.push(p); else { if (cur.length > 1) res.push(cur); cur = []; } } if (cur.length > 1) res.push(cur); }
  return res;
}
const r = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const pack = (ls, eps, d, minPts = 2) => ls.map((l) => dp(l, eps)).filter((l) => l.length >= minPts).map((l) => l.map(([x, y]) => [r(x, d), r(y, d)]));

const l10 = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/land-10m.json', import.meta.url)));
const l50 = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url)));
const c50 = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url)));
const c10 = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/countries-10m.json', import.meta.url)));
const region = pack(split(lines(topo.mesh(l10, l10.objects.land)), inBox), 0.004, 4, 3);
const world = pack(split(lines(topo.mesh(l50, l50.objects.land)), (p) => !inBox(p)), 0.03, 2, 2);
const bordersW = pack(split(lines(topo.mesh(c50, c50.objects.countries, (a, b) => a !== b)), (p) => !inBox(p)), 0.03, 2);
const bordersR = pack(split(lines(topo.mesh(c10, c10.objects.countries, (a, b) => a !== b)), inBox), 0.004, 4);
const json = { source: 'Natural Earth via world-atlas 2.0.2 (public domain)', coastRegion: region, coastWorld: world, borders: [...bordersW, ...bordersR] };
fs.writeFileSync(out, JSON.stringify(json));
console.log('region lines', region.length, 'pts', region.reduce((s, l) => s + l.length, 0), 'world', world.length, 'borders', json.borders.length, 'bytes', fs.statSync(out).size);

// ---- Filled land polygons for the vector basemap (public/geo/land.json) ----
// region: Natural Earth 10m clipped to LAND_BOX (crisp when zoomed into the Baltic)
// world:  Natural Earth 50m everywhere (coarse, for the zoomed-out globe)
const LAND_BOX = [3, 51, 37, 69];
function clipRing(ring, [x0, y0, x1, y1]) { // Sutherland–Hodgman against an axis-aligned box
  const edges = [
    (p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; },
    (p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; },
    (p) => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; },
    (p) => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; },
  ];
  let pts = ring;
  for (let e = 0; e < 8; e += 2) {
    const inside = edges[e], cut = edges[e + 1]; const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    pts = out; if (pts.length < 3) return [];
  }
  return pts;
}
const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
function polys(topoObj, obj) {
  const g = topo.feature(topoObj, obj);
  const fs_ = g.type === 'FeatureCollection' ? g.features : [g];
  const out = [];
  for (const f of fs_) {
    const geom = f.geometry; if (!geom) continue;
    if (geom.type === 'Polygon') out.push(geom.coordinates);
    else if (geom.type === 'MultiPolygon') out.push(...geom.coordinates);
  }
  return out;
}
const packRing = (r, eps, d) => {
  // closed ring: simplify the two halves separately (DP degenerates when start == end)
  const open = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
  if (open.length < 4) return null;
  const m = open.length >> 1;
  const s = [...dp(open.slice(0, m + 1), eps).slice(0, -1), ...dp([...open.slice(m), open[0]], eps)];
  return s.length >= 4 ? s.map(([x, y]) => [r_(x, d), r_(y, d)]) : null;
};
function r_(n, d) { return Math.round(n * 10 ** d) / 10 ** d; }
const regionPolys = [];
for (const p of polys(l10, l10.objects.land)) {
  const rings = [];
  for (const [i, ring] of p.entries()) {
    const c = clipRing(ring.slice(0, -1), LAND_BOX);
    if (c.length < 3 || ringArea(c) < (i === 0 ? 0.0006 : 0.004)) { if (i === 0) break; continue; }
    const pr = packRing([...c, c[0]], 0.0012, 4); if (pr) rings.push(pr); else if (i === 0) break;
  }
  if (rings.length) regionPolys.push(rings);
}
const worldPolys = [];
for (const p of polys(l50, l50.objects.land)) {
  const rings = p.map((r) => packRing(r, 0.04, 2)).filter(Boolean).filter((r, i) => i === 0 ? ringArea(r) > 0.05 : ringArea(r) > 0.5);
  if (rings.length && ringArea(p[0]) > 0.05) worldPolys.push(rings);
}
const landOut = out.replace(/coast\.json$/, 'land.json');
fs.writeFileSync(landOut, JSON.stringify({ source: 'Natural Earth 10m/50m via world-atlas 2.0.2 (public domain)', box: LAND_BOX, region: regionPolys, world: worldPolys }));
console.log('land: region polys', regionPolys.length, 'pts', regionPolys.flat(2).length, 'world polys', worldPolys.length, 'pts', worldPolys.flat(2).length, 'bytes', fs.statSync(landOut).size);

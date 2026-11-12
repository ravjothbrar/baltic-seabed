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

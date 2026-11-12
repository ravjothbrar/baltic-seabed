// Builds public/geo/hero-land.json: compact world land for the intro globe (first paint), from Natural Earth 50m
// via world-atlas (public domain). Simplified (~0.03°) and rounded to 2 decimals; small islands dropped.
// Usage: node scripts/build-heroland.mjs
import fs from 'node:fs';
import * as topo from 'topojson-client';
const t = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url)));
const land = topo.feature(t, t.objects.land);
function dp(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [s, e] = st.pop(); let mx = 0, idx = -1; const [ax, ay] = pts[s], [bx, by] = pts[e];
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let u = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(px - (ax + u * dx), py - (ay + u * dy)); if (d > mx) { mx = d; idx = i; }
    }
    if (mx > eps && idx > 0) { keep[idx] = 1; st.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r2 = (v) => Math.round(v * 100) / 100, r1 = (v) => Math.round(v * 10) / 10;
const polys = [];
for (const f of land.features) {
  const g = f.geometry; const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of list) {
    const outer = poly[0];
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const [x, y] of outer) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const baltic = maxx > 8 && minx < 32 && maxy > 53 && miny < 67;
    if (!baltic && (maxx - minx) * (maxy - miny) < 3) continue; // drop tiny islands away from the Baltic
    const rings = poly.map((ring) => {
      const s = dp(ring, baltic ? 0.02 : 0.16).map(([x, y]) => (baltic ? [r2(x), r2(y)] : [r1(x), r1(y)]));
      return s.filter((p, i) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
    }).filter((r) => r.length >= 4);
    if (rings.length) polys.push(rings);
  }
}
const out = new URL('../public/geo/hero-land.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({ source: 'Natural Earth 50m via world-atlas (public domain), simplified', polys }));
console.log('hero-land.json', polys.length, 'polygons,', polys.flat(2).length, 'points,', (fs.statSync(out).size / 1024).toFixed(0), 'KB');

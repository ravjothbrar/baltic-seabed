// Small geo helpers. Equirectangular approximations are fine at Baltic scale (< 1% error over a few nm).
export const BBOX = { minLon: 9.0, minLat: 53.5, maxLon: 31.0, maxLat: 66.5 };
const R_NM = 3440.065;
const toRad = (d) => (d * Math.PI) / 180;

export function distNm(lon1, lat1, lon2, lat2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Distance (nm) from point to segment, projecting in a local plane.
export function pointSegNm(px, py, ax, ay, bx, by) {
  const k = Math.cos(toRad(py));
  const x = (px - ax) * k, y = py - ay, dx = (bx - ax) * k, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L ? (x * dx + y * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = x - t * dx, ey = y - t * dy;
  return Math.sqrt(ex * ex + ey * ey) * 60; // 1 deg lat = 60 nm
}

export const inBbox = ([lon, lat], b = BBOX) => lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;

// Rough Baltic + Danish straits mask: excludes Skagerrak/Norway, the Elbe/North Sea side of Jutland, Lake Ladoga, Vänern/Vättern.
export function inBaltic([lon, lat]) {
  if (!inBbox([lon, lat])) return false;
  if (lon < 9.9 && lat < 55.2) return false;                   // Elbe, Schleswig west coast
  if (lon > 29.6 && lat > 60.2) return false;                  // Lake Ladoga
  if (lon >= 14.5) return lat <= 66.0 && !(lon < 15.3 && lat > 57.6 && lat < 59.0);
  return lat <= 57.9 && !(lat > 57.2 && lon < 10.6) && lon >= 9.8;
}

// Split a line into runs that stay inside the bbox (keeps one point outside so lines reach the edge).
export function clipLine(coords, inside = inBaltic) {
  const runs = []; let cur = [];
  coords.forEach((p, i) => {
    if (inside(p)) {
      if (!cur.length && i > 0) cur.push(coords[i - 1]);
      cur.push(p);
    } else if (cur.length) {
      cur.push(p); runs.push(cur); cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

export function simplify(pts, tol = 0.002) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let max = 0, idx = -1;
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
}

export function lineKm(coords) {
  let s = 0; for (let i = 1; i < coords.length; i++) s += distNm(...coords[i - 1], ...coords[i]);
  return s * 1.852;
}

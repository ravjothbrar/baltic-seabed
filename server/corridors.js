// Spatial index over infrastructure segments + port zones. O(1)-ish point queries. Pure: works in Node and browser.
import { pointSegNm, distNm } from './geo.js';

const CELL = 0.05;
export const CORRIDOR_NM = 1.5;
const key = (x, y) => `${x},${y}`;

export function buildCorridors(infra, anchorages) {
  const segs = []; const grid = new Map();
  for (const f of infra.features) {
    const p = f.properties;
    for (const run of f.geometry.coordinates) {
      for (let i = 1; i < run.length; i++) {
        const [ax, ay] = run[i - 1], [bx, by] = run[i];
        const s = { ax, ay, bx, by, name: p.name, kind: p.kind, named: p.named, id: p.id };
        const si = segs.push(s) - 1;
        const pad = 0.06; // ≈ 3.6 nm lat, covers the corridor buffer and DARK radius partially
        for (let x = Math.floor((Math.min(ax, bx) - pad * 2) / CELL); x <= Math.floor((Math.max(ax, bx) + pad * 2) / CELL); x++)
          for (let y = Math.floor((Math.min(ay, by) - pad) / CELL); y <= Math.floor((Math.max(ay, by) + pad) / CELL); y++) {
            const k = key(x, y); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(si);
          }
      }
    }
  }
  const ports = anchorages.features.map((f) => ({ name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], r: f.properties.radiusNm || 3, country: f.properties.country || null }));

  /** Nearest infrastructure within ~3 nm: { name, kind, named, id, nm } or null */
  function nearest(lon, lat) {
    const a = grid.get(key(Math.floor(lon / CELL), Math.floor(lat / CELL)));
    if (!a) return null;
    let best = null;
    for (const si of a) {
      const s = segs[si]; const d = pointSegNm(lon, lat, s.ax, s.ay, s.bx, s.by);
      // Prefer named assets when distances are similar.
      if (!best || d < best.nm - (s.named && !best.named ? 0.3 : 0)) best = { name: s.name, kind: s.kind, named: s.named, id: s.id, nm: d };
    }
    return best;
  }
  /** Nearest segment within maxNm, searching every index cell in range (for wider radii than the index pad). */
  function nearestWithin(lon, lat, maxNm) {
    const dy = maxNm / 60, dx = dy / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const seen = new Set(); let best = null;
    for (let x = Math.floor((lon - dx) / CELL); x <= Math.floor((lon + dx) / CELL); x++)
      for (let y = Math.floor((lat - dy) / CELL); y <= Math.floor((lat + dy) / CELL); y++) {
        const a = grid.get(key(x, y)); if (!a) continue;
        for (const si of a) {
          if (seen.has(si)) continue; seen.add(si);
          const s = segs[si]; const d = pointSegNm(lon, lat, s.ax, s.ay, s.bx, s.by);
          if (d <= maxNm && (!best || d < best.nm)) best = { name: s.name, kind: s.kind, named: s.named, id: s.id, nm: d };
        }
      }
    return best;
  }
  const corridor = (lon, lat) => { const n = nearest(lon, lat); return n && n.nm <= CORRIDOR_NM ? n : null; };
  function nearestPort(lon, lat) {
    let best = null;
    for (const p of ports) {
      if (Math.abs(p.lat - lat) > 0.6) continue;
      const d = distNm(lon, lat, p.lon, p.lat);
      if (!best || d - p.r < best.nm - best.r) best = { name: p.name, nm: +d.toFixed(1), r: p.r, inside: d <= p.r, country: p.country };
    }
    return best;
  }
  const named = [...new Set(infra.features.filter((f) => f.properties.named).map((f) => f.properties.name))];
  return { nearest, nearestWithin, corridor, nearestPort, named, segCount: segs.length };
}

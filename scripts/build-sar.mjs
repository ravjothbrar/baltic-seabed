// Global Fishing Watch SAR vessel detections → data/sar.json
// Satellite radar (Sentinel-1) detections of vessels, split into "matched to AIS" and "not matched" (dark).
// GFW data lags ~5 days, so this is context, not a live alarm.
//   node scripts/build-sar.mjs <out.json>   env: GFW_API_TOKEN (required to refresh), PREV_URL (reuse if < 24 h old)
// Licence: GFW data is CC BY-NC 4.0, attribution required. https://globalfishingwatch.org/our-apis/
import { writeFile } from 'node:fs/promises';
import { inBaltic, BBOX } from '../server/geo.js';

const OUT = process.argv[2] || 'sar.json';
const TOKEN = process.env.GFW_API_TOKEN;
const DAYS = 30, LAG = 5;

async function reusePrevious(reason) {
  if (!process.env.PREV_URL) { console.log(`sar: ${reason}; no previous file`); return; }
  try {
    const r = await fetch(process.env.PREV_URL, { cache: 'no-store' });
    if (!r.ok) { console.log(`sar: ${reason}; no previous file (${r.status})`); return; }
    const prev = await r.json();
    await writeFile(OUT, JSON.stringify(prev));
    console.log(`sar: ${reason}; reused previous (${prev.generated})`);
    return prev;
  } catch (e) { console.log(`sar: ${reason}; previous unavailable (${e.message})`); }
}

if (!TOKEN) { await reusePrevious('GFW_API_TOKEN not set'); process.exit(0); }
// refresh at most once a day
try {
  const r = await fetch(process.env.PREV_URL || 'about:blank', { cache: 'no-store' });
  if (r.ok) { const prev = await r.json(); if (Date.now() - Date.parse(prev.generated) < 23 * 3600e3) { await writeFile(OUT, JSON.stringify(prev)); console.log('sar: previous is < 24 h old, reused'); process.exit(0); } }
} catch {}

const day = (d) => d.toISOString().slice(0, 10);
const end = new Date(Date.now() - LAG * 86400e3), start = new Date(end.getTime() - DAYS * 86400e3);
const region = { geojson: { type: 'Polygon', coordinates: [[[BBOX.minLon, BBOX.minLat], [BBOX.maxLon, BBOX.minLat], [BBOX.maxLon, BBOX.maxLat], [BBOX.minLon, BBOX.maxLat], [BBOX.minLon, BBOX.minLat]]] } };

async function report(matched) {
  const q = new URLSearchParams({
    'spatial-resolution': 'HIGH', 'temporal-resolution': 'DAILY', 'datasets[0]': 'public-global-sar-presence:latest',
    'date-range': `${day(start)},${day(end)}`, format: 'JSON', 'filters[0]': `matched='${matched}'`,
  });
  const r = await fetch(`https://gateway.api.globalfishingwatch.org/v3/4wings/report?${q}`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(region),
  });
  if (!r.ok) throw new Error(`GFW ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// Walk the response and collect every {lat, lon, detections, date} row, whatever the nesting.
function rows(json) {
  const out = [];
  (function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') {
      if (typeof x.lat === 'number' && typeof x.lon === 'number') out.push(x);
      else Object.values(x).forEach(walk);
    }
  })(json);
  return out;
}

try {
  const [dark, lit] = await Promise.all([report(false), report(true)]);
  const cells = new Map(); let unmatched = 0;
  for (const r of rows(dark)) {
    if (!inBaltic([r.lon, r.lat])) continue;
    const n = r.detections ?? r.count ?? 1; unmatched += n;
    const k = `${r.lon.toFixed(2)},${r.lat.toFixed(2)}`;
    const c = cells.get(k) || { lon: +r.lon.toFixed(2), lat: +r.lat.toFixed(2), n: 0, last: null };
    c.n += n; const d = r.date || r.timestamp || null; if (d && (!c.last || d > c.last)) c.last = String(d).slice(0, 10);
    cells.set(k, c);
  }
  const matched = rows(lit).filter((r) => inBaltic([r.lon, r.lat])).reduce((s, r) => s + (r.detections ?? r.count ?? 1), 0);
  const out = {
    generated: new Date().toISOString(), dateRange: [day(start), day(end)], windowDays: DAYS, lagDays: LAG,
    detections: matched + unmatched, matched, unmatched,
    unmatchedCells: [...cells.values()].map((c) => [c.lon, c.lat, c.n, c.last]),
    source: 'Global Fishing Watch, SAR vessel detections (public-global-sar-presence)', licence: 'CC BY-NC 4.0',
    caveat: 'Radar detections not matched to an AIS track. Includes vessels too small for AIS, coverage-gap ships, and false detections near coasts/structures. Not evidence of intent.',
  };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`sar: ${out.detections} detections, ${unmatched} unmatched, ${cells.size} cells (${out.dateRange.join(' → ')})`);
} catch (e) {
  console.log('sar: refresh failed:', e.message);
  await reusePrevious('refresh failed');
}

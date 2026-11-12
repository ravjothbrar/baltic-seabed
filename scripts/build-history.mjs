// Builds data/history.json for browser mode (GitHub Pages): the last 6 h of thinned AIS tracks.
// Run by .github/workflows/pages.yml every ~15 min. It extends the previously published file, samples
// Digitraffic for a few minutes, prunes, and writes the result.
//   node scripts/build-history.mjs <out.json>   env: PREV_URL, SAMPLES (default 10), INTERVAL_S (default 60)
import { writeFile } from 'node:fs/promises';
import { inBaltic } from '../server/geo.js';

const OUT = process.argv[2] || 'history.json';
const SAMPLES = +(process.env.SAMPLES || 10), INTERVAL = +(process.env.INTERVAL_S || 60) * 1000;
const KEEP_S = 6 * 3600, DROP_S = 8 * 3600;
const DT = 'https://meri.digitraffic.fi/api/ais/v1';
const H = { 'Digitraffic-User': 'baltic-seabed-watch/0.1', 'Accept-Encoding': 'gzip' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tracks = {}, meta = {};
if (process.env.PREV_URL) {
  try {
    const r = await fetch(process.env.PREV_URL, { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); tracks = j.tracks || {}; meta = j.meta || {}; console.log(`previous: ${Object.keys(tracks).length} vessels`); }
    else console.log(`no previous history (${r.status})`);
  } catch (e) { console.log('no previous history', e.message); }
}

// Thinning: keep a point if ≥ 3 min since the last kept one, or ≥ 1 min and speed changed by ≥ 1.5 kn.
function add(mmsi, row) {
  const t = (tracks[mmsi] ||= []); const p = t[t.length - 1];
  if (p && row[2] <= p[2]) return;
  if (p && row[2] - p[2] < 180 && !(row[2] - p[2] >= 60 && Math.abs(row[3] - p[3]) >= 1.5)) return;
  t.push(row);
}

let from = 0;
for (let i = 0; i < SAMPLES; i++) {
  try {
    const r = await fetch(from ? `${DT}/locations?from=${from}` : `${DT}/locations`, { headers: H });
    const j = await r.json(); let max = from, n = 0;
    for (const f of j.features || []) {
      const p = f.properties; const [lon, lat] = f.geometry.coordinates;
      if (!inBaltic([lon, lat])) continue;
      add(p.mmsi, [+lon.toFixed(4), +lat.toFixed(4), Math.round(p.timestampExternal / 1000), p.sog >= 102.3 ? null : p.sog, p.cog >= 360 ? null : Math.round(p.cog), p.navStat]);
      if (p.timestampExternal > max) max = p.timestampExternal; n++;
    }
    from = max ? max - 1000 : Date.now() - 60e3;
    console.log(`sample ${i + 1}/${SAMPLES}: ${n} positions`);
  } catch (e) { console.log('sample failed', e.message); }
  if (i < SAMPLES - 1) await sleep(INTERVAL);
}

try {
  const r = await fetch(`${DT}/vessels`, { headers: H });
  for (const m of await r.json()) if (tracks[m.mmsi]) meta[m.mmsi] = [m.name?.trim() || null, m.imo || null, m.shipType ?? null, m.destination?.trim() || null];
} catch (e) { console.log('meta failed', e.message); }

const now = Date.now() / 1000;
for (const [mmsi, t] of Object.entries(tracks)) {
  const kept = t.filter((r) => r[2] >= now - KEEP_S);
  if (!kept.length || kept[kept.length - 1][2] < now - DROP_S) { delete tracks[mmsi]; delete meta[mmsi]; } else tracks[mmsi] = kept;
}
for (const mmsi of Object.keys(meta)) if (!tracks[mmsi]) delete meta[mmsi];

const out = { generated: new Date().toISOString(), source: 'Fintraffic Digitraffic AIS (CC BY 4.0)', format: 'tracks[mmsi] = [[lon,lat,tsSec,sog,cog,nav]], meta[mmsi] = [name,imo,shipType,destination]', tracks, meta };
const json = JSON.stringify(out);
await writeFile(OUT, json);
console.log(`history: ${Object.keys(tracks).length} vessels, ${Object.values(tracks).reduce((s, t) => s + t.length, 0)} points, ${(json.length / 1e6).toFixed(2)} MB`);

// Shared by the daily brief and the alerts feed: replay a published history.json through the same engine the site uses.
import { readFile } from 'node:fs/promises';
import { loadCorridors } from '../server/load.js';
import { createEngine, TRACK_MS } from '../server/engine.js';

export const readJSON = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
export async function fetchJSON(url) {
  if (!url) return null;
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}

/** Seed an engine from history.json and evaluate every ship as of now. */
export async function replay(history, { weather = true } = {}) {
  const corridors = loadCorridors('web/public/data/infra.geojson', 'web/public/data/anchorages.geojson');
  const watchlist = (await readJSON('server/data/watchlist.json')) || undefined;
  const engine = createEngine({ corridors, watchlist, emit: () => {}, mode: 'replay' });
  const cutoff = Date.now() - TRACK_MS;
  for (const [mmsi, m] of Object.entries(history.meta || {})) engine.onStatic(+mmsi, { name: m[0], imo: m[1], type: m[2], dest: m[3] });
  for (const [mmsi, rows] of Object.entries(history.tracks || {})) {
    engine.seedTrack(+mmsi, rows.filter((r) => r[2] * 1000 > cutoff).map((r) => [r[0], r[1], r[2] * 1000, r[3], r[4], r[5]]));
  }
  if (weather) await engine.refreshWeather().catch(() => {});
  engine.sweep();
  return { engine, snap: engine.snapshot(), cutoff };
}

// Daily "Baltic Seabed Brief" → data/brief.json
// Replays history.json through the same engine the site uses, then summarises the current picture.
// Regenerated at most once a day; keeps a 14-day trend by extending the previously published brief.
//   node scripts/build-brief.mjs <history.json> <out.json> [sar.json]   env: PREV_URL
import { readFile, writeFile } from 'node:fs/promises';
import { loadCorridors } from '../server/load.js';
import { createEngine, TRACK_MS } from '../server/engine.js';

const [HIST, OUT, SAR] = process.argv.slice(2);
const read = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

let prev = null;
if (process.env.PREV_URL) { try { const r = await fetch(process.env.PREV_URL, { cache: 'no-store' }); if (r.ok) prev = await r.json(); } catch {} }
if (prev && Date.now() - Date.parse(prev.generated) < 23 * 3600e3 && !process.env.FORCE) {
  await writeFile(OUT, JSON.stringify(prev)); console.log(`brief: previous is < 24 h old (${prev.generated}), reused`); process.exit(0);
}

const history = await read(HIST);
if (!history?.tracks) { console.log('brief: no history yet'); if (prev) await writeFile(OUT, JSON.stringify(prev)); process.exit(0); }

const corridors = loadCorridors('web/public/data/infra.geojson', 'web/public/data/anchorages.geojson');
const watchlist = (await read('server/data/watchlist.json')) || undefined;
const engine = createEngine({ corridors, watchlist, emit: () => {}, mode: 'brief' });
const cutoff = Date.now() - TRACK_MS;
for (const [mmsi, m] of Object.entries(history.meta || {})) engine.onStatic(+mmsi, { name: m[0], imo: m[1], type: m[2], dest: m[3] });
for (const [mmsi, rows] of Object.entries(history.tracks)) engine.seedTrack(+mmsi, rows.filter((r) => r[2] * 1000 > cutoff).map((r) => [r[0], r[1], r[2] * 1000, r[3], r[4], r[5]]));
await engine.refreshWeather().catch(() => {});
engine.sweep();
const snap = engine.snapshot();

const rank = { HIGH: 3, ELEVATED: 2, WATCH: 1 };
const top = [...snap.alerts]
  .sort((a, b) => rank[b.level] - rank[a.level] || b.signals.filter((s) => !s.explained).length - a.signals.filter((s) => !s.explained).length)
  .slice(0, 5)
  .map((a) => ({
    name: a.name, mmsi: a.mmsi, imo: a.imo, flag: a.flag, typeLabel: a.typeLabel, level: a.level, asset: a.asset,
    signals: a.signals.map(({ id, label, strength, evidence, explained, explainedBy }) => ({ id, label, strength, evidence, explained, explainedBy })),
    caveat: a.shouldntConclude?.[0] || null,
  }));

const sar = SAR ? await read(SAR) : null;
const today = new Date().toISOString().slice(0, 10);
const entry = { date: today, vessels: snap.stats.vessels, listed: snap.stats.watchlist, alerts: snap.stats.alerts.WATCH + snap.stats.alerts.ELEVATED + snap.stats.alerts.HIGH };
const trend = [...(prev?.history || []).filter((h) => h.date !== today), entry].slice(-14);

const notes = [
  `Covers the last ${TRACK_MS / 3600e3} h of AIS${history.aisstream ? ' (Digitraffic + aisstream.io, whole Baltic)' : ' (Digitraffic, northern Baltic)'}.`,
  'Every item is a pattern, not a finding. AIS is self-reported and sees nothing below the surface.',
];
if (!top.length) notes.unshift('No alerts in the window.');

const brief = {
  generated: new Date().toISOString(), windowHours: TRACK_MS / 3600e3,
  stats: { vessels: snap.stats.vessels, listed: snap.stats.watchlist, alerts: snap.stats.alerts, signals: snap.stats.signals, windKn: snap.stats.windKn },
  top,
  sar: sar ? { detections: sar.detections, unmatched: sar.unmatched, windowDays: sar.windowDays, dateRange: sar.dateRange, generated: sar.generated } : null,
  notes, history: trend,
};
await writeFile(OUT, JSON.stringify(brief));
console.log(`brief: ${brief.stats.vessels} vessels, ${top.length} top items, trend ${trend.length} days`);

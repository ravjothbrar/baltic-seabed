// Baltic Seabed Watch server: one process holds the live picture (server/engine.js), persists it, streams it over SSE.
import express from 'express';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { loadCorridors } from './load.js';
import { createEngine, TRACK_MS } from './engine.js';
import { BBOX } from './geo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

const corridors = loadCorridors(path.join(ROOT, 'web/public/data/infra.geojson'), path.join(ROOT, 'web/public/data/anchorages.geojson'));
let watchlist = { byImo: {}, byMmsi: {}, updated: null };
try { watchlist = JSON.parse(readFileSync(path.join(ROOT, 'server/data/watchlist.json'), 'utf8')); } catch { console.warn('no watchlist.json; run npm run fetch:watchlist'); }

// ── storage ──
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'seabed.db'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS positions (mmsi INTEGER, ts INTEGER, lon REAL, lat REAL, sog REAL, cog REAL, nav INTEGER);
  CREATE INDEX IF NOT EXISTS pos_mmsi_ts ON positions (mmsi, ts);
  CREATE TABLE IF NOT EXISTS vessels (mmsi INTEGER PRIMARY KEY, json TEXT);
  CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, mmsi INTEGER, level TEXT, first INTEGER, last INTEGER, json TEXT);`);
const insPos = db.prepare('INSERT INTO positions VALUES (?,?,?,?,?,?,?)');
const upVessel = db.prepare('INSERT INTO vessels VALUES (?,?) ON CONFLICT(mmsi) DO UPDATE SET json=excluded.json');
const upAlert = db.prepare('INSERT INTO alerts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET level=excluded.level,last=excluded.last,json=excluded.json');

// ── SSE ──
const clients = new Set();
function broadcast(event, data) { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); }

const engine = createEngine({
  corridors, watchlist, emit: broadcast, aisstreamEnabled: !!process.env.AISSTREAM_API_KEY, mode: 'server',
  log: (...a) => console.warn(...a),
  headers: { 'User-Agent': 'baltic-seabed-watch/0.1', 'Accept-Encoding': 'gzip' },
  hooks: {
    savePosition: (mmsi, r) => insPos.run(mmsi, r[2], r[0], r[1], r[3], r[4], r[5]),
    saveVessel: (v) => upVessel.run(v.mmsi, JSON.stringify({ ...v, lat: null, lon: null })),
    saveAlert: (a) => upAlert.run(a.id, a.mmsi, a.level, a.firstSeen, a.lastSeen, JSON.stringify(a)),
  },
});

// Restore names and the last 6 h of tracks so "usual speed" comparisons work right after a restart.
for (const r of db.prepare('SELECT json FROM vessels').all()) { try { engine.restoreVessel(JSON.parse(r.json)); } catch {} }
const byMmsi = new Map();
for (const r of db.prepare('SELECT mmsi, ts, lon, lat, sog, cog, nav FROM positions WHERE ts > ? ORDER BY ts').all(Date.now() - TRACK_MS)) {
  let a = byMmsi.get(r.mmsi); if (!a) byMmsi.set(r.mmsi, (a = [])); a.push([r.lon, r.lat, r.ts, r.sog, r.cog, r.nav]);
}
for (const [mmsi, rows] of byMmsi) engine.seedTrack(mmsi, rows);

// ── aisstream.io (optional, whole Baltic; key stays server-side) ──
function connectAisstream(delay = 1000) {
  if (!process.env.AISSTREAM_API_KEY) return;
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  ws.on('open', () => {
    ws.send(JSON.stringify({ APIKey: process.env.AISSTREAM_API_KEY, BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    engine.feeds.aisstream.ok = true; delay = 1000;
  });
  ws.on('message', (buf) => {
    try {
      const m = JSON.parse(buf); const md = m.MetaData || {};
      if (m.MessageType === 'PositionReport') {
        const p = m.Message.PositionReport;
        engine.onPosition(md.MMSI, p.Longitude, p.Latitude, p.Sog, p.Cog, p.TrueHeading, p.NavigationalStatus, Date.parse(md.time_utc?.replace(/ \+0000 UTC$/, 'Z').replace(' ', 'T')) || Date.now(), 'aisstream');
      } else if (m.MessageType === 'ShipStaticData') {
        const s = m.Message.ShipStaticData; engine.onStatic(md.MMSI, { name: s.Name, imo: s.ImoNumber, type: s.Type, dest: s.Destination });
      }
    } catch {}
  });
  ws.on('close', () => { engine.feeds.aisstream.ok = false; setTimeout(() => connectAisstream(Math.min(delay * 2, 60e3)), delay); });
  ws.on('error', () => ws.close());
}

// ── HTTP ──
const app = express();
app.disable('x-powered-by');
app.get('/api/snapshot', (_req, res) => res.json(engine.snapshot()));
app.get('/api/vessel/:mmsi', (req, res) => { const d = engine.vessel(req.params.mmsi); d ? res.json(d) : res.status(404).json({ error: 'unknown vessel' }); });
app.get('/api/alerts/log', (_req, res) => res.json(db.prepare('SELECT json FROM alerts ORDER BY last DESC LIMIT 200').all().map((r) => JSON.parse(r.json))));
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 3000\n\n'); clients.add(res);
  req.on('close', () => clients.delete(res));
});
app.get('/healthz', (_req, res) => res.json({ ok: true, vessels: engine.snapshot().vessels.length }));
const dist = path.join(ROOT, 'web/dist');
if (existsSync(dist)) app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
app.use('/data', express.static(path.join(ROOT, 'web/public/data'), { maxAge: '1h' }));
if (existsSync(dist)) app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

setInterval(() => broadcast('ping', Date.now()), 20000);
setInterval(() => { try { db.prepare('DELETE FROM positions WHERE ts < ?').run(Date.now() - 48 * 3600e3); } catch {} }, 3600e3);

await engine.pollDigitrafficMeta();
await engine.pollDigitraffic();
engine.start();
connectAisstream();
engine.refreshWeather();
app.listen(PORT, () => console.log(`Baltic Seabed Watch on :${PORT} · ${engine.snapshot().vessels.length} vessels · ${corridors.segCount} infra segments · watchlist ${engine.feeds.watchlist.count}`));

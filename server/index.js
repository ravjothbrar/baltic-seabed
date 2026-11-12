// Baltic Seabed Watch server: one process, holds the live picture, streams it over SSE.
import express from 'express';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { loadCorridors } from './corridors.js';
import { evaluate, SIGNAL_INFO } from './detect.js';
import { typeLabel, flagOf } from './ais-meta.js';
import { distNm, inBaltic, BBOX } from './geo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UA = 'baltic-seabed-watch/0.1';
const TRACK_MS = 6 * 3600e3;
const DROP_MS = 8 * 3600e3;

// ── reference data ───────────────────────────────────────────────────────────
const corridors = loadCorridors(path.join(ROOT, 'web/public/data/infra.geojson'), path.join(ROOT, 'web/public/data/anchorages.geojson'));
let watchlist = { byImo: {}, byMmsi: {}, updated: null };
try { watchlist = JSON.parse(readFileSync(path.join(ROOT, 'server/data/watchlist.json'), 'utf8')); } catch { console.warn('no watchlist.json; run npm run fetch:watchlist'); }
const watchOf = (v) => (v.imo && watchlist.byImo[String(v.imo)]) || watchlist.byMmsi[String(v.mmsi)] || null;

// ── storage ──────────────────────────────────────────────────────────────────
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

// ── live state ───────────────────────────────────────────────────────────────
/** mmsi → vessel */ const vessels = new Map();
/** mmsi → track rows [lon,lat,ts,sog,cog,nav] */ const tracks = new Map();
/** mmsi → alert */ const alerts = new Map();
const dirty = new Set(); const removed = new Set();
const feeds = {
  digitraffic: { ok: false, last: null, count: 0, label: 'Fintraffic Digitraffic AIS', url: 'https://www.digitraffic.fi/en/marine-traffic/' },
  aisstream: { ok: false, last: null, count: 0, enabled: !!process.env.AISSTREAM_API_KEY, label: 'aisstream.io', url: 'https://aisstream.io' },
  weather: { ok: false, last: null, label: 'Open-Meteo', url: 'https://open-meteo.com' },
  watchlist: { ok: !!watchlist.updated, count: Object.keys(watchlist.byImo).length + Object.keys(watchlist.byMmsi).length, updated: watchlist.updated, label: 'OpenSanctions maritime', url: 'https://www.opensanctions.org' },
};
let msgTimes = [];

// restore vessel metadata so names survive restarts
for (const r of db.prepare('SELECT json FROM vessels').all()) { try { const v = JSON.parse(r.json); v.lat = null; vessels.set(v.mmsi, v); } catch {} }

function vesselFor(mmsi) {
  let v = vessels.get(mmsi);
  if (!v) {
    const [flagCode, flag] = flagOf(mmsi);
    v = { mmsi, lat: null, lon: null, sog: null, cog: null, hdg: null, nav: null, name: null, imo: null, type: null, typeLabel: 'Unknown', flag, flagCode, dest: null, ts: 0, corridor: null, watch: null, level: null };
    vessels.set(mmsi, v);
  }
  return v;
}
const lastSaved = new Map();
function onPosition(mmsi, lon, lat, sog, cog, hdg, nav, ts, src) {
  if (!(lon > -180 && lon < 180 && lat > -90 && lat < 90) || !inBaltic([lon, lat])) return;
  const v = vesselFor(mmsi);
  if (ts <= v.ts) return;
  Object.assign(v, { lon, lat, sog: sog >= 102.3 ? null : sog, cog: cog >= 360 ? null : cog, hdg: hdg === 511 ? null : hdg, nav, ts });
  const c = corridors.corridor(lon, lat); v.corridor = c ? c.name : null;
  let t = tracks.get(mmsi); if (!t) tracks.set(mmsi, (t = []));
  const p = t[t.length - 1];
  if (!p || ts - p[2] >= 30e3 || distNm(p[0], p[1], lon, lat) > 0.1) t.push([lon, lat, ts, v.sog ?? 0, v.cog ?? 0, nav]);
  while (t.length && t[0][2] < ts - TRACK_MS) t.shift();
  if (ts - (lastSaved.get(mmsi) || 0) >= 60e3) { lastSaved.set(mmsi, ts); try { insPos.run(mmsi, ts, lon, lat, v.sog ?? 0, v.cog ?? 0, nav ?? 15); } catch {} }
  dirty.add(mmsi); msgTimes.push(Date.now());
  feeds[src].last = Date.now();
  evalVessel(v);
}
function onStatic(mmsi, s) {
  const v = vesselFor(mmsi);
  if (s.name) v.name = s.name.replace(/@+$/, '').trim() || v.name;
  if (s.imo && s.imo > 999999) v.imo = s.imo;
  if (s.type != null) { v.type = s.type; v.typeLabel = typeLabel(s.type); }
  if (s.dest) v.dest = s.dest.replace(/@+$/, '').trim();
  v.watch = watchOf(v);
  upVessel.run(mmsi, JSON.stringify({ ...v, lat: null, lon: null }));
  dirty.add(mmsi);
}

// ── weather (lazy, cached per 1° cell) ───────────────────────────────────────
const wx = new Map();
async function weatherAt(lon, lat) {
  const k = `${Math.round(lon)},${Math.round(lat)}`; const c = wx.get(k);
  if (c && Date.now() - c.t < 30 * 60e3) return c.v;
  if (c?.pending) return c.v;
  wx.set(k, { ...(c || {}), pending: true, t: c?.t || 0, v: c?.v || null });
  try {
    const [a, b] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${Math.round(lat)}&longitude=${Math.round(lon)}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${Math.round(lat)}&longitude=${Math.round(lon)}&current=wave_height`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const v = a?.current ? { windKn: a.current.wind_speed_10m, windDir: a.current.wind_direction_10m, waveM: b?.current?.wave_height ?? null } : null;
    wx.set(k, { t: Date.now(), v }); if (v) { feeds.weather.ok = true; feeds.weather.last = Date.now(); }
    return v;
  } catch { wx.set(k, { t: Date.now(), v: c?.v || null }); return c?.v || null; }
}
const wxCached = (lon, lat) => wx.get(`${Math.round(lon)},${Math.round(lat)}`)?.v || null;

// ── detection ────────────────────────────────────────────────────────────────
function peersNear(v, now) {
  let n = 0;
  for (const o of vessels.values()) {
    if (o === v || o.lat == null || now - o.ts > 10 * 60e3 || Math.abs(o.lat - v.lat) > 0.35) continue;
    if (distNm(v.lon, v.lat, o.lon, o.lat) <= 20) n++;
  }
  return n;
}
function evalVessel(v, now = Date.now()) {
  const track = tracks.get(v.mmsi); if (!track?.length) return;
  const silent = now - v.ts > 30 * 60e3;
  const r = evaluate({ vessel: v, track, now, corridors, weather: wxCached(v.lon, v.lat), watch: v.watch, peers: silent ? peersNear(v, now) : null });
  const prev = alerts.get(v.mmsi);
  if (r?.level) {
    const wk = `${Math.round(v.lon)},${Math.round(v.lat)}`;
    if (!wx.has(wk)) weatherAt(v.lon, v.lat).then((w) => { if (w) evalVessel(v); });
    const a = {
      id: prev?.id || `${v.mmsi}-${now}`, mmsi: v.mmsi, name: v.name, imo: v.imo, flag: v.flag, typeLabel: v.typeLabel, level: r.level, asset: r.asset,
      lat: v.lat, lon: v.lon, firstSeen: prev?.firstSeen || now, lastSeen: now, signals: r.signals,
      context: { ...r.context, peers: r.context.peers ?? peersNear(v, now) }, shouldntConclude: r.shouldntConclude, track: track.slice(-180).map((p) => [p[0], p[1], p[2], p[3]]),
    };
    const changed = !prev || prev.level !== a.level || prev.signals.map((s) => s.id + s.explained).join() !== a.signals.map((s) => s.id + s.explained).join();
    alerts.set(v.mmsi, a); v.level = a.level; dirty.add(v.mmsi);
    if (changed) { broadcast('alert', a); upAlert.run(a.id, a.mmsi, a.level, a.firstSeen, a.lastSeen, JSON.stringify(a)); }
  } else if (prev && now - prev.lastSeen > 30 * 60e3) {
    alerts.delete(v.mmsi); v.level = null; dirty.add(v.mmsi); broadcast('alert_clear', { id: prev.id, mmsi: v.mmsi });
  }
}

// ── Digitraffic (keyless, Finnish coastal receivers) ─────────────────────────
const DT = 'https://meri.digitraffic.fi/api/ais/v1';
const dtHeaders = { 'Digitraffic-User': UA, 'Accept-Encoding': 'gzip' };
let dtFrom = 0, dtMetaFrom = 0;
async function pollDigitraffic() {
  try {
    const url = dtFrom ? `${DT}/locations?from=${dtFrom}` : `${DT}/locations`;
    const r = await fetch(url, { headers: dtHeaders }); if (!r.ok) throw new Error(r.status);
    const j = await r.json(); let max = dtFrom;
    for (const f of j.features || []) {
      const p = f.properties; const [lon, lat] = f.geometry.coordinates;
      onPosition(p.mmsi, lon, lat, p.sog, p.cog, p.heading, p.navStat, p.timestampExternal, 'digitraffic');
      if (p.timestampExternal > max) max = p.timestampExternal;
    }
    dtFrom = max ? max - 1000 : Date.now() - 60e3;
    feeds.digitraffic.ok = true; feeds.digitraffic.last = Date.now();
  } catch (e) { feeds.digitraffic.ok = false; console.warn('digitraffic', e.message); }
}
async function pollDigitrafficMeta() {
  try {
    const r = await fetch(dtMetaFrom ? `${DT}/vessels?from=${dtMetaFrom}` : `${DT}/vessels`, { headers: dtHeaders }); if (!r.ok) throw new Error(r.status);
    const t0 = Date.now();
    for (const m of await r.json()) onStatic(m.mmsi, { name: m.name, imo: m.imo, type: m.shipType, dest: m.destination });
    dtMetaFrom = t0 - 60e3;
  } catch (e) { console.warn('digitraffic meta', e.message); }
}

// ── aisstream.io (optional, whole Baltic; key stays server-side) ─────────────
function connectAisstream(delay = 1000) {
  if (!process.env.AISSTREAM_API_KEY) return;
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  ws.on('open', () => {
    ws.send(JSON.stringify({ APIKey: process.env.AISSTREAM_API_KEY, BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    feeds.aisstream.ok = true; delay = 1000;
  });
  ws.on('message', (buf) => {
    try {
      const m = JSON.parse(buf); const md = m.MetaData || {};
      if (m.MessageType === 'PositionReport') {
        const p = m.Message.PositionReport;
        onPosition(md.MMSI, p.Longitude, p.Latitude, p.Sog, p.Cog, p.TrueHeading, p.NavigationalStatus, Date.parse(md.time_utc?.replace(/ \+0000 UTC$/, 'Z').replace(' ', 'T')) || Date.now(), 'aisstream');
      } else if (m.MessageType === 'ShipStaticData') {
        const s = m.Message.ShipStaticData; onStatic(md.MMSI, { name: s.Name, imo: s.ImoNumber, type: s.Type, dest: s.Destination });
      }
    } catch {}
  });
  ws.on('close', () => { feeds.aisstream.ok = false; setTimeout(() => connectAisstream(Math.min(delay * 2, 60e3)), delay); });
  ws.on('error', () => ws.close());
}

// ── stats / heat ─────────────────────────────────────────────────────────────
let lastSweepMs = 0;
function stats() {
  const now = Date.now(); msgTimes = msgTimes.filter((t) => t > now - 60e3);
  const s = { vessels: 0, inCorridor: 0, watchlist: 0, dark: 0, alerts: { WATCH: 0, ELEVATED: 0, HIGH: 0 }, signals: Object.fromEntries(Object.keys(SIGNAL_INFO).map((k) => [k, 0])), msgsPerMin: msgTimes.length, sweepMs: lastSweepMs };
  for (const v of vessels.values()) {
    if (v.lat == null || now - v.ts > DROP_MS) continue;
    if (now - v.ts < 30 * 60e3) s.vessels++;
    if (v.corridor && now - v.ts < 30 * 60e3) s.inCorridor++;
    if (v.watch) s.watchlist++;
  }
  for (const a of alerts.values()) { s.alerts[a.level]++; for (const g of a.signals) { s.signals[g.id]++; if (g.id === 'DARK') s.dark++; } }
  const w = wxCached(25, 60); s.windKn = w?.windKn ?? null;
  s.level = s.alerts.HIGH ? 'HIGH' : s.alerts.ELEVATED ? 'ELEVATED' : s.alerts.WATCH ? 'WATCH' : 'NOMINAL';
  return s;
}
function heat() {
  const cells = new Map(); const now = Date.now();
  for (const [mmsi, t] of tracks) {
    const seen = new Set();
    for (const p of t) { if (now - p[2] > TRACK_MS) continue; const k = `${(Math.floor(p[0] * 4) + 0.5) / 4},${(Math.floor(p[1] * 4) + 0.5) / 4}`; if (!seen.has(k)) { seen.add(k); cells.set(k, (cells.get(k) || 0) + 1); } }
    void mmsi;
  }
  return [...cells].map(([k, n]) => [...k.split(',').map(Number), n]);
}
const vesselOut = (v) => ({ mmsi: v.mmsi, lat: v.lat, lon: v.lon, sog: v.sog, cog: v.cog, hdg: v.hdg, nav: v.nav, name: v.name, imo: v.imo, type: v.type, typeLabel: v.typeLabel, flag: v.flag, flagCode: v.flagCode, dest: v.dest, ts: v.ts, corridor: v.corridor, watch: v.watch ? { risk: v.watch.risk, datasets: v.watch.datasets, url: v.watch.url, name: v.watch.name } : null, level: v.level });
const liveVessels = () => [...vessels.values()].filter((v) => v.lat != null && Date.now() - v.ts < DROP_MS);
const feedsOut = () => ({ ...feeds, digitraffic: { ...feeds.digitraffic, ok: feeds.digitraffic.ok && Date.now() - feeds.digitraffic.last < 120e3, count: liveVessels().length } });

// ── SSE ──────────────────────────────────────────────────────────────────────
const clients = new Set();
function broadcast(event, data) { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); }

const app = express();
app.disable('x-powered-by');
app.get('/api/snapshot', (_req, res) => res.json({ ts: Date.now(), feeds: feedsOut(), vessels: liveVessels().map(vesselOut), alerts: [...alerts.values()], stats: stats(), heat: heat(), signalInfo: SIGNAL_INFO }));
app.get('/api/vessel/:mmsi', (req, res) => {
  const v = vessels.get(+req.params.mmsi); if (!v) return res.status(404).json({ error: 'unknown vessel' });
  res.json({ vessel: vesselOut(v), track: (tracks.get(v.mmsi) || []).map((p) => [p[0], p[1], p[2], p[3]]), alert: alerts.get(v.mmsi) || null });
});
app.get('/api/alerts/log', (_req, res) => res.json(db.prepare('SELECT json FROM alerts ORDER BY last DESC LIMIT 200').all().map((r) => JSON.parse(r.json))));
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 3000\n\n'); clients.add(res);
  req.on('close', () => clients.delete(res));
});
app.get('/healthz', (_req, res) => res.json({ ok: true, vessels: liveVessels().length }));
const dist = path.join(ROOT, 'web/dist');
if (existsSync(dist)) app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
app.use('/data', express.static(path.join(ROOT, 'web/public/data'), { maxAge: '1h' }));
if (existsSync(dist)) app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

// ── loops ────────────────────────────────────────────────────────────────────
setInterval(() => {
  if (!dirty.size && !removed.size) return;
  const upd = [...dirty].map((m) => vessels.get(m)).filter((v) => v && v.lat != null).map(vesselOut);
  broadcast('vessels', { ts: Date.now(), upd, del: [...removed] }); dirty.clear(); removed.clear();
}, 2000);
setInterval(() => broadcast('stats', stats()), 5000);
setInterval(() => broadcast('feeds', feedsOut()), 10000);
setInterval(() => broadcast('heat', heat()), 60000);
setInterval(() => broadcast('ping', Date.now()), 20000);
// sweep: re-evaluate everything (DARK only fires on time passing), drop stale ships
setInterval(() => {
  const t0 = Date.now();
  for (const v of vessels.values()) {
    if (v.lat == null) continue;
    if (t0 - v.ts > DROP_MS) { removed.add(v.mmsi); v.lat = null; tracks.delete(v.mmsi); continue; }
    evalVessel(v, t0);
  }
  lastSweepMs = Date.now() - t0;
}, 30000);
setInterval(() => { try { db.prepare('DELETE FROM positions WHERE ts < ?').run(Date.now() - 48 * 3600e3); } catch {} }, 3600e3);
setInterval(() => weatherAt(25, 60), 15 * 60e3);

// Warm tracks from the archive so slowdowns vs. "usual speed" work right after a restart.
for (const r of db.prepare('SELECT mmsi, ts, lon, lat, sog, cog, nav FROM positions WHERE ts > ? ORDER BY ts').all(Date.now() - TRACK_MS)) {
  let t = tracks.get(r.mmsi); if (!t) tracks.set(r.mmsi, (t = [])); t.push([r.lon, r.lat, r.ts, r.sog, r.cog, r.nav]);
}

await pollDigitrafficMeta();
await pollDigitraffic();
setInterval(pollDigitraffic, 10000);
setInterval(pollDigitrafficMeta, 10 * 60e3);
connectAisstream();
weatherAt(25, 60);
app.listen(PORT, () => console.log(`Baltic Seabed Watch on :${PORT} · ${liveVessels().length} vessels · ${corridors.segCount} infra segments · watchlist ${feeds.watchlist.count}`));

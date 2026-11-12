// The live picture: vessels, tracks, alerts, stats. Isomorphic (Node server and browser-only mode share it).
// No Node or DOM imports here; I/O comes in through `opts`.
import { evaluate, SIGNAL_INFO, T } from './detect.js';
import { typeLabel, flagOf } from './ais-meta.js';
import { distNm, inBaltic } from './geo.js';

export const TRACK_MS = 6 * 3600e3;
export const DROP_MS = 8 * 3600e3;
const DT = 'https://meri.digitraffic.fi/api/ais/v1';

/**
 * @param {object} opts
 * @param {object} opts.corridors  from buildCorridors()
 * @param {object} [opts.watchlist] { byImo, byMmsi, updated }
 * @param {(event:string, data:any)=>void} opts.emit
 * @param {object} [opts.hooks] { savePosition(mmsi,row), saveVessel(v), saveAlert(a) }
 * @param {object} [opts.headers] extra fetch headers
 * @param {(...a:any[])=>void} [opts.log]
 */
export function createEngine({ corridors, watchlist = { byImo: {}, byMmsi: {}, updated: null }, emit, hooks = {}, headers = {}, log = () => {}, aisstreamEnabled = false, mode = 'server' }) {
  const vessels = new Map(), tracks = new Map(), alerts = new Map();
  const dirty = new Set(), removed = new Set(), lastSaved = new Map();
  let msgTimes = [], lastSweepMs = 0;
  const watchOf = (v) => (v.imo && watchlist.byImo?.[String(v.imo)]) || watchlist.byMmsi?.[String(v.mmsi)] || null;
  const feeds = {
    digitraffic: { ok: false, last: null, count: 0, label: 'Fintraffic Digitraffic AIS', url: 'https://www.digitraffic.fi/en/marine-traffic/' },
    aisstream: { ok: false, last: null, count: 0, enabled: aisstreamEnabled, label: 'aisstream.io', url: 'https://aisstream.io' },
    weather: { ok: false, last: null, label: 'Open-Meteo', url: 'https://open-meteo.com' },
    watchlist: { ok: !!watchlist.updated, count: Object.keys(watchlist.byImo || {}).length + Object.keys(watchlist.byMmsi || {}).length, updated: watchlist.updated, label: 'OpenSanctions maritime', url: 'https://www.opensanctions.org' },
    history: { ok: false, last: null, label: 'Track history', mode },
  };

  function setWatchlist(w) {
    watchlist = w;
    feeds.watchlist = { ...feeds.watchlist, ok: !!w.updated, count: Object.keys(w.byImo || {}).length + Object.keys(w.byMmsi || {}).length, updated: w.updated };
    for (const v of vessels.values()) { const before = !!v.watch; v.watch = watchOf(v); if (!!v.watch !== before) dirty.add(v.mmsi); }
  }

  function vesselFor(mmsi) {
    let v = vessels.get(mmsi);
    if (!v) {
      const [flagCode, flag] = flagOf(mmsi);
      v = { mmsi, lat: null, lon: null, sog: null, cog: null, hdg: null, nav: null, name: null, imo: null, type: null, typeLabel: 'Unknown', flag, flagCode, dest: null, ts: 0, corridor: null, watch: null, level: null };
      vessels.set(mmsi, v);
    }
    return v;
  }
  function restoreVessel(v) { vessels.set(v.mmsi, { ...v, lat: null }); }

  function onPosition(mmsi, lon, lat, sog, cog, hdg, nav, ts, src, { evaluateNow = true } = {}) {
    if (!(lon > -180 && lon < 180 && lat > -90 && lat < 90) || !inBaltic([lon, lat])) return;
    const v = vesselFor(mmsi);
    if (ts <= v.ts) return;
    Object.assign(v, { lon, lat, sog: sog >= 102.3 ? null : sog, cog: cog >= 360 ? null : cog, hdg: hdg === 511 ? null : hdg, nav, ts });
    const c = corridors.corridor(lon, lat); v.corridor = c ? c.name : null;
    let t = tracks.get(mmsi); if (!t) tracks.set(mmsi, (t = []));
    const p = t[t.length - 1];
    if (!p || ts - p[2] >= 30e3 || distNm(p[0], p[1], lon, lat) > 0.1) t.push([lon, lat, ts, v.sog ?? 0, v.cog ?? 0, nav]);
    while (t.length && t[0][2] < ts - TRACK_MS) t.shift();
    if (src && hooks.savePosition && ts - (lastSaved.get(mmsi) || 0) >= 60e3) { lastSaved.set(mmsi, ts); try { hooks.savePosition(mmsi, [lon, lat, ts, v.sog ?? 0, v.cog ?? 0, nav ?? 15]); } catch {} }
    dirty.add(mmsi);
    if (src) { msgTimes.push(Date.now()); feeds[src].last = Date.now(); }
    if (evaluateNow) evalVessel(v);
  }
  function onStatic(mmsi, s) {
    const v = vesselFor(mmsi);
    if (s.name) v.name = s.name.replace(/@+$/, '').trim() || v.name;
    if (s.imo && s.imo > 999999) v.imo = s.imo;
    if (s.type != null) { v.type = s.type; v.typeLabel = typeLabel(s.type); }
    if (s.dest) v.dest = s.dest.replace(/@+$/, '').trim();
    v.watch = watchOf(v);
    hooks.saveVessel?.(v);
    dirty.add(mmsi);
  }

  /** Seed tracks (e.g. from a history file). rows: [lon,lat,tsMs,sog,cog,nav] ascending. */
  function seedTrack(mmsi, rows) {
    for (const r of rows) onPosition(mmsi, r[0], r[1], r[3], r[4], null, r[5], r[2], null, { evaluateNow: false });
  }

  // ── weather: one batched Open-Meteo call per hour over a 2° grid ──
  const wx = new Map();
  const WX_CELLS = [];
  for (let lon = 10; lon <= 30; lon += 2) for (let lat = 54; lat <= 66; lat += 2) if (inBaltic([lon, lat])) WX_CELLS.push([lon, lat]);
  async function refreshWeather() {
    try {
      const lats = WX_CELLS.map((c) => c[1]).join(','), lons = WX_CELLS.map((c) => c[0]).join(',');
      const [a, b] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`).then((r) => (r.ok ? r.json() : null)),
        fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const A = Array.isArray(a) ? a : a ? [a] : [], B = Array.isArray(b) ? b : b ? [b] : [];
      if (!A.length) throw new Error('no data (rate limit?)');
      WX_CELLS.forEach(([lon, lat], i) => {
        const cur = A[i]?.current; if (!cur) return;
        wx.set(`${lon},${lat}`, { t: Date.now(), v: { windKn: cur.wind_speed_10m, windDir: cur.wind_direction_10m, waveM: B[i]?.current?.wave_height ?? null } });
      });
      feeds.weather.ok = true; feeds.weather.last = Date.now(); feeds.weather.cells = wx.size;
      for (const v of vessels.values()) if (v.lat != null) evalVessel(v);
      return true;
    } catch (e) { feeds.weather.ok = false; log('weather', e.message); return false; }
  }
  function wxNear(lon, lat) {
    let best = null, bd = 9;
    for (const [k, c] of wx) { const [x, y] = k.split(',').map(Number); const d = Math.abs(x - lon) + Math.abs(y - lat); if (d < bd) { bd = d; best = c.v; } }
    return bd <= 3 ? best : null;
  }

  // ── detection ──
  function peersNear(v, now) {
    let n = 0;
    for (const o of vessels.values()) {
      if (o === v || o.lat == null || now - o.ts > 10 * 60e3 || Math.abs(o.lat - v.lat) > 0.2) continue;
      if (distNm(v.lon, v.lat, o.lon, o.lat) <= T.DARK_PEER_NM) n++;
    }
    return n;
  }
  function evalVessel(v, now = Date.now()) {
    const track = tracks.get(v.mmsi); if (!track?.length) return;
    const silent = now - v.ts > T.DARK_MIN * 60e3;
    const r = evaluate({ vessel: v, track, now, corridors, weather: wxNear(v.lon, v.lat), watch: v.watch, peers: silent ? peersNear(v, now) : null });
    const prev = alerts.get(v.mmsi);
    if (r?.level) {
      const a = {
        id: prev?.id || `${v.mmsi}-${now}`, mmsi: v.mmsi, name: v.name, imo: v.imo, flag: v.flag, typeLabel: v.typeLabel, level: r.level, asset: r.asset,
        lat: v.lat, lon: v.lon, firstSeen: prev?.firstSeen || now, lastSeen: now, signals: r.signals,
        context: { ...r.context, peers: r.context.peers ?? peersNear(v, now) }, shouldntConclude: r.shouldntConclude, track: track.slice(-180).map((p) => [p[0], p[1], p[2], p[3]]),
      };
      const changed = !prev || prev.level !== a.level || prev.signals.map((s) => s.id + s.explained).join() !== a.signals.map((s) => s.id + s.explained).join();
      alerts.set(v.mmsi, a); v.level = a.level; dirty.add(v.mmsi);
      if (changed) { emit('alert', a); hooks.saveAlert?.(a); }
    } else if (prev && now - prev.lastSeen > 30 * 60e3) {
      alerts.delete(v.mmsi); v.level = null; dirty.add(v.mmsi); emit('alert_clear', { id: prev.id, mmsi: v.mmsi });
    }
  }

  // ── Digitraffic (keyless, CORS-enabled) ──
  let dtFrom = 0, dtMetaFrom = 0;
  const dtHeaders = { 'Digitraffic-User': 'baltic-seabed-watch/0.1', ...headers };
  async function pollDigitraffic() {
    try {
      const r = await fetch(dtFrom ? `${DT}/locations?from=${dtFrom}` : `${DT}/locations`, { headers: dtHeaders }); if (!r.ok) throw new Error(r.status);
      const j = await r.json(); let max = dtFrom;
      for (const f of j.features || []) {
        const p = f.properties; const [lon, lat] = f.geometry.coordinates;
        onPosition(p.mmsi, lon, lat, p.sog, p.cog, p.heading, p.navStat, p.timestampExternal, 'digitraffic');
        if (p.timestampExternal > max) max = p.timestampExternal;
      }
      dtFrom = max ? max - 1000 : Date.now() - 60e3;
      feeds.digitraffic.ok = true; feeds.digitraffic.last = Date.now();
    } catch (e) { feeds.digitraffic.ok = false; log('digitraffic', e.message); }
  }
  async function pollDigitrafficMeta() {
    try {
      const r = await fetch(dtMetaFrom ? `${DT}/vessels?from=${dtMetaFrom}` : `${DT}/vessels`, { headers: dtHeaders }); if (!r.ok) throw new Error(r.status);
      const t0 = Date.now();
      for (const m of await r.json()) onStatic(m.mmsi, { name: m.name, imo: m.imo, type: m.shipType, dest: m.destination });
      dtMetaFrom = t0 - 60e3;
    } catch (e) { log('digitraffic meta', e.message); }
  }

  // ── outputs ──
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
    s.windKn = wxNear(25, 60)?.windKn ?? null;
    s.level = s.alerts.HIGH ? 'HIGH' : s.alerts.ELEVATED ? 'ELEVATED' : s.alerts.WATCH ? 'WATCH' : 'NOMINAL';
    return s;
  }
  function heat() {
    const cells = new Map(); const now = Date.now();
    for (const t of tracks.values()) {
      const seen = new Set();
      for (const p of t) { if (now - p[2] > TRACK_MS) continue; const k = `${(Math.floor(p[0] * 4) + 0.5) / 4},${(Math.floor(p[1] * 4) + 0.5) / 4}`; if (!seen.has(k)) { seen.add(k); cells.set(k, (cells.get(k) || 0) + 1); } }
    }
    return [...cells].map(([k, n]) => [...k.split(',').map(Number), n]);
  }
  const vesselOut = (v) => ({ mmsi: v.mmsi, lat: v.lat, lon: v.lon, sog: v.sog, cog: v.cog, hdg: v.hdg, nav: v.nav, name: v.name, imo: v.imo, type: v.type, typeLabel: v.typeLabel, flag: v.flag, flagCode: v.flagCode, dest: v.dest, ts: v.ts, corridor: v.corridor, watch: v.watch ? { risk: v.watch.risk, datasets: v.watch.datasets, url: v.watch.url, name: v.watch.name } : null, level: v.level });
  const liveVessels = () => [...vessels.values()].filter((v) => v.lat != null && Date.now() - v.ts < DROP_MS);
  const feedsOut = () => ({ ...feeds, digitraffic: { ...feeds.digitraffic, ok: feeds.digitraffic.ok && Date.now() - feeds.digitraffic.last < 120e3, count: liveVessels().length } });
  const snapshot = () => ({ ts: Date.now(), mode, feeds: feedsOut(), vessels: liveVessels().map(vesselOut), alerts: [...alerts.values()], stats: stats(), heat: heat(), signalInfo: SIGNAL_INFO });
  function vessel(mmsi) {
    const v = vessels.get(+mmsi); if (!v) return null;
    return { vessel: vesselOut(v), track: (tracks.get(v.mmsi) || []).map((p) => [p[0], p[1], p[2], p[3]]), alert: alerts.get(v.mmsi) || null };
  }
  function flush() {
    if (!dirty.size && !removed.size) return;
    const upd = [...dirty].map((m) => vessels.get(m)).filter((v) => v && v.lat != null).map(vesselOut);
    emit('vessels', { ts: Date.now(), upd, del: [...removed] }); dirty.clear(); removed.clear();
  }
  function sweep() {
    const t0 = Date.now();
    for (const v of vessels.values()) {
      if (v.lat == null) continue;
      if (t0 - v.ts > DROP_MS) { removed.add(v.mmsi); v.lat = null; tracks.delete(v.mmsi); continue; }
      evalVessel(v, t0);
    }
    lastSweepMs = Date.now() - t0;
  }

  /** Start all loops. Returns stop(). */
  function start({ poll = 10e3 } = {}) {
    const iv = [
      setInterval(flush, 2000),
      setInterval(() => emit('stats', stats()), 5000),
      setInterval(() => emit('feeds', feedsOut()), 10000),
      setInterval(() => emit('heat', heat()), 60000),
      setInterval(sweep, 30000),
      setInterval(pollDigitraffic, poll),
      setInterval(pollDigitrafficMeta, 10 * 60e3),
      setInterval(refreshWeather, 60 * 60e3),
    ];
    return () => iv.forEach(clearInterval);
  }

  return { vessels, tracks, alerts, feeds, onPosition, onStatic, seedTrack, restoreVessel, setWatchlist, pollDigitraffic, pollDigitrafficMeta, refreshWeather, sweep, flush, stats, heat, snapshot, vessel, feedsOut, start };
}

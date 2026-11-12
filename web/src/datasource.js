// Where the live picture comes from.
//  · server mode:  a Node server (server/index.js) is behind /api → snapshot + SSE stream.
//  · browser mode: static hosting (GitHub Pages). The same engine runs in this tab: it polls Digitraffic
//    (CORS-enabled, keyless), seeds tracks from data/history.json (built every ~15 min by GitHub Actions),
//    and evaluates the same detection rules locally.
import { asset } from './base.js';

const getJSON = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };

export function createDataSource() {
  let mode = null, first = null, engine = null, handlers = {};
  let booting = null;

  async function detect() {
    try {
      const r = await fetch(asset('api/snapshot'), { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) { first = await r.json(); return (mode = 'server'); }
    } catch {}
    return (mode = 'browser');
  }

  async function bootBrowser() {
    const [{ createEngine, TRACK_MS }, { buildCorridors }] = await Promise.all([import('../../server/engine.js'), import('../../server/corridors.js')]);
    const [infra, anch, watchlist, history] = await Promise.all([
      getJSON(asset('data/infra.geojson')), getJSON(asset('data/anchorages.geojson')),
      getJSON(asset('data/watchlist.json')), getJSON(asset('data/history.json')),
    ]);
    engine = createEngine({
      corridors: buildCorridors(infra || { features: [] }, anch || { features: [] }),
      watchlist: watchlist || undefined, mode: 'browser',
      emit: (e, d) => handlers[e]?.(d), log: (...a) => console.debug('[engine]', ...a),
    });
    if (history?.tracks) {
      const cutoff = Date.now() - TRACK_MS;
      for (const [mmsi, m] of Object.entries(history.meta || {})) engine.onStatic(+mmsi, { name: m[0], imo: m[1], type: m[2], dest: m[3] });
      for (const [mmsi, rows] of Object.entries(history.tracks)) {
        engine.seedTrack(+mmsi, rows.filter((r) => r[2] * 1000 > cutoff).map((r) => [r[0], r[1], r[2] * 1000, r[3], r[4], r[5]]));
      }
      engine.feeds.history = { ...engine.feeds.history, ok: true, last: history.generated ? Date.parse(history.generated) : null, vessels: Object.keys(history.tracks).length };
    }
    await Promise.all([engine.pollDigitrafficMeta(), engine.pollDigitraffic()]);
    engine.sweep();
    engine.start();
    engine.refreshWeather();
  }

  async function ready() {
    if (!booting) booting = (async () => { if ((await detect()) === 'browser') await bootBrowser(); })();
    return booting;
  }

  return {
    get mode() { return mode; },
    async snapshot() {
      await ready();
      if (mode === 'server') { const s = first || (await getJSON(asset('api/snapshot'))); first = null; return s; }
      return engine.snapshot();
    },
    async vessel(mmsi) {
      await ready();
      return mode === 'server' ? getJSON(asset(`api/vessel/${mmsi}`)) : engine.vessel(mmsi);
    },
    async subscribe(h) {
      await ready();
      handlers = h;
      if (mode === 'browser') { h.open?.(); return; }
      let es;
      try { es = new EventSource(asset('api/stream')); } catch { return; }
      es.onopen = () => h.open?.();
      es.onerror = () => h.error?.();
      for (const ev of ['vessels', 'alert', 'alert_clear', 'stats', 'feeds', 'heat']) es.addEventListener(ev, (e) => h[ev]?.(JSON.parse(e.data)));
    },
  };
}

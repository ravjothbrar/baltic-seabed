// `npm run diag`: checks everything Baltic Seabed Watch depends on and says what to do about anything missing.
// Read-only: makes one small request per source, writes nothing.
import { stat, readFile } from 'node:fs/promises';
import net from 'node:net';

const C = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', bad: '\x1b[31m✗\x1b[0m', dim: (s) => `\x1b[2m${s}\x1b[0m` };
let problems = 0;
const line = (st, name, msg, fix) => { if (st === C.bad) problems++; console.log(` ${st} ${name.padEnd(26)} ${msg}${fix ? '\n   ' + C.dim('→ ' + fix) : ''}`); };
async function probe(url, opts = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts }); return { ok: r.ok, status: r.status, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, status: e.cause?.code || e.name, ms: Date.now() - t0 }; }
}
const env = process.env;

console.log('\nBaltic Seabed Watch · diagnostics\n');
console.log('Runtime');
const major = +process.versions.node.split('.')[0];
line(major >= 22 ? C.ok : C.bad, 'Node.js', `v${process.versions.node}`, major >= 22 ? '' : 'Install Node 22+ (needs native fetch, node:sqlite, top-level await)');
for (const [dir, label] of [['node_modules', 'Root dependencies'], ['web/node_modules', 'Web dependencies']]) {
  const has = await stat(dir).then(() => true, () => false);
  line(has ? C.ok : C.bad, label, has ? 'installed' : 'missing', has ? '' : `npm install${dir.startsWith('web') ? ' --prefix web' : ''}`);
}
const built = await stat('web/dist/index.html').then(() => true, () => false);
line(built ? C.ok : C.warn, 'Web build', built ? 'web/dist ready' : 'not built', built ? '' : 'npm run build (the server serves web/dist)');
const port = +(env.PORT || 8787);
const free = await new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port); });
line(free ? C.ok : C.warn, `Port ${port}`, free ? 'free' : 'in use (a server may already be running)', free ? '' : `stop it, or PORT=${port + 1} npm start`);

console.log('\nCommitted data (works offline)');
for (const [f, label, min] of [['web/public/data/infra.geojson', 'Cables & pipelines', 1e5], ['web/public/data/incidents.json', 'Incident log', 1e3],
  ['web/public/data/anchorages.geojson', 'Port zones', 1e4], ['web/public/data/grid.json', 'Glider grid', 1e4], ['web/public/data/depth.json', 'Bathymetry', 1e5],
  ['server/data/watchlist.json', 'Sanctions watchlist', 1e5], ['web/public/geo/land.json', 'Land / coastlines', 1e5]]) {
  const s = await stat(f).catch(() => null);
  const good = s && s.size >= min;
  line(good ? C.ok : C.bad, label, s ? `${(s.size / 1024).toFixed(0)} KB` : 'missing', good ? '' : f.includes('watchlist') ? 'npm run fetch:watchlist' : 'npm run fetch:static');
}
try {
  const infra = JSON.parse(await readFile('web/public/data/infra.geojson', 'utf8'));
  const names = infra.features.filter((f) => f.properties.kind === 'power').map((f) => f.properties.name).join(' ').toLowerCase();
  const missing = ['estlink', 'nordbalt', 'fenno-skan', 'swepol'].filter((k) => !names.includes(k));
  line(missing.length ? C.warn : C.ok, 'Named HVDC links', missing.length ? `missing: ${missing.join(', ')}` : 'all present', missing.length ? 'run the refresh-data workflow (fetches OpenStreetMap via Overpass)' : '');
} catch {}

console.log('\nLive sources (no key needed)');
const UA = { 'User-Agent': 'baltic-seabed-watch/diag', 'Digitraffic-User': 'baltic-seabed-watch/diag' };
for (const [name, url] of [
  ['Digitraffic AIS', `https://meri.digitraffic.fi/api/ais/v1/locations?from=${Date.now() - 60e3}`],
  ['Open-Meteo weather', 'https://api.open-meteo.com/v1/forecast?latitude=60&longitude=25&current=wind_speed_10m'],
  ['TeleGeography cables', 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json'],
  ['EMODnet', 'https://ows.emodnet-humanactivities.eu/wfs?service=WFS&request=GetCapabilities'],
  ['OpenSanctions', 'https://data.opensanctions.org/datasets/latest/maritime/index.json'],
]) {
  const r = await probe(url, { method: 'GET', headers: UA });
  line(r.ok ? C.ok : r.status === 429 ? C.warn : C.bad, name, r.ok ? `reachable (${r.ms} ms)` : `failed: ${r.status}`, r.ok ? '' : r.status === 429 ? 'rate-limited; retries automatically' : 'check your network/proxy; the site degrades gracefully without it');
}

console.log('\nOptional keys (set as env vars locally, or as GitHub Actions secrets for the Pages site)');
for (const [k, what, how] of [
  ['AISSTREAM_API_KEY', 'whole-Baltic ships', 'aisstream.io → sign in with GitHub → API Keys'],
  ['GFW_API_TOKEN', 'satellite-radar detections', 'globalfishingwatch.org → Our APIs → request access (non-commercial)'],
  ['DISCORD_WEBHOOK_URL', 'push FLASH/PRIORITY alerts', 'Discord channel → Edit → Integrations → Webhooks → New'],
]) line(env[k] ? C.ok : C.warn, k, env[k] ? `set (${what})` : `not set: ${what} off`, env[k] ? '' : how);

console.log(problems ? `\n${problems} problem(s) above. Everything marked ! is optional.\n` : '\nAll good. Run: npm run build && npm start\n');
process.exit(problems ? 1 : 0);

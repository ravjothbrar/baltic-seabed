// Builds web/public/data/{infra.geojson, anchorages.geojson, grid.json} from public sources.
// Output is committed so the live site never depends on these upstreams.
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { clipLine, simplify, lineKm, distNm, BBOX, inBaltic } from '../server/geo.js';

const OUT = new URL('../web/public/data/', import.meta.url);
const UA = { 'User-Agent': 'baltic-seabed-watch/0.1 (open-source research project)' };
const EMOD = (layer) =>
  `https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=emodnet:${layer}&outputFormat=application/json&srsName=EPSG:4326&count=10000`;

// Assets named in public incident reporting get highlighted.
const NAMED = [
  /c-lion/i, /bcs east-west/i, /sweden-latvia/i, /latvia-sweden/i, /finland.?estonia/i, /sweden-estonia/i,
  /baltica/i, /kingisepp/i, /nordbalt/i, /balticconnector/i, /nord ?stream/i, /baltic pipe/i, /estlink/i, /eastern light/i,
];
const isNamed = (n) => !!n && NAMED.some((r) => r.test(n));

async function getJSON(url, file) {
  try {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    if (file) { console.warn(`  ! ${url} failed (${e.message}), using local ${file}`); return JSON.parse(await readFile(file, 'utf8')); }
    throw e;
  }
}

function lines(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

const features = [];
function add(props, geom) {
  const runs = lines(geom).flatMap((l) => clipLine(l)).map((r) => simplify(r)).filter((r) => r.length >= 2);
  if (!runs.length) return;
  features.push({ type: 'Feature', properties: props, geometry: { type: 'MultiLineString', coordinates: runs } });
}

console.log('· TeleGeography submarine cables');
const tg = await getJSON('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json');
for (const f of tg.features) {
  const name = f.properties.name;
  add({ id: `tg-${f.properties.id}`, name, kind: 'telecom', named: isNamed(name), source: 'TeleGeography' }, f.geometry);
}

console.log('· EMODnet pipelines');
const pipes = await getJSON(EMOD('pipelines'));
for (const [i, f] of pipes.features.entries()) {
  const p = f.properties; const name = p.name || 'Pipeline';
  add({ id: `emod-pipe-${i}`, name, kind: 'pipeline', named: isNamed(p.name), source: 'EMODnet', status: p.status || null, operator: p.operator || null, medium: p.medium || null }, f.geometry);
}

console.log('· EMODnet power cables');
for (const layer of ['pcablesbshcontis', 'pcablesnve', 'pcablesshom']) {
  try {
    const pc = await getJSON(EMOD(layer));
    for (const [i, f] of pc.features.entries()) {
      const p = f.properties; const name = p.name_ || p.name || 'Power cable';
      add({ id: `emod-${layer}-${i}`, name, kind: 'power', named: isNamed(name), source: 'EMODnet', status: p.status || null }, f.geometry);
    }
  } catch (e) { console.warn(`  ! ${layer}: ${e.message}`); }
}

// Optional: OpenStreetMap subsea power cables, if a local Overpass export exists (Overpass is often unreachable).
try {
  const osm = JSON.parse(await readFile(process.env.OSM_CABLES || 'scripts/cache/osm-power-cables.json', 'utf8'));
  for (const w of osm.elements || []) {
    if (!w.geometry) continue;
    const name = w.tags?.name || w.tags?.operator || 'Power cable';
    add({ id: `osm-${w.id}`, name, kind: 'power', named: isNamed(name), source: 'OpenStreetMap' },
      { type: 'LineString', coordinates: w.geometry.map((g) => [g.lon, g.lat]) });
  }
  console.log('· OpenStreetMap power cables merged');
} catch { console.log('· (no OpenStreetMap power-cable export; skipping)'); }

const infra = { type: 'FeatureCollection', generated: new Date().toISOString(), features };
await mkdir(OUT, { recursive: true });
await writeFile(new URL('infra.geojson', OUT), JSON.stringify(infra));
const counts = features.reduce((a, f) => ((a[f.properties.kind] = (a[f.properties.kind] || 0) + 1), a), {});
console.log('  infra features:', counts, 'named:', features.filter((f) => f.properties.named).length);

console.log('· EMODnet port locations → anchorage zones');
const ports = await getJSON(EMOD('portlocations'));
const anch = ports.features
  .filter((f) => f.geometry && inBaltic(f.geometry.coordinates))
  .map((f) => ({ type: 'Feature', properties: { name: f.properties.portname || f.properties.port, country: f.properties.country, radiusNm: 3 }, geometry: { type: 'Point', coordinates: f.geometry.coordinates.map((v) => +v.toFixed(4)) } }));
await writeFile(new URL('anchorages.geojson', OUT), JSON.stringify({ type: 'FeatureCollection', note: 'Port points from EMODnet; treated as 3 nm port/anchorage zones', features: anch }));
console.log('  ports:', anch.length);

console.log('· glider grid');
const CELL = 0.1; const cells = new Map();
for (const f of features) {
  for (const run of f.geometry.coordinates) {
    for (let i = 1; i < run.length; i++) {
      const [a, b] = [run[i - 1], run[i]];
      const km = lineKm([a, b]); const steps = Math.max(1, Math.ceil(km / 2));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps; const lon = a[0] + (b[0] - a[0]) * t, lat = a[1] + (b[1] - a[1]) * t;
        if (!inBaltic([lon, lat])) continue;
        const key = `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
        const c = cells.get(key) || { km: 0, named: 0 };
        c.km += km / steps; if (f.properties.named) c.named = 1; cells.set(key, c);
      }
    }
  }
}
// Drop cells that are on land: within ~1.5 km of a port is fine, but we have no land mask, so keep all
// cable cells (they are by definition on or near the seabed) and flag that depth is not modelled.
const grid = {
  cell: CELL,
  note: 'Cells crossed by mapped cables/pipelines. depthOk=1 everywhere: no bathymetry mask applied in this build.',
  cells: [...cells].map(([k, v]) => { const [x, y] = k.split(',').map(Number); return [+((x + 0.5) * CELL).toFixed(3), +((y + 0.5) * CELL).toFixed(3), +v.km.toFixed(2), v.named, 1]; }),
};
await writeFile(new URL('grid.json', OUT), JSON.stringify(grid));
console.log('  grid cells:', grid.cells.length);
void distNm;

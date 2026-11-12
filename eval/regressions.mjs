// Regression tests for review findings. Run with `npm run eval`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCorridors } from '../server/load.js';
import { evaluate, T } from '../server/detect.js';
import { createEngine, DROP_MS } from '../server/engine.js';
import { typeLabel, flagOf } from '../server/ais-meta.js';
import { distNm } from '../server/geo.js';

const corridors = loadCorridors('web/public/data/infra.geojson', 'web/public/data/anchorages.geojson');
const infra = JSON.parse(readFileSync('web/public/data/infra.geojson', 'utf8'));
const NOW = Date.UTC(2026, 10, 12, 12), MIN = 60e3;
const vessel = (mmsi, type, extra = {}) => { const [flagCode, flag] = flagOf(mmsi); return { mmsi, type, typeLabel: typeLabel(type), flag, flagCode, dest: null, ...extra }; };
const cable = infra.features.filter((f) => f.properties.name === 'C-Lion1').flatMap((f) => f.geometry.coordinates).sort((a, b) => b.length - a.length)[0];
const far = cable.find((p) => (corridors.nearestPort(...p)?.nm ?? 99) > 15);
const ev = (v, track, extra = {}) => evaluate({ vessel: v, track, now: track[track.length - 1][2], corridors, weather: null, watch: null, peers: null, ...extra });
const ids = (r) => (r?.signals || []).map((s) => s.id);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`  ✓  ${name}`); };

console.log('\nregressions');

ok('unavailable speed (null sog) is never counted as loitering', () => {
  const track = Array.from({ length: 45 }, (_, i) => [far[0], far[1], NOW - (45 - i) * MIN, null, null, 0]);
  assert.ok(!ids(ev(vessel(230000010, 70), track)).includes('LOITER'));
});

ok('a single slow fix after fast transit does not create DRAG', () => {
  // fast fixes at 12 kn, then a gap, then ONE slow fix ≥ 3 km further along the cable (sparse AIS / thinned history)
  const track = Array.from({ length: 90 }, (_, i) => [cable[0][0], cable[0][1] + i * 1e-4, NOW - (110 - i) * MIN, 12, 90, 0]);
  const prev = track[track.length - 1];
  const far3 = cable.find((p) => distNm(prev[0], prev[1], p[0], p[1]) * 1.852 > 3 && corridors.corridor(p[0], p[1]));
  track.push([far3[0], far3[1], NOW, 3, 90, 0]);
  assert.ok(!ids(ev(vessel(230000011, 70), track)).includes('DRAG'));
});

ok('inbound ship to a Russian port gets no PROFILE', () => {
  const track = Array.from({ length: 45 }, (_, i) => [far[0] + i * 1e-5, far[1], NOW - (45 - i) * MIN, 0.2, 0, 1]);
  const r = ev(vessel(518000012, 80, { dest: 'RU PRI' }), track);
  assert.ok(ids(r).includes('LOITER') && !ids(r).includes('PROFILE'), ids(r).join());
});

ok('DARK finds infrastructure beyond the index pad (within 10 nm)', () => {
  // a point ~6 nm north of a cable vertex
  const base = cable[Math.floor(cable.length / 2)]; const pt = [base[0], base[1] + 6 / 60];
  const near = corridors.nearestWithin(pt[0], pt[1], T.DARK_NEAR_NM);
  assert.ok(near && near.nm <= T.DARK_NEAR_NM, 'nearestWithin should find a segment');
  const track = [[pt[0], pt[1], NOW - 120 * MIN, 11, 90, 0], [pt[0] + 0.01, pt[1], NOW - 60 * MIN, 11, 90, 0]];
  const r = evaluate({ vessel: vessel(230000013, 70), track, now: NOW, corridors, weather: null, watch: null, peers: 8 });
  assert.ok(ids(r).includes('DARK'), ids(r).join());
});

ok('sweep clears the alert of an expired vessel', () => {
  const events = [];
  const e = createEngine({ corridors, emit: (ev, d) => events.push([ev, d]) });
  const t0 = Date.now();
  for (let i = 0; i < 45; i++) e.onPosition(230000014, far[0] + i * 1e-5, far[1], 0.1, 0, null, 1, t0 - DROP_MS - (60 - i) * MIN, null);
  e.onStatic(230000014, { type: 70, name: 'TEST' });
  // force an alert as if it had fired while live
  e.alerts.set(230000014, { id: 'x', mmsi: 230000014, level: 'WATCH', signals: [], lastSeen: t0 });
  e.sweep();
  assert.equal(e.alerts.has(230000014), false);
  assert.ok(events.some(([ev, d]) => ev === 'alert_clear' && d.id === 'x'));
});

ok('restored metadata does not block archived track replay', () => {
  const e = createEngine({ corridors, emit: () => {} });
  e.restoreVessel({ mmsi: 230000015, name: 'R', ts: NOW, type: 70 });
  e.seedTrack(230000015, [[far[0], far[1], NOW - 120 * MIN, 10, 0, 0], [far[0] + 0.01, far[1], NOW - 60 * MIN, 10, 0, 0]]);
  assert.equal(e.tracks.get(230000015)?.length, 2);
});

console.log(`\n${n} regression checks passed`);

// Replays labelled episodes through detect.js and prints per-signal precision/recall.
// Two kinds of cases:
//   1. eval/labels.json — REAL episodes you hand-label from the recorded archive (data/seabed.db).
//   2. Synthetic cases generated below from real cable geometry. Marked synthetic: true everywhere.
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadCorridors } from '../server/load.js';
import { evaluate } from '../server/detect.js';
import { typeLabel, flagOf } from '../server/ais-meta.js';
import { distNm } from '../server/geo.js';

const corridors = loadCorridors('web/public/data/infra.geojson', 'web/public/data/anchorages.geojson');
const infra = JSON.parse(readFileSync('web/public/data/infra.geojson', 'utf8'));
const ports = JSON.parse(readFileSync('web/public/data/anchorages.geojson', 'utf8')).features;

const NOW = Date.UTC(2026, 10, 12, 12);
const MIN = 60e3;
const vessel = (mmsi, type, extra = {}) => { const [flagCode, flag] = flagOf(mmsi); return { mmsi, type, typeLabel: typeLabel(type), flag, flagCode, dest: null, ...extra }; };

// Walk along a polyline at a speed profile → track rows.
function along(line, legs, start = NOW - legs.reduce((s, l) => s + l.min, 0) * MIN, nav = 0) {
  const out = []; let seg = 0, f = 0, t = start;
  for (const leg of legs) {
    for (let m = 0; m < leg.min; m++) {
      let nm = leg.kn / 60;
      while (nm > 0 && seg < line.length - 1) {
        const [a, b] = [line[seg], line[seg + 1]]; const L = distNm(...a, ...b) || 1e-6; const left = L * (1 - f);
        if (nm >= left) { nm -= left; seg++; f = 0; } else { f += nm / L; nm = 0; }
      }
      const [a, b] = [line[seg], line[Math.min(seg + 1, line.length - 1)]];
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, t, leg.kn, 0, leg.nav ?? nav]); t += MIN;
    }
  }
  return out;
}
const longestRun = (name) => infra.features.filter((f) => f.properties.name === name).flatMap((f) => f.geometry.coordinates).sort((a, b) => b.length - a.length)[0];
const cable = longestRun('C-Lion1') || longestRun(corridors.named[0]);
const stay = (p, min, kn = 0.2, nav = 0) => Array.from({ length: min }, (_, i) => [p[0] + i * 1e-5, p[1], NOW - (min - i) * MIN, kn, 0, nav]);
// a cable point far from any port, and one close to a port
const far = cable.find((p) => (corridors.nearestPort(...p)?.nm ?? 99) > 15) || cable[Math.floor(cable.length / 2)];
let nearPort = null;
for (const f of infra.features) for (const run of f.geometry.coordinates) for (const p of run) {
  if (!nearPort && ports.some((q) => distNm(...p, ...q.geometry.coordinates) < 2)) nearPort = p;
}

const synthetic = [
  { id: 'syn-drag-tanker', synthetic: true, should_flag: true, expect: ['DRAG'], note: 'Modelled on published Eagle S descriptions: long slow run along a cable after normal transit speed.',
    vessel: vessel(518000001, 80), track: along(cable, [{ min: 120, kn: 11 }, { min: 50, kn: 3 }]) },
  { id: 'syn-anchored-on-cable', synthetic: true, should_flag: true, expect: ['LOITER'], note: 'Anchored on a cable 15+ nm from any port.',
    vessel: vessel(230000002, 70), track: stay(far, 45, 0.1, 1) },
  { id: 'syn-transit', synthetic: true, should_flag: false, expect: [], note: 'Ordinary 12 kn transit along/over the cable.',
    vessel: vessel(265000003, 70), track: along(cable, [{ min: 180, kn: 12 }]) },
  { id: 'syn-fishing', synthetic: true, should_flag: false, expect: [], note: 'Trawler working slowly over a cable: explained by type.',
    vessel: vessel(230000004, 30), track: stay(far, 60, 2.5) },
  { id: 'syn-gale', synthetic: true, should_flag: false, expect: [], note: 'Cargo ship slowed to 2 kn on a cable in a 38 kn gale.',
    vessel: vessel(276000005, 70), track: stay(far, 50, 2), weather: { windKn: 38, waveM: 3.6 } },
  ...(nearPort ? [{ id: 'syn-port-wait', synthetic: true, should_flag: false, expect: [], note: 'Waiting at anchor inside a port zone that a cable lands in.',
    vessel: vessel(219000006, 70), track: stay(nearPort, 90, 0, 1) }] : []),
];

// Real, hand-labelled episodes from the recorded archive.
let real = [];
if (existsSync('eval/labels.json')) {
  const labels = JSON.parse(readFileSync('eval/labels.json', 'utf8')).episodes || [];
  const db = existsSync('data/seabed.db') ? new DatabaseSync('data/seabed.db', { readOnly: true }) : null;
  for (const e of labels) {
    if (!db) break;
    const rows = db.prepare('SELECT lon, lat, ts, sog, cog, nav FROM positions WHERE mmsi=? AND ts BETWEEN ? AND ? ORDER BY ts').all(e.mmsi, Date.parse(e.from), Date.parse(e.to));
    const meta = db.prepare('SELECT json FROM vessels WHERE mmsi=?').get(e.mmsi);
    const v = meta ? JSON.parse(meta.json) : vessel(e.mmsi, null);
    real.push({ ...e, synthetic: false, vessel: v, track: rows.map((r) => [r.lon, r.lat, r.ts, r.sog, r.cog, r.nav]) });
  }
}

const cases = [...real, ...synthetic];
const per = {}; let tp = 0, fp = 0, fn = 0, tn = 0;
console.log(`\n${real.length} real · ${synthetic.length} synthetic cases\n`);
for (const c of cases) {
  if (!c.track.length) { console.log(`  ?  ${c.id}: no track rows`); continue; }
  // Evaluate at every point; an episode is "flagged" if any evaluation raised a level.
  let flagged = false; const seen = new Set();
  for (let i = 5; i <= c.track.length; i++) {
    const tr = c.track.slice(0, i); const now = tr[tr.length - 1][2];
    const r = evaluate({ vessel: c.vessel, track: tr, now, corridors, weather: c.weather || null, watch: null, peers: null });
    if (r?.level) flagged = true;
    for (const s of r?.signals || []) if (!s.explained) seen.add(s.id);
  }
  const ok = flagged === c.should_flag;
  if (flagged && c.should_flag) tp++; else if (flagged) fp++; else if (c.should_flag) fn++; else tn++;
  for (const id of new Set([...seen, ...c.expect])) {
    per[id] ??= { tp: 0, fp: 0, fn: 0 };
    if (seen.has(id) && c.expect.includes(id)) per[id].tp++; else if (seen.has(id)) per[id].fp++; else per[id].fn++;
  }
  console.log(`  ${ok ? '✓' : '✗'}  ${c.synthetic ? '[synthetic] ' : ''}${c.id}: flagged=${flagged} expected=${c.should_flag} signals=[${[...seen].join(',')}]`);
}
const pr = (a, b) => (a + b ? (a / (a + b)).toFixed(2) : '—');
console.log(`\nepisodes  precision ${pr(tp, fp)}  recall ${pr(tp, fn)}  false-positive rate ${pr(fp, tn)}  (tp ${tp} fp ${fp} fn ${fn} tn ${tn})`);
for (const [id, s] of Object.entries(per)) console.log(`  ${id.padEnd(11)} precision ${pr(s.tp, s.fp)}  recall ${pr(s.tp, s.fn)}`);
if (!real.length) console.log('\nNo real labels yet: record 48 h (npm start), then add episodes to eval/labels.json (see eval/README.md).');
process.exit(fp + fn ? 1 : 0);

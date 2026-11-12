// OpenSanctions maritime export (free for non-commercial use) → compact IMO/MMSI watchlist.
// https://www.opensanctions.org/articles/2025-05-27-maritime-download
import { writeFile, mkdir } from 'node:fs/promises';

const URL_CSV = 'https://data.opensanctions.org/datasets/latest/maritime/maritime.csv';
const OUT = new URL('../server/data/watchlist.json', import.meta.url);

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const res = await fetch(URL_CSV, { headers: { 'User-Agent': 'baltic-seabed-watch/0.1 (non-commercial research)' } });
if (!res.ok) throw new Error(`OpenSanctions ${res.status}`);
const [head, ...rows] = parseCSV(await res.text());
const ix = Object.fromEntries(head.map((h, i) => [h, i]));

// Only risk tags that mean "listed": sanctions, shadow-fleet tracking, port-state detentions.
const KEEP = new Set(['sanction', 'mare.shadow', 'mare.detained']);
const byImo = {}, byMmsi = {};
let n = 0;
for (const r of rows) {
  if (r[ix.type] !== 'VESSEL') continue;
  const risk = r[ix.risk].split(';').filter((x) => KEEP.has(x));
  if (!risk.length) continue;
  const e = { name: r[ix.caption], risk, flag: r[ix.flag] || null, datasets: r[ix.datasets].split(';').filter(Boolean).slice(0, 6), url: r[ix.url] };
  const imo = (r[ix.imo] || '').replace(/\D/g, '');
  if (imo.length === 7) byImo[imo] = e;
  for (const m of (r[ix.mmsi] || '').split(';')) if (/^\d{9}$/.test(m)) byMmsi[m] = e;
  n++;
}
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ source: 'OpenSanctions maritime export', url: URL_CSV, license: 'CC BY-NC 4.0 (non-commercial)', updated: new Date().toISOString(), byImo, byMmsi }));
console.log(`watchlist: ${n} vessels · ${Object.keys(byImo).length} IMO · ${Object.keys(byMmsi).length} MMSI`);

// Brief archive → data/briefs/index.json + data/briefs/YYYY-MM-DD.json (newest first, up to KEEP days).
// GitHub Pages replaces the whole site on each deploy, so earlier days are carried forward from the published copy.
//   node scripts/archive-brief.mjs <brief.json> <outDir>   env: PREV_BASE (published data/ URL)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJSON } from './replay.mjs';

// 404 → null (nothing published yet). Anything else is retried, then fails the run, so a network blip
// can never publish an emptied archive (a failed run leaves the live site as it was).
async function fetchStrict(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  console.error(`brief archive: could not fetch ${url}; failing so the published archive is kept`);
  process.exit(1);
}

const KEEP = 60;
const [BRIEF, OUT] = process.argv.slice(2);
const dir = path.join(OUT, 'briefs');
await mkdir(dir, { recursive: true });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

const base = process.env.PREV_BASE ? process.env.PREV_BASE + 'briefs/' : null;
const prevIndex = base ? await fetchStrict(base + 'index.json') : null;
const dates = new Set();

for (const d of (prevIndex?.dates || []).filter(isDate).slice(0, KEEP)) {
  const b = await fetchStrict(base + d + '.json');
  if (b) { await writeFile(path.join(dir, d + '.json'), JSON.stringify(b)); dates.add(d); }
}

const brief = await readJSON(BRIEF);
if (brief?.generated) {
  const d = brief.generated.slice(0, 10);
  await writeFile(path.join(dir, d + '.json'), JSON.stringify(brief)); dates.add(d);
}

const list = [...dates].sort().reverse().slice(0, KEEP);
await writeFile(path.join(dir, 'index.json'), JSON.stringify({ updated: new Date().toISOString(), dates: list }));
console.log(`brief archive: ${list.length} day(s), newest ${list[0] || 'none'}`);

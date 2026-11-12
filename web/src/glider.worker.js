// Greedy maximum-coverage placement for a SIMULATED glider fleet.
// Greedy is prefix-consistent: the first N picks of a 300-pick run are the N-glider answer,
// so we compute once per (R, heat) and the N slider just slices.

const MAX_N = 300;
let cells = []; // {lon, lat, w}
let samples = []; // {name, lon, lat}
let assetNames = [];
let cache = null; // {R, order:[idx], curve:[cov], sampleFirst:Int32Array}

function km(lon1, lat1, lon2, lat2) {
  const dx = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const dy = (lat2 - lat1) * 110.57;
  return Math.hypot(dx, dy);
}

function buildCells(grid, heat) {
  const size = grid.cell || 0.05;
  const hk = (lon, lat) => `${Math.floor(lon / size)}:${Math.floor(lat / size)}`;
  const hmap = new Map();
  let hmax = 0;
  for (const [lon, lat, c] of heat || []) {
    const k = hk(lon, lat);
    const v = (hmap.get(k) || 0) + c;
    hmap.set(k, v);
    if (v > hmax) hmax = v;
  }
  const lmax = Math.log1p(hmax || 1);
  cells = [];
  for (const [lon, lat, infraKm, named, depthOk] of grid.cells) {
    if (!(infraKm > 0)) continue;
    const traffic = hmax ? Math.log1p(hmap.get(hk(lon, lat)) || 0) / lmax : 0;
    const w = infraKm * (1 + traffic) * (named ? 3 : 1) * (depthOk === 0 ? 0.3 : 1);
    cells.push({ lon, lat, w });
  }
}

function solve(R) {
  const n = cells.length;
  const bucket = Math.max(R / 60, 0.05); // degrees, rough
  const grid = new Map();
  const key = (x, y) => `${x}:${y}`;
  cells.forEach((c, i) => {
    const k = key(Math.floor(c.lon / (bucket * 2)), Math.floor(c.lat / bucket));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const near = (lon, lat) => {
    const bx = Math.floor(lon / (bucket * 2));
    const by = Math.floor(lat / bucket);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(key(bx + dx, by + dy));
      if (!arr) continue;
      for (const j of arr) if (km(lon, lat, cells[j].lon, cells[j].lat) <= R) out.push(j);
    }
    return out;
  };
  const cover = new Array(n);
  for (let i = 0; i < n; i++) cover[i] = near(cells[i].lon, cells[i].lat);
  const total = cells.reduce((s, c) => s + c.w, 0) || 1;
  const covered = new Uint8Array(n);
  const gain = (i) => {
    let g = 0;
    for (const j of cover[i]) if (!covered[j]) g += cells[j].w;
    return g;
  };
  // lazy greedy with a max-heap of [gain, idx]
  const heap = [];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let i = 0; i < n; i++) push([gain(i), i]);
  const order = [];
  const curve = [0];
  let acc = 0;
  while (order.length < MAX_N && heap.length) {
    const [g, i] = pop();
    const fresh = gain(i);
    if (heap.length && fresh < heap[0][0] - 1e-9) { push([fresh, i]); continue; }
    if (fresh <= 0) break;
    order.push(i);
    for (const j of cover[i]) if (!covered[j]) { covered[j] = 1; acc += cells[j].w; }
    curve.push(acc / total);
  }
  // first glider index covering each named-asset sample
  const sampleFirst = new Int32Array(samples.length).fill(1e9);
  samples.forEach((s, si) => {
    for (let k = 0; k < order.length; k++) {
      const c = cells[order[k]];
      if (km(s.lon, s.lat, c.lon, c.lat) <= R) { sampleFirst[si] = k; break; }
    }
  });
  cache = { R, order, curve, sampleFirst };
}

function answer(N, R) {
  if (!cells.length) return { ready: false };
  if (!cache || cache.R !== R) solve(R);
  const k = Math.min(N, cache.order.length);
  const gliders = cache.order.slice(0, k).map((i) => [cells[i].lon, cells[i].lat]);
  // named assets: covered if ≥80% of samples within R of one of the first N gliders
  const per = new Map();
  samples.forEach((s, si) => {
    const e = per.get(s.name) || { n: 0, c: 0 };
    e.n++;
    if (cache.sampleFirst[si] < k) e.c++;
    per.set(s.name, e);
  });
  let namedCovered = 0;
  const assets = [];
  for (const [name, e] of per) {
    const frac = e.n ? e.c / e.n : 0;
    if (frac >= 0.8) namedCovered++;
    assets.push({ name, frac });
  }
  return {
    ready: true,
    gliders,
    coverage: cache.curve[k] || 0,
    curve: cache.curve,
    maxUseful: cache.order.length,
    namedCovered,
    namedTotal: per.size,
    assets,
    cells: cells.length,
  };
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    buildCells(m.grid, m.heat);
    samples = m.samples || [];
    assetNames = [...new Set(samples.map((s) => s.name))];
    cache = null;
  } else if (m.type === 'heat') {
    if (m.grid) buildCells(m.grid, m.heat);
    cache = null;
  } else if (m.type === 'query') {
    const t = performance.now();
    const res = answer(m.N, m.R);
    res.ms = performance.now() - t;
    res.seq = m.seq;
    self.postMessage(res);
  }
};

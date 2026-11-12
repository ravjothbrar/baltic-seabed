// Flat 2D dashboard map (d3-geo + d3-zoom). Same interface as globe.js so main.js can route to either.
//  · land, borders, graticule, cables/pipelines: SVG under one zoom transform (non-scaling strokes)
//  · ships, tracks, gliders, incidents, tasking: one canvas, redrawn per frame in screen space
//  · labels: screen-space SVG text, constant size at every zoom, greedy collision pass
import { geoConicConformal, geoPath, geoGraticule10, geoArea } from 'd3-geo';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';
import { easeCubicInOut } from 'd3-ease';
import { PLACES } from './basemap.js';
import { kmBetween } from './globe.js';

const COL = {
  telecom: '#3fd8ff', power: '#b39bff', pipeline: '#ffb547',
  vessel: '#d6ebe8', vesselSlow: '#7f9fa3', watch: '#ff5fd2',
  WATCH: '#5cc8ff', ELEVATED: '#ffb547', HIGH: '#ff4d5e', mint: '#53f0c9', red: '#ff5a6a', glider: '#53f0c9',
};
// Baltic view box (lon/lat) and region boxes for the tabs.
const VIEW = [[9.3, 53.6], [30.6, 66.0]];
export const FLAT_REGIONS = {
  BALTIC: null,
  'GULF OF FINLAND': [[22.4, 58.9], [30.4, 60.95]],
  'ÅLAND': [[18.6, 59.3], [22.2, 60.75]],
  GOTLAND: [[16.4, 56.5], [20.2, 58.3]],
  BORNHOLM: [[13.2, 54.5], [16.4, 55.9]],
  'DANISH STRAITS': [[9.6, 54.3], [13.4, 57.2]],
};
const FOCUS = {
  listed: (v) => !!v.watch,
  alerts: (v) => !!v.level,
  corridor: (v) => !!v.corridor,
  moving: (v) => (v.sog || 0) > 0.6,
};
// label kinds → style + zoom window (k = zoom scale, 1 = whole Baltic)
const LABEL = {
  sea:     { cls: 'fl-sea',     size: 13, minK: 0,   maxK: 3.2, upper: true },
  gulf:    { cls: 'fl-sea',     size: 12, minK: 0,   maxK: 9,   upper: true },
  country: { cls: 'fl-country', size: 13.5, minK: 0, maxK: 7,   upper: true },
  city:    { cls: 'fl-city',    size: 12, minK: 1.4, maxK: 99,  dot: true },
  port:    { cls: 'fl-port',    size: 11.5, minK: 2.6, maxK: 99, dot: true },
};
const CHAR_W = { 'fl-country': 0.74, 'fl-sea': 0.66, 'fl-city': 0.58, 'fl-port': 0.58, 'fl-cable': 0.6, 'fl-inc': 0.62 };

function shortTitle(t = '') {
  const s = t.split(/[,(]| cable| pipeline/i)[0].trim();
  return s.length > 26 ? s.slice(0, 25) + '…' : s;
}

export function createFlatMap(container) {
  container.classList.add('flatmap');
  container.innerHTML = `
    <svg class="fl-base"><rect class="fl-sea-bg" width="100%" height="100%"/><g class="fl-z"><path class="fl-grat"/><path class="fl-land"/><path class="fl-border"/><g class="fl-infra"></g></g></svg>
    <canvas class="fl-canvas"></canvas>
    <svg class="fl-labels"></svg>`;
  const svg = select(container).select('svg.fl-base');
  const gz = svg.select('g.fl-z');
  const gInfra = gz.select('g.fl-infra');
  const canvas = container.querySelector('canvas.fl-canvas');
  const ctx = canvas.getContext('2d');
  const labelSvg = select(container).select('svg.fl-labels');

  let W = 0, H = 0, DPR = 1;
  const projection = geoConicConformal().parallels([56, 63]).rotate([-20, 0]);
  const path = geoPath(projection);
  let T = zoomIdentity;
  const listeners = { pick: [], hover: [], camera: [] };
  const layerVis = { telecom: true, power: true, pipeline: true, vessels: true, incidents: true, gliders: true };
  let reserved = () => [];

  // ---------- data ----------
  let land = null, borders = null;
  const infra = []; // {kind, name, named, pts:[[x,y]...] base projected}
  const vessels = new Map(); // mmsi -> {v, x, y}
  let incidents = []; // {inc, x, y}
  let track = null, trackLevel = null;
  let gliders = [], gliderR = 8, tasking = null;
  let focus = null;
  let infraLabels = [];

  const P = (lon, lat) => projection([lon, lat]);

  function fit() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    svg.attr('width', W).attr('height', H); labelSvg.attr('width', W).attr('height', H);
    const box = { type: 'MultiPoint', coordinates: [VIEW[0], [VIEW[1][0], VIEW[0][1]], VIEW[1], [VIEW[0][0], VIEW[1][1]]] };
    const pad = Math.min(W, H) * 0.04;
    projection.fitExtent([[pad, pad], [W - pad, H - pad]], box);
    reproject();
    const a = P(4, 50), b = P(37, 69.5), c = P(4, 69.5), d = P(37, 50);
    zoomer.translateExtent([[Math.min(a[0], c[0]), Math.min(c[1], b[1])], [Math.max(b[0], d[0]), Math.max(a[1], d[1])]]).extent([[0, 0], [W, H]]);
  }

  function reproject() {
    gz.select('.fl-grat').attr('d', path(geoGraticule10()));
    if (land) gz.select('.fl-land').attr('d', path(land));
    if (borders) gz.select('.fl-border').attr('d', path(borders));
    for (const l of infra) l.pts = l.coords.map(([x, y]) => P(x, y));
    gInfra.selectAll('path.fl-line').attr('d', (l) => 'M' + l.pts.map((p) => p.join(',')).join('L'));
    for (const e of vessels.values()) [e.x, e.y] = P(e.v.lon, e.v.lat);
    for (const i of incidents) [i.x, i.y] = P(i.inc.lon, i.inc.lat);
    for (const g of gliders) [g.x, g.y] = P(g.lon, g.lat);
    for (const l of placeLabels) [l.x, l.y] = P(l.lon, l.lat);
    for (const l of infraLabels) [l.x, l.y] = P(l.lon, l.lat);
    redrawLabels(); draw();
  }

  function setLand(data) {
    if (!data?.region) return;
    // d3-geo wants clockwise exterior rings on the sphere; a ring that "covers" more than a hemisphere is reversed.
    const polys = data.region.map((poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly));
    land = { type: 'MultiPolygon', coordinates: polys };
    gz.select('.fl-land').attr('d', path(land));
  }
  function setCoast(data) {
    if (!data?.borders) return;
    borders = { type: 'MultiLineString', coordinates: data.borders };
    gz.select('.fl-border').attr('d', path(borders));
  }

  function setInfra(fc) {
    infra.length = 0; infraLabels = [];
    const seen = new Set();
    for (const f of fc?.features || []) {
      const p = f.properties || {};
      const g = f.geometry; if (!g) continue;
      const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
      const kind = ['telecom', 'power', 'pipeline'].includes(p.kind) ? p.kind : 'telecom';
      for (const part of parts) {
        if (!part || part.length < 2) continue;
        infra.push({ kind, name: p.name, named: !!p.named, coords: part, pts: part.map(([x, y]) => P(x, y)) });
      }
      if (p.named && p.name && !seen.has(p.name) && parts[0]?.length) {
        seen.add(p.name);
        const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
        const mid = longest[Math.floor(longest.length / 2)];
        const [lx, ly] = P(mid[0], mid[1]);
        infraLabels.push({ text: p.name, lon: mid[0], lat: mid[1], x: lx, y: ly, cls: 'fl-cable fl-' + kind, size: 11, minK: 2.4, maxK: 99, pri: 40, kind, dx: 8, anchor: 'start' });
      }
    }
    // draw order: unnamed first, named on top
    infra.sort((a, b) => a.named - b.named);
    const sel = gInfra.selectAll('path.fl-line').data(infra);
    sel.exit().remove();
    sel.enter().append('path').attr('class', 'fl-line').merge(sel)
      .attr('class', (l) => `fl-line fl-${l.kind}${l.named ? ' named' : ''}`)
      .attr('d', (l) => 'M' + l.pts.map((q) => q.join(',')).join('L'));
    applyVis(); redrawLabels();
  }

  function setIncidents(list) {
    incidents = (list || []).filter((i) => typeof i.lat === 'number').map((inc) => { const [x, y] = P(inc.lon, inc.lat); return { inc, x, y }; });
    incLabels = incidents.map(({ inc }, idx) => ({
      text: `${(inc.date || '').slice(0, 7)} · ${inc.vessel?.name ? inc.vessel.name.split(' (')[0] : shortTitle(inc.title)}`,
      lon: inc.lon, lat: inc.lat, cls: 'fl-inc', size: 11, minK: 0, maxK: 99, pri: 95, dx: idx % 2 ? -12 : 12, anchor: idx % 2 ? 'end' : 'start', layer: 'incidents',
    }));
    for (const l of incLabels) [l.x, l.y] = P(l.lon, l.lat);
    redrawLabels(); draw();
  }
  let incLabels = [];

  // ---------- vessels ----------
  function upsertVessels(list) {
    for (const v of list) {
      if (typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
      const [x, y] = P(v.lon, v.lat);
      vessels.set(v.mmsi, { v, x, y });
    }
    draw();
  }
  function removeVessels(ids) { for (const id of ids) vessels.delete(id); draw(); }
  function setFocus(mode) { focus = mode && FOCUS[mode] ? mode : null; draw(); }
  function vColor(v) {
    if (v.level && COL[v.level]) return COL[v.level];
    if (v.watch) return COL.watch;
    return (v.sog || 0) > 0.6 ? COL.vessel : COL.vesselSlow;
  }

  // ---------- track / gliders / tasking ----------
  function showTrack(t, level) { track = t && t.length > 1 ? t.map((p) => ({ p, xy: P(p[0], p[1]) })) : null; trackLevel = level; draw(); }
  function clearTrack() { track = null; draw(); }
  function setGliders(list, rKm) {
    gliderR = rKm || gliderR;
    gliders = (list || []).map(([lon, lat], i) => { const [x, y] = P(lon, lat); return { lon, lat, x, y, phase: (i * 2.399) % (Math.PI * 2), head: (i * 1.7) % Math.PI }; });
    draw();
  }
  function setTasking(alert) {
    tasking = null;
    if (!alert || !gliders.length || typeof alert.lat !== 'number') { draw(); return null; }
    let best = null;
    for (const g of gliders) { const d = kmBetween(alert.lon, alert.lat, g.lon, g.lat); if (!best || d < best.d) best = { g, d }; }
    const etaH = best.d / (1.5 * 1.852);
    tasking = { a: P(alert.lon, alert.lat), g: best.g, km: best.d, etaH };
    draw();
    return { km: best.d, etaH };
  }

  // ---------- visibility ----------
  function applyVis() {
    gInfra.selectAll('path.fl-line').style('display', (l) => (layerVis[l.kind] ? null : 'none'));
    redrawLabels(); draw();
  }
  function setLayer(name, on) { layerVis[name] = on; applyVis(); }

  // ---------- labels (screen space, constant size, collision-free) ----------
  const placeLabels = PLACES.map(([text, lon, lat, kind, , , pri]) => {
    const st = LABEL[kind] || LABEL.city;
    const [x, y] = P(lon, lat);
    return { text: st.upper ? text.toUpperCase() : text, lon, lat, x, y, cls: st.cls, size: st.size, minK: st.minK, maxK: st.maxK, pri, dot: st.dot, dx: st.dot ? 7 : 0, anchor: st.dot ? 'start' : 'middle' };
  });
  // smaller seas/gulfs appear later
  for (const l of placeLabels) if (/ARCHIPELAGO|ÅLAND SEA|BOTHNIAN BAY/.test(l.text)) l.minK = 1.8;
  function redrawLabels() {
    if (!W) return;
    const k = T.k;
    const res = (reserved() || []).map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 }));
    const placed = [...res];
    const cand = [];
    const all = [...incLabels.filter(() => layerVis.incidents), ...placeLabels, ...infraLabels.filter((l) => layerVis[l.kind])];
    for (const l of all) {
      if (k < l.minK || k > l.maxK) continue;
      const sx = T.applyX(l.x), sy = T.applyY(l.y);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      if (sx < -50 || sy < -20 || sx > W + 50 || sy > H + 20) continue;
      cand.push({ l, sx, sy });
    }
    cand.sort((a, b) => b.l.pri - a.l.pri);
    const shown = [];
    for (const c of cand) {
      const { l } = c;
      const w = l.text.length * l.size * (CHAR_W[l.cls.split(' ')[0]] || 0.6) + (l.dot ? 8 : 0);
      const h = l.size + 6;
      const ax = c.sx + (l.dx || 0);
      const x0 = l.anchor === 'middle' ? ax - w / 2 : l.anchor === 'end' ? ax - w : ax;
      const box = { x0: x0 - 3, y0: c.sy - h / 2 - 2, x1: x0 + w + 3, y1: c.sy + h / 2 + 2 };
      if (box.x0 < 2 || box.x1 > W - 2 || box.y0 < 2 || box.y1 > H - 2) continue;
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      placed.push(box); shown.push(c);
    }
    const sel = labelSvg.selectAll('g.fl-lab').data(shown, (c) => c.l.cls + c.l.text);
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'fl-lab');
    en.append('circle').attr('r', 2.6);
    en.append('text');
    en.merge(sel).each(function (c) {
      const g = select(this); const l = c.l;
      g.attr('class', `fl-lab ${l.cls}`).attr('transform', `translate(${c.sx.toFixed(1)},${c.sy.toFixed(1)})`);
      g.select('circle').style('display', l.dot ? null : 'none');
      g.select('text').text(l.text).attr('x', l.dx || 0).attr('y', 0).attr('dy', '0.35em').attr('text-anchor', l.anchor || 'middle').style('font-size', l.size + 'px');
    });
  }

  // ---------- canvas draw (screen space) ----------
  let animT = 0, rafPending = false;
  function draw() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
  function frame(ts) {
    rafPending = false;
    animT = ts / 1000;
    render();
    // keep animating while something pulses or moves
    if (gliders.length && layerVis.gliders || hasAlerts() || (incidents.length && layerVis.incidents)) setTimeout(draw, 50);
  }
  let alertCount = 0;
  const hasAlerts = () => alertCount > 0 && layerVis.vessels;
  const sx = (x) => T.k * x + T.x, sy = (y) => T.k * y + T.y;

  function pxPerKm(lat) {
    const a = P(20, lat), b = P(20, lat + 1 / 110.57);
    return Math.abs(b[1] - a[1]) * T.k;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // gliders (sim): faint discs + small chevrons drifting on a racetrack
    if (layerVis.gliders && gliders.length) {
      const ppk = pxPerKm(59);
      const r = Math.max(2, gliderR * ppk);
      ctx.fillStyle = 'rgba(83,240,201,0.05)'; ctx.strokeStyle = 'rgba(83,240,201,0.22)'; ctx.lineWidth = 1;
      for (const g of gliders) {
        const X = sx(g.x), Y = sy(g.y);
        if (X < -r || Y < -r || X > W + r || Y > H + r) continue;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = COL.glider;
      for (const g of gliders) {
        const a = animT * 0.07 + g.phase;
        const along = Math.cos(a) * 2.4, across = Math.sin(a) * 0.8;
        const dx = (along * Math.cos(g.head) - across * Math.sin(g.head)) * ppk;
        const dy = -(along * Math.sin(g.head) + across * Math.cos(g.head)) * ppk;
        const X = sx(g.x) + dx, Y = sy(g.y) + dy;
        if (X < -5 || Y < -5 || X > W + 5 || Y > H + 5) continue;
        ctx.save(); ctx.translate(X, Y); ctx.rotate(-(a + g.head));
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.6, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.6, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // track
    if (track) {
      const c = trackLevel && COL[trackLevel] ? COL[trackLevel] : COL.mint;
      ctx.strokeStyle = c; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.95;
      ctx.beginPath();
      track.forEach(({ xy }, i) => (i ? ctx.lineTo(sx(xy[0]), sy(xy[1])) : ctx.moveTo(sx(xy[0]), sy(xy[1]))));
      ctx.stroke();
      ctx.fillStyle = c; const step = Math.max(1, Math.floor(track.length / 40));
      track.forEach(({ xy }, i) => { if (i % step) return; ctx.beginPath(); ctx.arc(sx(xy[0]), sy(xy[1]), 2, 0, 7); ctx.fill(); });
      ctx.globalAlpha = 1;
    }
    // vessels
    alertCount = 0;
    if (layerVis.vessels) {
      const zoomBoost = Math.min(1.6, 1 + Math.log2(T.k) * 0.12);
      const ph = (animT % 1.6) / 1.6;
      const list = [...vessels.values()];
      // draw plain first, flagged on top
      list.sort((a, b) => (a.v.level ? 2 : a.v.watch ? 1 : 0) - (b.v.level ? 2 : b.v.watch ? 1 : 0));
      for (const e of list) {
        const v = e.v; const X = sx(e.x), Y = sy(e.y);
        if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
        const dim = focus && !FOCUS[focus](v);
        const c = vColor(v);
        const flagged = !!(v.level || v.watch);
        const r = (v.level ? 4.2 : v.watch ? 3.4 : 2.1) * zoomBoost + (focus && !dim ? 1.4 : 0);
        ctx.globalAlpha = dim ? 0.12 : flagged ? 1 : (v.sog || 0) > 0.6 ? 0.85 : 0.6;
        const cog = typeof v.cog === 'number' && v.cog < 360 ? v.cog : typeof v.hdg === 'number' && v.hdg < 360 ? v.hdg : null;
        if (cog != null && (v.sog || 0) > 0.6) {
          const L = (flagged ? 11 : 7) * zoomBoost; const rad = (cog * Math.PI) / 180;
          ctx.strokeStyle = c; ctx.lineWidth = flagged ? 1.5 : 1;
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.sin(rad) * L, Y - Math.cos(rad) * L); ctx.stroke();
        }
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
        if (flagged) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
        if (v.level && !dim) {
          alertCount++;
          ctx.globalAlpha = 0.9 * (1 - ph); ctx.strokeStyle = c; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(X, Y, r + 3 + ph * 14, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    // incidents: diamonds
    if (layerVis.incidents) {
      const s = 6 + 0.8 * Math.sin(animT * 3.2);
      for (const i of incidents) {
        const X = sx(i.x), Y = sy(i.y);
        ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(255,90,106,0.35)'; ctx.strokeStyle = COL.red; ctx.lineWidth = 1.8;
        ctx.fillRect(-s, -s, 2 * s, 2 * s); ctx.strokeRect(-s, -s, 2 * s, 2 * s);
        ctx.restore();
      }
    }
    // tasking line + label
    if (tasking) {
      const ax = sx(tasking.a[0]), ay = sy(tasking.a[1]), gx = sx(tasking.g.x), gy = sy(tasking.g.y);
      ctx.setLineDash([7, 5]); ctx.strokeStyle = COL.mint; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
      const text = `NEAREST GLIDER ${tasking.km.toFixed(1)} KM · ETA ~${tasking.etaH < 1 ? '<1' : tasking.etaH.toFixed(1)} H (SIM)`;
      ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(text).width; const mx = (ax + gx) / 2, my = (ay + gy) / 2 - 16;
      ctx.fillStyle = 'rgba(8,16,22,0.92)'; ctx.fillRect(mx - tw / 2 - 7, my - 10, tw + 14, 20);
      ctx.strokeStyle = 'rgba(83,240,201,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(mx - tw / 2 - 7, my - 10, tw + 14, 20);
      ctx.fillStyle = COL.mint; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, mx, my + 0.5);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  // ---------- zoom ----------
  const zoomer = d3zoom().scaleExtent([1, 48])
    .wheelDelta((e) => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.0022) * (e.ctrlKey ? 8 : 1))
    .on('zoom', (e) => {
      T = e.transform;
      gz.attr('transform', T.toString());
      container.style.setProperty('--k', T.k);
      redrawLabels(); render();
      emitCamera();
    });
  const zsel = select(container).call(zoomer).on('dblclick.zoom', null);
  // keep the browser from page-zooming on trackpad pinch even when d3 is at a scale limit
  container.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  let camT = 0;
  function emitCamera() {
    const now = performance.now(); if (now - camT < 120) return; camT = now;
    const c = projection.invert([T.invertX(W / 2), T.invertY(H / 2)]) || [20, 58];
    const l = projection.invert([T.invertX(0), T.invertY(H / 2)]), r = projection.invert([T.invertX(W), T.invertY(H / 2)]);
    const spanKm = l && r ? kmBetween(l[0], l[1], r[0], r[1]) : 0;
    listeners.camera.forEach((f) => f({ lon: c[0], lat: c[1], alt: spanKm * 1000, k: T.k, spanKm, flat: true, heading: 0, pitch: -90 }));
  }

  function transformFor(box, maxK = 48) {
    const pts = [box[0], [box[1][0], box[0][1]], box[1], [box[0][0], box[1][1]]].map(([x, y]) => P(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.max(1, Math.min(maxK, 0.92 / Math.max((x1 - x0) / W, (y1 - y0) / H)));
    return zoomIdentity.translate(W / 2 - (k * (x0 + x1)) / 2, H / 2 - (k * (y0 + y1)) / 2).scale(k);
  }
  function go(t, duration) {
    if (!duration) zsel.call(zoomer.transform, t);
    else zsel.transition().duration(duration * 1000).ease(easeCubicInOut).call(zoomer.transform, t);
  }
  function flyRegion(name, duration = 1.2) {
    const b = FLAT_REGIONS[name];
    go(b ? transformFor(b) : zoomIdentity, duration);
  }
  function flyPoint(lon, lat, range = 160000, duration = 1.1) {
    const km = (range / 1000) * 1.1; const dLat = km / 2 / 110.57, dLon = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
    go(transformFor([[lon - dLon, lat - dLat * 0.75], [lon + dLon, lat + dLat * 0.75]]), duration);
  }
  function zoomBy(f) { zsel.transition().duration(350).call(zoomer.scaleBy, f); }

  // ---------- picking ----------
  function pick(mx, my) {
    // vessels (nearest within 8px)
    let best = null, bd = 9 * 9;
    if (layerVis.vessels) for (const e of vessels.values()) {
      const dx = sx(e.x) - mx, dy = sy(e.y) - my; const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { kind: 'vessel', mmsi: e.v.mmsi }; }
    }
    if (best) return best;
    if (layerVis.incidents) for (const i of incidents) if (Math.abs(sx(i.x) - mx) < 9 && Math.abs(sy(i.y) - my) < 9) return { kind: 'incident', id: i.inc.id };
    if (layerVis.gliders) for (const [n, g] of gliders.entries()) if (Math.abs(sx(g.x) - mx) < 6 && Math.abs(sy(g.y) - my) < 6) return { kind: 'glider', i: n };
    // infra: distance to segments in base coords
    const bx = T.invertX(mx), by = T.invertY(my), tol = 6 / T.k;
    let ib = null, ibd = tol;
    for (const l of infra) {
      if (!layerVis[l.kind]) continue;
      const p = l.pts;
      for (let j = 1; j < p.length; j++) {
        const [ax, ay] = p[j - 1], [cx, cy] = p[j];
        if (Math.max(ax, cx) < bx - tol || Math.min(ax, cx) > bx + tol || Math.max(ay, cy) < by - tol || Math.min(ay, cy) > by + tol) continue;
        const dx = cx - ax, dy = cy - ay, L = dx * dx + dy * dy;
        let t = L ? ((bx - ax) * dx + (by - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(bx - (ax + t * dx), by - (ay + t * dy));
        if (d < ibd || (d < tol && l.named && !ib?.named)) { ibd = d; ib = { kind: 'infra', name: l.name, infraKind: l.kind, named: l.named }; }
      }
    }
    return ib;
  }
  let hoverRaf = 0, hoverPos = null;
  container.addEventListener('mousemove', (e) => {
    const r = container.getBoundingClientRect(); hoverPos = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; const id = pick(hoverPos.x, hoverPos.y);
      container.style.cursor = id ? 'pointer' : '';
      listeners.hover.forEach((f) => f(id, hoverPos));
    });
  });
  container.addEventListener('mouseleave', () => listeners.hover.forEach((f) => f(null, null)));
  container.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const r = container.getBoundingClientRect(); const pos = { x: e.clientX - r.left, y: e.clientY - r.top };
    const id = pick(pos.x, pos.y);
    listeners.pick.forEach((f) => f(id, pos));
  });

  function countInView() {
    let n = 0;
    for (const e of vessels.values()) { const X = sx(e.x), Y = sy(e.y); if (X >= 0 && Y >= 0 && X <= W && Y <= H) n++; }
    return n;
  }

  const ro = new ResizeObserver(() => { const k = T; fit(); zsel.call(zoomer.transform, k); });
  ro.observe(container);
  fit();

  return {
    setInfra, setCoast, setLand, setIncidents, upsertVessels, removeVessels, setFocus,
    showTrack, clearTrack, setGliders, setTasking, setLayer, flyRegion, flyPoint, zoomBy, countInView,
    setReserved: (f) => { reserved = f; },
    getFocus: () => focus,
    resize: () => { fit(); zsel.call(zoomer.transform, T); },
    redraw: () => { redrawLabels(); render(); },
    vesselCount: () => vessels.size,
    getVessel: (mmsi) => vessels.get(mmsi)?.v,
    get k() { return T.k; },
    on: (ev, f) => listeners[ev].push(f),
  };
}

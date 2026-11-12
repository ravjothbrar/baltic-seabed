// Lightweight intro globe: d3-geo orthographic on a 2D canvas. No WebGL, no tiles.
// Land comes from a ~50 KB file (geo/hero-land.json), preloaded in index.html, so it draws within a few hundred ms.
// It shows the same live layers as the dashboard (cables, ships, incidents), then swoops onto the Baltic and hands off
// to the flat Mercator map, framing the same box so the cross-fade reads as one continuous zoom.
import { geoOrthographic, geoPath, geoGraticule10, geoArea, geoInterpolate } from 'd3-geo';

const CENTER = [20.4, 58.6]; // Baltic
// Deep-sea tones: dark slate-teal land on a navy sea; the live Baltic data is the main point of colour.
const COL = {
  ocean0: '#0f1d27', ocean1: '#03080c', land: '#22343c', coast: 'rgba(150, 225, 214, 0.32)', grat: 'rgba(127, 233, 211, 0.05)',
  limb: 'rgba(120, 210, 220,', ring: 'rgba(170, 235, 225,', telecom: 'rgba(92, 200, 255,', power: 'rgba(169, 139, 255,', pipeline: 'rgba(255, 181, 71,',
  ship: 'rgba(240, 245, 245, 0.9)', listed: '#ff5fd2', alert: '#ffb547', incident: '#ff5a6a',
};
// Flat-map colours the swoop blends into, so the cross-fade lands seamlessly.
const FLAT = { land: [36, 54, 66], ocean: '#0c1822' };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRgb = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
// deterministic faint star/haze field
const STARS = Array.from({ length: 260 }, (_, i) => { const r = Math.sin(i * 12.9898) * 43758.5453; const f = r - Math.floor(r); const g = Math.sin(i * 78.233) * 12345.678; const h = g - Math.floor(g); return [f, h, 0.15 + ((i * 7) % 10) / 22]; });
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createHeroGlobe(canvas, { landUrl, reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  const proj = geoOrthographic().clipAngle(90).precision(0.4);
  const path = geoPath(proj, ctx);
  const grat = geoGraticule10();
  let W = 0, H = 0, DPR = 1;
  let land = null, cables = [], ships = [], incidents = [], focus = [];
  let rot = [-CENTER[0], -CENTER[1], 0];
  let base = { x: 0, y: 0, r: 0 }; // hero composition (set by layout())
  let anim = null; // swoop state
  let raf = 0, last = 0, drift = 0, alive = true, landAt = null;
  const listeners = { land: [] };

  function layout() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const portrait = H > W * 1.1;
    // big globe, partly cropped by the right edge (desktop) / by the top half (phones)
    base = portrait ? { x: W * 0.62, y: H * 0.27, r: W * 0.6 } : { x: W * 0.7, y: H * 0.4, r: Math.min(H * 0.5, W * 0.33) };
    if (!anim) apply(base, rot);
    draw();
  }
  function apply(b, r) { proj.translate([b.x, b.y]).scale(b.r).rotate(r); }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (anim?.clip) {
      const k = ease(anim.p), c0 = [0, 0, W, H], c1 = anim.clip;
      const cr = c0.map((v, i) => v + (c1[i] - v) * k);
      ctx.beginPath(); ctx.rect(cr[0], cr[1], cr[2], cr[3]); ctx.clip();
    }
    drawScene();
    ctx.restore();
  }
  function drawScene() {
    const [x, y] = proj.translate(), r = proj.scale();
    // atmosphere: soft outer limb glow
    const fade = anim ? Math.max(0, 1 - anim.p * 1.6) : 1;
    if (fade > 0) {
      // smoky haze + faint stars (Clarity's grey particle field)
      for (const [fx, fy, a] of STARS) { const sx = W * (0.38 + fx * 0.62), sy = H * fy * 0.8; if (Math.hypot(sx - x, sy - y) < r * 1.02) continue; ctx.fillStyle = `rgba(255,255,255,${a * 0.35 * fade})`; ctx.fillRect(sx, sy, 1, 1); }
      const hz = ctx.createRadialGradient(x + r * 0.55, y - r * 0.75, 0, x + r * 0.55, y - r * 0.75, r * 1.3);
      hz.addColorStop(0, `rgba(255,255,255,${0.05 * fade})`); hz.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
    }
    if (fade > 0) {
      const g = ctx.createRadialGradient(x, y, r * 0.96, x, y, r * 1.16);
      g.addColorStop(0, COL.limb + (0.32 * fade) + ')'); g.addColorStop(0.35, COL.limb + (0.1 * fade) + ')'); g.addColorStop(1, COL.limb + '0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.16, 0, Math.PI * 2); ctx.fill();
    }
    // ocean (blends to the flat map's flat sea colour as the swoop lands, so the cross-fade is seamless)
    if (anim && anim.p > 0.55) { ctx.fillStyle = FLAT.ocean; ctx.globalAlpha = Math.min(1, (anim.p - 0.55) / 0.45); }
    const og = ctx.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.1, x, y, r);
    og.addColorStop(0, COL.ocean0); og.addColorStop(1, COL.ocean1);
    ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = og; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (anim && anim.p > 0.55) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    // graticule
    ctx.beginPath(); path(grat); ctx.strokeStyle = COL.grat; ctx.lineWidth = 1; ctx.stroke();
    // land
    if (land) {
      const kb = anim ? Math.max(0, Math.min(1, (anim.p - 0.4) / 0.6)) : 0;
      ctx.beginPath(); path(land); ctx.fillStyle = kb ? mixRgb(hexRgb(COL.land), FLAT.land, kb) : COL.land; ctx.fill();
      ctx.strokeStyle = COL.coast; ctx.lineWidth = 0.7; ctx.stroke();
      if (landAt == null) { landAt = performance.now(); window.__heroLandAt = landAt; listeners.land.forEach((f) => f()); }
    }
    // cables: a wide faint pass + a thin bright pass reads as glow without shadowBlur
    for (const [kind, a1, a2] of [['telecom', 0.16, 0.75], ['power', 0.14, 0.7], ['pipeline', 0.14, 0.7]]) {
      const set = cables.filter((c) => c.kind === kind); if (!set.length) continue;
      ctx.beginPath(); for (const c of set) path(c.geom);
      ctx.strokeStyle = COL[kind] + a1 + ')'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = COL[kind] + a2 + ')'; ctx.lineWidth = 0.8; ctx.stroke();
    }
    // ships + incidents (only on the visible hemisphere)
    const vis = (lon, lat) => { const p = proj([lon, lat]); if (!p) return null; const d = Math.hypot(p[0] - x, p[1] - y); return d <= r ? p : null; };
    const sz = Math.max(1, Math.min(2.4, r / 420));
    for (const s of ships) {
      const p = vis(s.lon, s.lat); if (!p) continue;
      ctx.fillStyle = s.level ? COL.alert : s.watch ? COL.listed : COL.ship;
      ctx.beginPath(); ctx.arc(p[0], p[1], s.level || s.watch ? sz * 1.4 : sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = COL.incident; ctx.lineWidth = 1.2;
    for (const i of incidents) {
      const p = vis(i.lon, i.lat); if (!p) continue; const d = 4 + sz;
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - d); ctx.lineTo(p[0] + d, p[1]); ctx.lineTo(p[0], p[1] + d); ctx.lineTo(p[0] - d, p[1]); ctx.closePath(); ctx.stroke();
    }
    // God's Eye View tick ring with degree labels (fades out during the swoop)
    if (fade > 0) {
      const rr = r * 1.075; ctx.lineWidth = 1;
      ctx.strokeStyle = COL.ring + (0.35 * fade) + ')'; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      const spin = drift * 0.15;
      ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 3) {
        const a = ((d - 90) * Math.PI) / 180 + spin, long = d % 30 === 0;
        const r1 = rr + 3, r2 = rr + (long ? 12 : d % 15 === 0 ? 8 : 5);
        ctx.strokeStyle = COL.ring + ((long ? 0.45 : 0.16) * fade) + ')';
        ctx.beginPath(); ctx.moveTo(x + r1 * Math.cos(a), y + r1 * Math.sin(a)); ctx.lineTo(x + r2 * Math.cos(a), y + r2 * Math.sin(a)); ctx.stroke();
        // (degree labels omitted: Clarity-style restraint, ticks only)
      }
      // bracketed coordinate annotation pinned on a live point (an alerted ship when there is one)
      const tgt = focus.length ? focus[Math.floor(drift / 3.2) % focus.length] : { lon: 24.7536, lat: 59.437 };
      const p = vis(tgt.lon, tgt.lat);
      if (p) {
        const bw = 46, bh = 30, bx = p[0] - bw / 2, by = p[1] - bh / 2, c = 6;
        ctx.globalAlpha = fade; ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.4; ctx.beginPath();
        for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) { ctx.moveTo(cx, cy + dy * c); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * c, cy); }
        ctx.stroke();
        const lat = `${Math.abs(tgt.lat).toFixed(4)}${tgt.lat >= 0 ? 'N' : 'S'}`, lon = `${String(Math.abs(tgt.lon).toFixed(4)).padStart(8, '0')}${tgt.lon >= 0 ? 'E' : 'W'}`;
        ctx.font = '400 9.5px "BSW Mono", "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(`${lat} ${lon}`, bx, by - 5);
        ctx.globalAlpha = 1;
      }
    }
  }

  function frame(t) {
    raf = 0; if (!alive) return;
    const dt = last ? Math.min(64, t - last) : 16; last = t;
    if (anim) {
      anim.p = Math.min(1, (t - anim.t0) / anim.dur);
      const k = ease(anim.p);
      const b = { x: anim.from.x + (anim.to.x - anim.from.x) * k, y: anim.from.y + (anim.to.y - anim.from.y) * k, r: anim.from.r * Math.pow(anim.to.r / anim.from.r, k) };
      const c = anim.interp(k);
      apply(b, [-c[0], -c[1], 0]);
      draw();
      if (anim.p >= 1) { const done = anim.done; anim = null; done?.(); return; }
    } else if (!reduced) {
      drift += dt / 1000;
      rot = [-CENTER[0] - Math.sin(drift * 0.12) * 6, -CENTER[1] + Math.sin(drift * 0.07) * 1.5, 0]; // slow sway, Baltic stays in view
      apply(base, rot); draw();
    }
    raf = requestAnimationFrame(frame);
  }

  /** Swoop into `rect` (viewport px) so that lon/lat `box` fills it like the flat map's initial view. */
  function swoop(rect, box, { duration = 1400, pad = 0, clip = false, done } = {}) {
    if (raf) cancelAnimationFrame(raf), (raf = 0);
    const c = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
    const tmp = geoOrthographic().clipAngle(90).rotate([-c[0], -c[1], 0]);
    const cr = canvas.getBoundingClientRect();
    const ext = [[rect.left - cr.left + pad, rect.top - cr.top + pad], [rect.right - cr.left - pad, rect.bottom - cr.top - pad]];
    tmp.fitExtent(ext, { type: 'MultiPoint', coordinates: [box[0], [box[1][0], box[0][1]], box[1], [box[0][0], box[1][1]], c] });
    const [tx, ty] = tmp.translate();
    // the projection of the centre is the frame point the box centre lands on
    const target = { x: tx, y: ty, r: tmp.scale() };
    const from = { x: proj.translate()[0], y: proj.translate()[1], r: proj.scale() };
    const fromC = [-proj.rotate()[0], -proj.rotate()[1]];
    if (reduced || duration <= 0) { apply(target, [-c[0], -c[1], 0]); draw(); done?.(); return; }
    const clipRect = clip ? [rect.left - cr.left, rect.top - cr.top, rect.width, rect.height] : null;
    anim = { t0: performance.now(), dur: duration, from, to: target, interp: geoInterpolate(fromC, c), p: 0, done, clip: clipRect };
    last = 0; raf = requestAnimationFrame(frame);
  }

  function setInfra(features) {
    cables = features.map((f) => ({ kind: f.properties.kind, geom: f.geometry })).filter((c) => c.kind === 'telecom' || c.kind === 'power' || c.kind === 'pipeline');
    if (!raf) draw();
  }
  function setFocusShips(list) { focus = list.slice(0, 8).map((v) => ({ lon: v.lon, lat: v.lat })); }
  function setVessels(list) { ships = list.filter((v) => v.lat != null); if (!raf) draw(); }
  function setIncidents(list) { incidents = list.filter((i) => i.lat != null); if (!raf) draw(); }
  function setLand(polys) {
    const fix = (p) => (geoArea({ type: 'Polygon', coordinates: p }) > 2 * Math.PI ? p.map((r) => r.slice().reverse()) : p);
    land = { type: 'MultiPolygon', coordinates: polys.map(fix) };
    if (!raf) draw();
  }
  function destroy() { alive = false; if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', layout); }

  window.addEventListener('resize', layout);
  layout();
  if (landUrl) {
    fetch(landUrl, { priority: 'high' }).then((r) => r.json()).then((d) => setLand(d.polys)).catch(() => {});
  }
  if (!reduced) raf = requestAnimationFrame(frame);
  return { setFocusShips, setInfra, setVessels, setIncidents, setLand, swoop, destroy, layout, on: (ev, f) => listeners[ev].push(f), get landAt() { return landAt; } };
}

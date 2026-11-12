// Vector basemap: land/sea drawn into canvas tiles so the map stays crisp at every zoom.
// Natural Earth 10m inside the Baltic box, 50m elsewhere (public domain, via world-atlas).
import * as Cesium from 'cesium';
import { PLACES, sp } from './places.js';
export { PLACES };

export const MAP = {
  sea: '#03090e',
  seaDeep: '#02060a',
  land: '#1f2e38',
  landDot: 'rgba(140, 200, 210, 0.075)',
  coast: 'rgba(96, 204, 218, 0.62)',
  coastGlow: 'rgba(83, 240, 201, 0.35)',
  border: 'rgba(132, 168, 178, 0.32)',
  grat: 'rgba(80, 150, 170, 0.07)',
  gratMajor: 'rgba(80, 150, 170, 0.12)',
};

function prep(polys) {
  return polys.map((rings) => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { rings, bb: [x0, y0, x1, y1] };
  });
}
function prepLines(lines) {
  return (lines || []).map((l) => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of l) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { l, bb: [x0, y0, x1, y1] };
  });
}
const hit = (bb, w, s, e, n) => !(bb[2] < w || bb[0] > e || bb[3] < s || bb[1] > n);

export class VectorMapProvider {
  constructor(land, borders) {
    this.tilingScheme = new Cesium.GeographicTilingScheme();
    this.tileWidth = 256;
    this.tileHeight = 256;
    this.minimumLevel = 0;
    this.maximumLevel = 15;
    this.rectangle = this.tilingScheme.rectangle;
    this.errorEvent = new Cesium.Event();
    this.credit = new Cesium.Credit('Natural Earth');
    this.hasAlphaChannel = false;
    this.tileDiscardPolicy = undefined;
    this.proxy = undefined;
    this.ready = true;
    this.readyPromise = Promise.resolve(true);
    this.box = land.box;
    this.region = prep(land.region);
    this.world = prep(land.world);
    this.borders = prepLines(borders);
  }
  getTileCredits() { return undefined; }
  pickFeatures() { return undefined; }
  requestImage(x, y, level) {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    const w = Cesium.Math.toDegrees(r.west), e = Cesium.Math.toDegrees(r.east);
    const s = Cesium.Math.toDegrees(r.south), n = Cesium.Math.toDegrees(r.north);
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const px = (lon) => ((lon - w) / (e - w)) * S;
    const py = (lat) => ((n - lat) / (n - s)) * S;

    // sea: faint vertical gradient so the water has depth
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, MAP.sea); grad.addColorStop(1, MAP.seaDeep);
    g.fillStyle = grad; g.fillRect(0, 0, S, S);

    // graticule (skipped on the coarsest tiles, which get stretched)
    const span = e - w;
    if (level >= 2) {
    const step = span > 40 ? 10 : span > 8 ? 5 : span > 1.5 ? 1 : 0.5;
    g.lineWidth = 1;
    for (let lon = Math.ceil(w / step) * step; lon <= e; lon += step) {
      g.strokeStyle = lon % 5 === 0 ? MAP.gratMajor : MAP.grat;
      g.beginPath(); g.moveTo(Math.round(px(lon)) + 0.5, 0); g.lineTo(Math.round(px(lon)) + 0.5, S); g.stroke();
    }
    for (let lat = Math.ceil(s / step) * step; lat <= n; lat += step) {
      g.strokeStyle = lat % 5 === 0 ? MAP.gratMajor : MAP.grat;
      g.beginPath(); g.moveTo(0, Math.round(py(lat)) + 0.5); g.lineTo(S, Math.round(py(lat)) + 0.5); g.stroke();
    }
    }

    const [bx0, by0, bx1, by1] = this.box;
    const insideBox = w >= bx0 && e <= bx1 && s >= by0 && n <= by1;
    const touchesBox = hit([bx0, by0, bx1, by1], w, s, e, n);
    const pad = (e - w) * 0.02;

    const path = (list) => {
      g.beginPath();
      let any = false;
      for (const p of list) {
        if (!hit(p.bb, w - pad, s - pad, e + pad, n + pad)) continue;
        any = true;
        for (const ring of p.rings) {
          g.moveTo(px(ring[0][0]), py(ring[0][1]));
          for (let i = 1; i < ring.length; i++) g.lineTo(px(ring[i][0]), py(ring[i][1]));
          g.closePath();
        }
      }
      return any;
    };
    const paintLand = (list, coastW) => {
      if (!path(list)) return;
      g.fillStyle = MAP.land; g.fill('evenodd');
      // tactical dot-grid texture on land (tile-aligned so it is seamless)
      if (level >= 4) {
        g.save(); g.clip('evenodd');
        g.fillStyle = MAP.landDot;
        const st = level >= 8 ? 8 : 6;
        for (let yy = st / 2; yy < S; yy += st) for (let xx = st / 2; xx < S; xx += st) g.fillRect(xx, yy, 1, 1);
        g.restore();
        path(list);
      }
      g.save();
      if (level >= 5) { g.shadowColor = MAP.coastGlow; g.shadowBlur = 4; }
      g.strokeStyle = MAP.coast; g.lineWidth = coastW; g.lineJoin = 'round';
      g.stroke();
      g.restore();
    };

    // world (coarse) everywhere except inside the high-res box
    if (!insideBox) {
      g.save();
      if (touchesBox) {
        g.beginPath();
        g.rect(0, 0, S, S);
        g.rect(px(bx0), py(by1), px(bx1) - px(bx0), py(by0) - py(by1));
        g.clip('evenodd');
      }
      paintLand(this.world, 0.8);
      g.restore();
    }
    if (touchesBox) {
      g.save();
      if (!insideBox) { g.beginPath(); g.rect(px(bx0), py(by1), px(bx1) - px(bx0), py(by0) - py(by1)); g.clip(); }
      paintLand(this.region, level >= 7 ? 1.3 : 1);
      g.restore();
    }

    // borders: hairline dashes
    g.save();
    g.strokeStyle = MAP.border; g.lineWidth = level >= 6 ? 1 : 0.7; g.setLineDash(level >= 6 ? [4, 3] : [2, 2]);
    g.beginPath();
    for (const b of this.borders) {
      if (!hit(b.bb, w - pad, s - pad, e + pad, n + pad)) continue;
      g.moveTo(px(b.l[0][0]), py(b.l[0][1]));
      for (let i = 1; i < b.l.length; i++) g.lineTo(px(b.l[i][0]), py(b.l[i][1]));
    }
    g.stroke();
    g.restore();
    return Promise.resolve(c);
  }
}


const STYLE = {
  sea: { font: 'italic 500 13px Inter, system-ui, sans-serif', color: 'rgba(120, 190, 210, 0.62)', spaced: true },
  gulf: { font: 'italic 500 11px Inter, system-ui, sans-serif', color: 'rgba(120, 190, 210, 0.55)', spaced: true },
  country: { font: '600 10.5px "JetBrains Mono", ui-monospace, monospace', color: 'rgba(186, 204, 212, 0.5)', spaced: true },
  city: { font: '500 11px Inter, system-ui, sans-serif', color: 'rgba(206, 222, 228, 0.82)', dot: true },
  port: { font: '500 10px Inter, system-ui, sans-serif', color: 'rgba(170, 196, 204, 0.7)', dot: true },
};

export function addPlaceLabels(scene, declutter) {
  const labels = scene.primitives.add(new Cesium.LabelCollection());
  const dots = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  for (const [text, lon, lat, kind, min, max, pri] of PLACES) {
    const st = STYLE[kind];
    const shown = st.spaced ? sp(text) : text;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 200);
    const lab = labels.add({
      position: pos,
      text: shown,
      font: st.font,
      fillColor: Cesium.Color.fromCssColorString(st.color),
      outlineColor: Cesium.Color.fromCssColorString('#02070b').withAlpha(0.9),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: st.dot ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: st.dot ? new Cesium.Cartesian2(7, 0) : Cesium.Cartesian2.ZERO,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    });
    let dot = null;
    if (st.dot) dot = dots.add({ position: pos, pixelSize: kind === 'city' ? 4 : 3, color: Cesium.Color.fromCssColorString(kind === 'city' ? '#9ec3cc' : '#6f99a3'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, show: false });
    declutter.add({ label: lab, dot, pos, min, max, pri, chars: shown.length, size: parseFloat(st.font.match(/(\d+(?:\.\d+)?)px/)[1]), align: st.dot ? 'left' : 'center', dx: st.dot ? 7 : 0 });
  }
  return { labels, dots };
}

// ---- screen-space label collision ---------------------------------------------------
// Greedy by priority; labels already on screen get a bonus so they don't flicker.
export function createDeclutter(scene) {
  const items = [];
  const toWin = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  const scratch = new Cesium.Cartesian2();
  let enabled = true;
  let reserved = () => [];
  function add(it) { it.on = false; it.group = it.group || 'map'; items.push(it); return it; }
  function remove(pred) { for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) items.splice(i, 1); }
  function run() {
    const cam = scene.camera.positionWC;
    const occ = new Cesium.EllipsoidalOccluder(scene.globe.ellipsoid, cam);
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const cand = [];
    for (const it of items) {
      let ok = enabled && it.visible !== false;
      let rect = null;
      if (ok) {
        const d = Cesium.Cartesian3.distance(cam, it.pos);
        ok = d >= it.min && d <= it.max && occ.isPointVisible(it.pos);
      }
      if (ok) {
        const c = toWin(scene, it.pos, scratch);
        if (!c) ok = false;
        else {
          const wPx = it.chars * it.size * 0.62 + 6, hPx = it.size + 6;
          const x0 = it.align === 'left' ? c.x + (it.dx || 0) - 6 : it.align === 'right' ? c.x - (it.dx || 0) - wPx : c.x - wPx / 2;
          rect = [x0, c.y - hPx / 2, x0 + wPx, c.y + hPx / 2];
          if (rect[2] < 0 || rect[0] > W || rect[3] < 0 || rect[1] > H) ok = false;
        }
      }
      if (ok) cand.push({ it, rect, score: it.pri + (it.on ? 8 : 0) });
      else it.on = false;
    }
    cand.sort((a, b) => b.score - a.score);
    let placed = [];
    try { placed = reserved() || []; } catch { placed = []; }
    for (const c of cand) {
      const [a0, b0, a1, b1] = c.rect;
      const clash = placed.some(([x0, y0, x1, y1]) => a0 < x1 && a1 > x0 && b0 < y1 && b1 > y0);
      // keep labels inside the canvas so they never get sliced by its edge
      const clip = a0 < 2 || b0 < 2 || a1 > W - 2 || b1 > H - 2;
      if (clip && c.it.group !== 'incident') { c.it.on = false; continue; }
      c.it.on = !clash;
      if (!clash) placed.push(c.rect);
    }
    for (const it of items) {
      if (it.label) it.label.show = it.on;
      if (it.dot) it.dot.show = it.on;
      if (it.onChange) it.onChange(it.on);
    }
  }
  return { add, remove, run, each: (f) => items.forEach(f), setEnabled: (v) => { enabled = v; }, setReserved: (f) => { reserved = f; } };
}

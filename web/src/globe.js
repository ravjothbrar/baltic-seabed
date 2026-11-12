import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { VectorMapProvider, addPlaceLabels, createDeclutter } from './basemap.js';

const C = Cesium.Color;
const COL = {
  telecom: C.fromCssColorString('#3fd8ff'),
  power: C.fromCssColorString('#a98bff'),
  pipeline: C.fromCssColorString('#ffb547'),
  vessel: C.fromCssColorString('#cfe9e6'),
  vesselSlow: C.fromCssColorString('#7fa7a3'),
  watch: C.fromCssColorString('#ff5fd2'),
  WATCH: C.fromCssColorString('#5cc8ff'),
  ELEVATED: C.fromCssColorString('#ffb547'),
  HIGH: C.fromCssColorString('#ff4d5e'),
  mint: C.fromCssColorString('#53f0c9'),
  red: C.fromCssColorString('#ff4d5e'),
  glider: C.fromCssColorString('#53f0c9'),
};

export const REGIONS = {
  BALTIC: { lon: 20.2, lat: 57.6, range: 1500000, pitch: -52 },
  'GULF OF FINLAND': { lon: 25.4, lat: 59.75, range: 380000, pitch: -48 },
  'ÅLAND': { lon: 20.2, lat: 60.0, range: 300000, pitch: -50 },
  GOTLAND: { lon: 18.6, lat: 57.3, range: 380000, pitch: -50 },
  BORNHOLM: { lon: 14.9, lat: 55.2, range: 240000, pitch: -50 },
  'DANISH STRAITS': { lon: 11.6, lat: 55.7, range: 330000, pitch: -50 },
};

function canvasIcon(draw, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return c;
}

const ICON_DIAMOND = canvasIcon((g, s) => {
  g.translate(s / 2, s / 2);
  g.rotate(Math.PI / 4);
  g.shadowColor = '#ff4d5e';
  g.shadowBlur = 8;
  g.strokeStyle = '#ff4d5e';
  g.lineWidth = 2;
  g.strokeRect(-6, -6, 12, 12);
  g.fillStyle = 'rgba(255,77,94,0.35)';
  g.fillRect(-6, -6, 12, 12);
});

const ICON_GLIDER = canvasIcon((g, s) => {
  g.translate(s / 2, s / 2);
  g.shadowColor = '#53f0c9';
  g.shadowBlur = 6;
  g.fillStyle = '#53f0c9';
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(5, 6);
  g.lineTo(0, 3);
  g.lineTo(-5, 6);
  g.closePath();
  g.fill();
}, 24);

function shortTitle(t = '') {
  const s = t.split(/[,(]| cable| pipeline/i)[0].trim();
  return (s.length > 26 ? s.slice(0, 25) + '…' : s).toUpperCase();
}

function densify(coords, maxKm = 15) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    if (i > 0) {
      const [plon, plat] = coords[i - 1];
      const d = kmBetween(plon, plat, lon, lat);
      const n = Math.floor(d / maxKm);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([plon + (lon - plon) * t, plat + (lat - plat) * t]);
      }
    }
    out.push([lon, lat]);
  }
  return out;
}

export function kmBetween(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function createGlobe(container) {
  Cesium.Ion.defaultAccessToken = undefined;

  // Keyless, self-hosted base: Natural Earth II imagery bundled with Cesium (darkened),
  // with crisp vector coastlines/borders drawn on top (see setCoast).
  const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
    {},
  );

  const viewer = new Cesium.Viewer(container, {
    baseLayer,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    requestRenderMode: false,
    msaaSamples: 4,
    contextOptions: { webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true } },
  });

  const scene = viewer.scene;
  const globe = scene.globe;
  const base = viewer.imageryLayers.get(0);
  base.brightness = 0.4;
  base.contrast = 1.4;
  base.saturation = 0.18;
  base.hue = 0.0;
  base.gamma = 1.2;

  globe.baseColor = C.fromCssColorString('#02070a');
  globe.showGroundAtmosphere = true;
  globe.atmosphereLightIntensity = 9;
  globe.atmosphereHueShift = 0.02;
  globe.atmosphereBrightnessShift = -0.15;
  globe.enableLighting = false;
  globe.depthTestAgainstTerrain = false;
  globe.maximumScreenSpaceError = 1.6;
  globe.tileCacheSize = 400;
  scene.skyAtmosphere.show = true;
  scene.skyAtmosphere.hueShift = 0.02;
  scene.skyAtmosphere.saturationShift = 0.15;
  scene.skyAtmosphere.brightnessShift = 0.05;
  scene.backgroundColor = C.fromCssColorString('#010203');
  scene.fog.enabled = true;
  scene.fog.density = 0.00012;
  scene.sun.show = false;
  scene.moon.show = false;
  if (scene.skyBox) scene.skyBox.show = true;
  scene.highDynamicRange = false;

  const bloom = scene.postProcessStages.bloom;
  bloom.enabled = true;
  bloom.uniforms.glowOnly = false;
  bloom.uniforms.contrast = 119;
  bloom.uniforms.brightness = -0.35;
  bloom.uniforms.delta = 1.0;
  bloom.uniforms.sigma = 2.6;
  bloom.uniforms.stepSize = 1.0;
  scene.postProcessStages.fxaa.enabled = true;

  const ssc = scene.screenSpaceCameraController;
  ssc.minimumZoomDistance = 8000;
  ssc.maximumZoomDistance = 40000000;
  ssc.inertiaSpin = 0.85;

  // ---- collections ----
  const infraLines = { telecom: new Cesium.PolylineCollection(), power: new Cesium.PolylineCollection(), pipeline: new Cesium.PolylineCollection() };
  Object.values(infraLines).forEach((c) => scene.primitives.add(c));
  const coastLines = scene.primitives.add(new Cesium.PolylineCollection());
  const infraLabels = scene.primitives.add(new Cesium.LabelCollection());
  const vesselTicks = scene.primitives.add(new Cesium.PolylineCollection());
  const vesselPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }));
  const pulsePoints = scene.primitives.add(new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }));
  const incidentBB = scene.primitives.add(new Cesium.BillboardCollection());
  const incidentLabels = scene.primitives.add(new Cesium.LabelCollection());
  const gliderBB = scene.primitives.add(new Cesium.BillboardCollection());
  let gliderDiscs = null;
  let gliderRings = null;

  const declutter = createDeclutter(scene);
  addPlaceLabels(scene, declutter);

  const vessels = new Map(); // mmsi -> {pt, tick, pulse, v}
  const layerVis = { telecom: true, power: true, pipeline: true, vessels: true, incidents: true, gliders: true };
  const listeners = { pick: [], hover: [], camera: [] };

  const height = 400;

  // ---- basemap: vector land/sea tiles (crisp at any zoom) over the raster earth ----
  let coastData = null;
  let landData = null;
  let vectorLayer = null;
  function buildVector() {
    if (!landData) return;
    if (vectorLayer) viewer.imageryLayers.remove(vectorLayer, true);
    vectorLayer = new Cesium.ImageryLayer(new VectorMapProvider(landData, coastData?.borders || []), { alpha: 0 });
    viewer.imageryLayers.add(vectorLayer);
    coastLines.removeAll();
  }
  function setLand(data) { landData = data; buildVector(); }
  function setCoast(data) {
    coastData = data;
    if (landData) { buildVector(); return; }
    coastLines.removeAll();
    if (!data) return;
    const add = (lines, color, width, h = 60) => {
      for (const l of lines || []) {
        if (l.length < 2) continue;
        coastLines.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(l.flatMap(([x, y]) => [x, y, h])), width, material: Cesium.Material.fromType('Color', { color }) });
      }
    };
    add(data.coastWorld, C.fromCssColorString('#4fb8c8').withAlpha(0.42), 1.0);
    add(data.coastRegion, C.fromCssColorString('#6fd6e0').withAlpha(0.55), 1.2);
    add(data.borders, C.fromCssColorString('#3c6f78').withAlpha(0.35), 0.8);
  }

  // ---- infra ----
  function setInfra(fc) {
    Object.values(infraLines).forEach((c) => c.removeAll());
    infraLabels.removeAll();
    declutter.remove((it) => it.group === 'infra');
    if (!fc || !fc.features) return;
    const labelled = new Set();
    for (const f of fc.features) {
      const p = f.properties || {};
      const kind = p.kind in infraLines ? p.kind : 'telecom';
      const g = f.geometry;
      if (!g) continue;
      const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
      const color = COL[kind];
      for (const part of parts) {
        if (!part || part.length < 2) continue;
        const pts = densify(part);
        const positions = Cesium.Cartesian3.fromDegreesArrayHeights(pts.flatMap(([x, y]) => [x, y, height]));
        infraLines[kind].add({
          positions,
          width: p.named ? 3.4 : 1.7,
          material: Cesium.Material.fromType('PolylineGlow', {
            color: color.withAlpha(p.named ? 0.95 : 0.5),
            glowPower: p.named ? 0.2 : 0.12,
            taperPower: 1.0,
          }),
          id: { kind: 'infra', name: p.name, infraKind: kind, named: !!p.named },
        });
        if (p.named && p.name && !labelled.has(p.name)) {
          labelled.add(p.name);
          const mid = pts[Math.floor(pts.length / 2)];
          const text = p.name.toUpperCase();
          const lab = infraLabels.add({
            position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1], height),
            text,
            font: '500 9px "JetBrains Mono", monospace',
            fillColor: color.withAlpha(0.8),
            outlineColor: C.BLACK.withAlpha(0.9),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(8, -6),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            show: false,
            id: { kind: 'infra', name: p.name, infraKind: kind, named: true },
          });
          declutter.add({ group: 'infra', kind, label: lab, pos: lab.position, min: 0, max: 9e5, pri: 50, chars: text.length, size: 9, align: 'left', dx: 8 });
        }
      }
    }
    applyVis();
  }

  // ---- incidents ----
  function setIncidents(list) {
    incidentBB.removeAll();
    incidentLabels.removeAll();
    declutter.remove((it) => it.group === 'incident');
    const sorted = [...(list || [])].sort((a, b) => (a.lat || 0) - (b.lat || 0));
    sorted.forEach((inc, idx) => {
      if (typeof inc.lat !== 'number' || typeof inc.lon !== 'number') return;
      const left = idx % 2 === 1;
      const pos = Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat, 600);
      incidentBB.add({ position: pos, image: ICON_DIAMOND, scale: 1, id: { kind: 'incident', id: inc.id } });
      const lab = incidentLabels.add({
        position: pos,
        text: left
          ? `${inc.vessel?.name ? inc.vessel.name.toUpperCase() : shortTitle(inc.title)}  ${(inc.date || '').slice(0, 7)}`
          : `${(inc.date || '').slice(0, 7)}  ${inc.vessel?.name ? inc.vessel.name.toUpperCase() : shortTitle(inc.title)}`,
        font: '600 9.5px "JetBrains Mono", monospace',
        fillColor: COL.red.withAlpha(0.95),
        outlineColor: C.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(left ? -12 : 12, 0),
        horizontalOrigin: left ? Cesium.HorizontalOrigin.RIGHT : Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        show: false,
        id: { kind: 'incident', id: inc.id },
      });
      declutter.add({ group: 'incident', label: lab, pos, min: 0, max: 2.6e6, pri: 96, chars: lab.text.length, size: 9.5, align: left ? 'right' : 'left', dx: 12 });
    });
    applyVis();
  }

  // ---- vessels ----
  let focus = null; // null | 'listed' | 'alerts' | 'corridor' | 'moving'
  const FOCUS = {
    listed: (v) => !!v.watch,
    alerts: (v) => !!v.level,
    corridor: (v) => !!v.corridor,
    moving: (v) => (v.sog || 0) > 0.6,
  };
  function vesselColor(v) {
    const c = baseColor(v);
    return focus && FOCUS[focus] && !FOCUS[focus](v) ? c.withAlpha(0.1) : c;
  }
  function setFocus(mode) {
    focus = mode && FOCUS[mode] ? mode : null;
    upsertVessels([...vessels.values()].map((e) => e.v));
  }
  function baseColor(v) {
    if (v.level && COL[v.level]) return COL[v.level];
    if (v.watch) return COL.watch;
    return (v.sog || 0) > 0.6 ? COL.vessel.withAlpha(0.85) : COL.vesselSlow.withAlpha(0.6);
  }
  function tickPositions(v) {
    const sog = v.sog || 0;
    const cog = typeof v.cog === 'number' && v.cog < 360 ? v.cog : (typeof v.hdg === 'number' && v.hdg < 360 ? v.hdg : null);
    if (sog < 0.6 || cog == null) return null;
    const km = Math.min(sog * 1.852 * 0.25, 9); // 15 min projection, capped
    const rad = (cog * Math.PI) / 180;
    const dLat = (km * Math.cos(rad)) / 110.57;
    const dLon = (km * Math.sin(rad)) / (111.32 * Math.cos((v.lat * Math.PI) / 180));
    return [Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 150), Cesium.Cartesian3.fromDegrees(v.lon + dLon, v.lat + dLat, 150)];
  }
  function upsertVessels(list) {
    for (const v of list) {
      if (typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
      let e = vessels.get(v.mmsi);
      const pos = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 150);
      const col = vesselColor(v);
      const flagged = !!(v.level || v.watch);
      const fm = focus && FOCUS[focus] && FOCUS[focus](v);
      const size = (v.level ? 8 : v.watch ? 6.5 : 3.6) + (fm ? 2.5 : 0);
      if (!e) {
        e = {
          pt: vesselPoints.add({ position: pos, color: col, pixelSize: size, outlineColor: C.BLACK.withAlpha(0.6), outlineWidth: flagged ? 1 : 0, id: { kind: 'vessel', mmsi: v.mmsi } }),
          tick: null,
          pulse: null,
          v,
        };
        vessels.set(v.mmsi, e);
      } else {
        e.pt.position = pos;
        e.pt.color = col;
        e.pt.pixelSize = size;
        e.pt.outlineWidth = flagged ? 1 : 0;
        e.v = v;
      }
      e.pt.show = layerVis.vessels;
      const tp = tickPositions(v);
      if (tp) {
        if (!e.tick) e.tick = vesselTicks.add({ positions: tp, width: flagged ? 1.6 : 1, material: Cesium.Material.fromType('Color', { color: col.withAlpha(flagged ? 0.9 : 0.45) }) });
        else {
          e.tick.positions = tp;
          e.tick.material.uniforms.color = col.withAlpha(flagged ? 0.9 : 0.45);
        }
        e.tick.show = layerVis.vessels;
      } else if (e.tick) {
        vesselTicks.remove(e.tick);
        e.tick = null;
      }
      if (v.level) {
        if (!e.pulse) e.pulse = pulsePoints.add({ position: pos, color: C.TRANSPARENT, outlineColor: col, outlineWidth: 1.5, pixelSize: 10, id: { kind: 'vessel', mmsi: v.mmsi } });
        else {
          e.pulse.position = pos;
          e.pulse.outlineColor = col;
        }
        e.pulse.show = layerVis.vessels;
      } else if (e.pulse) {
        pulsePoints.remove(e.pulse);
        e.pulse = null;
      }
    }
  }
  function removeVessels(ids) {
    for (const id of ids) {
      const e = vessels.get(id);
      if (!e) continue;
      vesselPoints.remove(e.pt);
      if (e.tick) vesselTicks.remove(e.tick);
      if (e.pulse) pulsePoints.remove(e.pulse);
      vessels.delete(id);
    }
  }

  // ---- track ----
  let trackEnt = null;
  let trackDots = null;
  function showTrack(track, level) {
    clearTrack();
    if (!track || track.length < 2) return;
    const col = level && COL[level] ? COL[level] : COL.mint;
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(track.flatMap((t) => [t[0], t[1], 220]));
    trackEnt = viewer.entities.add({
      polyline: { positions, width: 3.5, material: new Cesium.PolylineGlowMaterialProperty({ color: col.withAlpha(0.95), glowPower: 0.25 }) },
    });
    trackDots = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const step = Math.max(1, Math.floor(track.length / 40));
    track.forEach((t, i) => {
      if (i % step) return;
      trackDots.add({ position: Cesium.Cartesian3.fromDegrees(t[0], t[1], 230), pixelSize: 3, color: col.withAlpha(0.8) });
    });
  }
  function clearTrack() {
    if (trackEnt) viewer.entities.remove(trackEnt);
    if (trackDots) scene.primitives.remove(trackDots);
    trackEnt = null;
    trackDots = null;
  }

  // ---- gliders (simulation) ----
  let gliders = [];
  function setGliders(list, rKm) {
    gliderBB.removeAll();
    if (gliderDiscs) scene.primitives.remove(gliderDiscs);
    if (gliderRings) scene.primitives.remove(gliderRings);
    gliderDiscs = gliderRings = null;
    gliders = (list || []).map(([lon, lat], i) => {
      const phase = (i * 2.399) % (Math.PI * 2);
      const head = (i * 1.7) % Math.PI;
      const bb = gliderBB.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 300), image: ICON_GLIDER, scale: 0.75, id: { kind: 'glider', i }, show: layerVis.gliders });
      return { lon, lat, phase, head, bb };
    });
    if (!gliders.length) return;
    const r = rKm * 1000;
    const discInst = [];
    const ringInst = [];
    for (const g of gliders) {
      const center = Cesium.Cartesian3.fromDegrees(g.lon, g.lat);
      discInst.push(new Cesium.GeometryInstance({
        geometry: new Cesium.CircleGeometry({ center, radius: r, height: 80, granularity: Cesium.Math.toRadians(2) }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(COL.glider.withAlpha(0.07)) },
      }));
      ringInst.push(new Cesium.GeometryInstance({
        geometry: new Cesium.CircleOutlineGeometry({ center, radius: r, height: 90, granularity: Cesium.Math.toRadians(2) }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(COL.glider.withAlpha(0.35)) },
      }));
    }
    gliderDiscs = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: discInst,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: false, flat: true }),
      asynchronous: true,
      show: layerVis.gliders,
    }));
    gliderRings = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: ringInst,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, flat: true, renderState: { lineWidth: 1 } }),
      asynchronous: true,
      show: layerVis.gliders,
    }));
  }

  let taskEnt = null;
  function setTasking(alert) {
    if (taskEnt) { viewer.entities.remove(taskEnt); taskEnt = null; }
    if (!alert || !gliders.length || typeof alert.lat !== 'number') return null;
    let best = null;
    for (const g of gliders) {
      const d = kmBetween(alert.lon, alert.lat, g.lon, g.lat);
      if (!best || d < best.d) best = { g, d };
    }
    if (!best) return null;
    const etaH = best.d / (1.5 * 1.852);
    const a = Cesium.Cartesian3.fromDegrees(alert.lon, alert.lat, 500);
    const b = Cesium.Cartesian3.fromDegrees(best.g.lon, best.g.lat, 500);
    const mid = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3());
    taskEnt = viewer.entities.add({
      position: mid,
      polyline: { positions: [a, b], width: 2, material: new Cesium.PolylineDashMaterialProperty({ color: COL.mint, dashLength: 12 }) },
      label: {
        text: `NEAREST GLIDER ${best.d.toFixed(1)} KM · ETA ~${etaH < 1 ? '<1' : etaH.toFixed(1)} H @1.5 KN (SIM)`,
        font: '600 10px "JetBrains Mono", monospace',
        fillColor: COL.mint,
        outlineColor: C.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        showBackground: true,
        backgroundColor: C.fromCssColorString('#020809').withAlpha(0.85),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    return { km: best.d, etaH };
  }

  // ---- visibility ----
  function applyVis() {
    infraLines.telecom.show = layerVis.telecom;
    infraLines.power.show = layerVis.power;
    infraLines.pipeline.show = layerVis.pipeline;
    declutter.each((it) => {
      if (it.group === 'infra') it.visible = layerVis[it.kind] !== false;
      if (it.group === 'incident') it.visible = layerVis.incidents;
    });
    incidentBB.show = layerVis.incidents;
    declutter.run();
    vesselPoints.show = vesselTicks.show = pulsePoints.show = layerVis.vessels;
    gliderBB.show = layerVis.gliders;
    if (gliderDiscs) gliderDiscs.show = layerVis.gliders;
    if (gliderRings) gliderRings.show = layerVis.gliders;
  }
  function setLayer(name, on) {
    layerVis[name] = on;
    applyVis();
  }

  // ---- camera ----
  function look(lon, lat, range, pitchDeg, duration = 2.2, headingDeg = 0) {
    const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 0), 1);
    const offset = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(headingDeg), Cesium.Math.toRadians(pitchDeg), range);
    if (duration === 0) {
      viewer.camera.viewBoundingSphere(sphere, offset);
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } else {
      viewer.camera.flyToBoundingSphere(sphere, { offset, duration, easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT });
    }
  }
  function aspectFactor() {
    const a = scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight);
    return a < 1 ? Math.min(2.1, 0.92 / a) : 1;
  }
  function flyRegion(name, duration) {
    const r = REGIONS[name];
    if (r) look(r.lon, r.lat - (aspectFactor() > 1 ? 1.2 : 0), r.range * aspectFactor(), r.pitch, duration);
  }
  function flyPoint(lon, lat, range = 160000, duration = 1.8) {
    look(lon, lat, range, -55, duration);
  }
  let spinning = false;
  function heroStart() {
    // whole-earth view, Baltic slightly above centre, slow spin
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(10, 44, 17500000) });
    // offset the globe from the headline: right on desktop, up on portrait phones
    const portrait = scene.canvas.clientHeight > scene.canvas.clientWidth;
    if (portrait) viewer.camera.lookDown(Cesium.Math.toRadians(11.5));
    else viewer.camera.lookLeft(Cesium.Math.toRadians(9.2));
    spinning = true;
  }
  function heroEnd(onDone) {
    spinning = false;
    const r = REGIONS.BALTIC;
    const f = aspectFactor();
    const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(r.lon, r.lat - (f > 1 ? 1.2 : 0), 0), 1);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(r.pitch), r.range * f),
      duration: 4.2,
      easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT,
      complete: onDone,
    });
  }

  // ---- picking ----
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  let hoverQueued = null;
  handler.setInputAction((m) => {
    hoverQueued = m.endPosition;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((m) => {
    const p = scene.pick(m.position);
    const id = p && p.id && p.id.kind ? p.id : null;
    listeners.pick.forEach((f) => f(id, m.position));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---- per-frame animation ----
  const t0 = performance.now();
  let lastCam = 0;
  let lastDeclutter = 0;
  scene.preRender.addEventListener(() => {
    const t = (performance.now() - t0) / 1000;
    if (spinning) viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0009);
    // alert pulses
    const ph = (t % 1.6) / 1.6;
    for (let i = 0; i < pulsePoints.length; i++) {
      const p = pulsePoints.get(i);
      p.pixelSize = 10 + ph * 26;
      p.outlineColor = p.outlineColor.withAlpha(0.9 * (1 - ph));
    }
    // incident pulse
    const s = 1 + 0.18 * Math.sin(t * 3.2);
    for (let i = 0; i < incidentBB.length; i++) incidentBB.get(i).scale = s;
    // gliders racetrack drift (~90 s loop)
    for (const g of gliders) {
      const a = t * 0.07 + g.phase;
      const along = Math.cos(a) * 2.4;
      const across = Math.sin(a) * 0.8;
      const dx = along * Math.cos(g.head) - across * Math.sin(g.head);
      const dy = along * Math.sin(g.head) + across * Math.cos(g.head);
      g.bb.position = Cesium.Cartesian3.fromDegrees(g.lon + dx / (111.32 * Math.cos((g.lat * Math.PI) / 180)), g.lat + dy / 110.57, 300);
      g.bb.rotation = -(Math.atan2(-Math.sin(a) * 0.8, -Math.sin(a) * 2.4) + g.head) + Math.PI / 2;
    }
    // hover
    if (hoverQueued) {
      const pos = hoverQueued;
      hoverQueued = null;
      const p = scene.pick(pos);
      const id = p && p.id && p.id.kind ? p.id : null;
      scene.canvas.style.cursor = id ? 'pointer' : 'default';
      listeners.hover.forEach((f) => f(id, pos));
    }
    if (t - lastDeclutter > 0.12) {
      lastDeclutter = t;
      declutter.run();
      if (vectorLayer) {
        const h = viewer.camera.positionCartographic.height;
        vectorLayer.alpha = Math.max(0, Math.min(1, (1.15e7 - h) / (1.15e7 - 5.5e6)));
      }
    }
    if (t - lastCam > 0.25) {
      lastCam = t;
      const c = viewer.camera.positionCartographic;
      const info = {
        lon: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
        alt: c.height,
        heading: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
      };
      listeners.camera.forEach((f) => f(info));
    }
  });

  const _scratch = new Cesium.Cartesian2();
  const toWin = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  function countInView() {
    const w = scene.canvas.clientWidth, h = scene.canvas.clientHeight;
    const occ = new Cesium.EllipsoidalOccluder(globe.ellipsoid, viewer.camera.positionWC);
    let n = 0;
    for (const e of vessels.values()) {
      const p = e.pt.position;
      if (!occ.isPointVisible(p)) continue;
      const c = toWin(scene, p, _scratch);
      if (c && c.x >= 0 && c.y >= 0 && c.x <= w && c.y <= h) n++;
    }
    return n;
  }

  return {
    viewer,
    setInfra,
    setCoast,
    setLand,
    setFocus,
    setReserved: (f) => declutter.setReserved(f),
    getFocus: () => focus,
    setIncidents,
    upsertVessels,
    removeVessels,
    showTrack,
    clearTrack,
    setGliders,
    setTasking,
    setLayer,
    flyRegion,
    flyPoint,
    heroStart,
    heroEnd,
    countInView,
    vesselCount: () => vessels.size,
    getVessel: (mmsi) => vessels.get(mmsi)?.v,
    on: (ev, f) => listeners[ev].push(f),
  };
}

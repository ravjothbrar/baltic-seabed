import { asset } from './base.js';
import { createDataSource } from './datasource.js';
import './styles.css';
import { REGIONS, kmBetween } from './geoutil.js';
import { createFlatMap, FLAT_VIEW } from './flatmap.js';
import GliderWorker from './glider.worker.js?worker';
import { createTour, offerTour } from './tour.js';
import { renderBrief } from './brief.js';
import { createHeroGlobe } from './heroglobe.js';
const ds = createDataSource();
// Intro globe first, so its land file (preloaded by index.html) paints as early as possible.
let heroGlobe = document.documentElement.classList.contains('nohero') ? null
  : createHeroGlobe(document.getElementById('intro-globe'), { landUrl: asset('geo/hero-land.json'), reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches });

// ---------------------------------------------------------------- constants
const SIGNALS = {
  LOITER: { label: 'Loitering on infrastructure', short: 'LOITER', weak: 'Ships wait for berths, pilots and weather all the time. Most loiters near cables are innocent.' },
  DRAG: { label: 'Possible anchor-drag pattern', short: 'DRAG', weak: 'Slow, steady movement can also mean towing, manoeuvring, heavy seas or a fouled propeller. AIS can’t see an anchor.' },
  CROSS_SLOW: { label: 'Slow crossing over asset', short: 'X-SLOW', weak: 'Ships slow down for traffic separation, pilots and ice. Crossing a cable is routine: thousands do it daily.' },
  DARK: { label: 'AIS gap near infrastructure', short: 'DARK', weak: 'Receiver coverage drops, transponders glitch, and messages get rate-limited. A gap is not proof of switching off.' },
  WATCHLIST: { label: 'Listed / sanctioned vessel', short: 'LISTED', weak: 'A list match says who owns or operates the ship, not what it’s doing now. Names and IMOs get reused and spoofed.' },
  FOC: { label: 'Flag-of-convenience pattern', short: 'FOC', weak: 'Open registries flag a large share of the world’s honest fleet too.' },
  PROFILE: { label: 'Matches past incident profile', short: 'PROFILE', weak: 'Fitting a profile built from a few cases is weak evidence. Several past “matches” were cleared.' },
};
const SIGNAL_ORDER = ['LOITER', 'DRAG', 'CROSS_SLOW', 'DARK', 'WATCHLIST', 'FOC', 'PROFILE'];
const LEVEL_RANK = { HIGH: 3, ELEVATED: 2, WATCH: 1 };
const MOBILE = () => window.matchMedia('(max-width: 900px)').matches;

// ---------------------------------------------------------------- state
const state = {
  vessels: new Map(),
  alerts: new Map(),
  stats: null,
  feeds: null,
  heat: [],
  infra: null,
  incidents: [],
  grid: null,
  selectedAlert: null,
  selectedMmsi: null,
  layers: { vessels: true, telecom: true, power: true, pipeline: true, incidents: true, gliders: true, sar: true },
  sar: null, brief: null,
  preset: 'NORMAL',
  region: 'BALTIC',
  hist: { vessels: [], inCorridor: [], watchlist: [], dark: [], alerts: [], msgs: [] },
  lastSnapshot: 0,
  lastVesselMsg: 0,
  sseOk: false,
  glider: { N: 120, R: 8, res: null },
  start: Date.now(),
  inView: 0,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-GB'));
const pad = (n, w = 2) => String(n).padStart(w, '0');
function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - (typeof ts === 'string' ? Date.parse(ts) : ts)) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function utc(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

// ---------------------------------------------------------------- DOM
const BRAND_SVG = `<svg class="brand-mark" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="#53f0c9" stroke-width="1.6" opacity=".9"/><circle cx="16" cy="16" r="8" fill="none" stroke="#53f0c9" stroke-width="1" opacity=".35"/><path d="M3.5 19.5c4.5-3 8.5 2.8 13 0s8.6-2.8 12 -.6" fill="none" stroke="#53f0c9" stroke-width="1.6"/><circle cx="16" cy="16" r="1.6" fill="#53f0c9"/></svg>`;

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <div class="brand">${BRAND_SVG}<div class="brand-name">BALTIC <b>SEABED</b> WATCH</div></div>
    <div class="strap"><span class="dot"></span>UNCLASSIFIED // OPEN SOURCE</div>
    <a class="byline" href="https://ravjothbrar.com" target="_blank" rel="noopener" data-tip="About the author · ravjothbrar.com"><span class="byline-k">CREATED BY</span><span class="byline-n">Ravjoth Brar</span><span class="byline-a">↗</span></a>
    <div class="top-spacer"></div>
    <span class="chip hide-m">SWEEP<b id="c-sweep">—</b></span>
    <span class="chip hide-m"><b id="c-utc" style="margin:0">—</b></span>
    <span class="chip hide-m">FEEDS<b id="c-feeds">—</b></span>
    <span class="chip hide-m">MSG/MIN<b id="c-msgs">—</b></span>
    <button class="chip btn tourbtn" id="b-tour" data-tip="Replay the 60-second guided tour"><span class="q">?</span><span class="hide-m">TOUR</span></button>
    <button class="chip btn" id="b-brief" data-tip="Today's one-page summary" aria-label="Daily brief"><svg class="bb-ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" stroke-width="1.2"/></svg><span class="bb-t">DAILY BRIEF</span></button>
    <a class="chip btn hide-m" id="b-how" href="./how.html">HOW IT WORKS</a>
    <button class="chip btn hide-m" id="b-signals">WHAT SIGNALS MEAN</button>
    <span class="status-pill" id="c-level" data-level="STALE">CONNECTING</span>
  </header>

  <aside class="col col-left">
    <section class="panel" data-tab="ASSETS" style="flex:none">
      <div class="panel-h"><span class="t">Sensor Grid</span><i class="info" data-tip="Live counts from the ship feed. Click a tile to highlight those ships on the map.">i</i><span class="tag live" id="t-live">LIVE</span></div>
      <div class="panel-b"><div class="tiles" id="tiles"></div></div>
    </section>
    <section class="panel" data-tab="SOURCES" style="flex:none">
      <div class="panel-h"><span class="t">Data Layers</span><i class="info" data-tip="Switch map layers on and off. The small text shows where each layer comes from and how fresh it is.">i</i><span class="tag" id="t-layers">6</span></div>
      <div class="panel-b"><div class="layers" id="layers"></div></div>
    </section>
    <section class="panel" data-tab="ASSETS" style="flex:1">
      <div class="panel-h"><span class="t">Critical Assets</span><i class="info" data-tip="Cables and pipelines named in past incidents, with how many ships are inside their 1.5 nm corridor right now. Click one to fly there.">i</i><span class="tag" id="t-assets">—</span></div>
      <div class="panel-b"><div class="assets" id="assets"></div></div>
    </section>
    <section class="panel" data-tab="SOURCES" style="flex:none">
      <div class="panel-h"><span class="t">Visual Presets</span><i class="info" data-tip="Change the look of the map. SONAR and NVG are styles only; they add no data.">i</i></div>
      <div class="panel-b"><div class="presets" id="presets"></div></div>
    </section>
  </aside>

  <main class="stage">
    <nav class="tabs" id="regions"></nav>
    <div class="frame" id="frame">
      <div id="globe"></div>
      <div id="flat"></div>
      <div class="mapctl" id="mapctl"><button id="z-in" title="Zoom in" aria-label="Zoom in">+</button><button id="z-out" title="Zoom out" aria-label="Zoom out">−</button><button id="b-mode" class="mode" title="Switch between flat map and 3D globe">3D GLOBE</button></div>
      <div class="ov ov-grid"></div>
      <div class="radar"></div>
      <div class="ov ov-sweep"></div>
      <div class="ov ov-scan"></div>
      <div class="ov ov-vig"></div>
      <div class="ring" id="ring"></div>
      <span class="brk tl"></span><span class="brk tr"></span><span class="brk bl"></span><span class="brk br"></span>
      <div class="hud tl">
        <div class="hud-obs">BSW // OBSERVER-1</div>
        <a class="byline byline-sheet" href="https://ravjothbrar.com" target="_blank" rel="noopener"><span class="byline-k">CREATED BY</span><span class="byline-n">Ravjoth Brar</span><span class="byline-a">↗</span></a>
        <div class="row hl" id="h-state">STATE ▸ ACQUIRING</div>
        <div class="row" style="margin-top:14px">OBSERVATIONS IN VIEW</div>
        <div class="big" id="h-obs">0</div>
        <div class="rule"></div>
      </div>
      <div class="hud tr">
        <div class="hl" id="h-utc">—</div>
        <div class="row" id="h-session">T+00:00:00</div>
        <div class="row" id="h-feeds">FEEDS — · SIGNALS —</div>
      </div>
      <div class="hud bl">
        <div id="h-cam">CAM —</div>
        <div class="row" id="h-cam2">ALT — · HDG — · PITCH —</div>
      </div>
      <div class="hud br">
        <div><span class="lead">SURFACE ACTIVITY ··········</span> <span class="hl">INGESTED</span></div>
        <div class="row"><span class="lead">SUBSURFACE ACTIVITY ·······</span> <span class="am">NO SENSOR</span></div>
      </div>
      <div class="focus-bar" id="focus-bar"></div>
      <div class="hint" id="hint"><span class="hint-dot"></span><span class="hide-m">Click any ship, cable or <b>◆</b> incident for details · scroll to zoom · drag to pan</span><span class="only-m">Tap a ship or <b>◆</b> for details</span></div>
      <div class="legend" id="legend"></div>
      <aside class="dossier" id="dossier"></aside>
    </div>
  </main>

  <aside class="col col-right">
    <section class="panel" data-tab="ALERTS" style="flex:1.25">
      <div class="panel-h"><span class="t">Alert Stream</span><i class="info" data-tip="Ships whose behaviour matches a pattern seen in past incidents. Click one to fly to it and open its dossier. These are patterns, not findings.">i</i><span class="tag live" id="t-alerts">0 LIVE</span></div>
      <div class="panel-b"><div class="alerts" id="alerts"></div></div>
    </section>
    <section class="panel" data-tab="ALERTS" style="flex:none">
      <div class="panel-h"><span class="t">Signal Core</span><i class="info" data-tip="How many ships each rule is firing on right now. A rule that fires a lot is weak evidence on its own.">i</i><span class="tag">24H RULES</span></div>
      <div class="panel-b"><div class="meters" id="meters"></div></div>
    </section>
    <section class="panel sc" data-tab="ALERTS" style="flex:1">
      <div class="panel-h"><span class="t">What you shouldn't conclude</span><i class="info" data-tip="The innocent explanations for the selected alert: weather, nearby anchorages, ship type, receiver coverage, and how past cases ended.">i</i><span class="tag warn">READ FIRST</span></div>
      <div class="panel-b" id="sc"></div>
    </section>
  </aside>

  <section class="bottom">
    <section class="panel" data-tab="INCIDENTS">
      <div class="panel-h"><span class="t">Incident Log</span><i class="info" data-tip="Real suspected-damage cases since 2022, with sources and how each case actually ended. Click one to fly to it.">i</i><span class="tag" id="t-inc">—</span></div>
      <div class="panel-b"><div class="incs" id="incs"></div></div>
    </section>
    <section class="panel" data-tab="GLIDERS">
      <div class="panel-h"><span class="t">Glider Coverage</span><i class="info" data-tip="A simulation, not real data: drag to place autonomous underwater gliders along the corridors and see how much of the seabed they would cover.">i</i><span class="tag sim">SIMULATION</span></div>
      <div class="panel-b" id="glider"></div>
    </section>
    <section class="panel" data-tab="SOURCES">
      <div class="panel-h"><span class="t">Data Sources</span><i class="info" data-tip="Every feed this page uses, whether it is live, and the known gaps.">i</i><span class="tag" id="t-src">—</span></div>
      <div class="panel-b"><div class="srcs" id="srcs"></div></div>
    </section>
  </section>

  <footer class="foot">
    <span class="foot-made">Made by Ravjoth Brar - <a class="foot-link" href="https://ravjothbrar.com" target="_blank" rel="noopener">ravjothbrar.com</a></span>
    <span class="sp"></span>
    <span class="foot-src">AIS is self-reported · nothing here is evidence of intent · Data: Digitraffic · EMODnet · TeleGeography · OpenSanctions · Natural Earth</span>
  </footer>

  <div class="sheet min" id="sheet">
    <div class="grab" id="grab"></div>
    <div class="stabs" id="stabs"></div>
    <div class="sbody" id="sbody"></div>
  </div>
`;

document.body.insertAdjacentHTML('beforeend', `
  <div class="tip" id="tip"></div>
  <div class="modal" id="modal"><div class="box">
    <button class="chip btn x" id="modal-x">CLOSE</button>
    <h2>WHAT SIGNALS MEAN</h2>
    <p class="intro-p">Every alert here is a <b>pattern in public ship-tracking data</b>, not a finding. Each rule is cheap to trigger and easy to explain away, so the map shows the reasons next to the flag. AIS is self-reported, can be spoofed or switched off, and sees nothing below the surface. That gap is what persistent underwater sensing would close.</p>
    <table>${SIGNAL_ORDER.map((k) => `<tr><td>${k}</td><td><b>${SIGNALS[k].label}.</b> ${SIGNALS[k].weak}</td></tr>`).join('')}
      <tr><td>LEVELS</td><td><b>WATCH</b> = one signal. <b>ELEVATED</b> = two independent signals. <b>HIGH</b> = three or more, including DRAG or DARK. Weather, ship type (fishing, dredging, cable-laying, pilot, SAR) and anchorages can mark a signal as <i>explained</i>.</td></tr>
    </table>
  </div></div>
`);

// ---------------------------------------------------------------- hero ring (GEV)
function buildRing() {
  const frame = $('#frame');
  const size = Math.min(frame.clientWidth, frame.clientHeight) * 0.86;
  const r = size / 2;
  const cx = r + 30;
  const ticks = [];
  for (let d = 0; d < 360; d += 2) {
    const a = ((d - 90) * Math.PI) / 180;
    const long = d % 30 === 0;
    const mid = d % 10 === 0;
    const r1 = r + 4;
    const r2 = r + (long ? 14 : mid ? 9 : 6);
    ticks.push(`<line x1="${cx + r1 * Math.cos(a)}" y1="${cx + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cx + r2 * Math.sin(a)}" stroke="rgba(92,200,255,${long ? 0.8 : 0.35})" stroke-width="${long ? 1.2 : 0.8}"/>`);
    if (long) {
      const rt = r + 26;
      ticks.push(`<text x="${cx + rt * Math.cos(a)}" y="${cx + rt * Math.sin(a) + 3}" fill="rgba(92,200,255,.7)" font-family="JetBrains Mono, monospace" font-size="9" text-anchor="middle" letter-spacing="1">${pad(d, 3)}</text>`);
    }
  }
  const W = size + 60;
  $('#ring').innerHTML = `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
    <defs><radialGradient id="rg"><stop offset="85%" stop-color="rgba(58,168,255,0)"/><stop offset="100%" stop-color="rgba(58,168,255,.10)"/></radialGradient></defs>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="url(#rg)" stroke="rgba(92,200,255,.55)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cx}" r="${r - 8}" fill="none" stroke="rgba(92,200,255,.18)" stroke-width="1" stroke-dasharray="2 5"/>
    <g class="spin">${ticks.join('')}</g>
    <text x="${cx}" y="${cx - r - 34}" fill="rgba(92,200,255,.8)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="middle" letter-spacing="3">SUBSTRATE BOUNDARY · BALTIC BASIN</text>
    <text x="${cx}" y="${cx + r + 44}" fill="rgba(92,200,255,.6)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="middle" letter-spacing="3" id="ring-cov">SUBSURFACE COVERAGE 0.0%</text>
  </svg>`;
}

// ---------------------------------------------------------------- number tick-up
const numAnim = new WeakMap();
function setNum(el, to, opts = {}) {
  if (!el) return;
  if (to == null || Number.isNaN(to)) { el.textContent = '—'; numAnim.delete(el); return; }
  const from = numAnim.has(el) ? numAnim.get(el).val : 0;
  const t0 = performance.now();
  const dur = opts.dur ?? 700;
  const dec = opts.dec ?? 0;
  const suf = opts.suf ?? '';
  const st = { val: from, to };
  numAnim.set(el, st);
  const step = (t) => {
    if (numAnim.get(el) !== st) return;
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    st.val = from + (to - from) * e;
    el.textContent = (dec ? st.val.toFixed(dec) : Math.round(st.val).toLocaleString('en-GB')) + suf;
    if (k < 1) requestAnimationFrame(step);
    else st.val = to;
  };
  requestAnimationFrame(step);
}

function spark(arr, color) {
  if (!arr || arr.length < 2) return '';
  const max = Math.max(...arr, 1);
  const min = Math.min(...arr, 0);
  const w = 54, h = 18;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 2) - 1}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

// ---------------------------------------------------------------- renderers
const TILE_DEFS = [
  { k: 'vessels', label: 'Vessels', sub: 'tracked live', color: '#cfe9e6', cls: '', focus: 'moving', fname: 'ships under way',
    tip: 'Ships that reported a position in the last 30 minutes. Click to highlight the ones under way.' },
  { k: 'inCorridor', label: 'In Corridor', sub: 'near cables', color: '#53f0c9', cls: '', focus: 'corridor', fname: 'ships within 1.5 nm of a cable or pipeline',
    tip: 'Ships within 1.5 nautical miles of a cable or pipeline right now. In busy lanes that is completely normal. Click to highlight them.' },
  { k: 'watchlist', label: 'Listed', sub: 'sanctions lists', color: '#ff5fd2', cls: 'mag', focus: 'listed', fname: 'listed / sanctioned ships',
    tip: 'Ships on a sanctions, shadow-fleet or detention list (OpenSanctions). A listing is about ownership, not what the ship is doing. Click to highlight them.' },
  { k: 'dark', label: 'AIS Dark', sub: 'signal gaps', color: '#ffb547', cls: 'amber', focus: 'alerts', fname: 'flagged ships',
    tip: 'Ships that stopped reporting near infrastructure while nearby ships kept reporting. Usually receiver coverage, sometimes not. Click to highlight flagged ships.' },
  { k: 'alerts', label: 'Alerts', sub: 'watch · elev · high', color: '#ff4d5e', cls: 'red', focus: 'alerts', fname: 'flagged ships', openAlerts: true,
    tip: 'Ships currently matching at least one pattern (WATCH · ELEVATED · HIGH). Click to highlight them and open the alert stream.' },
  { k: 'wind', label: 'Wind', sub: 'Gulf of Finland', color: '#5cc8ff', cls: '',
    tip: 'Current wind in the Gulf of Finland (Open-Meteo). In a gale, slow ships are normal, so speed-based alerts are discounted.' },
];
function setFocus(k) {
  const d = TILE_DEFS.find((x) => x.k === k);
  const mode = d?.focus && state.focusTile !== k ? d.focus : null;
  state.focusTile = mode ? k : null;
  globe.setFocus(mode);
  $$('#tiles .tile').forEach((t) => t.classList.toggle('sel', t.dataset.k === state.focusTile));
  const bar = $('#focus-bar');
  if (mode) {
    bar.innerHTML = `<span class="fb-k">HIGHLIGHTING</span> ${esc(d.fname)} <button class="fb-x" data-unfocus>CLEAR ✕</button>`;
    bar.classList.add('on');
  } else bar.classList.remove('on');
  if (mode && d?.openAlerts) {
    if (MOBILE()) setSheetTab('ALERTS', true);
    else { const p = $('.col-right .panel'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
  }
}
function renderTiles() {
  const el = $('#tiles');
  if (!el.children.length) {
    el.innerHTML = TILE_DEFS.map((d) => `<div class="tile ${d.cls}${d.focus ? ' act' : ''}" data-k="${d.k}" data-tip="${esc(d.tip)}"><div class="k" style="color:${d.color}"><i></i><span style="color:var(--ink-3)">${d.label}</span></div><div class="v">—</div><div class="s">${d.sub}</div><div class="sp"></div></div>`).join('');
  }
  const s = state.stats;
  const vals = {
    vessels: s?.vessels ?? (state.vessels.size || null),
    inCorridor: s?.inCorridor,
    watchlist: s?.watchlist,
    dark: s?.dark,
    alerts: s ? (s.alerts?.WATCH || 0) + (s.alerts?.ELEVATED || 0) + (s.alerts?.HIGH || 0) : null,
    wind: s?.windKn,
  };
  for (const d of TILE_DEFS) {
    const t = el.querySelector(`[data-k="${d.k}"]`);
    if (d.k === 'wind') {
      const v = t.querySelector('.v');
      v.textContent = vals.wind == null ? '—' : `${Math.round(vals.wind)} kn`;
      t.querySelector('.s').textContent = vals.wind == null ? (state.feeds?.weather?.ok ? 'no reading yet' : 'awaiting data') : vals.wind >= 30 ? 'gale' : 'Gulf of Finland';
    } else setNum(t.querySelector('.v'), vals[d.k]);
    if (d.k === 'alerts' && s) t.querySelector('.s').textContent = `${s.alerts?.WATCH || 0} · ${s.alerts?.ELEVATED || 0} · ${s.alerts?.HIGH || 0}`;
    const h = state.hist[d.k];
    t.querySelector('.sp').innerHTML = h ? spark(h, d.color) : '';
  }
}

const LAYER_DEFS = [
  { k: 'vessels', name: 'Live Vessels', color: '#cfe9e6', ic: '' },
  { k: 'telecom', name: 'Telecom Cables', color: '#3fd8ff', ic: 'line' },
  { k: 'power', name: 'Power Cables', color: '#a98bff', ic: 'line' },
  { k: 'pipeline', name: 'Pipelines', color: '#ffb547', ic: 'line' },
  { k: 'incidents', name: 'Past Incidents', color: '#ff4d5e', ic: '' },
  { k: 'gliders', name: 'Gliders (sim)', color: '#53f0c9', ic: '' },
  { k: 'sar', name: 'Radar · not on AIS', color: '#ffb547', ic: 'sq' },
];
function layerMeta(k) {
  const f = state.feeds || {};
  const infraCount = (kind) => state.infra ? state.infra.features.filter((x) => x.properties?.kind === kind).length : 0;
  const infraSrc = (kind) => {
    if (!state.infra) return 'loading…';
    const srcs = [...new Set(state.infra.features.filter((x) => x.properties?.kind === kind).map((x) => x.properties?.source).filter(Boolean))];
    return srcs.join(' · ') || 'no data';
  };
  switch (k) {
    case 'vessels': {
      const srcs = [];
      if (f.digitraffic) srcs.push('Digitraffic');
      if (f.aisstream?.enabled) srcs.push('aisstream');
      const last = Math.max(Date.parse(f.digitraffic?.last || 0) || 0, Date.parse(f.aisstream?.last || 0) || 0, state.lastVesselMsg);
      return { n: state.vessels.size, src: `${srcs.join(' · ') || 'AIS'} · ${last ? ago(last) : 'waiting'}` };
    }
    case 'telecom': return { n: infraCount('telecom'), src: infraSrc('telecom') };
    case 'power': return { n: infraCount('power'), src: infraSrc('power').includes('OpenStreetMap') ? `${infraSrc('power')} · partial` : `${infraSrc('power')} · DE waters only` };
    case 'pipeline': return { n: infraCount('pipeline'), src: infraSrc('pipeline') };
    case 'incidents': return { n: state.incidents.length, src: 'hand-curated · sourced' };
    case 'gliders': return { n: state.glider.N, src: `simulation · R ${state.glider.R} km` };
    case 'sar': return state.sar ? { n: state.sar.unmatchedCells?.length || 0, src: `GFW SAR · ${state.sar.windowDays || 30} d · ${state.sar.lagDays ?? 5}-day lag` } : { n: 0, src: 'Global Fishing Watch · pending' };
  }
  return { n: 0, src: '' };
}
function renderLayers() {
  const el = $('#layers');
  if (!el.children.length) {
    el.innerHTML = LAYER_DEFS.map((d) => `<div class="layer" data-k="${d.k}"><i class="ic ${d.ic}" style="color:${d.color}"></i><div><div class="nm">${d.name}</div><div class="src"></div></div><span class="ct">—</span><button class="pill on">ON</button></div>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.pill');
      if (!b) return;
      const k = b.closest('.layer').dataset.k;
      toggleLayer(k);
    });
  }
  for (const d of LAYER_DEFS) {
    const row = el.querySelector(`[data-k="${d.k}"]`);
    const m = layerMeta(d.k);
    row.querySelector('.ct').textContent = fmt(m.n);
    row.querySelector('.src').textContent = m.src;
    const on = state.layers[d.k];
    const p = row.querySelector('.pill');
    p.classList.toggle('on', on);
    p.textContent = on ? 'ON' : 'OFF';
  }
}
function toggleLayer(k, force) {
  state.layers[k] = force ?? !state.layers[k];
  globe.setLayer(k, state.layers[k]);
  renderLayers();
  renderLegend();
}

function namedAssets() {
  if (!state.infra) return [];
  const m = new Map();
  for (const f of state.infra.features) {
    const p = f.properties || {};
    if (!p.named || !p.name) continue;
    if (!m.has(p.name)) m.set(p.name, { name: p.name, kind: p.kind, coords: [] });
    const g = f.geometry;
    const parts = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
    for (const part of parts) m.get(p.name).coords.push(...part);
  }
  return [...m.values()];
}
function renderAssets() {
  const el = $('#assets');
  const assets = namedAssets();
  $('#t-assets').textContent = assets.length ? `${assets.length} NAMED` : '—';
  if (!assets.length) {
    el.innerHTML = `<div class="empty">Infrastructure layer not loaded yet.<br/>Run <b>npm run fetch:static</b>.</div>`;
    return;
  }
  const counts = new Map();
  for (const v of state.vessels.values()) if (v.corridor) counts.set(v.corridor, (counts.get(v.corridor) || 0) + 1);
  const alertAssets = new Set([...state.alerts.values()].map((a) => a.asset));
  assets.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0) || a.name.localeCompare(b.name));
  el.innerHTML = assets.map((a) => {
    const c = counts.get(a.name) || 0;
    const kindLabel = a.kind === 'pipeline' ? 'gas pipeline' : a.kind === 'power' ? 'power cable' : 'telecom cable';
    return `<button class="asset" data-name="${esc(a.name)}"><i class="d ${a.kind}" ${alertAssets.has(a.name) ? 'style="background:var(--amber);box-shadow:0 0 8px var(--amber)"' : ''}></i><span class="n">${esc(a.name)}<small>${kindLabel}</small></span><span class="c ${c ? 'hot' : ''}">${c} in corr.</span></button>`;
  }).join('');
}

const PRESETS = ['NORMAL', 'SONAR', 'NVG', 'CLEAN'];
function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p) => `<button class="preset ${state.preset === p ? 'on' : ''}" data-p="${p}">${p}</button>`).join('');
}
function setPreset(p) {
  state.preset = p;
  document.body.classList.remove('p-sonar', 'p-nvg', 'p-clean');
  if (p !== 'NORMAL') document.body.classList.add(`p-${p.toLowerCase()}`);
  renderPresets();
  setTimeout(() => { resize3d(); flat.resize(); }, 50);
  if (p === 'CLEAN') showToastPreset();
}
function showToastPreset() {
  if ($('#cleanx')) return;
  const b = document.createElement('button');
  b.id = 'cleanx';
  b.className = 'chip btn';
  b.textContent = 'EXIT CLEAN UI';
  b.style.cssText = 'position:absolute;right:46px;bottom:48px;z-index:12';
  b.onclick = () => { setPreset('NORMAL'); b.remove(); };
  $('#frame').appendChild(b);
}

function renderRegions() {
  $('#regions').innerHTML = Object.keys(REGIONS).map((r) => `<button class="tab ${state.region === r ? 'on' : ''}" data-r="${r}">${r}</button>`).join('');
}

function renderLegend() {
  const items = [
    ['telecom', 'ln', '#3fd8ff', 'TELECOM'],
    ['power', 'ln', '#a98bff', 'POWER'],
    ['pipeline', 'ln', '#ffb547', 'PIPELINE'],
    ['vessels', '', '#cfe9e6', 'VESSEL'],
    [null, '', '#ff5fd2', 'LISTED'],
    [null, '', '#ffb547', 'ALERT'],
    ['incidents', 'dm', '#ff4d5e', 'INCIDENT'],
    ['gliders', '', '#53f0c9', 'GLIDER (SIM)'],
    ...(state.sar?.unmatchedCells?.length ? [['sar', 'sq', '#ffb547', 'RADAR · NOT ON AIS']] : []),
  ];
  $('#legend').innerHTML = items.map(([k, ic, c, l]) => `<span class="lg ${k && !state.layers[k] ? 'off' : ''}" ${k ? `data-k="${k}" style="cursor:pointer"` : ''}><i class="${ic}" style="color:${c}"></i><span>${l}</span></span>`).join('');
}

function sortedAlerts() {
  return [...state.alerts.values()].sort((a, b) => (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0) || (Date.parse(b.lastSeen || 0) || 0) - (Date.parse(a.lastSeen || 0) || 0));
}
function renderAlerts() {
  const el = $('#alerts');
  const list = sortedAlerts();
  $('#t-alerts').textContent = `${list.length} LIVE`;
  if (!list.length) {
    el.innerHTML = state.sseOk || state.lastSnapshot
      ? `<div class="empty">No anomalies right now.<br/>Rules are running on <b>${fmt(state.vessels.size)}</b> ships. Quiet is the normal state, and it's an honest one.</div>`
      : `<div class="empty">Connecting to the live feed…<br/>If this persists, the server is offline. Nothing is shown rather than anything made up.</div>`;
    return;
  }
  el.innerHTML = list.slice(0, 60).map((a) => `
    <button class="alert ${state.selectedAlert === a.id ? 'sel' : ''}" data-level="${a.level}" data-id="${esc(a.id)}">
      <div class="r1"><span class="lvl" data-level="${a.level}">${a.level}</span><span>${esc(a.flag || '')}${a.typeLabel ? ' · ' + esc(a.typeLabel).toUpperCase() : ''}</span><span class="tm">${ago(a.lastSeen || a.firstSeen)}</span></div>
      <div class="nm">${esc(a.name || 'MMSI ' + a.mmsi)}</div>
      <div class="as">${a.asset ? 'near ' + esc(a.asset) : 'near seabed infrastructure'}</div>
      <div class="sigs">${(a.signals || []).map((s) => `<span class="sig ${s.strength} ${s.explained ? 'x' : ''}" title="${esc(s.evidence)}">${SIGNALS[s.id]?.short || s.id}</span>`).join('')}</div>
    </button>`).join('');
}

function renderMeters() {
  const s = state.stats?.signals || {};
  const counts = {};
  for (const k of SIGNAL_ORDER) counts[k] = s[k] ?? 0;
  if (!state.stats) for (const a of state.alerts.values()) for (const sg of a.signals || []) counts[sg.id] = (counts[sg.id] || 0) + 1;
  const max = Math.max(5, ...Object.values(counts));
  const el = $('#meters');
  if (!el.children.length) {
    el.innerHTML = SIGNAL_ORDER.map((k) => `<div class="meter" data-k="${k}" title="${esc(SIGNALS[k].label)}"><span class="l">${k.replace('_', '-')}</span><span class="bar"><i style="width:0%"></i></span><span class="v">0</span></div>`).join('');
  }
  for (const k of SIGNAL_ORDER) {
    const m = el.querySelector(`[data-k="${k}"]`);
    m.querySelector('i').style.width = `${Math.max(counts[k] ? 4 : 0, (counts[k] / max) * 100)}%`;
    setNum(m.querySelector('.v'), counts[k], { dur: 500 });
    m.classList.toggle('warn', (k === 'DRAG' || k === 'DARK') && counts[k] > 0);
  }
}

function incidentStats() {
  const n = state.incidents.length;
  const soft = state.incidents.filter((i) => ['dismissed', 'cleared', 'accident', 'inconclusive'].includes(i.outcomeStatus)).length;
  return { n, soft };
}
function renderShouldnt() {
  const el = $('#sc');
  const a = state.selectedAlert ? state.alerts.get(state.selectedAlert) : null;
  const is = incidentStats();
  const precedent = state.incidents.filter((i) => i.vessel?.name && i.outcome).slice(-3);
  const foot = `<div class="foot">AIS is self-reported, can be spoofed or switched off, and can't see anything below the surface. No alert here is evidence of intent.</div>`;
  if (!a) {
    el.innerHTML = `
      <p class="lead"><b>Every flag on this map is a pattern, not a finding.</b> Select an alert to see why it might be innocent.</p>
      <ul>
        <li>Thousands of ships cross Baltic cables every day. Proximity is the norm, not the exception.</li>
        <li>Slow speed has dull causes: waiting for a berth, a pilot, ice or weather.</li>
        <li>AIS gaps are mostly receiver coverage, not transponders switched off.</li>
        <li>A sanctions-list match tells you about ownership, not about what the ship is doing.</li>
        <li>Live AIS covers the northern Baltic (Digitraffic); the whole Baltic is refreshed every 15 min when aisstream is enabled.</li>
        ${state.sar ? `<li>Radar squares: ${esc(state.sar.caveat || 'a radar detection with no AIS match can be a small boat, a platform, a wind turbine or a timing mismatch, and the data lags by days.')}</li>` : ''}
        ${is.n ? `<li>Of <b style="color:var(--ink)">${is.n}</b> logged incidents, <b style="color:var(--ink)">${is.soft}</b> ended dismissed, cleared, ruled an accident or inconclusive.</li>` : ''}
      </ul>
      ${precedent.length ? `<div class="sech">PRECEDENT</div><ul>${precedent.map((i) => `<li><b style="color:var(--ink)">${esc(i.vessel.name)}</b>: ${esc(i.outcome)}</li>`).join('')}</ul>` : ''}
      ${foot}`;
    return;
  }
  const ctx = a.context || {};
  const sigs = (a.signals || []).map((s) => `
    <div class="sgi ${s.explained ? 'x' : ''}">
      <div class="h">${esc(SIGNALS[s.id]?.label || s.label || s.id)}<span class="st ${s.strength}">${(s.strength || '').toUpperCase()} ALONE</span></div>
      <p>${esc(s.evidence || '')}</p>
      ${s.explained ? `<p class="ex">EXPLAINED ▸ ${esc(s.explainedBy || '')}</p>` : `<p style="color:var(--ink-3)">${esc(SIGNALS[s.id]?.weak || '')}</p>`}
    </div>`).join('');
  el.innerHTML = `
    <p class="lead"><b>${esc(a.name || 'MMSI ' + a.mmsi)}</b> · ${a.level} · ${(a.signals || []).length} signal${(a.signals || []).length === 1 ? '' : 's'}${a.asset ? ' near ' + esc(a.asset) : ''}</p>
    <div class="ctx">
      <div><span>WIND</span><b>${ctx.windKn != null ? Math.round(ctx.windKn) + ' kn' : '—'}</b></div>
      <div><span>WAVES</span><b>${ctx.waveM != null ? ctx.waveM.toFixed(1) + ' m' : '—'}</b></div>
      <div><span>NEAREST ANCHORAGE</span><b>${ctx.nearestAnchorage ? esc(ctx.nearestAnchorage.name) + ' · ' + ctx.nearestAnchorage.nm.toFixed(1) + ' nm' : '—'}</b></div>
      <div><span>AIS COVERAGE HERE</span><b>${ctx.coverage != null ? Math.round(ctx.coverage * 100) + '%' : '—'}</b></div>
    </div>
    <div class="sgl">${sigs}</div>
    ${(a.shouldntConclude || []).length ? `<ul>${a.shouldntConclude.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${foot}`;
}

function renderIncidents() {
  const el = $('#incs');
  const list = [...state.incidents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#t-inc').textContent = list.length ? `${list.length} LOGGED` : '—';
  if (!list.length) {
    el.innerHTML = `<div class="empty">Incident log is being verified against sources.<br/>Rows appear here only once each is cited.</div>`;
    return;
  }
  const verified = list.some((i) => i.verification);
  const note = `<div class="incnote" title="${esc(state.incidentNote || '')}">Sources <b>${verified ? 'search-verified' : 'cited'}</b> · see links</div>`;
  el.innerHTML = note + list.map((i) => `
    <div class="inc" role="button" tabindex="0" data-id="${esc(i.id)}">
      <span class="dt">${esc((i.date || '').slice(0, 10))}</span>
      <span><div class="ti">${esc(i.title)}</div><div class="ve">${i.vessel?.name ? esc(i.vessel.name) + (i.vessel.flag ? ' · ' + esc(i.vessel.flag) : '') : 'no vessel identified'}</div><div class="oc">${esc(i.outcome || '')}</div>
      <div class="lk">${(i.sources || []).slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || 'source')} ↗</a>`).join('')}</div></span>
      <span class="ost" data-s="${esc(i.outcomeStatus || '')}">${esc(i.outcomeStatus || '—')}</span>
    </div>`).join('');
}

function renderGlider() {
  const el = $('#glider');
  const g = state.glider;
  const r = g.res;
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <div class="gl">
        <div class="ctl">
          <div class="sl"><div class="lb"><span>GLIDERS</span><b id="g-n">120</b></div><input type="range" id="g-nr" min="0" max="300" step="1" value="120"/></div>
          <div class="sl"><div class="lb"><span>RADIUS</span><b id="g-r">8 km</b></div><input type="range" id="g-rr" min="2" max="20" step="1" value="8"/></div>
          <div class="sl"><div class="lb"><span>CORRIDORS</span><b id="g-cov2" style="color:var(--violet)">0%</b></div><div class="covbar"><i id="g-bar" style="width:0%"></i></div></div>
        </div>
        <div class="ro">
          <div><span>COVERAGE</span><b id="g-cov">0.0%</b></div>
          <div><span>ASSETS</span><b id="g-named">—</b></div>
          <div><span>OPERATORS</span><b class="v">1</b></div>
          <div><span>PATROL</span><b>≤3 mo</b></div>
        </div>
        <div class="as"><b>ASSUMPTIONS (SIM):</b> R is an <b>assumed</b> passive-acoustic detection radius, not a published spec. Placement is greedy max-coverage over ~5 km cells weighted by cable km × live traffic × 3 for named assets. <span id="g-depth">Depth not modelled.</span> 1 operator and ≤3-month endurance are Helsing's public SG-1 Fathom claims. No Helsing data is used.</div>
      </div>`;
    const nr = $('#g-nr'), rr = $('#g-rr');
    const upd = () => {
      g.N = +nr.value;
      g.R = +rr.value;
      nr.style.setProperty('--p', `${(g.N / 300) * 100}%`);
      rr.style.setProperty('--p', `${((g.R - 2) / 18) * 100}%`);
      $('#g-n').textContent = g.N;
      $('#g-r').textContent = `${g.R} km`;
      if (g.N > 0 && !state.layers.gliders) toggleLayer('gliders', true);
      queryGliders();
    };
    nr.addEventListener('input', upd);
    rr.addEventListener('input', upd);
    upd();
  }
  if (r && r.ready) {
    const pct = r.coverage * 100;
    setNum($('#g-cov'), pct, { dec: 1, suf: '%', dur: 250 });
    $('#g-cov2').textContent = `${pct.toFixed(0)}%`;
    $('#g-bar').style.width = `${pct}%`;
    $('#g-named').textContent = r.namedTotal ? `${r.namedCovered}/${r.namedTotal}` : '—';
    const rc = $('#ring-cov');
    if (rc) rc.textContent = `SUBSURFACE COVERAGE ${pct.toFixed(1)}% · ${g.N} GLIDERS (SIM)`;
  } else if (r && !r.ready) {
    $('#g-named').textContent = '—';
  }
}

function renderSources() {
  const f = state.feeds || {};
  const rows = [];
  const live = (o) => o && o.ok;
  rows.push({ n: 'Digitraffic AIS', s: 'Fintraffic · keyless · N. Baltic', st: f.digitraffic ? (live(f.digitraffic) ? 'ok' : 'bad') : 'off', a: f.digitraffic ? `${fmt(f.digitraffic.count)} · ${ago(f.digitraffic.last)}` : 'pending' });
  rows.push(f.aisstream?.enabled
    ? { n: 'aisstream.io', s: f.aisstream.label || 'whole-Baltic AIS', st: live(f.aisstream) ? 'ok' : 'warn', a: [f.aisstream.count ? fmt(f.aisstream.count) : null, f.aisstream.last ? ago(f.aisstream.last) : null].filter(Boolean).join(' · ') || 'enabled' }
    : { n: 'aisstream.io', s: 'whole-Baltic AIS · needs key', st: 'off', a: 'no key set' });
  rows.push(state.sar
    ? { n: 'Global Fishing Watch SAR', s: `radar vessel detections · ${state.sar.licence || 'CC BY-NC 4.0'}`, st: 'ok', a: (state.sar.dateRange || []).join(' → ') || ago(state.sar.generated) }
    : { n: 'Global Fishing Watch SAR', s: 'radar vessel detections', st: 'off', a: 'token not set / pending' });
  rows.push({ n: 'Open-Meteo', s: 'wind & waves · context', st: f.weather ? (live(f.weather) ? 'ok' : 'warn') : 'off', a: f.weather ? ago(f.weather.last) : 'pending' });
  rows.push({ n: 'OpenSanctions', s: 'maritime watchlist', st: f.watchlist ? (live(f.watchlist) ? 'ok' : 'warn') : 'off', a: f.watchlist ? `${fmt(f.watchlist.count)} · ${f.watchlist.updated ? ago(f.watchlist.updated) : ''}` : 'pending' });
  rows.push({ n: 'Telecom cables', s: 'TeleGeography · public cable map', st: state.infra ? 'ok' : 'off', a: state.infra ? `${fmt(state.infra.features.filter((x) => x.properties?.kind === 'telecom').length)} lines` : 'not loaded' });
  rows.push({ n: 'Pipelines', s: 'EMODnet Human Activities', st: state.infra ? 'ok' : 'off', a: state.infra ? `${fmt(state.infra.features.filter((x) => x.properties?.kind === 'pipeline').length)} lines` : 'not loaded' });
  const power = state.infra ? state.infra.features.filter((x) => x.properties?.kind === 'power') : [];
  const osmPower = power.some((x) => x.properties?.source === 'OpenStreetMap');
  // Major Baltic HVDC links: list whichever are still missing from the open data, by name.
  const KEY_LINKS = ['Estlink', 'NordBalt', 'Fenno-Skan', 'SwePol', 'Baltic Cable', 'Kontek'];
  const names = power.map((x) => x.properties?.name || '').join(' | ').toLowerCase();
  const missing = KEY_LINKS.filter((k) => !names.includes(k.toLowerCase()));
  rows.push({
    n: 'Power cables', s: osmPower ? 'EMODnet + OpenStreetMap' : 'EMODnet · German waters only',
    ...(missing.length ? { gap: `Gap: ${missing.join(', ')} not in reachable open data yet` } : {}),
    st: !state.infra ? 'off' : missing.length ? 'warn' : 'ok', a: state.infra ? `${fmt(power.length)} lines` : 'not loaded',
  });
  const depthOn = !!state.grid?.cells?.some((c) => c[4] !== 1);
  rows.push(depthOn
    ? { n: 'Bathymetry', s: 'EMODnet bathymetry · depth mask on', st: 'ok', a: 'glider layer' }
    : { n: 'Bathymetry', s: 'glider depth mask', gap: 'Gap: depth not modelled', st: 'off', a: 'not used' });
  rows.push({ n: 'Incident log', s: 'hand-curated · every row cited', st: state.incidents.length ? 'ok' : 'off', a: state.incidents.length ? `${state.incidents.length} rows` : 'pending' });
  rows.push(ds.mode === 'browser'
    ? { n: 'Live engine', s: 'runs in this browser tab', st: state.sseOk ? 'ok' : 'bad', a: state.sseOk ? 'running' : 'offline' }
    : { n: 'Live stream', s: 'SSE · this server', st: state.sseOk ? 'ok' : 'bad', a: state.sseOk ? 'connected' : 'offline' });
  const ok = rows.filter((r) => r.st === 'ok').length;
  $('#t-src').textContent = `${ok}/${rows.length} OK`;
  $('#srcs').innerHTML = rows.map((r) => `<div class="srci"><i class="d ${r.st === 'ok' ? '' : r.st}"></i><span class="n">${r.n}<small>${r.s}</small>${r.gap ? `<small class="gap">${r.gap}</small>` : ''}</span><span class="a">${r.a}</span></div>`).join('')
    + '<p class="src-note">Independent project · public data only · not affiliated with or endorsed by Helsing.</p>';
}

function renderTop() {
  const s = state.stats;
  const f = state.feeds || {};
  const feeds = ['digitraffic', 'aisstream', 'weather', 'watchlist'].filter((k) => f[k] && (k !== 'aisstream' || f[k].enabled));
  const okFeeds = feeds.filter((k) => f[k].ok).length;
  $('#c-feeds').textContent = feeds.length ? `${okFeeds}/${feeds.length}` : '—';
  $('#c-sweep').textContent = s?.sweepMs != null ? `${(s.sweepMs / 1000).toFixed(1)}s` : '—';
  $('#c-msgs').textContent = s?.msgsPerMin != null ? fmt(Math.round(s.msgsPerMin)) : '—';
  // STALE when the transport is down OR no AIS feed is fresh (the transport being open says nothing about the ships).
  const aisFresh = ['digitraffic', 'aisstream'].some((k) => f[k]?.ok && f[k]?.last && Date.now() - f[k].last < 120e3);
  const transportDown = !state.sseOk && Date.now() - state.lastSnapshot > 30000;
  const stale = transportDown || (!!state.feeds && !aisFresh);
  const lvl = stale ? 'STALE' : s?.level || 'NOMINAL';
  const pill = $('#c-level');
  pill.dataset.level = lvl;
  pill.textContent = lvl === 'STALE' ? (state.lastSnapshot ? 'STALE' : 'CONNECTING') : lvl === 'HIGH' ? 'HIGH ALERT' : lvl;
  const nSig = s?.signals ? Object.values(s.signals).reduce((a, b) => a + b, 0) : 0;
  $('#h-feeds').textContent = `FEEDS ${feeds.length ? okFeeds + '/' + feeds.length : '—'} · SIGNALS ${fmt(nSig)}`;
  $('#h-state').textContent = `STATE ▸ ${stale ? 'STALE' : state.vessels.size ? 'TRACKING' : 'ACQUIRING'}`;
  $('#t-live').textContent = stale ? 'STALE' : 'LIVE';
  $('#t-live').classList.toggle('live', !stale);
}

function tickClock() {
  const now = new Date();
  $('#c-utc').textContent = utc(now).slice(5).replace(' ', ' · ');
  $('#h-utc').textContent = utc(now);
  const s = Math.floor((Date.now() - state.start) / 1000);
  $('#h-session').textContent = `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)} SESSION`;
}

// ---------------------------------------------------------------- dossier
async function openDossier(mmsi) {
  state.selectedMmsi = mmsi;
  const d = $('#dossier');
  const v0 = state.vessels.get(mmsi);
  d.classList.add('on');
  document.body.classList.add('dossier-on');
  d.innerHTML = dossierHTML(v0, null, null, true);
  let data = null;
  try {
    data = await ds.vessel(mmsi);
  } catch {}
  if (state.selectedMmsi !== mmsi) return;
  const v = data?.vessel || v0;
  const alert = data?.alert || [...state.alerts.values()].find((a) => a.mmsi === mmsi) || null;
  const track = data?.track || alert?.track || [];
  d.innerHTML = dossierHTML(v, track, alert, false);
  globe.showTrack(track, v?.level || alert?.level);
}
function closeDossier() {
  state.selectedMmsi = null;
  $('#dossier').classList.remove('on');
  document.body.classList.remove('dossier-on');
  globe.clearTrack();
}
function dossierHTML(v, track, alert, loading) {
  if (!v) return `<div class="dh"><div class="k">VESSEL DOSSIER</div><div class="nm">Unknown</div><button class="x" data-close>×</button></div>`;
  const hours = track && track.length > 1 ? ((track[track.length - 1][2] - track[0][2]) / 3.6e6).toFixed(1) : null;
  return `
    <div class="dh">
      <div class="k">VESSEL DOSSIER${v.level ? ` · <span style="color:var(--${v.level === 'HIGH' ? 'red' : v.level === 'ELEVATED' ? 'amber' : 'cyan'})">${v.level}</span>` : ''}</div>
      <div class="nm">${esc(v.name || 'UNNAMED')}</div>
      <div class="sub">${esc(v.typeLabel || 'Unknown type')}${v.flag ? ' · ' + esc(v.flag) : ''}${v.dest ? ' · → ' + esc(v.dest) : ''}</div>
      <button class="x" data-close>×</button>
    </div>
    <div class="db">
      <div class="kv">
        <div><span>MMSI</span><b>${esc(v.mmsi)}</b></div>
        <div><span>IMO</span><b>${esc(v.imo || '—')}</b></div>
        <div><span>FLAG</span><b>${esc(v.flagCode || v.flag || '—')}</b></div>
        <div><span>SPEED</span><b>${v.sog != null ? v.sog.toFixed(1) + ' kn' : '—'}</b></div>
        <div><span>COURSE</span><b>${v.cog != null && v.cog < 360 ? Math.round(v.cog) + '°' : '—'}</b></div>
        <div><span>LAST FIX</span><b>${v.ts ? ago(v.ts) : '—'}</b></div>
        <div style="grid-column:span 2"><span>POSITION</span><b>${v.lat?.toFixed(4)}°N ${v.lon?.toFixed(4)}°E</b></div>
        <div><span>CORRIDOR</span><b title="${esc(v.corridor || '')}">${esc(v.corridor || 'none')}</b></div>
      </div>
      ${v.watch ? `<div class="watchbox"><div class="k">LISTED VESSEL · ${esc((v.watch.risk || []).join(' · ').toUpperCase())}</div><p>${esc((v.watch.datasets || []).join(', '))}</p>${v.watch.url ? `<p><a href="${esc(v.watch.url)}" target="_blank" rel="noopener">OpenSanctions record ↗</a></p>` : ''}<p style="color:var(--ink-3)">A list match is about ownership or past conduct, not what this ship is doing now.</p></div>` : ''}
      <div class="sech">TRACK${hours ? ` · LAST ${hours} H · ${track.length} FIXES` : ''}</div>
      <div style="font-size:11px;color:var(--ink-3)">${loading ? 'Loading track…' : track && track.length > 1 ? 'Drawn on the map.' : 'No track history yet. It builds up while the server runs.'}</div>
      ${alert ? `<div class="sech">SIGNALS</div><div class="sigs" style="margin:0 0 6px">${alert.signals.map((s) => `<span class="sig ${s.strength} ${s.explained ? 'x' : ''}">${SIGNALS[s.id]?.short || s.id}</span>`).join('')}</div><div style="font-size:11px;color:var(--ink-2)">See <b style="color:var(--amber)">What you shouldn't conclude</b> for the innocent explanations.</div>` : `<div class="sech">SIGNALS</div><div style="font-size:11px;color:var(--ink-3)">No anomaly rules triggered for this ship.</div>`}
      ${v.watch && v.watch.url ? '' : ''}
    </div>`;
}

function selectAlert(id, fly = true) {
  const a = state.alerts.get(id);
  $('#hint')?.classList.add('gone');
  state.selectedAlert = a ? id : null;
  renderAlerts();
  renderShouldnt();
  if (!a) { globe.setTasking(null); return; }
  if (fly && typeof a.lon === 'number') globe.flyPoint(a.lon, a.lat, 120000);
  openDossier(a.mmsi);
  globe.setTasking(a);
  if (MOBILE()) setSheetTab('ALERTS', true);
}

// ---------------------------------------------------------------- data
let gliderWorker = null;
let gliderSeq = 0;
function gliderSamples() {
  const out = [];
  for (const a of namedAssets()) {
    const c = a.coords;
    let acc = 0;
    for (let i = 0; i < c.length; i++) {
      if (i === 0) { out.push({ name: a.name, lon: c[0][0], lat: c[0][1] }); continue; }
      const d = kmBetween(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
      if (d > 50) { acc = 0; continue; } // jump between parts
      acc += d;
      if (acc >= 3) { out.push({ name: a.name, lon: c[i][0], lat: c[i][1] }); acc = 0; }
    }
  }
  return out;
}
function deriveGrid() {
  // fallback when grid.json is absent: bin infra km into 0.05° cells (depth unknown → treated as OK)
  if (!state.infra) return null;
  const size = 0.05;
  const m = new Map();
  for (const f of state.infra.features) {
    const g = f.geometry;
    const named = f.properties?.named ? 1 : 0;
    const parts = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
    for (const p of parts) {
      for (let i = 1; i < p.length; i++) {
        const d = kmBetween(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
        const n = Math.max(1, Math.ceil(d / 1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const lon = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
          const lat = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
          const key = `${Math.floor(lon / size)}:${Math.floor(lat / size)}`;
          const e = m.get(key) || [(Math.floor(lon / size) + 0.5) * size, (Math.floor(lat / size) + 0.5) * size, 0, 0, 1];
          e[2] += d / n;
          e[3] = Math.max(e[3], named);
          m.set(key, e);
        }
      }
    }
  }
  return { cell: size, cells: [...m.values()], derived: true };
}
function initGliderWorker() {
  const grid = state.grid && state.grid.cells?.length ? state.grid : deriveGrid();
  if (!grid) return;
  if (!gliderWorker) {
    gliderWorker = new GliderWorker();
    gliderWorker.onmessage = (e) => {
      const r = e.data;
      if (r.seq !== gliderSeq) return;
      state.glider.res = r;
      globe.setGliders(r.ready ? r.gliders : [], state.glider.R);
      const sel = state.selectedAlert && state.alerts.get(state.selectedAlert);
      globe.setTasking(sel || null);
      renderGlider();
      renderLayers();
    };
  }
  gliderWorker.postMessage({ type: 'init', grid, heat: state.heat, samples: gliderSamples() });
  queryGliders();
}
let gq = null;
function queryGliders() {
  if (!gliderWorker) return;
  cancelAnimationFrame(gq);
  gq = requestAnimationFrame(() => {
    gliderWorker.postMessage({ type: 'query', N: state.glider.N, R: state.glider.R, seq: ++gliderSeq });
  });
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const t = await r.text();
    if (!t.trim()) return null;
    return JSON.parse(t);
  } catch {
    return null;
  }
}

let coastLoaded = false;
function openBrief() {
  let el = $('#brief');
  if (!el) {
    document.body.insertAdjacentHTML('beforeend', '<div class="brief" id="brief" role="dialog" aria-modal="true" aria-label="Daily brief"><div class="bf-box"><button class="bf-x" id="brief-x" aria-label="Close">✕</button><div id="brief-body"></div></div></div>');
    el = $('#brief');
  }
  $('#brief-body').innerHTML = renderBrief(state.brief);
  el.classList.add('on');
}

// Optional data published by GitHub Actions. Dev-only fixtures: ?sarsample / ?briefsample (never in a production build).
async function loadOptional(name) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has(`${name}sample`)) {
    const m = name === 'sar' ? await import('../dev/sar.sample.json') : await import('../dev/brief.sample.json');
    return m.default;
  }
  return getJSON(asset(`data/${name}.json`));
}

async function loadStatic() {
  if (heroGlobe && !heroGlobe.landAt) await new Promise((res) => { heroGlobe.on('land', res); setTimeout(res, 1500); });
  if (!coastLoaded) getJSON(asset('geo/coast.json')).then((c) => { if (c) { coastLoaded = true; globe.setCoast(c); } });
  if (!state.landLoaded) getJSON(asset('geo/land.json')).then((l) => { if (l) { state.landLoaded = true; globe.setLand(l); } });
  const [infra, incidents, grid, sar, brief] = await Promise.all([getJSON(asset('data/infra.geojson')), getJSON(asset('data/incidents.json')), getJSON(asset('data/grid.json')), loadOptional('sar'), loadOptional('brief')]);
  if (sar?.unmatchedCells) { state.sar = sar; flat.setSar(sar.unmatchedCells); renderLegend(); renderSources(); renderShouldnt(); }
  if (brief?.generated) state.brief = brief;
  if (infra && infra.features) {
    state.infra = infra;
    globe.setInfra(infra);
    heroGlobe?.setInfra(infra.features);
  }
  const incList = Array.isArray(incidents) ? incidents : Array.isArray(incidents?.incidents) ? incidents.incidents : null;
  if (incList) {
    state.incidents = incList;
    state.incidentNote = incidents?.note || null;
    globe.setIncidents(incList);
    heroGlobe?.setIncidents(incList);
  }
  if (grid && grid.cells) {
    state.grid = grid;
    const depthOn = grid.cells.some((c) => c[4] !== 1);
    const gd = $('#g-depth');
    if (gd) gd.textContent = depthOn ? 'Depth mask on (EMODnet bathymetry): shallow cells are down-weighted.' : 'Depth not modelled (no bathymetry mask in this build).';
  }
  if (state.infra) {
    let km = 0;
    for (const f of state.infra.features) {
      const g = f.geometry;
      const parts = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
      for (const p of parts) for (let i = 1; i < p.length; i++) km += kmBetween(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    }
    const hk = $('#hero-km');
    if (hk) hk.textContent = fmt(Math.round(km / 100) * 100);
  }
  renderAssets();
  renderLayers();
  renderIncidents();
  renderShouldnt();
  renderSources();
  initGliderWorker();
  // retry missing static files later (they may still be being generated)
  if (!state.infra || !state.incidents.length) setTimeout(loadStatic, 20000);
}

function pushHist() {
  const s = state.stats;
  if (!s) return;
  const h = state.hist;
  const add = (k, v) => { h[k].push(v ?? 0); if (h[k].length > 40) h[k].shift(); };
  add('vessels', s.vessels);
  add('inCorridor', s.inCorridor);
  add('watchlist', s.watchlist);
  add('dark', s.dark);
  add('alerts', (s.alerts?.WATCH || 0) + (s.alerts?.ELEVATED || 0) + (s.alerts?.HIGH || 0));
}

function applyVessels(upd, del) {
  if (upd?.length) {
    for (const v of upd) state.vessels.set(v.mmsi, v);
    globe.upsertVessels(upd);
    if (heroGlobe) heroGlobe.setVessels([...state.vessels.values()]);
    state.lastVesselMsg = Date.now();
  }
  if (del?.length) {
    for (const id of del) state.vessels.delete(id);
    globe.removeVessels(del);
  }
}
function applyAlert(a) {
  if (!a || !a.id) return;
  state.alerts.set(a.id, a);
}

async function loadSnapshot() {
  const s = await ds.snapshot();
  if (!s) return false;
  state.lastSnapshot = Date.now();
  state.feeds = s.feeds || null;
  state.stats = s.stats || null;
  state.heat = s.heat || [];
  applyVessels(s.vessels || [], []);
  state.alerts.clear();
  (s.alerts || []).forEach(applyAlert);
  pushHist();
  renderAll();
  if (gliderWorker) {
    gliderWorker.postMessage({ type: 'heat', grid: state.grid?.cells?.length ? state.grid : deriveGrid(), heat: state.heat });
    queryGliders();
  }
  return true;
}

function connectStream() {
  ds.subscribe({
    open: () => { state.sseOk = true; renderSources(); renderTop(); },
    error: () => { state.sseOk = false; renderSources(); renderTop(); },
    vessels: (d) => { applyVessels(d.upd, d.del); throttledRender(); },
    alert: (a) => { applyAlert(a); renderAlerts(); renderMeters(); if (state.selectedAlert) renderShouldnt(); },
    alert_clear: ({ id }) => {
      state.alerts.delete(id);
      if (state.selectedAlert === id) { state.selectedAlert = null; renderShouldnt(); globe.setTasking(null); }
      renderAlerts();
    },
    stats: (st) => { state.stats = st; pushHist(); renderTiles(); renderMeters(); renderTop(); },
    feeds: (f) => { state.feeds = f; renderSources(); renderTop(); renderLayers(); },
    heat: (h) => {
      state.heat = h;
      if (gliderWorker) {
        gliderWorker.postMessage({ type: 'heat', grid: state.grid?.cells?.length ? state.grid : deriveGrid(), heat: state.heat });
        queryGliders();
      }
    },
  });
}

let rt = 0;
function throttledRender() {
  if (rt) return;
  rt = setTimeout(() => {
    rt = 0;
    renderLayers();
    renderAssets();
    if (!state.stats) renderTiles();
  }, 1500);
}

function renderAll() {
  renderTiles();
  renderLayers();
  renderAssets();
  renderAlerts();
  renderMeters();
  renderShouldnt();
  renderSources();
  renderTop();
}

// ---------------------------------------------------------------- mobile sheet
const SHEET_TABS = ['ALERTS', 'ASSETS', 'INCIDENTS', 'GLIDERS', 'SOURCES'];
let sheetTab = 'ALERTS';
let sheetMode = null;
function layoutForViewport() {
  const mobile = MOBILE();
  if (mobile === sheetMode) return;
  sheetMode = mobile;
  const panels = $$('section.panel[data-tab]');
  if (mobile) {
    const body = $('#sbody');
    panels.forEach((p) => {
      p.dataset.home = p.dataset.home || (p.parentElement.classList.contains('bottom') ? 'bottom' : p.parentElement.classList.contains('col-left') ? 'left' : 'right');
      body.appendChild(p);
    });
    $('#stabs').innerHTML = SHEET_TABS.map((t) => `<button data-t="${t}" class="${t === sheetTab ? 'on' : ''}">${t}</button>`).join('');
    setSheetTab(sheetTab);
  } else {
    const homes = { left: $('.col-left'), right: $('.col-right'), bottom: $('.bottom') };
    // restore original order
    const order = ['Sensor Grid', 'Data Layers', 'Critical Assets', 'Visual Presets', 'Alert Stream', 'Signal Core', "What you shouldn't conclude", 'Incident Log', 'Glider Coverage', 'Data Sources'];
    panels.sort((a, b) => order.indexOf($('.t', a).textContent) - order.indexOf($('.t', b).textContent));
    panels.forEach((p) => { p.hidden = false; if (p.dataset.home) homes[p.dataset.home].appendChild(p); });
  }
  setTimeout(() => { resize3d(); flat.resize(); buildRing(); }, 60);
}
function setSheetTab(t, expand) {
  sheetTab = t;
  $$('#stabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  $$('#sbody section.panel').forEach((p) => { p.hidden = p.dataset.tab !== t; });
  if (expand) $('#sheet').classList.remove('min');
}

// ---------------------------------------------------------------- globe + events
// Two views of the same data: the flat d3 map (default dashboard view) and the Cesium globe (intro + GLOBE mode).
// Data setters go to both; camera, picking and counting go to whichever is active.
// Cesium (~3.6 MB) is loaded on demand: only for the intro globe or 3D GLOBE mode. Until it loads, data-setter calls
// are recorded and replayed into it, so the globe always shows the same picture as the flat map.
let globe3d = null, globeLoading = null;
const replay = new Map();
const gHandlers = [];
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function record(k, a) {
  if (k === 'upsertVessels' || k === 'removeVessels') return; // replayed from state.vessels instead
  if (k === 'setLayer') replay.set(`setLayer:${a[0]}`, [k, a]);
  else if (k === 'showTrack' || k === 'clearTrack') replay.set('track', [k, a]);
  else replay.set(k, [k, a]);
}
function loadGlobe() {
  if (!globeLoading) {
    globeLoading = import('./globe.js').then(({ createGlobe }) => {
      globe3d = createGlobe($('#globe'));
      for (const [ev, f] of gHandlers) globe3d.on(ev, f);
      for (const [k, a] of replay.values()) globe3d[k](...a);
      if (state.vessels.size) globe3d.upsertVessels([...state.vessels.values()]);
      if (viewMode === 'flat') globe3d.viewer.useDefaultRenderLoop = false;
      window.__bsw.globe = globe3d;
      return globe3d;
    });
  }
  return globeLoading;
}
const resize3d = () => globe3d?.viewer.resize();
const flat = createFlatMap($('#flat'));
let viewMode = 'flat'; // flat map by default; 'globe' only when the user opens 3D GLOBE
const activeView = () => (viewMode === 'flat' || !globe3d ? flat : globe3d);
const BOTH = ['setInfra', 'setCoast', 'setLand', 'setIncidents', 'upsertVessels', 'removeVessels', 'setFocus', 'setGliders', 'setLayer', 'showTrack', 'clearTrack', 'setReserved'];
const globe = {
  flyRegion: (...a) => activeView().flyRegion(...a),
  flyPoint: (...a) => activeView().flyPoint(...a),
  countInView: () => activeView().countInView(),
  setTasking: (a) => { const r = flat.setTasking(a); globe3d?.setTasking(viewMode === 'globe' ? a : null); return r; },
  on: (ev, f) => { flat.on(ev, (...a) => viewMode === 'flat' && f(...a)); const g = (...a) => viewMode === 'globe' && f(...a); gHandlers.push([ev, g]); globe3d?.on(ev, g); },
};
for (const k of BOTH) globe[k] = (...a) => { flat[k](...a); record(k, a); return globe3d?.[k](...a); };
async function setViewMode(m, { fly = true } = {}) {
  if (m === 'globe' && !globe3d) {
    const btn = $('#b-mode'); btn.textContent = 'LOADING…'; btn.disabled = true;
    try { await loadGlobe(); } finally { btn.disabled = false; }
  }
  viewMode = m;
  document.body.classList.toggle('view-flat', m === 'flat');
  document.body.classList.toggle('view-globe', m === 'globe');
  if (globe3d) {
    if (m === 'globe') globe3d.viewer.useDefaultRenderLoop = true;
    else setTimeout(() => { if (viewMode === 'flat' && globe3d) globe3d.viewer.useDefaultRenderLoop = false; }, 800); // after the cross-fade
  }
  $('#b-mode').textContent = m === 'flat' ? '3D GLOBE' : '2D MAP';
  if (m === 'flat') { flat.resize(); if (fly) flat.flyRegion(state.region || 'BALTIC', 0); }
  else { resize3d(); if (fly) globe3d.flyRegion(state.region || 'BALTIC', REDUCED ? 0 : 1.2); }
  if (state.selectedAlert) { const a = state.alerts.get(state.selectedAlert); globe.setTasking(a || null); }
  buildRing();
}
window.__bsw = { globe: null, flat, state, setViewMode, loadGlobe }; // debug handle

buildRing();
renderRegions();
renderPresets();
renderLegend();
renderTiles();
renderLayers();
renderGlider();
renderAll();
renderIncidents();
tickClock();
setInterval(tickClock, 1000);
setInterval(() => { renderTop(); renderSources(); renderLayers(); }, 5000);

let introDone = false;
const params = new URLSearchParams(location.search);
const HOLD = params.has('hold');
$('#ring').classList.add('on');
// Intro → dashboard: the canvas globe swoops onto the Baltic, framed exactly like the flat map's opening view,
// then cross-fades into it. Cesium is never loaded for the intro (only for 3D GLOBE mode).
const INTRO_MS = 7700;
function exitHero() {
  if (!document.body.classList.contains('hero-on')) return;
  ['wheel', 'keydown', 'touchmove'].forEach((ev) => window.removeEventListener(ev, exitHero));
  document.body.classList.remove('hero-on');
  document.body.classList.add('hero-out');
  flat.resize(); buildRing(); // lay the dashboard out first so the swoop targets the final frame
  flat.flyRegion('BALTIC', 0);
  const hero = $('#hero');
  const finish = () => {
    introDone = true;
    hero?.classList.add('done'); // canvas fades out over the flat map
    setTimeout(() => { document.body.classList.remove('hero-out'); heroGlobe?.destroy(); heroGlobe = null; hero?.remove(); }, 550);
    maybeOfferTour();
  };
  const r = $('#flat').getBoundingClientRect();
  if (heroGlobe && !REDUCED) heroGlobe.swoop(r, FLAT_VIEW, { duration: 1400, pad: Math.min(r.width, r.height) * 0.04, clip: true, done: finish });
  else finish();
}
setViewMode('flat', { fly: false });
if (params.has('nohero')) {
  introDone = true;
  document.body.classList.remove('hero-on');
  $('#hero')?.remove();
  setTimeout(maybeOfferTour, 1500);
} else {
  $('#hero').addEventListener('click', (e) => { if (e.target.closest('.byline')) return; exitHero(e); });
  ['wheel', 'keydown', 'touchmove'].forEach((ev) => window.addEventListener(ev, exitHero, { passive: true }));
  if (!HOLD) setTimeout(exitHero, INTRO_MS);
}
setInterval(() => { const n = $('#hero-n'); if (n && state.vessels.size) n.textContent = fmt(state.vessels.size); }, 500);

globe.on('camera', (c) => {
  $('#h-cam').textContent = `${Math.abs(c.lat).toFixed(3)}°${c.lat >= 0 ? 'N' : 'S'}  ${Math.abs(c.lon).toFixed(3)}°${c.lon >= 0 ? 'E' : 'W'}`;
  if (c.flat) $('#h-cam2').textContent = `VIEW ${fmt(Math.round(c.spanKm))} KM ACROSS · ZOOM ${c.k.toFixed(1)}×`;
  else {
    const alt = c.alt > 100000 ? `${fmt(Math.round(c.alt / 1000))} KM` : `${(c.alt / 1000).toFixed(1)} KM`;
    $('#h-cam2').textContent = `ALT ${alt} · PITCH ${Math.round(c.pitch)}°`;
  }
  $('#ring').classList.toggle('on', viewMode === 'globe' && (c.alt > 4500000 || !introDone));
  const n = globe.countInView();
  if (n !== state.inView) { state.inView = n; setNum($('#h-obs'), n, { dur: 400 }); }
});

const tip = $('#tip');
// map labels avoid the HUD overlays
globe.setReserved(() => {
  const g = $('#globe').getBoundingClientRect();
  const out = [];
  for (const sel of ['.hud.tl', '.hud.tr', '.hud.bl', '.hud.br', '.legend', '#hint:not(.gone)', '.focus-bar.on', '#dossier.on', '#regions']) {
    const el = document.querySelector(sel);
    if (!el || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push([r.left - g.left - 4, r.top - g.top - 4, r.right - g.left + 4, r.bottom - g.top + 4]);
  }
  return out;
});
globe.on('hover', (id, pos) => {
  if (!id) { tip.style.display = 'none'; return; }
  const r = $('#globe').getBoundingClientRect();
  let html = '';
  if (id.kind === 'vessel') {
    const v = state.vessels.get(id.mmsi);
    if (!v) return;
    html = `${esc(v.name || 'MMSI ' + v.mmsi)}<small>${esc(v.typeLabel || '')}${v.flagCode ? ' · ' + esc(v.flagCode) : ''} · ${v.sog != null ? v.sog.toFixed(1) + ' kn' : ''}${v.level ? ' · ' + v.level : ''}${v.watch ? ' · LISTED' : ''}</small>`;
  } else if (id.kind === 'infra') {
    html = `${esc(id.name || 'Unnamed line')}<small>${id.infraKind === 'pipeline' ? 'PIPELINE' : id.infraKind === 'power' ? 'POWER CABLE' : 'TELECOM CABLE'}${id.named ? ' · CRITICAL ASSET' : ''}</small>`;
  } else if (id.kind === 'incident') {
    const i = state.incidents.find((x) => x.id === id.id);
    if (!i) return;
    html = `${esc(i.title)}<small>${esc(i.date)} · ${esc(i.outcomeStatus || '')} · approx. location</small>`;
  } else if (id.kind === 'sar') {
    html = `${fmt(id.n)} radar detection${id.n === 1 ? '' : 's'} not matched to AIS<small>last ${esc(id.last || '?')} · ${state.sar?.lagDays ?? 5}-day data lag · Global Fishing Watch</small>`;
  } else if (id.kind === 'glider') {
    html = `GLIDER ${pad(id.i + 1, 3)} (SIM)<small>R ${state.glider.R} km · racetrack patrol</small>`;
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = `${r.left + pos.x + 14}px`;
  tip.style.top = `${r.top + pos.y + 14}px`;
});
function dismissHint() { $('#hint')?.classList.add('gone'); }
globe.on('pick', (id) => {
  tip.style.display = 'none';
  if (!id) return;
  dismissHint();
  if (id.kind === 'vessel') {
    const a = [...state.alerts.values()].find((x) => x.mmsi === id.mmsi);
    if (a) selectAlert(a.id, false);
    else { state.selectedAlert = null; renderAlerts(); renderShouldnt(); globe.setTasking(null); openDossier(id.mmsi); }
  } else if (id.kind === 'incident') {
    flyIncident(id.id);
  }
});

function flyIncident(id) {
  const i = state.incidents.find((x) => x.id === id);
  if (i && typeof i.lon === 'number') globe.flyPoint(i.lon, i.lat, 260000);
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('#z-in')) { viewMode === 'flat' || !globe3d ? flat.zoomBy(1.8) : globe3d.viewer.camera.zoomIn(globe3d.viewer.camera.positionCartographic.height * 0.4); return; }
  if (t.closest('#z-out')) { viewMode === 'flat' || !globe3d ? flat.zoomBy(1 / 1.8) : globe3d.viewer.camera.zoomOut(globe3d.viewer.camera.positionCartographic.height * 0.6); return; }
  if (t.closest('#b-mode')) { setViewMode(viewMode === 'flat' ? 'globe' : 'flat'); return; }
  const reg = t.closest('.tab[data-r]');
  if (reg) { state.region = reg.dataset.r; renderRegions(); globe.flyRegion(state.region); return; }
  const tl = t.closest('#tiles .tile[data-k]');
  if (tl) { setFocus(tl.dataset.k); return; }
  if (t.closest('[data-unfocus]')) { state.focusTile = null; setFocus(null); return; }
  if (t.closest('#b-tour')) { startTour(); return; }
  const pr = t.closest('.preset');
  if (pr) { setPreset(pr.dataset.p); return; }
  const al = t.closest('.alert[data-id]');
  if (al) { selectAlert(al.dataset.id); return; }
  const as = t.closest('.asset[data-name]');
  if (as) {
    const a = namedAssets().find((x) => x.name === as.dataset.name);
    if (a && a.coords.length) {
      const mid = a.coords[Math.floor(a.coords.length / 2)];
      globe.flyPoint(mid[0], mid[1], 380000);
      if (MOBILE()) $('#sheet').classList.add('min');
    }
    return;
  }
  if (t.closest('a[href]')) return;
  const inc = t.closest('.inc[data-id]');
  if (inc) { flyIncident(inc.dataset.id); if (MOBILE()) $('#sheet').classList.add('min'); return; }
  const lg = t.closest('.lg[data-k]');
  if (lg) { toggleLayer(lg.dataset.k); return; }
  if (t.closest('[data-close]')) { closeDossier(); state.selectedAlert = null; renderAlerts(); renderShouldnt(); globe.setTasking(null); return; }
  if (t.closest('#b-signals')) { $('#modal').classList.add('on'); return; }
  if (t.closest('#b-brief')) { openBrief(); return; }
  if (t.closest('#brief-x') || t.id === 'brief') { $('#brief').classList.remove('on'); return; }
  if (t.closest('#modal-x') || t.id === 'modal') { $('#modal').classList.remove('on'); return; }
  const st = t.closest('#stabs button');
  if (st) { setSheetTab(st.dataset.t, true); return; }
  if (t.closest('#grab')) { $('#sheet').classList.toggle('min'); return; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#modal').classList.remove('on'); $('#brief')?.classList.remove('on'); closeDossier(); if (state.focusTile) { state.focusTile = null; setFocus(null); } }
});

// ---------------------------------------------------------------- tooltips for [data-tip]
let tipEl = null;
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el || el === tipEl) return;
  tipEl = el;
  const r = el.getBoundingClientRect();
  tip.innerHTML = `<span class="tt">${esc(el.dataset.tip)}</span>`;
  tip.classList.add('ui');
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = r.top - h - 8;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});
document.addEventListener('mouseout', (e) => {
  if (!tipEl) return;
  const to = e.relatedTarget;
  if (to && tipEl.contains(to)) return;
  tipEl = null;
  tip.classList.remove('ui');
  tip.style.display = 'none';
});

// ---------------------------------------------------------------- guided tour
const tabPanel = (tab, sel) => () => (MOBILE() ? '#sheet' : sel);
function onTab(tab) { if (MOBILE()) setSheetTab(tab, true); }
const TOUR_STEPS = [
  {
    target: () => '#frame',
    title: 'A live map of the Baltic',
    body: 'Every dot is a <b>real ship</b> reporting its position right now. The glowing lines are seabed infrastructure: <span class="c-cy">telecom cables</span>, <span class="c-vi">power cables</span> and <span class="c-am">gas pipelines</span>. Red <span class="c-rd">◆</span> marks past incidents.',
    before: () => { if (MOBILE()) $('#sheet').classList.add('min'); globe.flyRegion('BALTIC', 1.6); },
    wait: 700, pad: 0,
  },
  {
    target: tabPanel('ALERTS', '.col-right .panel'),
    title: 'Alerts are patterns, not findings',
    body: 'When a ship <b>loiters</b>, <b>slows sharply</b> or <b>goes silent</b> over a cable, it lands here. Click one to fly to it.<br><span class="lv w">WATCH</span> one signal · <span class="lv e">ELEVATED</span> two · <span class="lv h">HIGH</span> three, including a drag or AIS gap.',
    before: () => onTab('ALERTS'),
  },
  {
    target: () => (MOBILE() ? '#sheet' : (state.selectedAlert ? '#dossier' : '.col-right .panel.sc')),
    title: "Why it's probably innocent",
    body: "Selecting an alert opens the ship's <b>dossier</b> (track, flag, any sanctions listing) and <b>What you shouldn't conclude</b>: the weather, nearby anchorages, ship type and receiver coverage that could explain it, and how past cases actually ended.",
    before: () => {
      const a = sortedAlerts()[0];
      if (a) selectAlert(a.id, true);
      onTab('ALERTS');
    },
    wait: 1300,
  },
  {
    target: tabPanel('ASSETS', '.col-left .panel:nth-child(3)'),
    title: 'Critical assets & regions',
    body: 'The cables and pipelines named in past incidents, and how many ships are inside their 1.5 nm corridor <b>right now</b>. Click one, or use the region tabs above the map, to fly there.',
    before: () => {
      closeDossier(); state.selectedAlert = null; renderAlerts(); renderShouldnt(); globe.setTasking(null);
      state.region = 'GULF OF FINLAND'; renderRegions(); globe.flyRegion('GULF OF FINLAND', 1.6);
      onTab('ASSETS');
    },
    wait: 600,
  },
  {
    target: tabPanel('INCIDENTS', '.bottom .panel:nth-child(1)'),
    title: 'What actually happened before',
    body: 'Seven real cases since 2022, each with sources. Read the outcome chips: <b>dismissed</b>, <b>inconclusive</b>, <b>accident</b>, <b>open</b>. Ship-tracking data alone has never settled one of them.',
    before: () => onTab('INCIDENTS'),
  },
  {
    target: tabPanel('GLIDERS', '.bottom .panel:nth-child(2)'),
    title: 'What listening below the surface would add',
    body: 'A clearly labelled <b>simulation</b>: drag the slider to place up to 300 autonomous underwater gliders along the corridors and watch the coverage change. The assumptions are spelled out; none of it uses real glider data.',
    before: () => { state.region = 'BALTIC'; renderRegions(); globe.flyRegion('BALTIC', 1.6); onTab('GLIDERS'); },
    wait: 500,
  },
  {
    target: tabPanel('SOURCES', '.bottom .panel:nth-child(3)'),
    title: 'All public data. Gaps flagged.',
    body: 'Every feed, how fresh it is, and what is missing (in amber). Hover any <i class="info inl">i</i> or tile for a plain-English explanation. Replay this tour any time with <b>? TOUR</b>.',
    before: () => onTab('SOURCES'),
  },
];
const tour = createTour(TOUR_STEPS, { onEnd: () => { if (MOBILE()) { setSheetTab('ALERTS'); $('#sheet').classList.add('min'); } } });
function startTour() { $('.tour-offer')?.remove(); tour.start(); }
function maybeOfferTour() { if (!params.has('notour') && !params.has('tour') && !tour.active()) offerTour(startTour); }
if (params.has('tour')) setTimeout(startTour, params.has('nohero') ? 1200 : 7700 + 2200);

window.addEventListener('resize', () => { layoutForViewport(); buildRing(); });
layoutForViewport();

loadStatic();
(async () => {
  const ok = await loadSnapshot();
  connectStream();
  if (!ok) setTimeout(loadSnapshot, 8000);
  // periodic resync guards against missed deltas
  setInterval(loadSnapshot, 5 * 60 * 1000);
})();

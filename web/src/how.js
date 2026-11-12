import './how.css';
import { asset } from './base.js';
import { renderBrief } from './brief.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } }

async function loadBrief() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('briefsample')) return (await import('../dev/brief.sample.json')).default;
  return getJSON(asset('data/brief.json'));
}

const STATUS = { dismissed: 'Dismissed', cleared: 'Cleared', inconclusive: 'Inconclusive', accident: 'Ruled an accident', open: 'Open', acknowledged: 'Acknowledged' };

(async () => {
  const [inc, brief] = await Promise.all([getJSON(asset('data/incidents.json')), loadBrief()]);
  const list = Array.isArray(inc) ? inc : inc?.incidents || [];
  document.getElementById('h-inc').innerHTML = list.length ? `<ol>${list.map((i) => `
    <li>
      <div class="d">${esc((i.date || '').slice(0, 7))}</div>
      <div class="b">
        <div class="t">${esc(i.title)}${i.vessel?.name ? ` <span>· ${esc(i.vessel.name)}</span>` : ''}</div>
        <div class="o"><span class="st st-${esc(i.outcomeStatus)}">${esc(STATUS[i.outcomeStatus] || i.outcomeStatus || '')}</span> ${esc(i.outcome || '')}</div>
        <div class="s">${(i.sources || []).slice(0, 3).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('')}</div>
      </div>
    </li>`).join('')}</ol>` : '<p class="h-dim">Incident log unavailable.</p>';
  document.getElementById('h-brief').innerHTML = renderBrief(brief);
})();

// calm reveal on scroll
const io = 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 })
  : null;
document.querySelectorAll('.h-sec').forEach((s) => (io ? io.observe(s) : s.classList.add('in')));

// numbered accordion: one item open, screenshot swaps with it
const acc = document.getElementById('h-acc'), shotImg = document.querySelector('#h-shot img');
const ALT = { watch: 'Live flat map of the Baltic with ships and seabed lines', signals: 'Alert stream and a ship dossier with its signals', honesty: "The \u201cwhat you shouldn't conclude\u201d panel next to an alert", incidents: 'Gulf of Finland with incident markers and cable routes', gliders: 'Simulated glider coverage discs over the cable corridors' };
function openItem(li) {
  if (!li || li.classList.contains('on')) return;
  acc.querySelectorAll('li').forEach((x) => { x.classList.toggle('on', x === li); x.querySelector('button').setAttribute('aria-expanded', x === li); });
  const k = li.dataset.shot; shotImg.classList.add('fade');
  setTimeout(() => { shotImg.src = asset(`shots/${k}.webp`); shotImg.alt = ALT[k] || ''; shotImg.onload = () => shotImg.classList.remove('fade'); }, 180);
}
acc?.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) openItem(li); });
// preload the other screenshots once the page is idle
(window.requestIdleCallback || setTimeout)(() => ['signals', 'honesty', 'incidents', 'gliders'].forEach((k) => { const i = new Image(); i.src = asset(`shots/${k}.webp`); }));

// live figures in the stats row
(async () => {
  const fmt = (n) => n.toLocaleString('en-GB');
  const [inc, hist, infra] = await Promise.all([getJSON(asset('data/incidents.json')), getJSON(asset('data/brief.json')), getJSON(asset('data/infra.geojson'))]);
  const list = Array.isArray(inc) ? inc : inc?.incidents || [];
  if (list.length) document.getElementById('s-inc').textContent = list.length;
  if (hist?.stats?.vessels) document.getElementById('s-ships').textContent = fmt(hist.stats.vessels);
  if (infra?.features) {
    let km = 0; const R = 6371, rad = Math.PI / 180;
    for (const f of infra.features) { const g = f.geometry; const parts = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
      for (const p of parts) for (let i = 1; i < p.length; i++) { const [a, b] = [p[i - 1], p[i]]; const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2; km += 2 * R * Math.asin(Math.sqrt(h)); } }
    document.getElementById('s-km').textContent = fmt(Math.round(km / 100) * 100);
  }
})();

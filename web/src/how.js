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

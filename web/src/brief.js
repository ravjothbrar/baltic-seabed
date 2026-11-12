// Daily brief renderer, shared by the dashboard overlay and how.html.
// Data: data/brief.json, published by a daily GitHub Action.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(+n) ? '—' : Number(n).toLocaleString('en-GB'));

function spark(history, key, color) {
  const vals = (history || []).map((h) => (key === 'alerts' && typeof h.alerts === 'object' ? Object.values(h.alerts).reduce((a, b) => a + b, 0) : +h[key] || 0));
  if (vals.length < 2) return '<span class="bf-nospark">history builds daily</span>';
  const w = 120, h = 28, max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg class="bf-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="${color}"/></svg>`;
}

const alertsTotal = (a) => (a ? (a.WATCH || 0) + (a.ELEVATED || 0) + (a.HIGH || 0) : 0);

/** Returns the inner HTML of a brief. `compact` drops the header (for embedding). */
export function renderBrief(b, { compact = false } = {}) {
  if (!b || !b.generated) {
    return `<div class="bf-empty"><div class="bf-k">DAILY BRIEF</div><p>First brief publishes after the next daily run.</p><p class="bf-dim">It is generated each morning by a GitHub Action from the last ${b?.windowHours || 6} h of live data, and sits beside the map, not instead of it.</p></div>`;
  }
  const d = new Date(b.generated);
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const st = b.stats || {};
  const top = (b.top || []).slice(0, 5);
  const head = compact ? '' : `
    <header class="bf-head">
      <div class="bf-k">BALTIC SEABED WATCH · DAILY BRIEF</div>
      <h2>${esc(date)}</h2>
      <div class="bf-sub">Generated ${esc(d.toISOString().slice(11, 16))}Z · last ${b.windowHours || 6} h of public data · UNCLASSIFIED // OPEN SOURCE</div>
    </header>`;
  const nums = `
    <div class="bf-nums">
      <div><span>VESSELS SEEN</span><b>${fmt(st.vessels)}</b>${spark(b.history, 'vessels', '#cfe9e6')}</div>
      <div><span>LISTED VESSELS</span><b class="mag">${fmt(st.listed)}</b>${spark(b.history, 'listed', '#ff5fd2')}</div>
      <div><span>ALERTS</span><b class="amb">${fmt(alertsTotal(st.alerts))}</b><small>${fmt(st.alerts?.WATCH)} watch · ${fmt(st.alerts?.ELEVATED)} elevated · ${fmt(st.alerts?.HIGH)} high</small>${spark(b.history, 'alerts', '#ffb547')}</div>
    </div>`;
  const items = top.length ? top.map((t, i) => `
    <li class="bf-item">
      <div class="bf-n">${String(i + 1).padStart(2, '0')}</div>
      <div class="bf-body">
        <div class="bf-t"><span class="lvl" data-level="${esc(t.level)}">${esc(t.level)}</span> <b>${esc(t.name || 'MMSI ' + t.mmsi)}</b> <span class="bf-dim">${esc([t.typeLabel, t.flag].filter(Boolean).join(' · '))}${t.asset ? ' · near ' + esc(t.asset) : ''}</span></div>
        <div class="bf-sigs">${(t.signals || []).map((s) => `<span class="bf-sig ${s.explained ? 'x' : ''}" title="${esc(s.evidence || '')}">${esc(s.label || s.id)}${s.explained ? ' · explained' : ''}</span>`).join('')}</div>
        ${t.caveat ? `<div class="bf-cav">Why it may be nothing: ${esc(t.caveat)}</div>` : ''}
      </div>
    </li>`).join('') : '<li class="bf-item bf-dim">No alerts in the window. That is the normal state of the Baltic.</li>';
  const sar = b.sar ? `<div class="bf-sar"><span class="bf-k">SATELLITE RADAR · GLOBAL FISHING WATCH</span><p>${fmt(b.sar.detections)} radar vessel detections over ${b.sar.windowDays || 30} days; <b>${fmt(b.sar.unmatched)}</b> had no matching AIS broadcast. Most unmatched detections are small craft, offshore structures or timing gaps; the data lags by several days.</p></div>` : '';
  const notes = (b.notes || []).length ? `<ul class="bf-notes">${b.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `${head}${nums}
    <div class="bf-k bf-sec">TOP ${top.length || ''} ITEMS</div>
    <ol class="bf-list">${items}</ol>
    ${sar}${notes}
    <footer class="bf-foot">Every item is a pattern in self-reported AIS, not a finding. AIS can be spoofed or switched off and sees nothing below the surface. Nothing here is evidence of intent.</footer>`;
}

// Command-palette search (⌘K / Ctrl+K or /): ships, alerts, named assets, incidents, places and map regions.
// Items are built fresh on every open from whatever is currently loaded, so it never shows anything not on the map.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Score one key against the query: prefix > word prefix > substring > in-order letters (fuzzy). 0 = no match.
function scoreKey(key, q) {
  if (!key) return 0;
  if (key === q) return 120;
  if (key.startsWith(q)) return 100 - Math.min(20, key.length - q.length) * 0.5;
  const i = key.indexOf(q);
  if (i > 0 && /[\s\-(/·.]/.test(key[i - 1])) return 85;
  if (i >= 0) return 65;
  if (q.length < 3) return 0;
  let k = 0, first = -1, last = -1;
  for (let j = 0; j < key.length && k < q.length; j++) if (key[j] === q[k]) { if (first < 0) first = j; last = j; k++; }
  if (k < q.length) return 0;
  const spread = (last - first + 1) / q.length; // 1 = contiguous
  return spread > 3 ? 0 : 40 - spread * 6;
}

const KIND_LABEL = { alert: 'ALERT', ship: 'SHIP', asset: 'ASSET', incident: 'INCIDENT', place: 'PLACE', region: 'REGION' };

export function createSearch({ items, onPick, onOpen, onClose }) {
  let el = null, list = [], results = [], sel = 0, open = false;

  function build() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="srch" id="srch" role="dialog" aria-modal="true" aria-label="Search">
        <div class="srch-box">
          <div class="srch-in"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <input id="srch-q" type="text" autocomplete="off" spellcheck="false" placeholder="Ship name, MMSI, IMO, cable, pipeline, incident or place…" aria-label="Search" aria-controls="srch-list" />
            <kbd class="kbd">ESC</kbd></div>
          <div class="srch-list" id="srch-list" role="listbox"></div>
          <div class="srch-foot"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> move</span><span><kbd class="kbd">↵</kbd> open</span><span class="srch-n" id="srch-n"></span></div>
        </div>
      </div>`);
    el = document.getElementById('srch');
    const q = document.getElementById('srch-q');
    q.addEventListener('input', () => { sel = 0; run(q.value); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    el.addEventListener('click', (e) => { const r = e.target.closest('.srch-r'); if (r) choose(+r.dataset.i); });
    el.addEventListener('mousemove', (e) => { const r = e.target.closest('.srch-r'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; paintSel(); } });
  }

  function run(raw) {
    const q = norm(raw).trim();
    if (!q) {
      // empty query: alerts first, then the named assets, so the palette is useful before typing
      results = list.filter((it) => it.kind === 'alert').slice(0, 8).concat(list.filter((it) => it.kind === 'region' || it.kind === 'asset').slice(0, 10));
    } else {
      const qs = q.replace(/\s+/g, ' ');
      const digits = /^\d{3,}$/.test(qs);
      results = [];
      for (const it of list) {
        let best = 0;
        for (const k of it.keys) {
          if (digits && !/^\d+$/.test(k)) continue; // a number only matches MMSI/IMO
          const s = scoreKey(k, qs);
          if (s > best) best = s;
        }
        if (best) results.push([best + (it.boost || 0), it]);
      }
      results.sort((a, b) => b[0] - a[0]);
      results = results.slice(0, 40).map((r) => r[1]);
    }
    paint(raw);
  }

  function paint(raw) {
    const box = document.getElementById('srch-list');
    if (!results.length) {
      box.innerHTML = `<div class="srch-empty">${raw.trim() ? `Nothing in the current picture matches <b>${esc(raw.trim())}</b>.<br>Ships only appear while they're reporting AIS.` : 'Nothing loaded yet.'}</div>`;
    } else {
      box.innerHTML = results.map((it, i) => `<button class="srch-r k-${it.kind}${i === sel ? ' on' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">
        <span class="srch-k">${it.tag || KIND_LABEL[it.kind]}</span><span class="srch-t">${esc(it.label)}<small>${esc(it.sub || '')}</small></span></button>`).join('');
    }
    document.getElementById('srch-n').textContent = results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : '';
  }
  function paintSel() {
    document.querySelectorAll('#srch-list .srch-r').forEach((b, i) => { b.classList.toggle('on', i === sel); b.setAttribute('aria-selected', i === sel); });
    document.querySelector('#srch-list .srch-r.on')?.scrollIntoView({ block: 'nearest' });
  }
  function move(d) { if (!results.length) return; sel = (sel + d + results.length) % results.length; paintSel(); }
  function choose(i) { const it = results[i]; if (!it) return; close(); onPick(it); }

  function openIt() {
    if (!el) build();
    list = items();
    sel = 0;
    const q = document.getElementById('srch-q');
    q.value = '';
    run('');
    el.classList.add('on');
    open = true;
    onOpen?.();
    q.focus(); // synchronously, so no keystroke typed right after opening falls through to the map shortcuts
  }
  function close() {
    if (!open) return;
    el.classList.remove('on');
    open = false;
    document.getElementById('srch-q').blur();
    onClose?.();
  }
  return { open: openIt, close, isOpen: () => open };
}

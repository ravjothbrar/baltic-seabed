// "What changed": a log of state transitions since the page opened, derived from the live event stream.
// The first snapshot is a silent baseline; later snapshots (periodic resyncs) only update the baseline, so
// nothing is emitted for state the page already knew about. Only real transitions are logged.
const RANK = { WATCH: 1, ELEVATED: 2, HIGH: 3 };
const MAX = 300;
const DEBOUNCE_MS = 10 * 60e3;
const FEED_NAMES = { digitraffic: 'DIGITRAFFIC AIS', aisstream: 'AISSTREAM', weather: 'OPEN-METEO', watchlist: 'OPENSANCTIONS' };

export function createChanges({ isNamed = () => false } = {}) {
  const log = [];
  const alertPrev = new Map(); // alert id → { level, dark, mmsi }
  const vesselPrev = new Map(); // mmsi → named corridor name | null
  const feedPrev = new Map(); // feed key → ok
  const lastEmit = new Map(); // `${subject}:${type}` → ms
  let ready = false;
  const listeners = [];

  const hasDark = (a) => (a.signals || []).some((s) => s.id === 'DARK');
  const namedCorridor = (v) => v.corridor || null; // raw corridor name; "named" is checked at emit time
  const label = (o) => o?.name || (o?.mmsi ? `MMSI ${o.mmsi}` : 'Unknown ship');

  function emit(ev) {
    const k = `${ev.subject}:${ev.type}`;
    const now = Date.now();
    if (now - (lastEmit.get(k) || 0) < DEBOUNCE_MS) return;
    lastEmit.set(k, now);
    ev.t = now;
    log.push(ev);
    if (log.length > MAX) log.shift();
    for (const f of listeners) f(ev);
  }

  /** Snapshot: the first one sets the baseline; later ones resync silently. */
  function snapshot({ alerts = [], vessels = [], feeds = null }) {
    alertPrev.clear();
    for (const a of alerts) alertPrev.set(a.id, { level: a.level, dark: hasDark(a), mmsi: a.mmsi });
    for (const v of vessels) if (v.lat != null) vesselPrev.set(v.mmsi, namedCorridor(v));
    if (feeds) for (const k of Object.keys(FEED_NAMES)) if (feeds[k]) feedPrev.set(k, !!feeds[k].ok);
    ready = true;
  }

  function alert(a) {
    if (!a?.id) return;
    const prev = alertPrev.get(a.id);
    const dark = hasDark(a);
    alertPrev.set(a.id, { level: a.level, dark, mmsi: a.mmsi });
    if (!ready) return;
    const base = { mmsi: a.mmsi, alertId: a.id, name: label(a), asset: a.asset || null, subject: a.mmsi || a.id };
    if (!prev) emit({ ...base, type: 'new', sev: a.level, level: a.level, signals: (a.signals || []).map((s) => s.id) });
    else if ((RANK[a.level] || 0) > (RANK[prev.level] || 0)) emit({ ...base, type: 'up', sev: a.level, from: prev.level, level: a.level });
    else if ((RANK[a.level] || 0) < (RANK[prev.level] || 0)) emit({ ...base, type: 'down', sev: 'DOWN', from: prev.level, level: a.level });
    // a DARK signal appearing on an alert that already existed (new alerts carry it in their own line)
    if (dark && prev && !prev.dark) emit({ ...base, type: 'dark', sev: 'DARK' });
  }

  function clear({ id, mmsi }, name) {
    const prev = alertPrev.get(id);
    alertPrev.delete(id);
    if (!ready || !prev) return;
    emit({ type: 'clear', sev: 'CLEAR', mmsi: mmsi ?? prev.mmsi, alertId: null, name: name || label({ mmsi: mmsi ?? prev.mmsi }), from: prev.level, subject: mmsi ?? prev.mmsi ?? id });
  }

  function vessels(upd = []) {
    for (const v of upd) {
      if (v.lat == null) continue; // no position yet: nothing to compare
      const now = namedCorridor(v);
      const had = vesselPrev.has(v.mmsi);
      const prev = vesselPrev.get(v.mmsi);
      vesselPrev.set(v.mmsi, now);
      // only ships seen before (outside this corridor) count as "entering": a ship that first appears
      // inside a corridor may simply have come into receiver range
      if (ready && had && v.watch && now && now !== prev && isNamed(now)) emit({ type: 'corridor', sev: 'LISTED', mmsi: v.mmsi, name: label(v), asset: now, listed: v.watch.datasets || null, subject: v.mmsi });
    }
  }
  function removeVessels(del = []) { for (const id of del) vesselPrev.delete(id); }

  function feeds(f) {
    if (!f) return;
    for (const k of Object.keys(FEED_NAMES)) {
      const o = f[k]; if (!o) continue;
      if (k === 'aisstream' && !o.enabled) continue;
      const ok = !!o.ok;
      const had = feedPrev.has(k), prev = feedPrev.get(k);
      feedPrev.set(k, ok);
      if (!ready || !had || prev === ok) continue;
      emit({ type: ok ? 'feed_ok' : 'feed_stale', sev: ok ? 'OK' : 'STALE', feed: k, name: FEED_NAMES[k], subject: `feed:${k}` });
    }
  }

  function list(windowMs) {
    const from = windowMs ? Date.now() - windowMs : 0;
    return log.filter((e) => e.t >= from);
  }

  return { snapshot, alert, clear, vessels, removeVessels, feeds, list, on: (f) => listeners.push(f), get ready() { return ready; } };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}
const CHIP = { HIGH: 'h', ELEVATED: 'e', WATCH: 'w', DOWN: 'dn', CLEAR: 'cl', LISTED: 'li', DARK: 'dk', STALE: 'st', OK: 'ok' };
const CHIP_TXT = { DOWN: '↓', CLEAR: 'CLR', LISTED: 'LIST', DARK: 'DARK', STALE: 'FEED', OK: 'FEED' };

function itemHtml(e) {
  let what;
  switch (e.type) {
    case 'new': what = `new <b>${e.level}</b> alert${e.signals?.includes('DARK') ? ' · AIS gap' : ''}${e.asset ? ` · ${esc(e.asset)}` : ''}`; break;
    case 'up': what = `${e.from} → <b>${e.level}</b>`; break;
    case 'down': what = `${e.from} → ${e.level}`; break;
    case 'clear': what = `alert cleared (was ${e.from})`; break;
    case 'corridor': what = `listed ship entered <b>${esc(e.asset)}</b> corridor`; break;
    case 'dark': what = `AIS gap signal${e.asset ? ` near ${esc(e.asset)}` : ''}`; break;
    case 'feed_stale': what = 'feed went stale'; break;
    case 'feed_ok': what = 'feed recovered'; break;
    default: what = e.type;
  }
  const chip = CHIP_TXT[e.sev] || e.sev;
  const attrs = e.feed ? `data-feed="${e.feed}"` : `data-mmsi="${e.mmsi ?? ''}"${e.alertId ? ` data-alert="${esc(e.alertId)}"` : ''}`;
  return `<button class="chg" type="button" ${attrs}><span class="chg-c ${CHIP[e.sev] || ''}">${chip}</span><span class="chg-n"><b class="nm">${esc(e.name)}</b><small>${what}</small></span><span class="chg-t">${ago(e.t)}</span></button>`;
}

export function counters(items) {
  const n = { new: 0, up: 0, down: 0, clear: 0, corridor: 0, dark: 0, feed: 0 };
  for (const e of items) n[e.type.startsWith('feed') ? 'feed' : e.type]++;
  const parts = [];
  if (n.new) parts.push(`+${n.new} new`);
  if (n.up) parts.push(`${n.up} ↑`);
  if (n.down) parts.push(`${n.down} ↓`);
  if (n.clear) parts.push(`${n.clear} cleared`);
  if (n.corridor) parts.push(`${n.corridor} listed in corridor`);
  if (n.dark) parts.push(`${n.dark} AIS gap`);
  if (n.feed) parts.push(`${n.feed} feed`);
  return parts.join(' · ');
}

export function renderChanges(el, items, { mode }) {
  const sorted = items.slice().reverse().slice(0, 80);
  const body = sorted.length
    ? sorted.map(itemHtml).join('')
    : `<div class="empty">${mode === 'hour' ? 'No changes in the last hour: watching.' : 'No changes yet: watching. Changes since you opened the page appear here.'}</div>`;
  el.innerHTML = body;
}

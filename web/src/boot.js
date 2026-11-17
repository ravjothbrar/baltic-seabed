// Boot log: one line per real check, typed in when that check actually completes. No fake delays:
// the only animation is a ~150 ms typing effect on each line. Failures are shown in amber, never as ✓.
const MARK = { ok: '✓', warn: '!', pend: '…', off: '–' };

export function createBoot({ lite = () => false } = {}) {
  const lines = new Map(); // key → { text, st }
  const order = [];
  const hosts = [];

  function rowFor(host, key) {
    let row = host.el.querySelector(`[data-k="${key}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'bl';
      row.dataset.k = key;
      row.innerHTML = '<span class="bl-t"></span><span class="bl-s"></span>';
      host.el.appendChild(row);
    }
    return row;
  }
  // Keep at most N rows (the landing sets data-max from the room it has). "Not configured" rows go first.
  function trim(host) {
    const max = host.el.dataset.max != null ? Number(host.el.dataset.max) : host.max;
    // drop order when short of room: not-configured, then pending, then the oldest line that isn't the live ship feed
    while (host.el.children.length > max) {
      (host.el.querySelector('.bl.off') || host.el.querySelector('.bl.pend') || host.el.querySelector('.bl:not([data-k="dt"])') || host.el.firstElementChild).remove();
    }
  }
  function paint(host, key, animate) {
    const l = lines.get(key);
    const row = rowFor(host, key);
    row.className = `bl ${l.st}`;
    const t = row.querySelector('.bl-t'), s = row.querySelector('.bl-s');
    s.textContent = MARK[l.st] || '';
    trim(host);
    if (!animate || lite() || t.textContent === l.text) { t.textContent = l.text; return; }
    const txt = l.text, t0 = performance.now(), dur = 150;
    row._typing = txt;
    const step = (now) => {
      if (row._typing !== txt) return;
      const k = Math.min(1, (now - t0) / dur);
      t.textContent = txt.slice(0, Math.max(1, Math.round(txt.length * k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Set or update a line. Same text + state is a no-op, so this is safe to call on every feeds event. */
  function set(key, text, st = 'ok') {
    const cur = lines.get(key);
    if (cur && cur.text === text && cur.st === st) return;
    if (!cur) order.push(key);
    lines.set(key, { text, st });
    for (const h of hosts) if (h.el.isConnected) paint(h, key, true);
  }
  /** Attach a container; existing lines are drawn into it at once (they already completed). */
  function attach(el, max = 6) {
    if (!el) return;
    const h = { el, max };
    hosts.push(h);
    for (const k of order) paint(h, k, false);
  }
  return { set, attach, has: (k) => lines.has(k), get: (k) => lines.get(k) };
}

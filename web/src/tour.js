// Coach-mark tour: dimmed backdrop with a cut-out spotlight on real UI, callout with Next/Back/Skip.
const KEY = 'bsw-tour-v1';
export const tourSeen = () => { try { return localStorage.getItem(KEY) === 'done'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, 'done'); } catch {} };

export function createTour(steps, { onEnd } = {}) {
  let i = -1;
  let root = null;
  let raf = 0, busy = false;

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

  function mount() {
    root = el(`<div class="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div class="tour-hole"></div>
      <div class="tour-card">
        <div class="tour-k"><span class="tour-n"></span><span class="tour-bar"><i></i></span></div>
        <h3></h3><p></p>
        <div class="tour-act">
          <button class="tour-skip">Skip tour</button>
          <span class="sp"></span>
          <button class="tour-back">Back</button>
          <button class="tour-next">Next →</button>
        </div>
      </div>
    </div>`);
    document.body.appendChild(root);
    root.querySelector('.tour-skip').onclick = () => end();
    root.querySelector('.tour-back').onclick = () => { if (!busy) go(i - 1); };
    root.querySelector('.tour-next').onclick = () => { if (busy) return; i >= steps.length - 1 ? end() : go(i + 1); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
  }
  let rz = 0;
  function onResize() { cancelAnimationFrame(rz); rz = requestAnimationFrame(place); }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (!busy) (i >= steps.length - 1 ? end() : go(i + 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!busy) go(i - 1); }
  }
  function target() {
    const s = steps[i];
    const sel = (typeof s.target === 'function' ? s.target() : s.target);
    return sel ? document.querySelector(sel) : null;
  }
  function place() {
    if (!root || i < 0) return;
    const s = steps[i];
    const hole = root.querySelector('.tour-hole');
    const card = root.querySelector('.tour-card');
    const t = target();
    const vw = window.innerWidth, vh = window.innerHeight;
    let r = t ? t.getBoundingClientRect() : null;
    if (r && (r.width < 2 || r.height < 2)) r = null;
    const padPx = s.pad ?? 6;
    if (r) {
      const x = Math.max(4, r.left - padPx), y = Math.max(4, r.top - padPx);
      const w = Math.min(vw - x - 4, r.width + padPx * 2), h = Math.min(vh - y - 4, r.height + padPx * 2);
      Object.assign(hole.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, opacity: 1 });
    } else {
      Object.assign(hole.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px', opacity: 1 });
    }
    // callout placement: right, left, below, above — whichever fits; centred if nothing fits
    const cw = Math.min(360, vw - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight || 200;
    let cx, cy;
    const mobile = vw < 900;
    if (!r) { cx = (vw - cw) / 2; cy = (vh - ch) / 2; }
    else if (mobile) {
      cx = (vw - cw) / 2;
      cy = r.top > vh / 2 ? Math.max(12, r.top - ch - 16) : Math.min(vh - ch - 12, r.bottom + 16);
    } else if (r.right + 18 + cw < vw && s.side !== 'left') { cx = r.right + 18; cy = r.top; }
    else if (r.left - 18 - cw > 0) { cx = r.left - 18 - cw; cy = r.top; }
    else if (r.bottom + 16 + ch < vh) { cx = Math.min(vw - cw - 12, Math.max(12, r.left)); cy = r.bottom + 16; }
    else { cx = Math.min(vw - cw - 12, Math.max(12, r.left)); cy = Math.max(12, r.top - ch - 16); }
    cy = Math.min(vh - ch - 12, Math.max(12, cy));
    card.style.left = `${cx}px`;
    card.style.top = `${cy}px`;
  }
  async function go(n) {
    if (n < 0 || n >= steps.length) return;
    i = n;
    const s = steps[i];
    busy = true;
    root.classList.add('busy');
    root.querySelector('.tour-n').textContent = `STEP ${i + 1} / ${steps.length}`;
    root.querySelector('.tour-bar i').style.width = `${((i + 1) / steps.length) * 100}%`;
    root.querySelector('h3').textContent = s.title;
    root.querySelector('p').innerHTML = s.body;
    root.querySelector('.tour-back').disabled = i === 0;
    root.querySelector('.tour-next').textContent = i === steps.length - 1 ? 'Finish ✓' : 'Next →';
    try { await s.before?.(); } catch {}
    await new Promise((res) => setTimeout(res, s.wait ?? 320));
    if (steps[i] !== s || !root) return;
    place();
    busy = false;
    root.classList.remove('busy');
    cancelAnimationFrame(raf);
    const follow = () => { place(); raf = requestAnimationFrame(follow); };
    if (s.follow) raf = requestAnimationFrame(follow);
  }
  function start() {
    if (root) return;
    mount();
    requestAnimationFrame(() => root.classList.add('on'));
    go(0);
  }
  function end() {
    if (!root) return;
    markSeen();
    cancelAnimationFrame(raf);
    try { steps[i]?.after?.(); } catch {}
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root.classList.remove('on');
    const r = root; root = null; i = -1;
    setTimeout(() => r.remove(), 300);
    onEnd?.();
  }
  return { start, end, active: () => !!root };
}

export function offerTour(onYes) {
  if (tourSeen()) return;
  const d = document.createElement('div');
  d.className = 'tour-offer';
  d.innerHTML = `<div class="to-k"><span class="dot"></span>FIRST TIME HERE?</div>
    <div class="to-t">Take the 60-second tour of what this map shows, and what it can't.</div>
    <div class="to-act"><button class="to-yes">Take the tour →</button><button class="to-no">Skip</button></div>`;
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('on'));
  const close = () => { d.classList.remove('on'); setTimeout(() => d.remove(), 300); };
  d.querySelector('.to-yes').onclick = () => { close(); onYes(); };
  d.querySelector('.to-no').onclick = () => { close(); markSeen(); };
  setTimeout(() => { if (d.isConnected) close(); }, 20000);
}

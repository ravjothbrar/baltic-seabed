// Rule-based, explainable detection. Pure: same inputs → same output, so eval can replay it.
// track rows: [lon, lat, tsMs, sog, cog, nav]
import { distNm } from './geo.js';
import { WORK_TYPES, isTankerOrCargo, FOC_SHADOW, RU_GOF_DEST } from './ais-meta.js';

export const T = {
  LOITER_SOG: 3, LOITER_MIN: 20,
  DRAG_SOG_MIN: 1, DRAG_SOG_MAX: 7, DRAG_DROP: 0.6, DRAG_MEDIAN_MIN: 8, DRAG_KM: 2,
  CROSS_NM: 0.3, CROSS_DROP: 0.5, CROSS_MEDIAN_MIN: 6,
  DARK_MIN: 45, DARK_MAX_H: 6, DARK_NEAR_NM: 10, DARK_PEERS: 5, DARK_PEER_NM: 10,
  PORT_NM: 3, GALE_KN: 30, WAVE_M: 3,
};

export const SIGNAL_INFO = {
  LOITER: { label: 'Loitering on infrastructure', base: 'weak', why: 'Ships slow down or stop for pilots, berths, weather and orders. On its own this is routine.' },
  DRAG: { label: 'Possible anchor-drag pattern', base: 'moderate', why: 'A sustained unexplained slowdown along a corridor is consistent with a dragging anchor, but also with engine trouble, ice or traffic separation.' },
  CROSS_SLOW: { label: 'Slow crossing of named asset', base: 'weak', why: 'Ships change speed for many reasons; crossing a cable slowly is common in busy lanes.' },
  DARK: { label: 'AIS gap near infrastructure', base: 'moderate', why: 'Receivers miss messages and transponders fail. Gaps are only meaningful when neighbouring ships kept reporting.' },
  WATCHLIST: { label: 'Listed vessel', base: 'moderate', why: 'A sanctions or detention listing describes ownership or past conduct, not what this ship is doing now.' },
  FOC: { label: 'Shadow-fleet-associated registry', base: 'weak', why: 'Thousands of legitimate ships fly these flags. Flag alone says nothing about intent.' },
  PROFILE: { label: 'Matches past incident profile', base: 'moderate', why: 'Past incidents involved tankers/bulkers leaving Russian Gulf of Finland ports. Most such ships are simply trading.' },
};

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function evaluate({ vessel: v, track, now, corridors, weather, watch, peers }) {
  const signals = [];
  const last = track[track.length - 1];
  if (!last) return null;
  const [lon, lat] = last;
  const corr = corridors.corridor(lon, lat);
  const port = corridors.nearestPort(lon, lat);
  const inPort = port && port.inside;
  const waiting = /FOR ORDERS|ORDERS|ANCHORAGE|ANCH\b|WAITING|\bOPL\b|DRIFTING/i.test(v.dest || '');
  const work = WORK_TYPES.has(v.type);
  const gale = weather && ((weather.windKn ?? 0) >= T.GALE_KN || (weather.waveM ?? 0) >= T.WAVE_M);

  // Ship's own normal speed: median over moving points older than 30 min.
  const hist = track.filter((p) => p[2] < now - 30 * 60e3 && p[3] >= 0.5).map((p) => p[3]);
  const med = median(hist);

  // ── LOITER: contiguous recent stretch in a corridor at < 3 kn
  let i = track.length - 1;
  while (i >= 0 && track[i][3] < T.LOITER_SOG && corridors.corridor(track[i][0], track[i][1])) i--;
  const loiterMin = i < track.length - 1 ? (last[2] - track[i + 1][2]) / 60e3 : 0;
  if (corr && loiterMin >= T.LOITER_MIN && !inPort && last[5] !== 5) { // nav 5 = moored at a berth
    const anchored = last[5] === 1;
    signals.push(sig('LOITER', anchored ? 'moderate' : 'weak',
      `${Math.round(loiterMin)} min at < ${T.LOITER_SOG} kn within ${corr.nm.toFixed(1)} nm of ${corr.name}${anchored ? ' · nav status AT ANCHOR' : ''}`,
      work ? `vessel type ${v.typeLabel} routinely works slowly` : v.type >= 60 && v.type <= 69 ? 'passenger ferries wait at terminals and quays' : waiting ? `declared destination "${v.dest}" says it is waiting` : gale ? `weather: ${fmtWx(weather)}` : null));
  }

  // ── DRAG: in-corridor stretch, under way, speed well below own median, ≥ 2 km
  if (med && med >= T.DRAG_MEDIAN_MIN) {
    let j = track.length - 1, km = 0;
    while (j > 0) {
      const p = track[j];
      const ok = p[3] >= T.DRAG_SOG_MIN && p[3] <= T.DRAG_SOG_MAX && p[3] <= med * T.DRAG_DROP && (p[5] === 0 || p[5] == null || p[5] === 15) && corridors.corridor(p[0], p[1]);
      if (!ok) break;
      km += distNm(track[j - 1][0], track[j - 1][1], p[0], p[1]) * 1.852; j--;
    }
    if (km >= T.DRAG_KM && corr) {
      const avg = track.slice(j + 1).reduce((s, p) => s + p[3], 0) / Math.max(1, track.length - 1 - j);
      signals.push(sig('DRAG', 'moderate',
        `${km.toFixed(1)} km along ${corr.name} at ~${avg.toFixed(1)} kn vs its usual ${med.toFixed(1)} kn, nav status still "under way"`,
        work ? `vessel type ${v.typeLabel}` : gale ? `weather: ${fmtWx(weather)}` : null));
    }
  }

  // ── CROSS_SLOW: recently passed very close to a named asset well below its own median
  if (med && med >= T.CROSS_MEDIAN_MIN) {
    const recent = track.filter((p) => p[2] >= now - 30 * 60e3);
    for (const p of recent) {
      const n = corridors.nearest(p[0], p[1]);
      if (n && n.named && n.nm <= T.CROSS_NM && p[3] < med * T.CROSS_DROP && p[3] > 0.3) {
        signals.push(sig('CROSS_SLOW', 'weak', `crossed ${n.name} at ${p[3].toFixed(1)} kn (usual ${med.toFixed(1)} kn)`,
          work ? `vessel type ${v.typeLabel}` : gale ? `weather: ${fmtWx(weather)}` : null));
        break;
      }
    }
  }

  // ── DARK: silent ≥ 30 min near infrastructure while neighbours kept reporting
  const silentMin = (now - last[2]) / 60e3;
  if (silentMin >= T.DARK_MIN && silentMin <= T.DARK_MAX_H * 60 && last[3] > 2) {
    const near = corridors.nearest(lon, lat);
    if (near && near.nm <= T.DARK_NEAR_NM && peers >= T.DARK_PEERS) {
      signals.push(sig('DARK', 'moderate', `no AIS for ${Math.round(silentMin)} min; last seen ${near.nm.toFixed(1)} nm from ${near.name} at ${last[3].toFixed(1)} kn; ${peers} ships within ${T.DARK_PEER_NM} nm kept reporting`, null));
    }
  }

  const hasBehaviour = signals.length > 0;

  // ── Identity signals (only attached to alerts, or to a listed ship inside a corridor)
  if (watch) {
    const strong = watch.risk.includes('sanction') || watch.risk.includes('mare.shadow');
    if (hasBehaviour || (strong && corr)) {
      signals.push(sig('WATCHLIST', strong ? 'moderate' : 'weak',
        `${watch.risk.map(riskLabel).join(', ')} · ${watch.datasets.slice(0, 3).join(', ')}`, null, watch.url));
    }
  }
  if (FOC_SHADOW.has(v.flagCode) && signals.length) signals.push(sig('FOC', 'weak', `flag ${v.flag} (from MMSI)`, null));
  if (isTankerOrCargo(v.type) && RU_GOF_DEST.test(v.dest || '') && signals.some((s) => s.id === 'DRAG' || s.id === 'LOITER'))
    signals.push(sig('PROFILE', 'moderate', `${v.typeLabel} with destination "${v.dest}" plus slow-movement signal`, null));

  if (!signals.length) return { signals, level: null, asset: corr?.name ?? null, corridor: corr };

  const live = signals.filter((s) => !s.explained);
  const n = live.length;
  const core = live.some((s) => s.id === 'DRAG' || s.id === 'DARK');
  // Identity (WATCHLIST/FOC/PROFILE) never escalates on its own: ELEVATED+ needs unexplained behaviour.
  const behaviour = live.some((s) => ['LOITER', 'DRAG', 'CROSS_SLOW', 'DARK'].includes(s.id));
  let level = null;
  if (behaviour && n >= 3 && core) level = 'HIGH';
  else if (behaviour && n >= 2) level = 'ELEVATED';
  else if (behaviour || (live.some((s) => s.id === 'WATCHLIST') && corr)) level = 'WATCH';

  const context = { windKn: weather?.windKn ?? null, waveM: weather?.waveM ?? null, nearestAnchorage: port, peers };
  return { signals, level, asset: corr?.name ?? corridors.nearest(lon, lat)?.name ?? null, corridor: corr, context, shouldntConclude: caveats(signals, context, v) };
}

function sig(id, strength, evidence, explainedBy, url) {
  return { id, label: SIGNAL_INFO[id].label, strength, evidence, explained: !!explainedBy, ...(explainedBy ? { explainedBy } : {}), ...(url ? { url } : {}) };
}
const fmtWx = (w) => [w.windKn != null ? `wind ${Math.round(w.windKn)} kn` : null, w.waveM != null ? `waves ${w.waveM.toFixed(1)} m` : null].filter(Boolean).join(', ');
const riskLabel = (r) => ({ sanction: 'sanctioned', 'mare.shadow': 'shadow-fleet tracked', 'mare.detained': 'port-state detention' }[r] || r);

function caveats(signals, ctx, v) {
  const out = [];
  for (const s of signals) out.push(`${s.label}: ${SIGNAL_INFO[s.id].why}`);
  if (ctx.nearestAnchorage) out.push(`Nearest port/anchorage zone: ${ctx.nearestAnchorage.name}, ${ctx.nearestAnchorage.nm} nm away. Waiting for a berth or pilot looks exactly like this.`);
  if (/ORDERS|ANCH|WAITING|OPL/i.test(v.dest || '')) out.push(`Declared destination "${v.dest}": tankers often anchor in the open Gulf waiting for orders. That is commercial routine, and it puts anchors near cables.`);
  if (ctx.windKn != null) out.push(`Weather here now: ${fmtWx(ctx)}.${ctx.windKn >= 25 ? ' Ships routinely slow or heave-to in these conditions.' : ''}`);
  if (ctx.peers != null) out.push(`AIS coverage: ${ctx.peers} other ships within 10 nm reported in the last 10 min. The coverage here comes from Finnish coastal receivers and it is patchy.`);
  out.push('Eagle S (Estlink 2, 2024): seabed drag marks were found, yet a district court dismissed the case in Oct 2025 (an appeal court sent it back for trial in Aug 2026). Yi Peng 3: no conclusive evidence of deliberate dragging. Even strong-looking cases are hard to prove.');
  out.push('AIS is self-reported, can be spoofed or switched off, and sees nothing below the surface. No alert here is evidence of intent.');
  return out;
}

// Alerts feed → data/alerts.json, data/alerts.xml (RSS) and, if DISCORD_WEBHOOK_URL is set, Discord pushes.
// Runs in the Pages workflow every ~15 min. Tiers, cooldowns and hourly caps come from config/seabed.config.js;
// what was already pushed is remembered in data/alerts-state.json (extended from the previously published copy).
//   node scripts/build-alerts.mjs <history.json> <outDir>   env: PREV_BASE (published data/ URL), SITE_URL, DISCORD_WEBHOOK_URL
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { replay, readJSON, fetchJSON } from './replay.mjs';
import CONFIG from '../config/seabed.config.js';

const [HIST, OUT] = process.argv.slice(2);
const SITE = (process.env.SITE_URL || 'https://ravjothbrar.com/baltic-seabed/').replace(/\/?$/, '/');
const HOOK = process.env.DISCORD_WEBHOOK_URL || '';
const now = Date.now();
const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const history = await readJSON(HIST);
const prevState = (await fetchJSON(process.env.PREV_BASE && process.env.PREV_BASE + 'alerts-state.json')) || { sent: {}, pushes: [] };
const state = {
  sent: Object.fromEntries(Object.entries(prevState.sent || {}).filter(([, t]) => now - t < 24 * 3600e3)),
  pushes: (prevState.pushes || []).filter((p) => now - p.t < 3600e3),
  first: { ...(prevState.first || {}) }, // id → when this alert was first published (stable RSS guid/pubDate)
};

const rank = { HIGH: 3, ELEVATED: 2, WATCH: 1 };
let alerts = [];
if (history?.tracks) {
  const { snap } = await replay(history);
  alerts = [...snap.alerts].sort((a, b) => rank[b.level] - rank[a.level] || b.lastSeen - a.lastSeen);
} else console.log('alerts: no history yet');

const compact = alerts.map((a) => ({
  id: `${a.mmsi}-${a.level}`, published: new Date(state.first[`${a.mmsi}-${a.level}`] ||= now).toISOString(), tier: CONFIG.tiers[a.level]?.label || a.level, level: a.level,
  name: a.name, mmsi: a.mmsi, imo: a.imo, flag: a.flag, typeLabel: a.typeLabel, asset: a.asset, lat: a.lat, lon: a.lon,
  firstSeen: new Date(a.firstSeen).toISOString(), lastSeen: new Date(a.lastSeen).toISOString(),
  signals: a.signals.map(({ id, label, evidence, explained, explainedBy }) => ({ id, label, evidence, explained, explainedBy })),
  caveat: a.shouldntConclude?.[0] || null,
}));

// forget first-seen times of alerts that have been gone for a day
const liveIds = new Set(compact.map((a) => a.id));
for (const [id, t] of Object.entries(state.first)) if (!liveIds.has(id) && now - t > 24 * 3600e3) delete state.first[id];

// ── Discord pushes: tiered, de-duplicated per ship+level, cooldown and hourly cap per tier ──
let pushed = 0;
if (HOOK) {
  for (const a of compact) {
    const tier = CONFIG.tiers[a.level];
    if (!tier?.push) continue;
    if (state.sent[a.id] && now - state.sent[a.id] < tier.cooldownMin * 60e3) continue;
    if (state.pushes.filter((p) => p.level === a.level).length >= tier.maxPerHour) continue;
    const live = a.signals.filter((s) => !s.explained);
    const embed = {
      title: `${tier.label} · ${a.level} · ${a.name || 'MMSI ' + a.mmsi}`,
      url: SITE,
      color: a.level === 'HIGH' ? 0xff4d5e : a.level === 'ELEVATED' ? 0xffb547 : 0x5cc8ff,
      description: [
        `${a.typeLabel || 'Vessel'}${a.flag ? ' · ' + a.flag : ''}${a.asset ? ' · near **' + a.asset + '**' : ''}`,
        '',
        ...live.map((s) => `• **${s.label}:** ${s.evidence}`),
        '',
        a.caveat ? `_Why it may be nothing:_ ${a.caveat}` : '',
        '_A pattern in self-reported AIS, not evidence of intent._',
      ].filter((l) => l !== null).join('\n').slice(0, 3900),
      footer: { text: 'Baltic Seabed Watch · public data · not affiliated with Helsing' },
      timestamp: a.lastSeen,
    };
    try {
      const r = await fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Baltic Seabed Watch', embeds: [embed] }) });
      if (!r.ok) throw new Error(`Discord ${r.status}`);
      state.sent[a.id] = now; state.pushes.push({ t: now, level: a.level }); pushed++;
      await new Promise((res) => setTimeout(res, 1200)); // stay well inside webhook rate limits
    } catch (e) { console.log('alerts: push failed', e.message); }
  }
} else console.log('alerts: DISCORD_WEBHOOK_URL not set (RSS/JSON only)');

// ── RSS 2.0 feed of current alerts (any reader / Slack / IFTTT can follow it) ──
const items = compact.map((a) => `    <item>
      <title>${esc(`${a.tier} · ${a.level} · ${a.name || 'MMSI ' + a.mmsi}${a.asset ? ' near ' + a.asset : ''}`)}</title>
      <link>${esc(SITE)}</link>
      <guid isPermaLink="false">${esc(a.id + '@' + a.published)}</guid>
      <pubDate>${new Date(a.published).toUTCString()}</pubDate>
      <description>${esc([...a.signals.filter((s) => !s.explained).map((s) => `${s.label}: ${s.evidence}`), a.caveat ? `Why it may be nothing: ${a.caveat}` : '', 'A pattern in self-reported AIS, not evidence of intent.'].filter(Boolean).join(' · '))}</description>
    </item>`).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Baltic Seabed Watch · alerts</title>
    <link>${esc(SITE)}</link>
    <description>Live patterns over Baltic undersea cables and pipelines, from public data. Every item is a pattern, not a finding.</description>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
    <ttl>15</ttl>
${items}
  </channel>
</rss>
`;

await writeFile(path.join(OUT, 'alerts.json'), JSON.stringify({ generated: new Date(now).toISOString(), count: compact.length, alerts: compact }));
await writeFile(path.join(OUT, 'alerts.xml'), rss);
await writeFile(path.join(OUT, 'alerts-state.json'), JSON.stringify(state));
console.log(`alerts: ${compact.length} current (${compact.filter((a) => a.level !== 'WATCH').length} ELEVATED+), pushed ${pushed}`);

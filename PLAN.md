# Baltic Seabed Watch: plan

A live, Crucix-style 3D globe for watching over the Baltic's undersea cables and pipelines. It
fuses public AIS ship positions, published sanction and shadow-fleet lists, and seabed
infrastructure routes. It flags ships that loiter over or drag across infrastructure, says
plainly how weak each signal is on its own, and ends on a layer showing where a few hundred
autonomous gliders would close the gaps that AIS can't see.

Built for one reader: the team behind Helsing's **Lura + SG-1 Fathom**. Helsing says
*"a single operator can task and monitor hundreds of gliders"* for *"persistent underwater
surveillance"* across *"the North Sea and Baltic"*
([Helsing press release](https://helsing.ai/newsroom/helsing-unveils-lura-and-sg-1-fathom-autonomous-mass-to-surveil-and-defend-the-depths),
[Monch](https://monch.com/?p=369002), [Naval News](https://www.navalnews.com/naval-news/2025/05/helsing-unveils-lura-and-sg-1-fathom-autonomous-mass-to-surveil-and-defend-the-depths/)).
They've shown hardware and a claim. Nobody outside has shown what that operator's screen might
look like, or why the surface picture alone isn't enough. This build shows both.

> Independent project by Ravjoth Brar. Not affiliated with or endorsed by Helsing.
> Public data only.

---

## 1. The story the page tells (top to bottom, ~60 seconds)

1. **Live:** about 2,000 real ships moving across the Baltic right now, with cables and pipelines
   glowing on the seabed under them.
2. **Watch:** a ship slows to 2 knots on top of Estlink 2. The alert stream lights up and the
   ship's track turns amber.
3. **Doubt:** the "what you shouldn't conclude" panel opens next to the alert. Wind is 38 knots,
   the ship is 4 nm from a known anchorage, and AIS coverage here drops out every night. The
   evidence is weak, and the page says so.
4. **History:** the incident log. Newnew Polar Bear, Yi Peng 3, Eagle S, Vezhen and Fitburg,
   each with what was alleged and what courts and investigators actually found. Several were
   cleared or dismissed. That's the point: AIS alone can't settle these cases.
5. **Answer:** the glider layer. Drag a slider from 0 to 300 gliders and watch acoustic coverage
   spread along the infrastructure corridors. "Coverage of cable corridors: 12% → 81%. Operators
   needed: 1."

The ending is the pitch. AIS sees ships that choose to be seen. Gliders hear what's under the
surface.

---

## 2. Architecture

```
                 ┌──────────────────────── build time (scripts/, committed output) ───────────────────────┐
                 │ EMODnet WFS ─► cables, pipelines ─┐                                                    │
                 │ TeleGeography cable map ──────────┼─► clip to Baltic bbox, simplify ─► web/data/*.geojson│
                 │ EMODnet bathymetry (coarse grid) ─┘                                                    │
                 │ OpenSanctions maritime CSV ─► IMO/MMSI watchlist ─► server/data/watchlist.json          │
                 │ incidents.json (hand-curated, every row sourced)                                       │
                 └────────────────────────────────────────────────────────────────────────────────────────┘

  aisstream.io ──wss──►┌───────────── server/ (one Node 22 process, always on) ─────────────┐
  (Baltic bbox,        │ ingest.js     keeps the WebSocket open, reconnects with backoff     │
   key stays here)     │ state.js      in-memory vessel table + rolling 6h tracks           │
                       │ corridors.js  grid index of buffered infrastructure lines          │
  Open-Meteo marine ──►│ detect.js     rule engine, runs on each position + every 30s sweep │
  (wind/waves, keyless)│ fuse.js       watchlist match, flag-of-convenience, AIS gaps       │
                       │ db.js         node:sqlite: alerts log, 48h track archive           │
                       │ http.js       Express: static web/, /api/snapshot, /api/stream SSE │
                       └───────────────────────────────┬────────────────────────────────────┘
                                                        │ SSE: vessel deltas every 2s,
                                                        │ alerts and sweep stats as they happen
                                                        ▼
                       ┌───────────── web/ (static, Vite + vanilla JS) ─────────────────────┐
                       │ CesiumJS globe (keyless dark imagery + bathymetry tint)            │
                       │ HUD panels in Crucix layout, God's Eye View chrome, presets        │
                       │ glider.js: coverage model runs in the browser (Web Worker)         │
                       └────────────────────────────────────────────────────────────────────┘
```

### Why it's shaped this way

- **A server is required.** aisstream.io doesn't support browser connections, and the API key
  must never ship to the client. One long-lived process holds the socket, the same pattern as
  Crucix (Node + Express + SSE, almost no dependencies).
- **One process, not microservices.** A Baltic bounding box sees roughly 1,500–3,000 vessels and
  tens of messages a second. That fits in memory on a 256 MB VM. Don't add Redis, Kafka or
  Postgres.
- **SSE, not WebSockets, to the browser.** It's one-way, survives proxies, reconnects on its
  own, and matches Crucix.
- **Static layers are baked at build time and committed.** EMODnet or TeleGeography being down
  on demo day can't break the site.
- **Glider coverage runs client-side.** It's interactive (slider-driven) and only needs static
  layers plus a traffic heatmap the server already sends.
- **Keyless frontend.** No Cesium ion or Google tiles. Use CartoDB dark or NASA Black Marble
  imagery and an EMODnet bathymetry WMS overlay, so nobody has to sign up for anything to run it.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22, ESM, native `fetch`, built-in `node:sqlite` | Crucix's footprint, nothing to compile |
| Server deps | `express`, `ws` | That's all |
| Geo math | `@turf/turf` (server and client) | Buffers, distances, point-to-line |
| Globe | `cesium` via Vite | The God's Eye View look: 3D, post-processing, polylines that hug the globe |
| UI | Vanilla JS + CSS custom properties | Panels are just DOM, so no framework to fight |
| Fonts | JetBrains Mono / IBM Plex Mono (Google Fonts) | The Crucix / GEV terminal feel |
| Hosting | Fly.io, one `shared-cpu-1x` machine, 1 GB volume for SQLite | Always-on WebSocket, about $3–5 a month. Railway or Render work too |
| Domain | `baltic.ravjothbrar.com` (CNAME to Fly) | |

---

## 3. Data sources (all public)

| Feed | Source | Refresh | Notes |
|---|---|---|---|
| Ship positions and static data | [aisstream.io](https://aisstream.io/documentation) WebSocket, bbox `[[53.0, 9.0], [66.0, 30.5]]`, `PositionReport` + `ShipStaticData` | Live | Free and in beta with no SLA. Show a feed-health indicator and say when it's stale |
| Telecom and power cables | [EMODnet Human Activities WFS](https://emodnet.ec.europa.eu/human-activities) (`https://ows.emodnet-humanactivities.eu/wfs`, cable layers, `outputFormat=json`) plus the TeleGeography submarine cable map | Build | Confirm layer names with GetCapabilities first. Hand-check the named assets below |
| Pipelines | EMODnet `emodnet:pipelines` | Build | Nord Stream 1/2, Balticconnector, Baltic Pipe |
| Named critical assets | Hand list: Estlink 1/2, Balticconnector, C-Lion1, BCS East-West, NordBalt, Fenno-Skan 1/2, Baltic Pipe, Nord Stream 1/2, Kontek, SwePol | Build | These are the ones named in incidents, so label them prominently |
| Sanctions and shadow fleet | [OpenSanctions maritime export](https://www.opensanctions.org/articles/2025-05-27-maritime-download) (free for non-commercial use), EU and UK sanctioned vessel lists | Daily | Match on **IMO first**, MMSI second, name never. Names and flags change |
| Weather and sea state | Open-Meteo Marine + Forecast APIs (keyless) | 15 min, per 1° cell | Used to *explain away* alerts: low speed in a gale is normal |
| Ports and anchorages | Hand-drawn polygons for the main anchorages (Primorsk, Ust-Luga, Tallinn, Helsinki, Gdańsk, Klaipėda, Copenhagen roads) | Build | The main false-positive suppressor |
| Bathymetry | EMODnet Bathymetry (coarse grid + WMS tiles) | Build | Seabed shading, and glider depth suitability |
| Incidents | `incidents.json`, hand-curated with a source URL on every field | Manual | See §6 |

---

## 4. Detection engine (rule-based, explainable, no ML)

Every rule gives a **signal**: a name, a strength (`weak | moderate | strong`), the evidence,
and the innocent explanations it can't rule out. An alert is a vessel plus a set of signals.
The UI never shows a bare score without the reasons behind it.

Corridor = each cable or pipeline buffered by **1.5 nm**. Index the buffers in a 0.05° grid so a
position check is O(1).

| ID | Signal | Rule (starting thresholds, tune against the eval set) | Strength alone |
|---|---|---|---|
| `LOITER` | Loitering on infrastructure | In corridor, SOG < 3 kn for ≥ 20 min, outside every anchorage polygon | weak |
| `DRAG` | Possible anchor-drag signature | In corridor, SOG 1–7 kn, nav status still "under way", speed ≥ 40% below the ship's own 6 h median, ≥ 2 km travelled like this. Raised if the track follows or repeatedly crosses the same asset | moderate |
| `CROSS_SLOW` | Slow crossing | Crosses a named asset at < 50% of its own median speed | weak |
| `DARK` | AIS gap near infrastructure | No message for ≥ 30 min, last seen within 10 nm of a corridor, **and** other ships nearby kept reporting (so it isn't a coverage hole) | moderate |
| `WATCHLIST` | Sanctioned or listed vessel | IMO or MMSI on a sanctions or shadow-fleet list | moderate (identity, not intent) |
| `FOC` | Flag-of-convenience pattern | Flag in a configured list (e.g. Cook Islands, Gabon, Comoros, Sierra Leone), or flag/name changed in the static data during the session | weak |
| `PROFILE` | Matches historical incident profile | Tanker or bulk carrier sailing out of a Russian Gulf of Finland port **and** `DRAG` or `LOITER` | moderate |

**Alert level** = the number of independent signals, capped by the weakest *context check*:

- Wind ≥ 30 kn or waves ≥ 3 m → `LOITER` and `CROSS_SLOW` drop to "explained".
- Ship type fishing, dredging, cable-layer, research, pilot or SAR → `LOITER` and `DRAG` drop to
  "explained" (that's their job).
- Inside or within 2 nm of an anchorage → `LOITER` is suppressed.

Levels: `WATCH` (1 signal), `ELEVATED` (2 independent), `HIGH` (≥ 3, including `DRAG` or
`DARK`). The top-bar alert state is the highest live level, like Crucix's `HIGH ALERT` chip.

### "What you shouldn't conclude" panel

Shown for whichever alert is selected. It's generated from the signals, not written freehand:

- **For each signal:** one sentence on how often it fires innocently. Fill this with the real
  number from the eval run in §7, e.g. "`LOITER` fired on 41 ships in 48 h. 39 were waiting for
  a berth or for weather."
- **Context that weakens it:** current wind and waves, distance to the nearest anchorage, AIS
  coverage quality in this cell over the last 24 h.
- **The precedent line:** "Eagle S: seized, seabed drag marks found, case dismissed October 2025
  for lack of evidence. Yi Peng 3: Swedish investigators found no conclusive evidence of
  deliberate dragging." Pull it from `incidents.json`.
- **The fixed footer:** "AIS is self-reported, can be spoofed or switched off, and can't see
  anything below the surface. No alert here is evidence of intent."

This panel is what makes the project credible to a defence audience. Overclaiming is the fastest
way to lose them.

---

## 5. Glider coverage layer (the Lura pitch)

The model is a simulation and labelled as one. Helsing hasn't published detection ranges, so
the range is a slider with an honest label.

- **Grid:** the Baltic in ~5 km hexes or 0.05° cells. Precompute at build time.
- **Cell value** = `infra_km_in_cell × (1 + traffic_density) × criticality`, where criticality
  is ×3 for a named asset (Estlink, Balticconnector, C-Lion1, etc.). `traffic_density` comes
  from the live AIS heatmap the server keeps (rolling 24 h).
- **Depth mask:** cells shallower than ~25 m get reduced weight (they're harder for gliders). The
  Baltic averages ~55 m, so this matters and it's honest to show.
- **Placement:** greedy maximum coverage. Pick the cell that adds the most uncovered value within
  radius `R`, repeat `N` times. Run it in a Web Worker so the slider stays at 60 fps. N goes from
  0 to 300, R from 2 to 20 km (default 8, labelled "assumed passive acoustic detection radius,
  not a published spec").
- **Render:** glider icons on slow racetrack patrols along their assigned corridor segment,
  translucent coverage discs, and gaps left uncovered shown in red hatching.
- **Readouts:** "Corridor coverage: X%", "Named assets fully covered: k/11", "Operators: 1",
  "Endurance: up to 3 months (Helsing figure)".
- **Tie-in to the live layer:** when an alert fires, highlight the nearest simulated glider and
  draw a dashed tasking line: "nearest glider 6.2 km, ETA ~2 h at 1.5 kn". This is the "one
  operator tasking hundreds" moment.

---

## 6. Incident log (not replay)

A side panel and globe markers. Every field cites a source, and approximate locations are labelled
approximate. Don't invent coordinates; use what the reporting gives (e.g. "Gulf of Finland, near
Porkkala").

Seed rows, to verify against sources before committing:

| Date | Asset | Vessel | What happened to the case |
|---|---|---|---|
| Sep 2022 | Nord Stream 1 & 2 | (none, explosions) | Under criminal investigation in several countries |
| Oct 2023 | Balticconnector + telecom cables | Newnew Polar Bear | Anchor drag; Chinese authorities later acknowledged the ship's anchor was involved |
| Nov 2024 | BCS East-West, C-Lion1 | Yi Peng 3 | Boarded after a standoff. No conclusive evidence of deliberate dragging (Sweden) |
| Dec 2024 | Estlink 2 + 4 telecom cables | Eagle S | Seized by Finland, seabed tracks found, case dismissed Oct 2025 |
| Jan 2025 | Sweden–Latvia cable | Vezhen | Released; investigators called it an accident |
| Dec 2025 | Arelion cable, Gulf of Finland | Fitburg | Drag tracks over tens of km; no evidence linking the ship as of Jan 2026 |

Sources: [gCaptain timeline](https://gcaptain.com/a-timeline-of-suspected-underwater-sabotage-incidents-in-the-baltic-sea/),
[Baird Maritime factbox](https://www.bairdmaritime.com/marine-projects/marine-infrastructure/factbox-suspected-underwater-cable-sabotage-in-the-baltic-sea),
[Wilson Center map](https://www.wilsoncenter.org/article/mapping-undersea-infrastructure-attacks-baltic-sea).

The "outcome" column is the most important one. It's the evidence for §4's honesty panel and
for §5's argument.

---

## 7. Evaluation (do this before tuning anything)

The bad failure is a globe covered in red over ferries. So the main metric is the
**false-positive rate on ordinary traffic**.

1. Ship the ingest first and let it **record 48 h of Baltic AIS** into SQLite.
2. **You hand-label** 30–40 vessel episodes from that recording, in `eval/labels.json`: ferries
   crossing Estlink, ships at Primorsk anchorage, trawlers, pilot boats, a cable-repair vessel if
   one turns up, a tanker riding out a gale. Each one gets `should_flag: true|false` and a
   one-line reason. Don't let a model generate these labels.
3. Add 3–5 **positive cases built by hand from published incident descriptions** (e.g. "~100 km
   at reduced speed across Estlink 2"). Mark them `synthetic: true` in the file and in any write-up.
4. `npm run eval` replays the labelled episodes through `detect.js` and prints precision and
   recall per signal, and the per-signal innocent-fire rate that feeds the honesty panel.
5. Sweep the thresholds (LOITER minutes, DRAG speed-drop %, corridor buffer) and keep the
   curve. "I swept the corridor buffer from 0.5 to 3 nm against 40 hand-labelled episodes" is
   the sentence that starts a conversation with an engineer.

---

## 8. UI spec

The layout follows Crucix: dense panels around a central globe, mono type, thin borders,
`LIVE` chips. The chrome follows God's Eye View: corner brackets, glowing globe, presets,
classification-style strapline. Black background, teal/cyan primary, amber for warnings,
red for alerts.

```
┌ BALTIC SEABED WATCH ▪ UNCLASSIFIED // OPEN SOURCE ── SWEEP 2.0s ─ 12 NOV 2026 08:09Z ─ FEEDS 6/6 ─ [ELEVATED] ┐
├──────────────┬──────────────────────────────────────────────────────────┬────────────────────────┤
│ SENSOR GRID  │ [BALTIC] [GULF OF FINLAND] [GOTLAND] [BORNHOLM] [BELTS]  │ ALERT STREAM    7 LIVE │
│ Vessels 2,114│                                                          │ ▲ ELEVATED EAGLE-like  │
│ In corridor 63│              CesiumJS globe, tilted onto the Baltic      │   DRAG + WATCHLIST     │
│ Watchlist  4 │              cables glow cyan, pipelines amber           │ ...                    │
│ AIS dark   2 │              ships as dim dots, alerted ships amber      ├────────────────────────┤
│ Wind 22kn NE │              trails, glider discs when that layer is on  │ WHAT YOU SHOULDN'T     │
├──────────────┤                                                          │ CONCLUDE               │
│ ASSETS       │                                                          │ wind 38 kn · anchorage │
│ Estlink 2  ● │                                                          │ 4 nm · coverage 61%    │
│ C-Lion1    ● │  legend: CABLE · PIPELINE · VESSEL · WATCHLIST · ALERT   │ Eagle S: dismissed ... │
├──────────────┼────────────────────────────┬─────────────────────────────┼────────────────────────┤
│ PRESETS      │ INCIDENT LOG  6 ITEMS      │ GLIDER COVERAGE (SIM)       │ SIGNAL CORE            │
│ NORMAL SONAR │ 2024-12-25 Eagle S ...     │ N ━━━━━●━━ 212   R 8 km     │ LOITER ▮▮▮▯ 12         │
│ NVG  CLEAN   │                            │ corridor cover 81% · 1 op   │ DRAG   ▮▯▯▯  2         │
└──────────────┴────────────────────────────┴─────────────────────────────┴────────────────────────┘
  Independent project by Ravjoth Brar · public data · not affiliated with Helsing
```

- **Visual presets** (GEV-style): `NORMAL`, `SONAR` (green phosphor, a radial sweep, cables
  pulsing), `NVG`, `CLEAN UI`. Use Cesium post-process stages for bloom and color grading, and
  CSS overlays for grain, scanlines and vignette.
- **Strapline:** "UNCLASSIFIED // OPEN SOURCE". It's honest and still has the look. Don't use
  fake classification markings.
- **Click a ship** to get a dossier card: name, IMO, flag, type, the 6 h track drawn on the
  globe, signals, and the honesty panel. **Click a cable** for owner, length, the incidents on
  it, and ships in its corridor now.
- **Mobile:** the globe goes full-screen and the panels become a bottom sheet with tabs. It
  should still look good in a phone screen recording.

---

## 9. Repo layout

```
baltic-seabed/
  CLAUDE.md                 build rules for Claude Code
  PLAN.md                   this file
  package.json              workspaces: server, web
  fly.toml, Dockerfile
  scripts/
    fetch-static.mjs        EMODnet / TeleGeography → clip → simplify → web/data/
    fetch-watchlist.mjs     OpenSanctions maritime CSV → server/data/watchlist.json
    build-grid.mjs          glider grid + bathymetry weights → web/data/grid.json
  server/
    index.js  ingest.js  state.js  corridors.js  detect.js  fuse.js  weather.js  db.js  http.js
    data/anchorages.geojson  watchlist.json  foc-flags.json
  web/
    index.html  main.js  globe.js  panels/*.js  glider.worker.js  presets.js  styles.css
    data/cables.geojson  pipelines.geojson  assets.json  incidents.json  grid.json
  eval/
    labels.json  run-eval.mjs  results/
```

---

## 10. Build phases (each one leaves something you can demo)

| Phase | Deliverable | Exit test |
|---|---|---|
| **0. Static globe** | Cesium globe on the Baltic, cables and pipelines and named assets, incident markers and log, HUD shell | It already looks like a product in a screenshot, and every incident row has a source link |
| **1. Live ships** | Server ingest, `/api/snapshot` + SSE, ships moving on the globe, feed-health chip | 1,500+ vessels visible and updating, survives a socket drop |
| **2. Record** | SQLite archive running on Fly | 48 h of AIS recorded (this runs in the background while you build phases 3–5) |
| **3. Detect + honesty** | `detect.js`, alert stream, dossier card, the "shouldn't conclude" panel, weather context | `npm run eval` passes on the hand labels, with a false-positive rate you're willing to publish |
| **4. Fuse** | Watchlist and FOC matching, `DARK` with the coverage check | Sanctioned ships appear in the Baltic with sources cited |
| **5. Gliders** | Coverage worker, slider, racetracks, alert-to-glider tasking line | Slider at 60 fps, readouts update, every assumption labelled |
| **6. Ship it** | Presets, mobile, `baltic.ravjothbrar.com`, 30 s screen recording, README | Loads in < 3 s cold and works on a phone |

If time runs out after phase 3 you still have a live, honest, working tool. Phase 5 is the
pitch, but it rests on everything before it.

---

## 11. Deploy

```bash
fly launch --no-deploy   # node 22 image, 1 machine, region arn (Stockholm) or ams
```

```bash
fly volumes create data --size 1 --region arn
```

```bash
fly secrets set AISSTREAM_API_KEY=...
```

```bash
fly deploy
```

- Set `min_machines_running = 1` and `auto_stop_machines = "off"` in `fly.toml`. The socket
  has to stay open.
- Point a CNAME for `baltic` at the Fly app.
- If aisstream is down, the server keeps serving the last snapshot with a `STALE` badge. Never
  fill the gap with fake ships.

---

## 12. Rules (also in CLAUDE.md)

- Public data only. Nothing behind a login, and respect each source's terms (OpenSanctions is
  free for non-commercial use, which this is).
- **Never fabricate data.** No invented ships, incidents or coordinates. Synthetic eval cases are
  labelled synthetic everywhere they appear.
- **No personal data.** Ships and companies only, never crew names.
- The glider layer is labelled **simulation** with its assumptions shown. Don't imply it uses
  Helsing data or performance figures beyond what they've published.
- No Helsing logo or branding. Put "Independent project · not affiliated" in the footer.
- Language is about signals and anomalies, never accusations. Say "matches a pattern", not
  "sabotage".

---

## 13. Outreach (after it's live)

- **A heads-up:** Helsing is now a large company with a formal hiring pipeline. That's the case
  where a cold build usually lands nowhere. So don't send it to `careers@`. Aim it at named
  people working on Lura and maritime (UK maritime lead, Lura product and engineering people on
  LinkedIn), one message that reaches the relevant people at once.
- **The message** (draft it with the internship-outreach-email skill when it's time): link plus
  a 30 s video at the top, one line on what it is, one line quoting their "single operator …
  hundreds of gliders" back at them, no ask.
- Wait a week. Send one follow-up with new information (e.g. the eval result). Post it publicly
  at 10–14 days as your own build, with Helsing credited but not tagged.
- **Re-aim the same artifact at other readers:** Ocean Infinity and QinetiQ (Lura partners),
  Cinia, Elering, Fingrid (asset owners), NATO Baltic Sentry coverage, Saab, Kraken Robotics.
  Most of these get no reply, and that's normal. The portfolio piece is yours either way.

---

## Appendix: other niche ideas (if you ever want a second build)

- **GNSS jamming over the Baltic:** fuse ADS-B NIC/NACp degradation (adsb.lol / OpenSky) and AIS
  position jumps into a live jamming heatmap around Kaliningrad. Very relevant to Helsing's
  electronic-warfare work.
- **Drone-sighting airspace picture:** NOTAMs, airport closures and public drone reports around
  European airports and bases (Copenhagen, Munich, Belgian bases in 2025), with the same honesty
  panel.
- **Eastern-flank sensor coverage:** a simulated layout of HX-2 / acoustic sensors along the
  Baltic land border against terrain and roads, sized by operator count.

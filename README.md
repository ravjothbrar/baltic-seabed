# Baltic Seabed Watch

A live map of the Baltic Sea: every ship moving right now, and the cables and pipelines on the seabed beneath them.
When a ship loiters, slows sharply or goes silent right over a cable, it gets flagged, and next to every flag the
site explains why it's probably innocent. The last layer shows how a few hundred autonomous underwater gliders could
listen below the surface and cover the gaps that ship tracking misses.

![Baltic Seabed Watch](docs/screenshots/desktop.png)

*Independent project by Ravjoth Brar. Public data only. Not affiliated with Helsing.*

## What's in it
| Layer | Source | Notes |
|---|---|---|
| Live ships | [Fintraffic Digitraffic](https://www.digitraffic.fi/en/marine-traffic/) (keyless), optional [aisstream.io](https://aisstream.io) | Digitraffic covers the northern Baltic; aisstream extends to the whole sea |
| Telecom cables | [TeleGeography](https://www.submarinecablemap.com) | 44 Baltic systems |
| Pipelines, power cables, ports | [EMODnet Human Activities](https://emodnet.ec.europa.eu/human-activities) | Power cables: German waters only (Estlink/NordBalt not in open data) |
| Sanctions & shadow fleet | [OpenSanctions maritime](https://www.opensanctions.org) | CC BY-NC, non-commercial use |
| Wind & waves | [Open-Meteo](https://open-meteo.com) | Used to *explain away* alerts |
| Incidents | `web/public/data/incidents.json` | 7 cases 2022–2026, each with sources |

## Signals
Seven plain rules in `server/detect.js`: `LOITER`, `DRAG`, `CROSS_SLOW`, `DARK`, `WATCHLIST`, `FOC`, `PROFILE`.
Each one carries its evidence and the innocent explanations it can't rule out (weather, port zones, ship type,
"waiting for orders", receiver coverage). Identity signals, such as a sanctions listing or a flag, never raise an
alert above WATCH without unusual behaviour as well.

## Run locally
```bash
npm install
```
```bash
npm run build
```
```bash
npm start
```
Open http://localhost:8787. For frontend dev with hot reload, run `npm start` in one terminal and `npm --prefix web run dev` in another, then open :5173.

Other commands: `npm run eval` runs the detection tests, `npm run fetch:static` rebuilds the cable layers, and `npm run fetch:watchlist` refreshes the sanctions list.

## Deploy
One always-on Node process, built from the `Dockerfile`, running on Fly.io (about $3–5 a month), with DNS on Cloudflare.

On every push to `main`, GitHub Actions runs CI (`ci.yml`) and deploys (`deploy.yml`). Every Monday it also refreshes the data (`refresh-data.yml`).
See `docs/OUTREACH.md` for what happens after it's live.

## Layout
```
server/   index.js (ingest, state, SSE, API) · detect.js (rules) · corridors.js · ais-meta.js · geo.js
web/      Vite + CesiumJS front end (src/main.js, src/globe.js, src/glider.worker.js)
scripts/  data builders     eval/  detection harness     docs/  contract, outreach, screenshots
```

# Baltic Seabed Watch: build rules

Read `PLAN.md` first. It's the spec. Build it in the phase order in §10, and commit after each
phase so an early stop still leaves something you can demo.

## Stack (don't add to it without a reason)
- Node 22 ESM, native `fetch`, built-in `node:sqlite`. Server deps: `express`, `ws`, `@turf/turf`.
- Frontend: Vite + vanilla JS + CesiumJS. No React. Keyless imagery only: no Cesium ion token,
  no Google tiles.
- One server process serves the API, the SSE stream and the built `web/dist`.

## Hard rules
- `AISSTREAM_API_KEY` lives only in server env. It never goes to the client or into git.
- Never fabricate ships, incidents, coordinates or sanctions hits. With no data, show an empty
  or `STALE` state. Synthetic eval cases carry `synthetic: true`.
- Every `incidents.json` field has a `source` URL. Approximate locations get `approx: true`.
- Every alert shows its signals, its evidence and its innocent explanations
  (the "What you shouldn't conclude" panel). Never show a bare score.
- The glider layer is labelled SIMULATION, and every assumption (detection radius, depth mask)
  is visible in the UI.
- No Helsing logos or branding. The footer says: "Independent project by Ravjoth Brar · public
  data · not affiliated with Helsing".
- Wording: "anomaly", "matches pattern", "signal". Never "sabotage" or "suspect" about a live ship.
- No crew or personal data.

## Look
- Crucix layout (dense mono panels around a central globe) plus God's Eye View chrome (corner
  brackets, glow, presets NORMAL / SONAR / NVG / CLEAN). Black bg, cyan/teal primary, amber warn,
  red alert. All colours are CSS custom properties.
- It has to look good in a 30 s phone screen recording, so check the mobile layout.

## Commands (create these)
- `npm run fetch:static`: build `web/data/*` from EMODnet and TeleGeography (output committed)
- `npm run fetch:watchlist`: OpenSanctions maritime → `server/data/watchlist.json`
- `npm run dev`: server and Vite together
- `npm run eval`: replay `eval/labels.json` through `detect.js` and print per-signal precision/recall
- `fly deploy`: production

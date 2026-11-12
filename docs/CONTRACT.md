# Data contract (server ⇄ web)

## Static files (web/public/data/, served at /data/*)
- `infra.geojson`: FeatureCollection of LineString/MultiLineString.
  props: `{ id, name, kind: "telecom"|"power"|"pipeline", named: bool, source: "TeleGeography"|"EMODnet"|"OpenStreetMap", status? }`
  `named:true` = critical asset (Estlink 2, Balticconnector, C-Lion1, BCS East-West Interlink, NordBalt, Nord Stream, Sweden-Latvia, LV-SE 1, FEC, Baltic Pipe...).
- `incidents.json`: `[{ id, date, title, assets:[name], vessel:{name, imo?, flag?}|null, lat, lon, approx:true, summary, outcome, outcomeStatus:"cleared"|"dismissed"|"inconclusive"|"open"|"accident", sources:[{label,url}] }]`
- `anchorages.geojson`: Polygons, props `{ name }`.
- `grid.json`: glider grid `{ cell: deg, cells:[[lon,lat,infraKm,named(0/1),depthOk(0/1)]] }`.

## GET /api/snapshot
```
{ ts, feeds: { digitraffic:{ok,last,count}, aisstream:{ok,last,count,enabled}, weather:{ok,last}, watchlist:{ok,count,updated} },
  vessels: [Vessel], alerts: [Alert], stats: Stats, heat: [[lon,lat,count]] }
```
Vessel: `{ mmsi, lat, lon, sog, cog, hdg, nav, name, imo, type, typeLabel, flag, flagCode, dest, ts, corridor: assetName|null, watch: {risk:[...], datasets:[...], url}|null, level: "WATCH"|"ELEVATED"|"HIGH"|null }`

Alert: `{ id, mmsi, name, imo, flag, typeLabel, level, asset, lat, lon, firstSeen, lastSeen,
  signals:[{ id:"LOITER"|"DRAG"|"CROSS_SLOW"|"DARK"|"WATCHLIST"|"FOC"|"PROFILE", label, strength:"weak"|"moderate"|"strong", evidence, explained:bool, explainedBy? }],
  context:{ windKn?, waveM?, nearestAnchorage?:{name,nm}, coverage?:0..1 },
  shouldntConclude:[string], track:[[lon,lat,tsMs,sog]] }`

Stats: `{ vessels, inCorridor, watchlist, dark, alerts:{WATCH,ELEVATED,HIGH}, signals:{LOITER:n,...}, msgsPerMin, windKn?, level:"NOMINAL"|"WATCH"|"ELEVATED"|"HIGH", sweepMs }`

## GET /api/stream (SSE)
- `event: vessels` `{ ts, upd:[Vessel], del:[mmsi] }` every 2 s
- `event: alert` Alert (new or changed)
- `event: alert_clear` `{ id }`
- `event: stats` Stats every 5 s
- `event: feeds` feeds object every 10 s
- `event: heat` heat array every 60 s

## GET /api/vessel/:mmsi
`{ vessel: Vessel, track:[[lon,lat,tsMs,sog]], alert: Alert|null }`

# Evaluation

`npm run eval` replays episodes through `server/detect.js`.

- **Synthetic cases** are generated in `run-eval.mjs` along real cable geometry and are marked `[synthetic]`.
  They test the rules' logic, not their real-world false-positive rate.
- **Real cases** are what matter. Run the server for 48 h, then add episodes to `labels.json`:

```json
{ "id": "ferry-estlink-1", "mmsi": 276829000, "from": "2026-11-13T08:00:00Z", "to": "2026-11-13T10:00:00Z",
  "should_flag": false, "expect": [], "reason": "Tallinn–Helsinki ferry crossing Estlink at service speed" }
```

Aim for 30–40: ferries, ships at Primorsk/Ust-Luga anchorages, trawlers, pilot boats, ice-breaker escorts,
a tanker riding out a gale. Then sweep the thresholds in `detect.js` (`T`) and keep the curve.

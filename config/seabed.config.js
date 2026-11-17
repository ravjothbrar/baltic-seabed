// Baltic Seabed Watch: every tunable number in one place.
// Pure ESM with no Node or DOM imports, so the browser engine and the Node server read the same values.
// Change a value here, run `npm run eval`, and the synthetic and regression tests tell you what moved.

export default {
  /** How far either side of a cable or pipeline counts as "in its corridor" (nautical miles). */
  corridorNm: 1.5,

  /** History kept per ship, and when a silent ship is dropped from the map. */
  trackHours: 6,
  dropAfterHours: 8,

  /** Detection thresholds (see server/detect.js and the How it works page). */
  rules: {
    LOITER_SOG: 3,          // kn: slower than this counts as loitering...
    LOITER_MIN: 20,         // ...for at least this many minutes in a corridor
    DRAG_MIN: 10,           // min duration (min) of a drag-like run
    DRAG_SOG_MIN: 1,        // kn: drag-like speed band (low end)
    DRAG_SOG_MAX: 7,        // kn: drag-like speed band (high end)
    DRAG_DROP: 0.6,         // speed at most 60% of the ship's own median
    DRAG_MEDIAN_MIN: 8,     // only for ships that usually make ≥ 8 kn
    DRAG_KM: 2,             // ≥ 2 km of consecutive slow fixes along the corridor
    CROSS_NM: 0.3,          // "crossing" = within 0.3 nm of a named asset
    CROSS_DROP: 0.5,        // at under half the usual speed
    CROSS_MEDIAN_MIN: 6,
    DARK_MIN: 45,           // AIS silent ≥ 45 min...
    DARK_MAX_H: 6,          // ...but < 6 h (older = just gone)
    DARK_NEAR_NM: 10,       // last seen within 10 nm of infrastructure
    DARK_PEERS: 5,          // and ≥ 5 ships nearby kept reporting (rules out coverage holes)
    DARK_PEER_NM: 10,
    PORT_NM: 3,             // default port/anchorage zone radius
    GALE_KN: 30,            // wind at/above this explains slow speed
    WAVE_M: 3,              // waves at/above this explain slow speed
  },

  /** Alert tiers for push channels (Discord webhook, RSS). Cooldown is per ship and level. */
  tiers: {
    HIGH:     { label: 'FLASH',    push: true,  cooldownMin: 60,  maxPerHour: 6 },
    ELEVATED: { label: 'PRIORITY', push: true,  cooldownMin: 180, maxPerHour: 4 },
    WATCH:    { label: 'ROUTINE',  push: false, cooldownMin: 360, maxPerHour: 2 },
  },
};

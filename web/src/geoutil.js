// Camera regions and distance helper (no Cesium dependency).
export const REGIONS = {
  BALTIC: { lon: 20.2, lat: 57.6, range: 1500000, pitch: -52 },
  'GULF OF FINLAND': { lon: 25.4, lat: 59.75, range: 380000, pitch: -48 },
  'ÅLAND': { lon: 20.2, lat: 60.0, range: 300000, pitch: -50 },
  GOTLAND: { lon: 18.6, lat: 57.3, range: 380000, pitch: -50 },
  BORNHOLM: { lon: 14.9, lat: 55.2, range: 240000, pitch: -50 },
  'DANISH STRAITS': { lon: 11.6, lat: 55.7, range: 330000, pitch: -50 },
  WORLD: { lon: 20, lat: 30, range: 18000000, pitch: -90 },
};

export function kmBetween(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

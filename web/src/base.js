// Everything is served relative to the deploy base: "/" on a server, "/baltic-seabed/" on GitHub Pages.
export const BASE = import.meta.env.BASE_URL;
export const asset = (p) => BASE + p.replace(/^\//, '');
window.CESIUM_BASE_URL = asset('cesium/');

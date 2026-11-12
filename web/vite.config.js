import { defineConfig } from 'vite';

// Absolute site URL for link-preview tags (set by the Pages workflow); empty locally → relative URLs.
process.env.VITE_SITE_URL ??= '';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
    fs: { allow: ['..'] },
  },
  build: {
    chunkSizeWarningLimit: 6000, outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), how: resolve(__dirname, 'how.html') } },
  },
  worker: { format: 'es' },
});

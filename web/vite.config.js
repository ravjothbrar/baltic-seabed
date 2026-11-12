import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
  build: { chunkSizeWarningLimit: 6000, outDir: 'dist', emptyOutDir: true },
  worker: { format: 'es' },
});

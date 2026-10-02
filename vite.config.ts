import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 baut alles in eine einzige HTML-Datei (für den Vorschau-Link); Karten bleiben eigene Dateien.
export default defineConfig({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});

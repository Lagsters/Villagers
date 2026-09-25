import { defineConfig } from 'vite';

// Build dziala z podkatalogu GitHub Pages: base = /<nazwa-repozytorium>/.
// Nadpisz przez zmienna srodowiskowa BASE (np. BASE=/ dla wlasnej domeny).
const base = process.env.BASE ?? '/osadnicy-doliny/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? base : '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
}));

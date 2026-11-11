import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      // The game, and the sound test page (docs/sound.md), which ships with it.
      input: { main: 'index.html', soundlab: 'soundlab.html' },
    },
  },
});

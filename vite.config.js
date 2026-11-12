import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/dependency-planner/' : './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          graph: ['@xyflow/react', '@dagrejs/dagre'],
          router: ['react-router-dom'],
        },
      },
    },
  },
});

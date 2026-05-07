import { defineConfig } from 'vite';

const buildDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// When deployed to GitHub Pages at https://USER.github.io/realm-defense/, all
// asset URLs need the /realm-defense/ prefix or they 404. The deploy workflow
// sets DEPLOY_BASE=/realm-defense/ when building for production. Local dev and
// drag-and-drop static hosts (Netlify, etc.) keep relative paths via the './'
// fallback, which works from any path.
const base = process.env.DEPLOY_BASE ?? './';

export default defineConfig({
  base,
  server: {
    port: 5173,
    open: true
  },
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate)
  }
});

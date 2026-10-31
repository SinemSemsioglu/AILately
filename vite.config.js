import { defineConfig } from 'vite';

// Three pages: the map (index.html), the daily front page (dashboard.html) and the Field guide.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', dashboard: 'dashboard.html', guide: 'field-guide.html' },
    },
  },
});

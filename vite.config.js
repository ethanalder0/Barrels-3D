import { writeFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only image sink for the field lab (field.html).
 *
 * POST a data URL to /__capture?name=foo and it lands in .capture/foo.png. The
 * point is being able to look at what the field actually rendered — the layout
 * texture and the 3D view — as files, instead of eyeballing a live canvas.
 * `apply: 'serve'` keeps every byte of this out of a production build.
 */
function captureSink() {
  return {
    name: 'barrels-capture-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') return res.end();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const name = new URL(req.url, 'http://x').searchParams.get('name') || 'capture';
          const data = body.replace(/^data:image\/\w+;base64,/, '');
          mkdirSync('.capture', { recursive: true });
          const file = `.capture/${name.replace(/[^a-z0-9_-]/gi, '')}.png`;
          writeFileSync(file, Buffer.from(data, 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), captureSink()],
  server: {
    /* 5173 unless the environment names a port. Two dev servers on this repo at
       once — the app and the field lab, or two sessions — cannot both have 5173,
       and a hardcoded port here silently wins over any --port passed in. */
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // The Python backend (server/app.py). Proxying keeps the browser on one
      // origin, so no CORS and EventSource just works. API_PORT points it at a
      // backend on another port, for the same reason PORT exists above.
      '/api': {
        target: `http://127.0.0.1:${Number(process.env.API_PORT) || 8787}`,
        changeOrigin: true,
        // SSE must not be buffered or the stream arrives in one lump at the end.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if ((proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
});

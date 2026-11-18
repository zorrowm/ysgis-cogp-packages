import { defineConfig } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const globePackages = ['cesium', 'mars3d-cesium'];
const poisPath = '/data/pois.cogp.parquet';
const poisUpstream = 'https://cogp-demo.spatialty.io/v2.2.2/pois.cogp.parquet';

// The upstream serves byte ranges but does not allow cross-origin browser reads.
function servePois({ middlewares, config }) {
  middlewares.use(async (req, res, next) => {
    if (new URL(req.url, 'http://localhost').pathname !== poisPath) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const range = req.headers.range;
    if (req.method === 'GET' && !/^bytes=\d+-\d+$/.test(range ?? '')) {
      res.writeHead(400).end('A single bounded byte range is required');
      return;
    }
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const response = await fetch(poisUpstream, {
        method: req.method,
        headers: range ? { Range: range } : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (response.status !== (req.method === 'HEAD' ? 200 : 206)) {
        await response.body?.cancel();
        res.writeHead(response.status === 416 ? 416 : 502).end();
        return;
      }
      for (const name of ['Content-Length', 'Content-Range', 'Content-Type']) {
        const value = response.headers.get(name);
        if (value !== null) res.setHeader(name, value);
      }
      res.writeHead(response.status, { 'Accept-Ranges': 'bytes' });
      if (response.body) await pipeline(response.body, res);
      else res.end();
    } catch (error) {
      if (controller.signal.aborted) return;
      config.logger.error(`POI dataset request failed: ${error}`);
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    }
  });
}

// Serve each globe engine's matching assets without a CDN or token.
export default defineConfig({
  resolve: {
    alias: [
      // Mars3D extends a mutable Cesium object, so use the SDKs' CommonJS entries.
      { find: /^mars3d$/, replacement: path.resolve('node_modules/mars3d/mars3d.js') },
      { find: /^mars3d-cesium$/, replacement: path.resolve('node_modules/mars3d-cesium/Build/Cesium/index.cjs') },
    ],
  },
  worker: { format: 'es' },
  build: { outDir: 'dist/examples', chunkSizeWarningLimit: 8000 },
  plugins: [{
    name: 'pois-range-relay',
    configureServer: servePois,
    configurePreviewServer: servePois,
  }, {
    name: 'local-example-assets',
    async writeBundle() {
      await cp('test-data', 'dist/examples/fixtures', { recursive: true });
      for (const pkg of globePackages) {
        await mkdir(`dist/examples/${pkg}`, { recursive: true });
        for (const folder of ['Assets', 'Widgets', 'Workers', 'ThirdParty']) {
          await cp(`node_modules/${pkg}/Build/Cesium/${folder}`, `dist/examples/${pkg}/${folder}`, { recursive: true });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        let file;
        if (/^\/fixtures\/[\w-]+\.parquet$/.test(pathname)) file = path.resolve('test-data', path.basename(pathname));
        else if (globePackages.includes(pathname.split('/')[1])) {
          const pkg = pathname.split('/')[1];
          const root = path.resolve(`node_modules/${pkg}/Build/Cesium`);
          const candidate = path.resolve(root, '.' + pathname.slice(pkg.length + 1));
          if (candidate.startsWith(root + path.sep)) file = candidate;
        }
        if (!file) return next();
        let size;
        try { size = statSync(file).size; } catch { return next(); }
        res.setHeader('Accept-Ranges', 'bytes');
        if (file.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        if (file.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        if (req.method === 'HEAD') { res.setHeader('Content-Length', size); res.end(); return; }
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        res.statusCode = match ? 206 : 200;
        if (match) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  }],
});

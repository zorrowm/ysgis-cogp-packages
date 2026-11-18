import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import { mkdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const production = process.argv.includes('--production');
const pois = process.argv.includes('--pois');
const poisPath = '/data/pois.cogp.parquet';
const server = production ? await preview({ preview: { host: '127.0.0.1', port: 0 } }) : await createServer({ server: { host: '127.0.0.1', port: 0 } });
if (!production) await server.listen();
const port = server.httpServer.address().port;
let executablePath;
for (const candidate of [process.env.COGP_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
try {
  for (const engine of ['openlayers', 'cesium', 'maplibre', 'mars3d']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ranges = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname === poisPath && response.request().method() === 'GET') ranges.push(response.status());
    });
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname === poisPath && request.failure().errorText !== 'net::ERR_ABORTED') errors.push(request.failure().errorText);
    });
    const url = `http://127.0.0.1:${port}/?engine=${engine}${pois ? '' : '&data=cogp'}`;
    await page.goto(url);
    await page.waitForFunction(() => window.cogpExample?.loaded || window.cogpExample?.errors.length, null, { timeout: 60000 });
    if (pois && engine === 'openlayers' && !(await page.evaluate(() => window.cogpExample.errors.length))) {
      await page.waitForFunction(() => window.cogpExample.largestTile > 2500 || window.cogpExample.errors.length, null, { timeout: 30000 });
    }
    const diagnostics = await page.evaluate(() => window.cogpExample);
    assert.deepEqual([...diagnostics.errors, ...errors], [], `${engine} browser errors`);
    assert.equal(diagnostics.loaded, true);
    assert.ok(await page.locator('canvas').count(), `${engine} has a canvas`);
    if (engine === 'cesium' || engine === 'mars3d') assert.ok(diagnostics.rows > 0);
    let dataPixels = 0;
    const deadline = Date.now() + 15000;
    while (dataPixels <= 5 && Date.now() < deadline) {
      const screenshot = await page.locator('#map').screenshot();
      dataPixels = await page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
          if (r > 150 && g < 110 && b < 100) count++;
        }
        return count;
      }, [...screenshot]);
      if (dataPixels <= 5) await page.waitForTimeout(100);
    }
    assert.ok(dataPixels > 5, `${engine} data has visible pixels (${dataPixels})`);
    if (pois) {
      assert.equal(await page.locator('#data').inputValue(), 'pois');
      assert.ok(ranges.length > 0 && ranges.every(status => status === 206), `POI uses HTTP Range: ${ranges}`);
      assert.equal(diagnostics.truncated, false, `${engine} does not truncate North America POI coverage`);
      if (engine === 'openlayers') {
        assert.ok(diagnostics.largestTile > 2500);
        console.log(`${engine}: largest loaded tile = ${diagnostics.largestTile} POIs`);
      } else if (engine === 'cesium' || engine === 'mars3d') {
        assert.ok(diagnostics.rows > 2500);
        if (engine === 'cesium') assert.ok(diagnostics.level < diagnostics.requestedLevel, 'Cesium coarsens instead of truncating');
        console.log(`${engine}: ${diagnostics.rows} POIs at LoD ${diagnostics.level + 1} (requested ${diagnostics.requestedLevel + 1})`);
      }
    } else {
      const runtime = await page.evaluate(async () => {
        const client = window.cogpClient;
        const url = new URL('/fixtures/refinement.parquet', location.href).href;
        const a = await client.openDataset({ url });
        const b = await client.openDataset({ url });
        const controller = new AbortController();
        const aborted = a.readBatch({ columns: [], signal: controller.signal }).then(() => false, error => error.name === 'AbortError');
        controller.abort();
        const cancelled = await aborted;
        await a.close();
        const result = await b.readBatch({ properties: {}, maxRows: 1 });
        const stats = await b.getStats();
        await b.close();
        return { cancelled, length: result.batch.length, geometry: Boolean(result.batch.geometry), truncated: result.truncated, bytes: stats.bytes };
      });
      assert.equal(runtime.cancelled, true);
      assert.equal(runtime.length, 1);
      assert.equal(runtime.geometry, true);
      assert.equal(runtime.truncated, true);
      assert.ok(runtime.bytes > 0);
    }
    const screenshotPrefix = `artifacts/${engine}${pois ? '-pois' : ''}`;
    await page.screenshot({ path: `${screenshotPrefix}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout fits viewport');
    await page.screenshot({ path: `${screenshotPrefix}-mobile.png` });
    if (engine === 'cesium' || engine === 'mars3d') await page.evaluate(() => window.cogpLayer.destroy());
    else if (engine === 'openlayers') await page.evaluate(() => window.cogpLayer.getSource().close());
    await page.close();
    console.log(`${engine}: ${pois ? 'Global POI' : 'Local GeoParquet'} HTTP Range and map rendering passed`);
  }
} finally {
  await browser.close();
  if (production) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
}

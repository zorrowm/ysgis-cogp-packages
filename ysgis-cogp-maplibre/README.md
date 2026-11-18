# ysgis-cogp-maplibre

Use [Cloud Optimized GeoParquet](https://github.com/Kanahiro/cloud-optimized-geoparquet) as a MapLibre GL JS vector source. The adapter reads COGP in a module worker and produces vector tiles in the browser.

```sh
pnpm add ysgis-cogp-maplibre maplibre-gl
```

## Add a source

Register the protocol once, then use `cogpUrl()` to create the tile template. Each key becomes a MapLibre `source-layer` name.

```ts
import * as maplibregl from 'maplibre-gl';
import { cogpUrl, registerCogpProtocol } from 'ysgis-cogp-maplibre';

registerCogpProtocol(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      city: {
        type: 'vector',
        tiles: [cogpUrl({
          buildings: { url: 'https://example.com/buildings.cogp.parquet' },
        })],
      },
    },
    layers: [{
      id: 'buildings', type: 'fill', source: 'city',
      'source-layer': 'buildings',
      paint: { 'fill-color': '#666' },
    }],
  },
});
```

## Select properties or combine files

Each key passed to `cogpUrl()` creates one MVT layer. Omit `properties` to read all ordinary attributes; pass `{}` for geometry only. A mapping selects columns and renames their MVT properties.

```ts
const tiles = cogpUrl({
  buildings: {
    url: 'https://example.com/buildings.cogp.parquet',
    properties: { height: 'details.height', secondFloor: 'floors[1]' },
    maxRowsPerTile: 10_000,
  },
  roads: { url: 'https://example.com/roads.cogp.parquet' },
});
```

MVT property values are display strings, including numbers. Source files need CORS and HTTP range support. Geometry coordinates must be longitude/latitude for Web Mercator tiles. The bundler must support module workers created with `new Worker(new URL(..., import.meta.url))`.

For optional metadata and diagnostics, `inspectCogp(url, signal?)` and `getCogpStats(url)` use the same worker reader cache as tile requests.

## Development

```sh
pnpm --filter ysgis-cogp-maplibre test
```

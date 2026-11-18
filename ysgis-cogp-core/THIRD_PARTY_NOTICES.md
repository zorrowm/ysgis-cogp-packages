# Third-party notices

The reader implementation, fixture data, and tests are based on Cloud Optimized GeoParquet, Copyright (c) 2026 Kanahiro Iguchi, distributed under MIT. See `LICENSE`, `SOURCE_SYNC.md`, and `SOURCE_SYNC.json`.

Vendored hyparquet sources originate from https://github.com/Kanahiro/hyparquet (a fork of https://github.com/hyparam/hyparquet) at commit `9365a88f34a0816b9a77e08c176ca0c480d3524c`, distributed under MIT. See `vendor/hyparquet/README.md` and `vendor/hyparquet/LICENSE`. Both JavaScript and colocated declarations are shipped as required by the fork's column-view and page-planning APIs.

Runtime dependencies include `hyparquet-compressors` (MIT), `lineclip` (ISC), and `@hpcc-js/wasm-zstd` (Apache-2.0). Their licenses and notices are included by their respective package distributions. MVT tile calculations and the Worker communication approach are adapted from the same project's MapLibre adapter under MIT.

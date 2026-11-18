# Source sync baseline

- Reference repository: https://github.com/Kanahiro/cloud-optimized-geoparquet
- Reference commit: `44f29be34d303fbb1febb154413a5aa7aa568a91`
- Reference reader package: `js/packages/reader`, version `2.1.4`
- Vendored hyparquet fork commit: `9365a88f34a0816b9a77e08c176ca0c480d3524c`

The first migration keeps the original flat `src/` layout to preserve imports and simplify upstream comparisons. Reader format algorithms and the vendored JS/declarations are unchanged. `reader-index.ts` retains the original public exports; `index.ts` adds Core APIs implemented in separate files. No runtime or type imports reference `@cogp/reader`.

`SOURCE_SYNC.json` records each original source/vendor file and its SHA-256 hash. The original `index.ts` is the expected changed entry point. The complete Reader test suite is enabled in the default Core test command. Fixture paths are local to this repository; one export assertion was expanded to allow Core's additive exports while requiring every Reader export.

To resynchronize against a new reviewed snapshot, run `node scripts/restore-reference-tests.mjs <upstream-directory>` and `node scripts/record-source-sync.mjs <upstream-directory>`, review changes, reapply the additive-export assertion, then run the full test suite, browser tests, and package smoke tests. Fixture generation scripts require Python/Rust only when regenerating their data; normal tests use committed fixtures.

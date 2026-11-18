import { cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { comlink } from 'vite-plugin-comlink';
import vitePluginBundleObfuscator from 'vite-plugin-bundle-obfuscator';

const root = process.cwd();
const sourceRoot = path.resolve(root, 'src');
const dist = path.resolve(root, 'dist');
const output = path.resolve(root, '.vite-package-dist');

async function collectEntries(directory, relative = '') {
  const entries = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    const name = path.join(relative, item.name);
    if (item.isDirectory()) {
      Object.assign(entries, await collectEntries(file, name));
      continue;
    }
    if (!item.name.endsWith('.ts') || item.name.endsWith('.d.ts')) continue;
    const entryName = name.slice(0, -path.extname(name).length).replaceAll(path.sep, '/');
    entries[entryName] = file;
  }
  return entries;
}

async function removeRuntimeArtifacts(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) {
      await removeRuntimeArtifacts(file);
      if ((await readdir(file)).length === 0) await rm(file, { recursive: true, force: true });
      continue;
    }
    if (item.name.endsWith('.js') || item.name.endsWith('.map')) await rm(file);
  }
}

await rm(output, { recursive: true, force: true });

await build({
  configFile: false,
  root,
  base: './',
  plugins: [
    comlink(),
    vitePluginBundleObfuscator({
      apply: 'build',
      obfuscateWorker: true,
      options: {
        selfDefending: false,
        sourceMap: false,
      },
    }),
  ],
  worker: {
    format: 'es',
    plugins: () => [comlink()],
  },
  build: {
    lib: {
      entry: await collectEntries(sourceRoot),
      formats: ['es'],
    },
    outDir: output,
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      input: await collectEntries(sourceRoot),
      preserveEntrySignatures: 'strict',
      external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
      output: {
        format: 'es',
        preserveModules: true,
        preserveModulesRoot: sourceRoot,
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});

await removeRuntimeArtifacts(dist);
await cp(output, dist, { recursive: true });
await rm(output, { recursive: true, force: true });

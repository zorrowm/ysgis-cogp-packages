import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformWithEsbuild } from 'vite';

const dist = path.resolve(process.cwd(), 'dist');

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (entry.name.endsWith('.map')) { await rm(file); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(file, 'utf8');
    const result = await transformWithEsbuild(source, file, {
      loader: 'js', target: 'es2022', minify: true,
      minifyIdentifiers: true, minifySyntax: true, minifyWhitespace: true,
      legalComments: 'none', sourcemap: false,
    });
    await writeFile(file, result.code, 'utf8');
  }
}

await visit(dist);

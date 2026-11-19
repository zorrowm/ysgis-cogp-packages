import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageNames = [
  'ysgis-cogp-core',
  'ysgis-cogp-openlayers',
  'ysgis-cogp-cesium',
  'ysgis-cogp-maplibre',
  'ysgis-cogp-mars3d',
];

for (const name of packageNames) {
  const packageRoot = path.join(root, name);
  const publishRoot = path.join(packageRoot, 'publish');
  await rm(publishRoot, { recursive: true, force: true });
  await mkdir(publishRoot, { recursive: true });
  await cp(path.join(packageRoot, 'dist'), path.join(publishRoot, 'dist'), { recursive: true });
  await cp(path.join(packageRoot, 'README.md'), path.join(publishRoot, 'README.md'));

  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageJson.dependencies?.['ysgis-cogp-core'] === 'workspace:*') {
    packageJson.dependencies['ysgis-cogp-core'] = '0.0.1';
  }
  await writeFile(
    path.join(publishRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('build exposes the Mars3D layer and graphics adapters', async () => {
  const index = await readFile(join(root, 'dist', 'index.js'), 'utf8')
  const declarations = await readFile(join(root, 'dist', 'layer.d.ts'), 'utf8')
  assert.match(index, /CogpMars3dLayer/)
  assert.match(index, /geometryGraphics/)
  assert.match(declarations, /attach\(map: mars3d\.Map\)/)
  assert.match(declarations, /heightMode\?: 'clamp' \| 'absolute'/)
})

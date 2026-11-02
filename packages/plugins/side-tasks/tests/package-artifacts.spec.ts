import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types?: string; default?: string }>
}

describe('package export surfaces', () => {
  it('ships every declared export target', () => {
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target === 'string') continue
      for (const file of [target.types, target.default]) {
        if (file === undefined) continue
        expect(existsSync(resolve(packageRoot, file)), `${subpath} -> ${file}`).toBe(true)
      }
    }
  })
})

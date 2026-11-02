import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifacts = join(packageRoot, 'artifacts')
const output = join(packageRoot, 'lib')
mkdirSync(output, { recursive: true })

// tsdown names CJS differently across releases; Harness always discovers client.js.
if (!existsSync(join(output, 'client.js')) && existsSync(join(output, 'client.cjs'))) {
  renameSync(join(output, 'client.cjs'), join(output, 'client.js'))
  if (existsSync(join(output, 'client.cjs.map'))) {
    renameSync(join(output, 'client.cjs.map'), join(output, 'client.js.map'))
  }
}

const hostRemote = readFileSync(join(artifacts, 'typert.host.js'), 'utf8')
const factoryEnd = hostRemote.indexOf('\nexport const TYPERT =')
if (factoryEnd < 0) throw new Error('Invalid Host Remote artifact')
const clientRemote = `${hostRemote.slice(0, factoryEnd).replace('const $remote =', 'export const TYPERT_REMOTE =')}\n\nexport default TYPERT_REMOTE\n`
writeFileSync(join(output, 'typert.remote-client.js'), clientRemote)

for (const name of [
  'typert.host.js',
  'typert.host.d.ts',
  'typert.remote-client.d.ts',
]) {
  copyFileSync(join(artifacts, name), join(output, name))
}

for (const name of ['index.js', 'client.js', 'typert.host.js', 'typert.remote-client.js']) {
  if (!existsSync(join(output, name))) throw new Error(`Missing build artifact: ${name}`)
}

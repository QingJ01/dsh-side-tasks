import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The client imports its own `./remote` export. Materialize the generated
// Remote artifacts before tsc so a clean checkout can resolve that self-import.
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifacts = join(packageRoot, 'artifacts')
const output = join(packageRoot, 'lib')
mkdirSync(output, { recursive: true })

const hostRemote = readFileSync(join(artifacts, 'typert.host.js'), 'utf8')
const factoryEnd = hostRemote.indexOf('\nexport const TYPERT =')
if (factoryEnd < 0) throw new Error('Invalid Host Remote artifact')
const clientRemote = `${hostRemote.slice(0, factoryEnd).replace('const $remote =', 'export const TYPERT_REMOTE =')}\n\nexport default TYPERT_REMOTE\n`
writeFileSync(join(output, 'typert.remote-client.js'), clientRemote)
copyFileSync(join(artifacts, 'typert.remote-client.d.ts'), join(output, 'typert.remote-client.d.ts'))

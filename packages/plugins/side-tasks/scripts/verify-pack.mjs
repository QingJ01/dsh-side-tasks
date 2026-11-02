import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tarball = process.argv[2]
if (tarball === undefined) throw new Error('usage: node scripts/verify-pack.mjs <tarball>')

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'))
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
const required = [
  'package/package.json',
  'package/README.md',
  'package/THIRD_PARTY_NOTICES.md',
  'package/lib/index.js',
  'package/lib/client.js',
  'package/lib/typert.host.js',
  'package/lib/typert.remote-client.js',
  'package/lib/types/types.js',
]

for (const entry of required) {
  if (!entries.includes(entry)) throw new Error(`packed tarball is missing ${entry}`)
}
for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (typeof target === 'string') continue
  for (const file of [target.types, target.default]) {
    if (file === undefined) continue
    if (!entries.includes(`package/${file.replace(/^\.\//, '')}`)) {
      throw new Error(`export ${subpath} points outside the packed tarball: ${file}`)
    }
  }
}

const packed = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
if (packed.version !== manifest.version) {
  throw new Error(`packed version ${packed.version} does not match ${manifest.version}`)
}
console.log(`verified ${tarball}: ${entries.length} entries, version ${packed.version}`)

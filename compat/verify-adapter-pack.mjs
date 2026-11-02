#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const required = [
  'README.md',
  'README.zh.md',
  'apply-harness-sidechat.mjs',
  'base.json',
  'harness-sidechat.patch',
]

for (const file of required) {
  const path = resolve(root, file)
  if (!statSync(path).isFile()) throw new Error(`missing repository adapter file: compat/${file}`)
}

const base = JSON.parse(readFileSync(resolve(root, 'base.json'), 'utf8'))
const helper = readFileSync(resolve(root, 'apply-harness-sidechat.mjs'), 'utf8')
const patch = readFileSync(resolve(root, 'harness-sidechat.patch'), 'utf8')
const paths = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
  .map(match => [match[1], match[2]])

if (base.tag !== 'dsh-v0.2.1-rc.5'
  || base.commit !== 'b830ec950faba0a46dda564be3e2d854afed94f1'
  || !helper.includes(`const base = '${base.commit}'`)) {
  throw new Error('adapter base metadata and apply helper do not identify the same pinned source')
}
if (paths.length === 0 || paths.some(([before, after]) => before !== after)) {
  throw new Error('Harness patch has no files or contains a rename')
}
if (paths.some(([, path]) => path.startsWith('/')
  || /(^|\/)(node_modules|\.git|lib|dist)\//.test(path))) {
  throw new Error('Harness patch contains an absolute, private-runtime, or build-output path')
}
if (!paths.some(([, path]) => path.endsWith('.ts'))
  || !paths.some(([, path]) => path.startsWith('docs/'))) {
  throw new Error('Harness patch is missing source or documentation changes')
}

console.log(`Repository adapter pack verified (${required.length} files, ${paths.length} Harness paths, ${base.tag}).`)

#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = 'b830ec950faba0a46dda564be3e2d854afed94f1'
const patch = resolve(dirname(fileURLToPath(import.meta.url)), 'harness-sidechat.patch')
const source = process.argv[2]

function git(path, args) {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim()
}

if (process.argv.length !== 3 || source === undefined || source.trim() === '') {
  console.error('usage: node compat/apply-harness-sidechat.mjs <explicit-Harness-source-path>')
  process.exit(2)
}

let root
try {
  root = realpathSync(resolve(source))
  if (git(root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new Error('path is not the Harness repository root')
  }
  if (git(root, ['rev-parse', 'HEAD']) !== base) {
    throw new Error(`expected pinned base ${base}`)
  }
  const changes = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (changes !== '') {
    throw new Error(`Harness source tree is not clean:\n${changes}`)
  }
  execFileSync('git', ['-C', root, 'apply', '--check', patch], { stdio: 'inherit' })
  execFileSync('git', ['-C', root, 'apply', patch], { stdio: 'inherit' })
  console.log(`Applied Harness sidechat adapter to ${root}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

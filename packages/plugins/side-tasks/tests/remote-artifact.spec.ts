import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideTaskService } from '../lib/index.js'
import { TYPERT } from '../lib/typert.host.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

const methods = ['sideTasks/create', 'sideTasks/capabilities', 'sideTasks/configure', 'sideTasks/discard']

describe('Typert Remote artifacts', () => {
  it('publishes independent creation, capability, configuration, and close endpoints', () => {
    expect(TYPERT.invocations.map(item => item.id).sort()).toEqual(methods.map(method => `dsh-side-tasks#${method}`).sort())
    expect(Object.keys(TYPERT_REMOTE.methods).sort()).toEqual([...methods].sort())
  })

  it('keeps the artifact endpoint set in parity with source decorators', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const decorators = [...source.matchAll(/@Remote\((?:'([^']+)'|{ name: '([^']+)'|)/g)]
      .map(match => match[1] ?? match[2] ?? 'create')
      .sort()
    expect(methods.map(method => method.slice('sideTasks/'.length)).sort()).toEqual(decorators)
  })

  it('authorizes every source and target Session at the Remote boundary', () => {
    const ctx = new Context()
    ctx.provide('agents', { list: () => [] } as never)
    const service = new SideTaskService(ctx)
    const remote = new Map(remoteMethods(service).map(marker => [marker.method, marker]))
    expect(remote.get('create')?.resources?.session('source' as SessionId)).toBe('source')
    expect(remote.get('configure')?.resources?.session({
      parentSessionId: 'source', childSessionId: 'child', kind: 'model',
      selection: { provider: 'test', model: 'model' },
    })).toEqual(['source', 'child'])
    expect(remote.get('discard')?.resources?.session({
      parentSessionId: 'source', childSessionId: 'child',
    })).toEqual(['source', 'child'])
    void ctx.fiber.dispose()
  })

  it('uses a direct source Session argument and has no scoped-Agent lookup', () => {
    const create = TYPERT.invocations.find(item => item.id === 'dsh-side-tasks#sideTasks/create')
    expect(create?.scope).toBeUndefined()
    expect(create?.parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.wire,
      source: parameter.source,
      typeSymbol: parameter.strictCodec?.typeSymbol,
    }))).toEqual([
      { name: 'sourceSessionId', wire: 'sourceSessionId', source: undefined, typeSymbol: '@deepseek-ai/dsh-session/types#SessionId' },
      { name: 'request', wire: 'request', source: 'json', typeSymbol: 'dsh-side-tasks#CreateSideTaskRequest' },
    ])
    expect(create?.result.typeSymbol).toBe('dsh-side-tasks#SideTaskAddress')
    expect(TYPERT_REMOTE.methods['sideTasks/create'].input({ strict: true }).create().parse({
      sourceSessionId: 'source', request: { prompt: 'inspect' },
    })).toEqual({ sourceSessionId: 'source', request: { prompt: 'inspect' } })
    expect(() => TYPERT_REMOTE.methods['sideTasks/create'].input({ strict: true }).create().parse({
      agentId: 'source', request: { prompt: 'inspect' },
    })).toThrow()
    expect(TYPERT_REMOTE.methods['sideTasks/create'].result.create().parse({
      parentSessionId: 'source', childSessionId: 'child', mode: 'independent', contextThrough: -1,
    })).toMatchObject({ mode: 'independent' })
  })

  it('exposes the live Host capability and validates child configuration and close requests', () => {
    expect(TYPERT.invocations.find(item => item.id === 'dsh-side-tasks#sideTasks/capabilities')?.result.typeSymbol)
      .toBe('dsh-side-tasks#SideTaskCapabilities')
    const configure = TYPERT_REMOTE.methods['sideTasks/configure']
    const request = {
      parentSessionId: 'source', childSessionId: 'child', kind: 'model',
      selection: { provider: 'test', model: 'next', reasoningEffort: 'high' },
    }
    expect(configure.input({ strict: true }).create().parse({ request })).toEqual({ request })
    expect(() => configure.input({ strict: true }).create().parse({
      request: { ...request, selection: { ...request.selection, extra: true } },
    })).toThrow()
    expect(TYPERT_REMOTE.methods['sideTasks/discard'].input({ strict: true }).create().parse({
      request: { parentSessionId: 'source', childSessionId: 'child' },
    })).toEqual({ request: { parentSessionId: 'source', childSessionId: 'child' } })
  })

  it('does not depend on the hoist-sensitive protocol remote-info subpath', () => {
    const host = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../lib/typert.remote-client.js', import.meta.url), 'utf8')
    expect(host).not.toContain('@deepseek-ai/dsh-typert-protocol/remote-info')
    expect(client).not.toContain('@deepseek-ai/dsh-typert-protocol/remote-info')
  })
})

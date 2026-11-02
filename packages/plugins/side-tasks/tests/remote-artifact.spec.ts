import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPERT } from '../lib/typert.host.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

describe('Typert Remote artifacts', () => {
  it('publishes the same creation endpoint on Host and Client', () => {
    expect(TYPERT.invocations.map(item => item.id)).toContain('dsh-side-tasks#sideTasks/create')
    expect(Object.keys(TYPERT_REMOTE.methods)).toEqual(['sideTasks/create', 'sideTasks/discard', 'sideTasks/configure'])
  })

  it('keeps the artifact endpoint set in parity with source decorators', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const decorators = [...source.matchAll(/@Remote\('([^']+)'\)/g)].map(match => match[1]).sort()
    const methods = TYPERT.invocations.map(invocation => invocation.method).sort()
    expect(methods).toEqual(decorators)
  })

  it('pins parameter wires, lookup scope, and result types', () => {
    const create = TYPERT.invocations.find(item => item.id === 'dsh-side-tasks#sideTasks/create')
    const discard = TYPERT.invocations.find(item => item.id === 'dsh-side-tasks#sideTasks/discard')
    expect(create?.scope).toEqual({ context: 'agent', wire: 'agentId' })
    expect(create?.parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.wire,
      source: parameter.source,
      typeSymbol: parameter.strictCodec?.typeSymbol,
    }))).toEqual([
      { name: 'agent', wire: 'agentId', source: 'lookup', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId' },
      { name: 'request', wire: 'request', source: 'json', typeSymbol: 'dsh-side-tasks#CreateSideTaskRequest' },
    ])
    expect(create?.result.typeSymbol).toBe('dsh-side-tasks#SideTaskAddress')
    expect(discard?.scope).toBeUndefined()
    expect(discard?.parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.wire,
      source: parameter.source,
      typeSymbol: parameter.strictCodec?.typeSymbol,
    }))).toEqual([
      { name: 'request', wire: 'request', source: 'json', typeSymbol: 'dsh-side-tasks#DiscardSideTaskRequest' },
    ])
    expect(discard?.result.typeSymbol).toBe('dsh-side-tasks#DiscardSideTaskResult')
  })

  it('wires the Gateway-injected cancellation signal on both endpoints', () => {
    for (const id of ['dsh-side-tasks#sideTasks/create', 'dsh-side-tasks#sideTasks/discard']) {
      const invocation = TYPERT.invocations.find(item => item.id === id)
      expect(invocation?.cancellation).toEqual({ parameter: 'signal' })
    }
  })

  it('validates wire input and result with the public protocol factory', () => {
    const method = TYPERT_REMOTE.methods['sideTasks/create']
    expect(method).toBeDefined()
    const input = method.input({ strict: true }).create()
    expect(input.parse({ agentId: 'parent', request: { prompt: 'inspect' } })).toEqual({
      agentId: 'parent',
      request: { prompt: 'inspect' },
    })
    expect(() => input.parse({ agentId: 'parent', request: { prompt: 'inspect', extra: true } })).toThrow()
    expect(method.result.create().parse({
      parentSessionId: 'parent',
      childSessionId: 'child',
      mode: 'continuable',
    })).toEqual({
      parentSessionId: 'parent',
      childSessionId: 'child',
      mode: 'continuable',
    })
  })

  it('does not depend on the hoist-sensitive protocol remote-info subpath', () => {
    const host = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../lib/typert.remote-client.js', import.meta.url), 'utf8')
    expect(host).not.toContain('@deepseek-ai/dsh-typert-protocol/remote-info')
    expect(client).not.toContain('@deepseek-ai/dsh-typert-protocol/remote-info')
  })

  it('validates child configuration without Agent lookup or unknown preset arguments', () => {
    const method = TYPERT_REMOTE.methods['sideTasks/configure']
    const input = method.input({ strict: true }).create()
    const request = { parentSessionId: 'parent', childSessionId: 'child', kind: 'model', selection: { provider: 'test', model: 'next', reasoningEffort: 'high' } }
    expect(input.parse({ request })).toEqual({ request })
    expect(() => input.parse({ request: { ...request, selection: { ...request.selection, extra: true } } })).toThrow()
    expect(() => input.parse({ request: { parentSessionId: 'parent', childSessionId: 'child', kind: 'permission', preset: 'workspace-write; other' } })).toThrow()
    const descriptor = TYPERT.invocations.find(item => item.method === 'configure')
    expect(descriptor?.scope).toBeUndefined()
    expect(descriptor?.cancellation).toEqual({ parameter: 'signal' })
    expect(method.result.create().parse({ configured: true })).toEqual({ configured: true })
  })

  it('validates the close request and result', () => {
    const method = TYPERT_REMOTE.methods['sideTasks/discard']
    expect(method.input({ strict: true }).create().parse({
      request: { parentSessionId: 'parent', childSessionId: 'child' },
    })).toEqual({ request: { parentSessionId: 'parent', childSessionId: 'child' } })
    expect(method.result.create().parse({ discarded: true })).toEqual({ discarded: true })
  })
})

import { describe, expect, it } from 'vitest'
import { TYPERT } from '../lib/typert.host.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

describe('Typert Remote artifacts', () => {
  it('publishes the same creation endpoint on Host and Client', () => {
    expect(TYPERT.invocations.map(item => item.id)).toContain('dsh-side-tasks#sideTasks/create')
    expect(Object.keys(TYPERT_REMOTE.methods)).toEqual(['sideTasks/create'])
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
})

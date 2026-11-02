import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from '../src/types.ts'
import { SideChatPreparations } from '../src/client/preparation.ts'

const address: SideTaskAddress = { parentSessionId: 'parent' as SessionId, childSessionId: 'child' as SessionId, mode: 'continuable' }
const success = { ok: true as const, value: address }

describe('side chat creation ownership', () => {
  it('deduplicates synchronous mount attempts for one occurrence', async () => {
    const create = vi.fn(async () => success)
    const owner = new SideChatPreparations(create, vi.fn())
    const first = owner.prepare(address.parentSessionId, 'tab')
    expect(owner.prepare(address.parentSessionId, 'tab')).toBe(first)
    await first
    expect(create).toHaveBeenCalledOnce()
  })

  it('archives a late accepted child after close and never navigates', async () => {
    const pending = Promise.withResolvers<typeof success>()
    const discard = vi.fn()
    const owner = new SideChatPreparations(() => pending.promise, discard)
    const result = owner.prepare(address.parentSessionId, 'tab')
    owner.close(address.parentSessionId, 'tab')
    pending.resolve(success)
    await result
    const navigate = vi.fn()
    owner.transfer(address.parentSessionId, 'tab', navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledExactlyOnceWith(address)
  })

  it('does not archive the child when replacing its preparation tab', async () => {
    const discard = vi.fn()
    const owner = new SideChatPreparations(async () => success, discard)
    await owner.prepare(address.parentSessionId, 'tab')
    owner.transfer(address.parentSessionId, 'tab', () => owner.close(address.parentSessionId, 'tab'))
    expect(discard).not.toHaveBeenCalled()
  })

  it('cleans up after failed placement and on unload', async () => {
    const discard = vi.fn()
    const owner = new SideChatPreparations(async () => success, discard)
    await owner.prepare(address.parentSessionId, 'tab')
    expect(() => owner.transfer(address.parentSessionId, 'tab', () => { throw Error('gone') })).toThrow('gone')
    owner.dispose()
    expect(discard).toHaveBeenCalledOnce()
  })
})

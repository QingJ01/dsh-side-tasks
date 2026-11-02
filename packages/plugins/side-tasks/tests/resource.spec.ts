import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sideChatResourceProvider } from '../src/client/sidebar-chat.tsx'
import { sideTaskChatAddress } from '../src/shared.ts'
import type { SideTaskAddress } from '../src/types.ts'

async function firstFrame(provider: ReturnType<typeof sideChatResourceProvider>, address: string) {
  for await (const frame of provider.open(address, { signal: new AbortController().signal })) return frame
  return undefined
}

describe('sidechat resource provider', () => {
  it('reports a malformed address as a failure frame instead of throwing', async () => {
    const frame = await firstFrame(sideChatResourceProvider({} as never), 'dsh-resource://sidechat/nope')
    expect(frame).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'sidechat/invalid-address' }),
    }))
  })

  it('reports a retain failure as a failure frame', async () => {
    const addresses = new Map<SessionId, SideTaskAddress>()
    const boundaries = new Map<SessionId, number>()
    const provider = sideChatResourceProvider({
      retain: () => { throw new Error('child unavailable') },
    } as never, boundaries, addresses)
    const address = sideTaskChatAddress({
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'child' as SessionId,
      mode: 'continuable',
      contextThrough: -1,
    })
    const frame = await firstFrame(provider, address)
    expect(frame).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'sidechat/retain-failed', message: 'child unavailable' }),
    }))
    expect(addresses.size).toBe(0)
    expect(boundaries.size).toBe(0)
  })

  it('keeps shared child routing until the last resource closes, without failed-retain pollution', async () => {
    const addresses = new Map<SessionId, SideTaskAddress>()
    const boundaries = new Map<SessionId, number>()
    const release = vi.fn()
    const retain = vi.fn(() => ({ release }))
    const provider = sideChatResourceProvider({ retain } as never, boundaries, addresses)
    const child = 'child' as SessionId
    const address = { parentSessionId: 'parent' as SessionId, childSessionId: child,
      mode: 'continuable' as const, contextThrough: -1 }
    const first = provider.open(sideTaskChatAddress(address), { signal: new AbortController().signal })
    const second = provider.open(sideTaskChatAddress(address), { signal: new AbortController().signal })
    expect((await first.next()).value).toMatchObject({ ok: true })
    expect((await second.next()).value).toMatchObject({ ok: true })
    retain.mockImplementationOnce(() => { throw new Error('wrong parent') })
    await firstFrame(provider, sideTaskChatAddress({ ...address, parentSessionId: 'other' as SessionId, contextThrough: 99 }))
    expect(addresses.get(child)).toEqual(address)
    expect(boundaries.get(child)).toBe(-1)
    await second.return(undefined)
    expect(release).toHaveBeenCalledOnce()
    expect(addresses.get(child)).toEqual(address)
    expect(boundaries.get(child)).toBe(-1)
    await first.return(undefined)
    expect(release).toHaveBeenCalledTimes(2)
    expect(addresses.size).toBe(0)
    expect(boundaries.size).toBe(0)
  })

  it('cleans routing on abort while waiting for the resource to close', async () => {
    const addresses = new Map<SessionId, SideTaskAddress>()
    const boundaries = new Map<SessionId, number>()
    const release = vi.fn()
    const provider = sideChatResourceProvider({ retain: () => ({ release }) } as never, boundaries, addresses)
    const controller = new AbortController()
    const resource = provider.open(sideTaskChatAddress({ parentSessionId: 'parent' as SessionId,
      childSessionId: 'child' as SessionId, mode: 'continuable', contextThrough: -1 }), { signal: controller.signal })
    await resource.next()
    const completion = resource.next()
    controller.abort()
    expect((await completion).done).toBe(true)
    expect(release).toHaveBeenCalledOnce()
    expect(addresses.size).toBe(0)
    expect(boundaries.size).toBe(0)
  })
})

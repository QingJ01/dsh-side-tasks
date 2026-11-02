import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sideChatResourceProvider } from '../src/client/sidebar-chat.tsx'
import { sideTaskChatAddress } from '../src/shared.ts'

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
    const provider = sideChatResourceProvider({
      retain: () => { throw new Error('child unavailable') },
    } as never)
    const address = sideTaskChatAddress({
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'child' as SessionId,
      mode: 'continuable',
    })
    const frame = await firstFrame(provider, address)
    expect(frame).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'sidechat/retain-failed', message: 'child unavailable' }),
    }))
  })
})

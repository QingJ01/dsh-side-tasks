// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatEmptyState, SideChatStartPage, hasOwnSideChatTurn } from '../src/client/sidebar-chat.tsx'
import { SideChatPreparations } from '../src/client/preparation.ts'
import { en, type SideTaskKey } from '../src/client/locales.ts'

const t = ((key: SideTaskKey) => en[key]) as never
const address = { parentSessionId: 'parent' as SessionId, childSessionId: 'child' as SessionId, mode: 'continuable' as const }
afterEach(cleanup)

describe('native side chat preparation', () => {
  it('keeps inherited turns behind the empty notice until the child starts its own turn', () => {
    const window = { entries: [{ type: 'event', event: { type: 'turn/start', seq: 3 } }], hasMore: false } as never
    expect(hasOwnSideChatTurn(window, 10)).toBe(false)
    expect(hasOwnSideChatTurn(window, 2)).toBe(true)
    expect(hasOwnSideChatTurn(window, undefined)).toBe(true)
  })
  it('explains temporary chat closure', () => {
    render(<SideChatEmptyState t={t} />)
    expect(screen.getByText(en['empty.description'])).toBeTruthy()
  })

  it('blocks child or archived parents before creating anything', () => {
    const create = vi.fn()
    render(<SideChatStartPage parentSessionId={'parent' as SessionId}
      tab={{ id: 'draft', actions: {} } as never}
      preparations={new SideChatPreparations(create, vi.fn())} t={t} blocked />)
    expect(screen.getByText(en['create.blocked'])).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('creates once under StrictMode and replaces the preparation with native Conversation', async () => {
    const create = vi.fn(async () => ({ ok: true as const, value: address }))
    const preparations = new SideChatPreparations(create, vi.fn())
    const openResource = vi.fn(() => { preparations.close(address.parentSessionId, 'draft') })
    const { container } = render(<StrictMode><SideChatStartPage parentSessionId={address.parentSessionId}
      tab={{ id: 'draft', actions: { openResource } } as never}
      preparations={preparations} t={t} /></StrictMode>)
    await waitFor(() => expect(openResource).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledExactlyOnceWith('parent', '')
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining('/session/child?'), { replaceTab: true })
    expect(container.querySelector('textarea')).toBeNull()
  })
})

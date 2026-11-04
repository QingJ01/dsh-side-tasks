// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EmptyChatView, SideChatEmptyState, SideChatStartPage, hasOwnSideChatTurn } from '../src/client/sidebar-chat.tsx'
import { SideChatPreparations } from '../src/client/preparation.ts'
import { en, zh, type SideTaskKey } from '../src/client/locales.ts'

const t = ((key: SideTaskKey) => en[key]) as never
const address = { parentSessionId: 'parent' as SessionId, childSessionId: 'child' as SessionId, mode: 'continuable' as const }
afterEach(cleanup)

describe('native side chat preparation', () => {
  it('keeps the native draft-persistence owner mounted while hiding an empty transcript', () => {
    const renderSlot = vi.fn(() => <div data-native-session />)
    const { container } = render(<EmptyChatView {...{ renderSlot } as never} />)
    expect(renderSlot).toHaveBeenCalledWith('conversation.session', { view: 'chat' })
    expect(container.querySelector('[hidden] [data-native-session]')).not.toBeNull()
  })

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

  it.each(['user/message', 'assistant/message', 'assistant/live-chunk'])(
    'recognizes a paginated child %s without its turn/start', (type) => {
      const window = { entries: [{ type: type === 'assistant/live-chunk' ? 'transient' : 'event',
        event: { type, seq: 501, data: { source: { kind: 'user' } } } }], hasMore: true } as never
      expect(hasOwnSideChatTurn(window, -1)).toBe(true)
      expect(hasOwnSideChatTurn(window, 501)).toBe(false)
    },
  )

  it('does not mistake metadata or injected context for a first child exchange', () => {
    const window = { entries: [
      { type: 'event', event: { type: 'subagent/descriptor', seq: 0 } },
      { type: 'event', event: { type: 'user/message', seq: 1, data: { source: { kind: 'context' } } } },
    ], hasMore: false } as never
    expect(hasOwnSideChatTurn(window, -1)).toBe(false)
  })

  it('blocks child or archived parents before creating anything', () => {
    const create = vi.fn()
    render(<SideChatStartPage parentSessionId={'parent' as SessionId}
      tab={{ id: 'draft', actions: {} } as never}
      preparations={new SideChatPreparations(create, vi.fn())} t={t} blocked />)
    expect(screen.getByText(en['create.blocked'])).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([en, zh])('localizes creation failures without exposing Remote or thrown payloads', async (locale) => {
    const payload = 'private source details'
    const failures = [
      ['side-tasks/unsupported-harness', 'create.unsupported'],
      ['side-tasks/archived-source', 'create.archived'],
      ['side-tasks/non-ordinary-source', 'create.nonOrdinary'],
    ] as const
    const create = vi.fn()
    for (const [code] of failures) {
      const wire = JSON.parse(JSON.stringify({ code, message: payload, details: {} }))
      create.mockResolvedValueOnce({ ok: false, error: new RemoteError(wire.code, wire.message, wire.details) })
    }
    create.mockResolvedValueOnce({ ok: false, error: { code: 'unknown', message: payload } })
      .mockRejectedValueOnce(new Error(payload))
      .mockResolvedValueOnce({ ok: true, value: address })
    const preparations = new SideChatPreparations(create, vi.fn())
    const openResource = vi.fn()
    render(<SideChatStartPage parentSessionId={address.parentSessionId}
      tab={{ id: 'draft', actions: { openResource } } as never}
      preparations={preparations} t={((key: SideTaskKey) => locale[key]) as never} />)
    for (const key of [...failures.map(([, key]) => key), 'create.failed', 'create.failed'] as const) {
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(locale[key]))
      expect(document.body.textContent).not.toContain(payload)
      fireEvent.click(screen.getByRole('button', { name: locale.retry }))
    }
    await waitFor(() => expect(openResource).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
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

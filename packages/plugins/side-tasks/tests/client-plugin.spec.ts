import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from '../src/types.ts'
import { apply } from '../src/client/index.ts'
import { SIDE_CHAT_KIND, SIDE_CHAT_PAGE_ADDRESS, sideTaskChatAddress } from '../src/shared.ts'

const address: SideTaskAddress = {
  parentSessionId: 'parent' as SessionId,
  childSessionId: 'child' as SessionId,
  mode: 'continuable',
}

describe('client creation and close lifecycle', () => {
  it('opens children and discards the same identity on tab close without another create', async () => {
    let registration: { definition: { inject: (id: SessionId) => {
      createSideTask: (prompt: string) => Promise<unknown>
      openSideTask: (address: SideTaskAddress) => void
      refreshSideTasks: () => void
    } } } | undefined
    let closeHandler: ((parent: SessionId, tab: { id: string; contentId: string }) => void) | undefined
    const create = vi.fn(async () => ({ ok: true as const, value: address }))
    const discard = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    const openResource = vi.fn()
    const refreshProjections = vi.fn()
    const registerCloseHandler = vi.fn((_kind: string, handler: typeof closeHandler) => {
      closeHandler = handler
      return () => {}
    })
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => callback(ctx),
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      slots: {
        inject: (seat: string, callback: () => unknown) => {
          const value = callback() as typeof registration
          if (seat === 'conversation.session.header.actions') registration = value
          return value
        },
        register: (definition: unknown) => ({ definition }),
      },
      resources: { register: vi.fn(() => () => {}) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      remote: { sideTasks: { create, discard } },
      sessions: {
        refreshProjections,
        list: { getSnapshot: vi.fn(() => ({ byId: {} })) },
      },
      sidebarRight: { openResource, registerCloseHandler },
    }
    apply(ctx as never)

    expect(registration).toBeDefined()
    expect(registerCloseHandler).toHaveBeenCalledWith(SIDE_CHAT_KIND, expect.any(Function))
    const tabType = ctx.sidebarRightTabs.register.mock.calls[0]?.[0]
    expect(tabType.guide).toHaveLength(1)
    expect(tabType.guide[0].order).toBe(25)
    expect(tabType.guide[0].title()).toBe('empty.title')
    expect(tabType.guide[0].description()).toBe('guide.description')
    expect(typeof tabType.guide[0].icon).toBe('function')
    const actions = registration!.definition.inject('parent' as SessionId)
    await actions.createSideTask('investigate')
    expect(create).toHaveBeenCalledWith('parent', { prompt: 'investigate' })
    expect(openResource).toHaveBeenCalledTimes(1)
    expect(openResource.mock.calls[0]?.[1]).toEqual({ kind: SIDE_CHAT_KIND, preferNewPane: true })

    const existing: SideTaskAddress = { ...address, childSessionId: 'existing' as SessionId }
    actions.openSideTask(existing)
    expect(openResource).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(1)

    closeHandler!('parent' as SessionId, { id: 'start-page', contentId: SIDE_CHAT_PAGE_ADDRESS })
    expect(discard).not.toHaveBeenCalled()

    closeHandler!('parent' as SessionId, {
      id: 'tab-1',
      contentId: sideTaskChatAddress(existing),
    })
    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith('parent', { childSessionId: 'existing' }))
    expect(create).toHaveBeenCalledTimes(1)
  })
})

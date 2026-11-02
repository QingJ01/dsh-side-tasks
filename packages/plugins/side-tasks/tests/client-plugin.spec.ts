import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from '../src/types.ts'
import { apply, inject } from '../src/client/index.ts'
import { SIDE_CHAT_KIND, SIDE_CHAT_PAGE_ADDRESS, sideTaskChatAddress } from '../src/shared.ts'

const address: SideTaskAddress = {
  parentSessionId: 'parent' as SessionId,
  childSessionId: 'child' as SessionId,
  mode: 'continuable',
}

describe('client creation and close lifecycle', () => {
  it('stays inert instead of failing boot when its Remote contribution cannot mount', async () => {
    expect(inject).not.toContain('remote.sideTasks')
    const injectChild = vi.fn()
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      locale: { register: vi.fn() },
      remote: { $mount: vi.fn(async () => { throw new Error('malformed contribution') }) },
      inject: injectChild,
    }
    await expect(apply(ctx as never)).resolves.toEqual(expect.any(Function))
    expect(injectChild).not.toHaveBeenCalled()
  })

  it('does not reject boot when locale registration collides', async () => {
    const ctx = {
      effect: () => { throw new Error('duplicate locale') },
      locale: { register: vi.fn() },
    }
    await expect(apply(ctx as never)).resolves.toEqual(expect.any(Function))
  })

  it('rolls back the Remote when async UI registration fails', async () => {
    const unmountRemote = vi.fn(async () => {})
    const dispose = vi.fn(async () => {})
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      locale: { register: vi.fn() },
      remote: { $mount: vi.fn(async () => unmountRemote) },
      inject: () => ({
        then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('registration failed')),
        dispose,
      }),
    }
    await expect(apply(ctx as never)).resolves.toEqual(expect.any(Function))
    expect(dispose).toHaveBeenCalledOnce()
    expect(unmountRemote).toHaveBeenCalledOnce()
  })

  it('unmounts the Remote if UI registration throws synchronously', async () => {
    const unmountRemote = vi.fn(async () => {})
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      locale: { register: vi.fn() },
      remote: { $mount: vi.fn(async () => unmountRemote) },
      inject: () => { throw new Error('slot conflict') },
    }
    await expect(apply(ctx as never)).resolves.toEqual(expect.any(Function))
    expect(unmountRemote).toHaveBeenCalledOnce()
  })

  it('opens children and discards the same identity on tab close without another create', async () => {
    let registration: { definition: { inject: (id: SessionId) => {
      openSideChat: () => void
    } } } | undefined
    let closeHandler: ((parent: SessionId, tab: { id: string; contentId: string }) => void) | undefined
    let bodyRegistration: { name?: string; children?: Record<string, unknown> } | undefined
    const create = vi.fn(async () => ({ ok: true as const, value: address }))
    const discard = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    const openTab = vi.fn()
    const focus = vi.fn()
    const refreshProjections = vi.fn()
    const openTabs: { sessionId: SessionId; tabId: string; kind: string; contentId: string }[] = []
    const registerCloseHandler = vi.fn((_kind: string, handler: typeof closeHandler) => {
      closeHandler = handler
      return () => {}
    })
    const unmountRemote = vi.fn(async () => {})
    const mountRemote = vi.fn(async () => unmountRemote)
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => callback(ctx),
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      slots: {
        entries: () => [],
        subscribe: () => () => {},
        inject: (seat: string, callback: () => unknown) => {
          const value = callback() as typeof registration
          if (seat === 'conversation.session.header.utilities') registration = value
          return value
        },
        register: (definition: { name?: string; children?: Record<string, unknown> }) => {
          if (definition.name === 'sidebar.right.pane.tab') bodyRegistration = definition
          return { definition }
        },
      },
      resources: { register: vi.fn(() => () => {}) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      remote: { $mount: mountRemote, sideTasks: { create, discard } },
      sessions: {
        refreshProjections,
        list: {
          getSnapshot: vi.fn(() => ({
            byId: {},
            projectionsBySession: {
              parent: {
                values: {
                  subagentCatalog: [{
                    id: 'existing',
                    createdAt: 1,
                    mode: 'continuable',
                    label: 'Side task · Existing investigation',
                  }],
                },
              },
            },
          })),
        },
      },
      sidebarRight: { openTab, focus, registerCloseHandler, openTabs: { getSnapshot: () => openTabs } },
    }
    await apply(ctx as never)

    expect(mountRemote).toHaveBeenCalledOnce()
    expect(registration).toBeDefined()
    expect(registerCloseHandler).toHaveBeenCalledWith(SIDE_CHAT_KIND, expect.any(Function))
    expect(bodyRegistration?.children).toEqual({
      'dsh-side-tasks.conversation': { kind: 'single', scope: 'session' },
    })
    expect(bodyRegistration?.children).not.toHaveProperty('sidebar.chat.conversation')
    const tabType = ctx.sidebarRightTabs.register.mock.calls[0]?.[0]
    expect(tabType.guide).toHaveLength(1)
    expect(tabType.guide[0].order).toBe(25)
    expect(tabType.guide[0].title()).toBe('empty.title')
    expect(tabType.guide[0].description()).toBe('guide.description')
    expect(typeof tabType.guide[0].icon).toBe('function')
    expect(tabType.title(sideTaskChatAddress({
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'existing' as SessionId,
      mode: 'continuable',
    }))).toBe('Existing investigation')
    const actions = registration!.definition.inject('parent' as SessionId)
    actions.openSideChat()
    expect(openTab).toHaveBeenCalledWith(SIDE_CHAT_KIND, { preferNewPane: false })
    expect(focus).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    // A second click focuses the tab already open for this parent instead of
    // minting another child and another tab.
    openTabs.push({ sessionId: 'parent' as SessionId, tabId: 'tab-1', kind: SIDE_CHAT_KIND, contentId: SIDE_CHAT_PAGE_ADDRESS })
    actions.openSideChat()
    expect(focus).toHaveBeenCalledWith('tab-1')
    expect(openTab).toHaveBeenCalledOnce()
    openTabs.length = 0

    const existing: SideTaskAddress = { ...address, childSessionId: 'existing' as SessionId }

    closeHandler!('parent' as SessionId, { id: 'start-page', contentId: SIDE_CHAT_PAGE_ADDRESS })
    expect(discard).not.toHaveBeenCalled()
    expect(() => closeHandler!('parent' as SessionId, {
      id: 'malformed',
      contentId: 'dsh-resource://sidechat/session/not-a-valid-address',
    })).not.toThrow()
    expect(discard).not.toHaveBeenCalled()

    closeHandler!('parent' as SessionId, {
      id: 'tab-1',
      contentId: sideTaskChatAddress(existing),
    })
    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith({
      parentSessionId: 'parent',
      childSessionId: 'existing',
    }))
    expect(create).not.toHaveBeenCalled()
  })
})

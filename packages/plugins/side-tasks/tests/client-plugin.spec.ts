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
  function reinjectableContext(discard: (request: unknown) => Promise<unknown>) {
    const scopeDisposers: Array<() => unknown> = []
    let closeHandler: ((parent: SessionId, tab: { id: string; contentId: string }) => void) | undefined
    let injected: ((scope: unknown) => unknown) | undefined
    const openTabs: { sessionId: SessionId; tabId: string; kind: string; contentId: string }[] = []
    const unmount = vi.fn(async () => {})
    const ctx = {
      effect: (callback: () => unknown) => {
        const disposer = callback()
        if (typeof disposer === 'function') scopeDisposers.push(disposer as () => unknown)
        return disposer
      },
      on: () => () => {},
      inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => {
        injected = callback
        callback(ctx)
        return { dispose: async () => {} }
      },
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      slots: {
        entries: () => [],
        subscribe: () => () => {},
        inject: (_seat: string, callback: () => unknown) => callback(),
        register: (definition: unknown) => ({ definition }),
      },
      resources: { register: vi.fn(() => () => {}) },
      uiWorkspace: { supportsSideChatSessions: true },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      remote: { $mount: vi.fn(async () => unmount), sideTasks: { create: vi.fn(), discard } },
      sessions: {
        retain: vi.fn(),
        retainInfo: vi.fn(() => ({ getSnapshot: () => ({ referenceCount: 1 }) })),
        binding: vi.fn(),
        refreshProjections: vi.fn(),
        list: { getSnapshot: vi.fn(() => ({ byId: {}, projectionsBySession: {} })) },
      },
      sidebarRight: {
        openTab: vi.fn(), focus: vi.fn(), isExpanded: () => true, toggleExpanded: vi.fn(),
        registerCloseHandler: (_kind: string, handler: typeof closeHandler) => {
          closeHandler = handler
          return () => {}
        },
        openTabs: { getSnapshot: () => openTabs },
      },
    }
    return {
      ctx,
      unmount,
      close: (tab: { id: string; contentId: string }) => closeHandler!('parent' as SessionId, tab),
      async disposeScope() {
        const disposers = scopeDisposers.splice(0, scopeDisposers.length)
        for (const disposer of disposers.reverse()) await disposer()
      },
      startScopeDisposal(): Promise<unknown> {
        const disposers = scopeDisposers.splice(0, scopeDisposers.length).reverse()
        return Promise.all(disposers.map(disposer => disposer()))
      },
      reinject: () => { injected!(ctx) },
    }
  }

  it('unmounts the Remote only after an independently disposing scope queue settles', async () => {
    const stalled = Promise.withResolvers<never>()
    const discard = vi.fn(() => stalled.promise)
    const scope = reinjectableContext(discard as never)
    const teardown = await apply(scope.ctx as never)
    scope.close({ id: 'tab-1', contentId: sideTaskChatAddress(address) })
    await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce())
    const scopeDisposal = scope.startScopeDisposal()
    let unmounted = false
    const outer = teardown().then(() => { unmounted = true })
    await Promise.resolve()
    expect(scope.unmount).not.toHaveBeenCalled()
    expect(unmounted).toBe(false)
    stalled.resolve({ ok: false, error: { code: 'gateway/internal' } } as never)
    await scopeDisposal
    await outer
    expect(scope.unmount).toHaveBeenCalledOnce()
  })

  it('owns one queue per injection scope and never issues requests from a withdrawn one', async () => {
    const discard = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    const scope = reinjectableContext(discard as never)
    const teardown = await apply(scope.ctx as never)
    const contentId = sideTaskChatAddress(address)
    await scope.disposeScope()
    scope.close({ id: 'tab-1', contentId })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(discard).not.toHaveBeenCalled()

    scope.reinject()
    scope.close({ id: 'tab-2', contentId })
    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith({
      parentSessionId: 'parent', childSessionId: 'child',
    }))
    expect(discard).toHaveBeenCalledOnce()
    await teardown()
  })

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
    const registeredSlots: string[] = []
    let registration: { definition: { inject: (id: SessionId) => {
      openSideChat: () => void
    } } } | undefined
    let closeHandler: ((parent: SessionId, tab: { id: string; contentId: string }) => void) | undefined
    let bodyRegistration: { name?: string; children?: Record<string, unknown> } | undefined
    let overlayRegistration: { inject?: () => Record<string, unknown> } | undefined
    let connectionReset: (() => void) | undefined
    const create = vi.fn(async () => ({ ok: true as const, value: address }))
    const discard = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    const openTab = vi.fn()
    const focus = vi.fn()
    let expanded = true
    const toggleExpanded = vi.fn(() => { expanded = !expanded })
    const refreshProjections = vi.fn()
    const openTabs: { sessionId: SessionId; tabId: string; kind: string; contentId: string }[] = []
    const registerCloseHandler = vi.fn((_kind: string, handler: typeof closeHandler) => {
      closeHandler = handler
      return () => {}
    })
    const unmountRemote = vi.fn(async () => {})
    const mountRemote = vi.fn(async () => unmountRemote)
    const on = vi.fn((name: string, handler: () => void) => {
      if (name === 'connection/reset') connectionReset = handler
      return () => {}
    })
    const uiDispose = vi.fn(async () => {})
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      on,
      inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => {
        callback(ctx)
        return { dispose: uiDispose }
      },
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      slots: {
        entries: () => [{ component: () => null, options: {}, inject: () => ({}) }],
        subscribe: () => () => {},
        inject: (seat: string, callback: () => unknown) => {
          const value = callback() as typeof registration
          if (seat === 'conversation.session.header.utilities') registration = value
          if (seat === 'shell.overlay') {
            overlayRegistration = (value as {
              definition: { inject?: () => Record<string, unknown> }
            }).definition
          }
          return value
        },
        register: (definition: {
          name?: string
          children?: Record<string, unknown>
          inject?: () => Record<string, unknown>
        }) => {
          if (definition.name !== undefined) registeredSlots.push(definition.name)
          if (definition.name === 'sidebar.right.pane.tab') bodyRegistration = definition
          return { definition }
        },
      },
      resources: { register: vi.fn(() => () => {}) },
      uiWorkspace: { supportsSideChatSessions: true },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      remote: { $mount: mountRemote, sideTasks: { create, discard } },
      sessions: {
        retain: vi.fn(),
        retainInfo: vi.fn(() => ({ getSnapshot: () => ({ referenceCount: 1 }) })),
        binding: vi.fn(),
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
      sidebarRight: { openTab, focus, isExpanded: () => expanded, toggleExpanded,
        registerCloseHandler, openTabs: { getSnapshot: () => openTabs } },
    }
    const dispose = await apply(ctx as never)

    expect(registeredSlots.filter(name => name.startsWith('conversation.input.'))).toEqual([])
    expect(overlayRegistration?.inject).toEqual(expect.any(Function))
    expect(connectionReset).toEqual(expect.any(Function))
    const noticeFace = overlayRegistration!.inject!()
    expect(noticeFace.hooks).toBeDefined()
    expect(typeof noticeFace.retryDiscards).toBe('function')
    connectionReset!()
    noticeFace.retryDiscards()
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
    }))).toBe('empty.title')
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
    expect(toggleExpanded).not.toHaveBeenCalled()
    expanded = false
    actions.openSideChat()
    expect(expanded).toBe(true)
    expect(toggleExpanded).toHaveBeenCalledOnce()
    actions.openSideChat()
    expect(expanded).toBe(true)
    expect(toggleExpanded).toHaveBeenCalledOnce()
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
    await dispose()
  })
})

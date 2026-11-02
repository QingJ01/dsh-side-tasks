import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { registerSideChatControls } from '../src/client/controls.tsx'

function fixture() {
  const core = new SlotCore()
  const Native = () => null
  core.register({ name: 'root', children: {
    'conversation.input.model': { kind: 'single', scope: 'session' },
    'conversation.input.permission': { kind: 'single', scope: 'session' },
    'conversation.input.right': { kind: 'list', scope: 'session' },
  } } as never, Native)
  const state = { current: { provider: 'test', model: 'old' }, status: 'ready', pending: null, error: null }
  const directory = { getSnapshot: () => state, update: (fn: (value: typeof state) => void) => fn(state) }
  const mainSelect = vi.fn(), load = vi.fn()
  core.register({ name: 'conversation.input.model', locale: 'model',
    children: { 'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true } },
    inject: () => ({ available: false, directory, load, select: mainSelect }),
  } as never, Native)
  core.register({ name: 'conversation.input.permission', inject: () => ({ select: mainSelect }) } as never, Native)
  let block: unknown
  const blocks = { set: vi.fn((_id: unknown, value: unknown) => { block = value }), storeFor: () => ({ getSnapshot: () => block }) }
  const ctx = { slots: core, get: () => ({ blocks }), locale: { bind: () => (key: string) => key }, effect: (fn: () => unknown) => fn() }
  const parent = 'parent' as SessionId, child = 'child' as SessionId
  const addresses = new Map([[child, { parentSessionId: parent, childSessionId: child, mode: 'continuable' as const }]])
  const configure = vi.fn(async (_request: unknown) => ({ ok: true as const, value: { configured: true as const } }))
  const refresh = vi.fn(async () => {})
  const session = { pendingSubmissions: [] as unknown[], awaitingFirstTurn: false }
  registerSideChatControls(ctx as never, { refreshProjections: refresh,
    binding: () => ({ session: { getSnapshot: () => session } }),
  } as never, addresses, configure)
  return { core, Native, mainSelect, blocks, configure, refresh, parent, child, session }
}

function injection(core: SlotCore, key: string, id: SessionId) {
  return (core.entriesOfSlot(key)[0]!.inject as unknown as (id: SessionId) => Record<string, unknown>)(id)
}

describe('native side-chat toolbar adapters', () => {
  it('preserves the main model registration and original native component', () => {
    const { core, Native, parent, child } = fixture()
    expect(core.entries('conversation.input.model')).toHaveLength(1)
    expect(core.entries('conversation.input.model')[0]!.component).toBe(Native)
    expect(injection(core, 'conversation.input.right', parent).active).toBe(false)
    const own = injection(core, 'conversation.input.right', child)
    expect(own.native).toBe(Native)
    expect((own.nativeProps as { available: boolean }).available).toBe(true)
  })

  it('routes model changes to the child and blocks send until its writer is released', async () => {
    const { core, child, parent, configure, refresh, blocks } = fixture()
    const own = injection(core, 'conversation.input.right', child)
    const select = (own.nativeProps as { select: (selection: object) => Promise<unknown> }).select
    await select({ provider: 'test', model: 'new', reasoningEffort: 'high' })
    expect(configure).toHaveBeenCalledWith({ parentSessionId: parent, childSessionId: child, kind: 'model', selection: { provider: 'test', model: 'new', reasoningEffort: 'high' } })
    expect(refresh).toHaveBeenCalledWith(child)
    expect(blocks.set.mock.calls[0]![1]).toMatchObject({ reason: 'settings.pending' })
    expect(blocks.set.mock.lastCall).toEqual([child, undefined])
  })

  it('rejects a menu choice if native Send was already submitted before its click', async () => {
    const { core, child, configure, session, blocks } = fixture()
    const own = injection(core, 'conversation.input.right', child)
    const select = (own.nativeProps as { select: (selection: object) => Promise<unknown> }).select
    session.pendingSubmissions.push({ requestId: 'in-flight' })
    await expect(select({ provider: 'test', model: 'new' })).rejects.toThrow('settings.waitForSend')
    expect(configure).not.toHaveBeenCalled()
    expect(blocks.set).not.toHaveBeenCalled()
  })

  it('keeps normal permission transport and routes only owned child presets', async () => {
    const { core, parent, child, configure, mainSelect } = fixture()
    expect(injection(core, 'conversation.input.permission', parent).select).toBe(mainSelect)
    await (injection(core, 'conversation.input.permission', child).select as (preset: string) => Promise<boolean>)('workspace-write')
    expect(configure).toHaveBeenCalledWith({ parentSessionId: parent, childSessionId: child, kind: 'permission', preset: 'workspace-write' })
    expect(mainSelect).not.toHaveBeenCalled()
  })
})

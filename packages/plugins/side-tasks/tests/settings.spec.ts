import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatSettings } from '../src/settings.ts'

const parentId = 'parent' as SessionId
const childId = 'child' as SessionId
const old = { provider: 'test', model: 'old' }
const next = { provider: 'test', model: 'next', reasoningEffort: 'high' }

function fixture({ live = true, owned = true } = {}) {
  const events = [
    { type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: owned ? 'side-task' : 'fork' } },
    { type: 'model/selection', data: old },
  ]
  const parent = { id: parentId, session: { append: vi.fn() } }
  const child = {
    id: childId, options: { ...old },
    session: { header: { origin: 'subagent', parentSession: parentId }, inheritedEventCount: 0,
      snapshotEvents: () => events,
      append: vi.fn((type: string, data: never) => { events.push({ type, data }) }),
    },
    ctx: { on: vi.fn(() => vi.fn()) },
  }
  const dispose = vi.fn(async () => {})
  const execute = vi.fn(async () => ({ result: { kind: 'success' } }))
  const unload: (() => void)[] = []
  const ctx = {
    on: vi.fn(),
    effect: (fn: () => () => void) => { unload.push(fn()); },
    agents: { list: () => [], get: (id: string) => id === parentId ? parent : live ? child : undefined,
      resume: vi.fn(async () => ({ agent: child, dispose })),
    },
    workspaceRegistry: { archivedSessionIds: [] as string[] },
    subagents: { listChildren: async () => [{ id: childId, mode: 'continuable' }] },
    sessionQuery: { observeSession: vi.fn(async () => ({ events, header: child.session.header, inheritedEventCount: 0, [Symbol.dispose]: () => {} })) },
    get: (name: string) => name === 'llm' ? {
      resolveModelInfo: vi.fn(async () => ({})),
      resolveCallConfig: vi.fn(async (selection: unknown) => selection),
    } : name === 'commands' ? { execute }
      : name === 'permissionPresets' ? { resolve: vi.fn() } : undefined,
  }
  const settings = new SideChatSettings(ctx as never)
  return { settings, ctx, child, parent, dispose, execute, events, unload }
}

const modelRequest = { parentSessionId: parentId, childSessionId: childId, kind: 'model' as const, selection: next }

describe('child-only native composer settings', () => {
  it('changes the live child route and modality options without touching its parent or disposing manager ownership', async () => {
    const { settings, child, parent, dispose, ctx } = fixture()
    await expect(settings.configure(modelRequest, new AbortController().signal)).resolves.toEqual({ configured: true })
    expect(child.session.append).toHaveBeenCalledWith('model/selection', next)
    expect(child.options).toMatchObject(next)
    expect(parent.session.append).not.toHaveBeenCalled()
    expect(ctx.agents.resume).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
    expect(child.ctx.on).toHaveBeenCalledWith('agent/request', expect.any(Function))
  })

  it('releases an idle temporary writer before resolving', async () => {
    const { settings, ctx, dispose } = fixture({ live: false })
    await settings.configure(modelRequest, new AbortController().signal)
    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: childId }))
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('runs permission selection against the exact child', async () => {
    const { settings, child, execute, parent } = fixture()
    const signal = new AbortController().signal
    await settings.configure({ parentSessionId: parentId, childSessionId: childId, kind: 'permission', preset: 'workspace-write' }, signal)
    expect(execute).toHaveBeenCalledWith(child, '/permission workspace-write', [], signal)
    expect(parent.session.append).not.toHaveBeenCalled()
  })

  it('rejects another provider and archived children before any mutation', async () => {
    const bad = fixture({ owned: false })
    await expect(bad.settings.configure(modelRequest, new AbortController().signal)).rejects.toThrow('not owned')
    expect(bad.child.session.append).not.toHaveBeenCalled()
    const archived = fixture()
    archived.ctx.workspaceRegistry.archivedSessionIds.push(childId)
    await expect(archived.settings.configure(modelRequest, new AbortController().signal)).rejects.toThrow('archived')
    expect(archived.child.session.append).not.toHaveBeenCalled()
  })

  it('joins concurrent native materialization without disposing the manager writer', async () => {
    const { settings, ctx, child, parent, dispose } = fixture({ live: false })
    let materialized = false
    ctx.agents.get = (id: string) => id === parentId ? parent : materialized ? child : undefined
    ctx.agents.resume.mockImplementationOnce(async () => {
      materialized = true
      throw new Error('agent child is already registered')
    })
    await settings.configure(modelRequest, new AbortController().signal)
    expect(child.options).toMatchObject(next)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('removes old routing middleware when the plugin unloads with a surviving manager child', () => {
    const { settings, ctx, child, unload, events } = fixture()
    settings.restore(child as never)
    const oldDisposers = child.ctx.on.mock.results.map(result => result.value)
    unload[0]!()
    for (const dispose of oldDisposers) expect(dispose).toHaveBeenCalledOnce()
    events.push({ type: 'model/selection', data: next })
    const reloaded = new SideChatSettings(ctx as never)
    reloaded.restore(child as never)
    expect(child.options).toMatchObject(next)
    expect(child.ctx.on).toHaveBeenCalledTimes(6)
  })

  it('does not append a duplicate selection when the same model is chosen again', async () => {
    const { settings, child } = fixture()
    const request = { parentSessionId: parentId, childSessionId: childId, kind: 'model' as const,
      selection: { provider: 'test', model: 'old' } }
    await settings.configure(request, new AbortController().signal)
    expect(child.session.append.mock.calls.filter(([type]) => type === 'model/selection')).toHaveLength(0)
    expect(child.options).toMatchObject({ provider: 'test', model: 'old' })
  })

  it.each([true, false])('injects completed parent replies and refreshes only on cold resume (live parent: %s)', async (liveParent) => {
    const { ctx, child, parent } = fixture()
    const parentEvents = [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '暗号是 ORCA-77' }] } },
      { type: 'assistant/message', data: { turn: 0, step: 0, stream: [], message: {
        id: 'reply-0', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'old' },
        content: [{ type: 'text', text: 'PARENT_REPLY_7241' }],
      } } },
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'NEXT_PARENT' }] } },
    ]
    const context = vi.fn((_contribution: { name: string; order: number; text: () => string }) => vi.fn())
    const makeChild = () => ({ ...child, ctx: { on: vi.fn(() => vi.fn()), get: (name: string) => name === 'systemPrompt'
      ? { getContextOrder: () => 120, context } : undefined } })
    const observedDispose = vi.fn()
    const query = { observeSession: vi.fn(async () => ({ events: parentEvents, [Symbol.dispose]: observedDispose })) }
    const originalGet = ctx.get
    ctx.get = name => name === 'sessionQuery' ? query as never : originalGet(name)
    ctx.agents.get = (id: string) => id === parentId && liveParent
      ? { ...parent, session: { ...parent.session, snapshotEvents: () => parentEvents } }
      : undefined
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as (event: { agent: unknown }) => Promise<void>
    const disposed = ctx.on.mock.calls.find(([name]) => name === 'agent/disposed')![1] as (event: { agent: unknown }) => void
    const first = makeChild()
    await created({ agent: first })
    expect(context).toHaveBeenCalledOnce()
    const initial = context.mock.calls[0]![0]
    expect(initial).toMatchObject({ name: 'side-task:parent-context', order: 121 })
    expect(initial.text()).toContain('User:\n暗号是 ORCA-77')
    expect(initial.text()).toContain('Assistant:\nPARENT_REPLY_7241')
    expect(initial.text()).not.toContain('NEXT_PARENT')

    parentEvents.push({ type: 'turn/end', data: {} })
    expect(initial.text()).not.toContain('NEXT_PARENT')
    disposed({ agent: first })
    expect(context.mock.results[0]!.value).toHaveBeenCalledOnce()
    await created({ agent: makeChild() })
    expect(context).toHaveBeenCalledTimes(2)
    expect(context.mock.calls[1]![0].text()).toContain('NEXT_PARENT')
    expect(context.mock.calls[1]![0].text()).toContain('Assistant:\nPARENT_REPLY_7241')
    expect(child.session.append).not.toHaveBeenCalled()
    expect(parent.session.append).not.toHaveBeenCalled()
    expect(query.observeSession).toHaveBeenCalledTimes(liveParent ? 0 : 2)
    expect(observedDispose).toHaveBeenCalledTimes(liveParent ? 0 : 2)
  })

  it('restores the durable user model on a later manager-created Agent', () => {
    const { settings, child, events } = fixture()
    events.push({ type: 'model/selection', data: next })
    settings.restore(child as never)
    expect(child.options).toMatchObject(next)
    settings.restore(child as never)
    expect(child.ctx.on).toHaveBeenCalledTimes(3)
  })
})

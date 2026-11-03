import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatSettings } from '../src/settings.ts'

vi.mock('@deepseek-ai/dsh-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-session')>()
  return {
    ...actual,
    appendPluginRecord: (session: { append(type: string, data: unknown): void }, type: string, data: unknown) =>
      session.append(type, data),
  }
})

const sourceId = 'source' as SessionId
const childId = 'child' as SessionId
const selected = { provider: 'test', model: 'new', reasoningEffort: ReasoningEffortId('high') }

function fixture(options: { live?: boolean; sourceArchived?: boolean; sourceFailure?: Error } = {}) {
  const descriptor = {
    type: 'plugin:side-tasks/descriptor', ignorable: true,
    data: { version: 1, sourceSessionId: sourceId, childSessionId: childId, label: 'side chat' },
  }
  const events: object[] = [descriptor, {
    type: 'model/selection', data: { provider: 'test', model: 'old' },
  }]
  const append = vi.fn((type: string, data: unknown) => { events.push({ type, ignorable: true, data }) })
  const context = vi.fn(() => vi.fn())
  const child = {
    id: childId,
    options: { provider: 'test', model: 'old' },
    session: {
      header: { origin: 'sidechat', agentPreset: 'minimal' },
      inheritedEventCount: 0,
      snapshotEvents: () => events,
      append,
    },
    ctx: {
      on: vi.fn(() => vi.fn()),
      get: (name: string) => name === 'systemPrompt'
        ? { getContextOrder: () => 120, context }
        : undefined,
    },
  }
  const sourceEvents = [
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'source prompt' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'source reply' }] } } },
    { type: 'turn/end', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'unfinished' }] } },
  ]
  const observation = {
    header: { origin: undefined, cwd: '/work' },
    events: sourceEvents,
    inheritedEventCount: 0,
    [Symbol.dispose]: vi.fn(),
  }
  const observeSession = vi.fn(async (id: SessionId) => {
    if (options.sourceFailure !== undefined) throw options.sourceFailure
    if (id === childId) {
      return {
        header: child.session.header, events, inheritedEventCount: 0, [Symbol.dispose]: vi.fn(),
      }
    }
    return observation
  })
  const unload: (() => void)[] = []
  const dispose = vi.fn(async () => {})
  const agentPresets = { mount: vi.fn(async () => ({ id: 'minimal' })) }
  const agents = {
    list: () => [],
    get: vi.fn((id: SessionId) => id === childId && options.live !== false ? child : undefined),
    resume: vi.fn(async ({ setup }: { setup?: (ctx: object, agent: typeof child) => Promise<void> }) => {
      await setup?.(child.ctx, child)
      return { agent: child, dispose }
    }),
  }
  const ctx = {
    on: vi.fn(),
    effect: (effect: () => () => void) => { unload.push(effect()) },
    agents,
    workspaceRegistry: { archivedSessionIds: options.sourceArchived ? [sourceId] : [] },
    sessionQuery: { observeSession },
    sessionController: { selectModel: vi.fn(async () => ({ selected })) },
    get: (name: string) => name === 'llm' ? {
      resolveModelInfo: vi.fn(async () => ({})),
      resolveCallConfig: vi.fn(async (value: unknown) => value),
    } : name === 'commands' ? { execute: vi.fn(async () => ({ result: { kind: 'success' } })) }
      : name === 'permissionPresets' ? { resolve: vi.fn() }
        : name === 'agentPresets' ? agentPresets : undefined,
  }
  const settings = new SideChatSettings(ctx as never)
  return { settings, ctx, agents, child, events, append, context, observation, unload, dispose, agentPresets }
}

const modelRequest = {
  parentSessionId: sourceId, childSessionId: childId, kind: 'model' as const, selection: selected,
}

describe('side-chat settings and cold context', () => {
  it('delegates owned child model selection to the native Session controller', async () => {
    const { settings, ctx, agents, child, append, dispose } = fixture()
    await expect(settings.configure(modelRequest, new AbortController().signal)).resolves.toEqual({ configured: true })
    expect(ctx.sessionController.selectModel).toHaveBeenCalledWith({ sessionId: childId, ...selected })
    expect(append).not.toHaveBeenCalled()
    expect(child.ctx.on).not.toHaveBeenCalled()
    expect(agents.get).not.toHaveBeenCalled()
    expect(agents.resume).not.toHaveBeenCalled()
    expect(ctx.sessionQuery.observeSession).toHaveBeenCalledWith(childId, expect.objectContaining({ projectionMode: 'none' }))
    expect(dispose).not.toHaveBeenCalled()
  })

  it('resumes and mounts only a cold child before changing its permission', async () => {
    const { settings, agents, child, dispose, agentPresets } = fixture({ live: false })
    await settings.configure({ parentSessionId: sourceId, childSessionId: childId,
      kind: 'permission', preset: 'read-only' }, new AbortController().signal)
    expect(agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: childId }))
    expect(agentPresets.mount).toHaveBeenCalledWith(child.ctx, 'minimal')
    expect(dispose).toHaveBeenCalledOnce()
    expect(agents.get).not.toHaveBeenCalledWith(sourceId)
  })

  it.each([
    ['wrong origin', { origin: 'subagent' }, 'sidechat'],
    ['parent lineage', { origin: 'sidechat', parentSession: sourceId }, 'sidechat'],
  ])('rejects forged ownership with %s before mutation', async (_name, header) => {
    const { settings, append, ctx } = fixture()
    const original = ctx.sessionQuery.observeSession
    ctx.sessionQuery.observeSession = vi.fn(async id => {
      const value = await original(id)
      return { ...value, header }
    })
    await expect(settings.configure(modelRequest, new AbortController().signal)).rejects.toThrow('not owned')
    expect(append).not.toHaveBeenCalled()
    expect(ctx.sessionController.selectModel).not.toHaveBeenCalled()
  })

  it('refreshes bounded source context on attach and persists the exact model-visible text first', async () => {
    const { ctx, child, append, context, observation } = fixture()
    new SideChatSettings(ctx as never)
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as
      (event: { agent: typeof child }) => Promise<void>
    await created({ agent: child })
    const stored = append.mock.calls.find(([type]) => type === 'plugin:side-tasks/context')?.[1] as { text: string }
    expect(stored.text).toContain('source prompt')
    expect(stored.text).toContain('source reply')
    expect(stored.text).not.toContain('unfinished')
    expect(context).toHaveBeenCalledOnce()
    expect(context.mock.calls[0]![0].text()).toBe(stored.text)
    expect(observation[Symbol.dispose]).toHaveBeenCalledOnce()
  })

  it('registers persisted context before waiting for a cold source refresh', async () => {
    const { ctx, child, events, context, observation } = fixture()
    events.push({
      type: 'plugin:side-tasks/context', ignorable: true,
      data: { version: 1, sourceSessionId: sourceId, text: 'durable child context' },
    })
    let finish!: (value: typeof observation) => void
    ctx.sessionQuery.observeSession = vi.fn(() => new Promise(resolve => { finish = resolve }) as never)
    new SideChatSettings(ctx as never)
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as
      (event: { agent: typeof child }) => Promise<void>
    const pending = created({ agent: child })
    await Promise.resolve()
    expect(context).toHaveBeenCalledOnce()
    expect(context.mock.calls[0]![0].text()).toBe('durable child context')
    finish(observation)
    await pending
    expect(context).toHaveBeenCalledTimes(2)
    expect(context.mock.results[0]!.value).toHaveBeenCalledOnce()
  })

  it('uses the child-owned recorded context when the source is archived', async () => {
    const { ctx, child, events, context } = fixture({ sourceArchived: true })
    events.push({
      type: 'plugin:side-tasks/context', ignorable: true,
      data: { version: 1, sourceSessionId: sourceId, text: 'recorded context' },
    })
    new SideChatSettings(ctx as never)
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as
      (event: { agent: typeof child }) => Promise<void>
    await created({ agent: child })
    expect(ctx.sessionQuery.observeSession).not.toHaveBeenCalled()
    expect(context.mock.calls[0]![0].text()).toBe('recorded context')
  })

  it('surfaces genuine source read failures instead of registering stale context as fresh', async () => {
    const { ctx, child, context } = fixture({ sourceFailure: new Error('source store unavailable') })
    new SideChatSettings(ctx as never)
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as
      (event: { agent: typeof child }) => Promise<void>
    await expect(created({ agent: child })).rejects.toThrow('source store unavailable')
    expect(context).not.toHaveBeenCalled()
  })

  it('cancels an in-flight source read on unload and ignores its late result', async () => {
    const { ctx, child, context, unload } = fixture()
    let finish!: (value: {
      header: typeof child.session.header
      events: object[]
      inheritedEventCount: number
      [Symbol.dispose](): void
    }) => void
    ctx.sessionQuery.observeSession = vi.fn(() => new Promise(resolve => { finish = resolve }) as never)
    const settings = new SideChatSettings(ctx as never)
    const created = ctx.on.mock.calls.find(([name]) => name === 'agent/created')![1] as
      (event: { agent: typeof child }) => Promise<void>
    const pending = created({ agent: child })
    await Promise.resolve()
    unload[0]!()
    finish({ header: child.session.header, events: [], inheritedEventCount: 0, [Symbol.dispose]: vi.fn() })
    await pending
    expect(context).not.toHaveBeenCalled()
  })
})

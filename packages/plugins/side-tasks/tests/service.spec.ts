import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { SideTaskService } from '../lib/index.js'

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

async function serviceFixture(supportsSideChatSessions = true) {
  const sourceEvents = [
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'source prompt' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'source reply' }] } } },
    { type: 'turn/end', data: {} },
    { type: 'permission/preset', data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { type: 'approval/policy', data: { policy: 'never' } },
  ] as SessionEvent[]
  const childEvents: unknown[] = []
  const child = {
    id: childId,
    session: { append: vi.fn((type: string, data: unknown) => childEvents.push({ type, ignorable: true, data })) },
  } as Agent
  const dispose = vi.fn(async () => {})
  const create = vi.fn(async (options: Parameters<AgentRegistry['create']>[0]) => {
    await options.setup?.({ get: () => undefined } as never, child)
    return { agent: child, dispose }
  })
  const archiveSession = vi.fn(async () => {})
  const observeSession = vi.fn(async (id: SessionId, options: { projectionMode: string; signal: AbortSignal }) => {
    expect(id).toBe(sourceId)
    expect(options.projectionMode).toBe('all')
    return {
      header: { cwd: '/source', agentPreset: 'minimal' },
      events: sourceEvents,
      inheritedEventCount: 0,
      projections: { values: {
        modelSelection: { next: { provider: 'test', model: 'child-model', reasoningEffort: ReasoningEffortId('high') } },
        workingDirectory: '/project', agentPreset: 'effective',
      } },
      [Symbol.dispose]: vi.fn(),
    }
  })
  const prompt = vi.fn(async () => ({ accepted: true }))
  const ctx = new Context()
  ctx.provide('agents', { list: () => [], create } as never)
  ctx.provide('workspaceRegistry', { archivedSessionIds: [], archiveSession } as never)
  ctx.provide('sessionQuery', { observeSession } as never)
  ctx.provide('sessionController', { supportsSideChatSessions, prompt } as never)
  ctx.provide('permissionPresets', {
    defaultPreset: 'safe',
    resolve: vi.fn(() => ({ sandbox: 'workspace-write', approval: 'never' })),
  } as never)
  ctx.provide('agentPresets', {
    resolve: vi.fn(async (id?: string) => ({ id: id ?? 'minimal' })),
    mount: vi.fn(async (_child: unknown, id?: string) => ({ id: id ?? 'minimal' })),
  } as never)
  await ctx.plugin(SideTaskService)
  return {
    service: ctx.sideTasks, ctx, create, childEvents, dispose, archiveSession, observeSession, prompt,
    close: () => ctx.fiber.dispose(),
  }
}

describe('side-task Host service', () => {
  it('captures source settings and completed context through read-only query, then prompts the independent child', async () => {
    const { service, create, childEvents, dispose, observeSession, prompt, close } = await serviceFixture()
    const result = await service.create(sourceId, { prompt: 'first child task' }, new AbortController().signal)
    expect(observeSession).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    const options = create.mock.calls[0]![0]
    expect(options.meta).toEqual({ cwd: '/project', origin: 'sidechat', agentPreset: 'effective' })
    expect(options).not.toHaveProperty('parentAgent')
    expect(options.meta).not.toHaveProperty('parentSession')
    expect(options).not.toHaveProperty('seed')
    expect(childEvents).toContainEqual({ type: 'model/selection', ignorable: true,
      data: { provider: 'test', model: 'child-model', reasoningEffort: 'high' } })
    expect(childEvents).toContainEqual({ type: 'permission/preset', ignorable: true, data: { preset: 'workspace-write' } })
    expect(childEvents).toContainEqual({ type: 'sandbox/mode', ignorable: true, data: { mode: 'workspace-write' } })
    expect(childEvents).toContainEqual({ type: 'approval/policy', ignorable: true, data: { policy: 'never' } })
    const context = childEvents.find(item => (item as { type: string }).type === 'plugin:side-tasks/context') as { data: { text: string } }
    expect(context.data.text).toContain('source prompt')
    expect(context.data.text).toContain('source reply')
    expect(context.data.text).not.toContain('unfinished')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.childSessionId, mode: 'queue',
      content: [{ type: 'text', text: 'first child task' }],
    }), expect.any(AbortSignal))
    expect(dispose).toHaveBeenCalledOnce()
    await close()
  })

  it('fails closed before observing or creating when the Host lacks the public capability', async () => {
    const { service, create, observeSession, close } = await serviceFixture(false)
    await expect(service.create(sourceId, { prompt: '' }, new AbortController().signal))
      .rejects.toThrow('does not support independent side chats')
    expect(observeSession).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(service.capabilities()).toEqual({ supportsSideChatSessions: false })
    await close()
  })

  it('archives a child if native prompt admission fails after creation', async () => {
    const { service, prompt, archiveSession, close } = await serviceFixture()
    prompt.mockRejectedValueOnce(new Error('prompt admission failed'))
    await expect(service.create(sourceId, { prompt: 'first task' }, new AbortController().signal))
      .rejects.toThrow('prompt admission failed')
    expect(archiveSession).toHaveBeenCalledWith(expect.any(String), { stopActivity: true })
    await close()
  })

  it('archives a child when the native controller declines the initial prompt', async () => {
    const { service, prompt, archiveSession, close } = await serviceFixture()
    prompt.mockResolvedValueOnce({ accepted: false })
    await expect(service.create(sourceId, { prompt: 'first task' }, new AbortController().signal))
      .rejects.toThrow('did not accept')
    expect(archiveSession).toHaveBeenCalledWith(expect.any(String), { stopActivity: true })
    await close()
  })
})

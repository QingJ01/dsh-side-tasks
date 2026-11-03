import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBlankSideTask } from '../src/blank.ts'

vi.mock('@deepseek-ai/dsh-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-session')>()
  return {
    ...actual,
    appendPluginRecord: (session: { append(type: string, data: unknown): void }, type: string, data: unknown) =>
      session.append(type, data),
  }
})

describe('independent side chat creation', () => {
  it('creates an unseeded root with child-owned configuration and context', async () => {
    const append = vi.fn()
    const child = { id: 'child', session: { append } } as Agent
    const dispose = vi.fn(async () => {})
    const presets = {
      resolve: vi.fn(async (id?: string) => ({ id: id ?? 'default' })),
      mount: vi.fn(async (_ctx: unknown, id?: string) => ({ id: id ?? 'default' })),
    }
    const create = vi.fn(async (options: {
      sessionId: SessionId
      meta: Record<string, unknown>
      setup: (ctx: unknown, agent: Agent) => Promise<void>
    }) => {
      await options.setup({ get: () => undefined }, child)
      return { agent: child, dispose }
    })
    const result = await createBlankSideTask(
      { create } as Pick<AgentRegistry, 'create'>,
      presets,
      {
        id: 'source' as SessionId,
        cwd: '/work',
        preset: 'code',
        model: { provider: 'deepseek', model: 'test' },
        permissions: { preset: 'custom', sandbox: 'read-only', approval: 'ask' },
      },
      'bounded source context',
      '',
      new AbortController().signal,
      vi.fn(async () => {}),
    )
    const options = create.mock.calls[0]![0]
    expect(options.meta).toEqual({ cwd: '/work', origin: 'sidechat', agentPreset: 'code' })
    expect(options.meta).not.toHaveProperty('parentSession')
    expect(options).not.toHaveProperty('parentAgent')
    expect(options).not.toHaveProperty('seed')
    expect(append).toHaveBeenCalledWith('model/selection', { provider: 'deepseek', model: 'test' })
    expect(append).toHaveBeenCalledWith('permission/preset', { preset: 'custom' })
    expect(append).toHaveBeenCalledWith('sandbox/mode', { mode: 'read-only' })
    expect(append).toHaveBeenCalledWith('approval/policy', { policy: 'ask' })
    expect(append).toHaveBeenCalledWith('plugin:side-tasks/descriptor', expect.objectContaining({
      sourceSessionId: 'source',
      childSessionId: result.childSessionId,
    }))
    expect(append).toHaveBeenCalledWith('plugin:side-tasks/context', {
      version: 1, sourceSessionId: 'source', text: 'bounded source context',
    })
    expect(result.mode).toBe('independent')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('persists an empty context snapshot when the source has no inherited text', async () => {
    const append = vi.fn()
    const child = { id: 'child', session: { append } } as Agent
    const presets = {
      resolve: vi.fn(async () => ({ id: 'default' })),
      mount: vi.fn(async () => ({ id: 'default' })),
    }
    const create = vi.fn(async (options: {
      setup: (ctx: unknown, agent: Agent) => Promise<void>
    }) => {
      await options.setup({ get: () => undefined }, child)
      return { agent: child, dispose: vi.fn(async () => {}) }
    })
    await createBlankSideTask(
      { create } as Pick<AgentRegistry, 'create'>,
      presets,
      {
        id: 'source' as SessionId,
        cwd: '/work',
        preset: 'default',
        permissions: { preset: 'default', sandbox: 'read-only', approval: 'ask' },
      },
      undefined,
      '',
      new AbortController().signal,
      vi.fn(async () => {}),
    )
    expect(append).toHaveBeenCalledWith('plugin:side-tasks/context', {
      version: 1, sourceSessionId: 'source', text: '',
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createBlankSideTask } from '../src/blank.ts'

function parentFixture(depth = 0): Agent {
  const append = vi.fn()
  return {
    id: 'parent',
    options: { provider: 'deepseek', model: 'test-model' },
    session: {
      header: { id: 'parent', cwd: '/work', delegationDepth: depth, createdAt: 1 },
      snapshotEvents: () => [],
      requestHeader: () => undefined,
      append,
    },
    ctx: {
      get: (name: string) => name === 'agentPresets'
        ? { composeFrom: vi.fn(), composedPreset: () => undefined }
        : name === 'workingDirectory'
          ? { set: vi.fn(async () => {}) }
          : undefined,
    },
  } as unknown as Agent
}

describe('blank side chat creation', () => {
  it('creates an idle origin=subagent child with descriptor and parent catalog facts', async () => {
    const parent = parentFixture()
    const childAppend = vi.fn()
    const dispose = vi.fn(async () => {})
    const create = vi.fn(async (options: {
      sessionId: string
      meta: Record<string, unknown>
      inheritedEventCount: number
      agentOptions: Record<string, unknown>
      setup: (ctx: unknown, child: unknown) => Promise<void>
    }) => {
      const child = {
        session: {
          append: childAppend,
          header: { createdAt: 123, id: options.sessionId },
        },
      }
      await options.setup({
        systemPrompt: { context: vi.fn(), getContextOrder: () => 0 },
        get: (name: string) => name === 'agentPresets'
          ? { composeFrom: vi.fn(), composedPreset: () => undefined }
          : name === 'workingDirectory'
            ? { set: vi.fn(async () => {}) }
            : undefined,
      }, child)
      return { agent: child, dispose }
    })
    const result = await createBlankSideTask(
      { create } as never,
      parent,
      3,
      new AbortController().signal,
      vi.fn(),
    )
    // The child log starts clean: parent turns travel as prompt context, not
    // as seeded events the transcript and footer would display and count.
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('seed')
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('inheritedEventCount')
    expect(create.mock.calls[0]?.[0].meta).toMatchObject({ isSeeded: false })
    expect(result).toEqual({
      contextThrough: -1,
      parentSessionId: 'parent',
      childSessionId: create.mock.calls[0]?.[0].sessionId,
      mode: 'continuable',
    })
    expect(create.mock.calls[0]?.[0].meta).toMatchObject({
      cwd: '/work',
      parentSession: 'parent',
      origin: 'subagent',
      delegationDepth: 1,
      isSeeded: false,
    })
    expect(create.mock.calls[0]?.[0].agentOptions).toMatchObject({
      provider: 'deepseek',
      model: 'test-model',
      subagentDepth: 1,
    })
    expect(childAppend).toHaveBeenCalledWith('subagent/descriptor', expect.objectContaining({
      version: 3,
      mode: 'continuable',
      provider: 'side-task',
      agentProvider: 'deepseek',
      agentModel: 'test-model',
    }))
    expect(dispose).toHaveBeenCalledOnce()
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan((parent.session.append as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!)
    expect(parent.session.append).toHaveBeenCalledWith('subagent/catalog', expect.objectContaining({
      childId: result.childSessionId,
      childCreatedAt: 123,
      mode: 'continuable',
    }))
  })

  it('archives a created child if cancellation wins before catalog publication', async () => {
    const parent = parentFixture()
    const controller = new AbortController()
    const archive = vi.fn(async () => {})
    const dispose = vi.fn(async () => { controller.abort() })
    const create = vi.fn(async () => ({ agent: { session: { header: { createdAt: 1 } } }, dispose }))
    await expect(createBlankSideTask({ create } as never, parent, 3, controller.signal, archive)).rejects.toThrow()
    expect(parent.session.append).not.toHaveBeenCalled()
    expect(archive).toHaveBeenCalledOnce()
  })

  it('rejects a child beyond the configured depth without creating one', async () => {
    const create = vi.fn()
    await expect(createBlankSideTask(
      { create } as never,
      parentFixture(2),
      2,
      new AbortController().signal,
      vi.fn(),
    )).rejects.toThrow('exceeds maxDepth')
    expect(create).not.toHaveBeenCalled()
  })
})

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
      append,
    },
    ctx: {
      get: (name: string) => name === 'agentPresets'
        ? { composeFrom: vi.fn() }
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
        get: (name: string) => name === 'agentPresets'
          ? { composeFrom: vi.fn() }
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
    )
    expect(result.address).toEqual({
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
    }))
    expect(parent.session.append).toHaveBeenCalledWith('subagent/catalog', expect.objectContaining({
      childId: result.address.childSessionId,
      childCreatedAt: 123,
      mode: 'continuable',
    }))
  })

  it('rejects a child beyond the configured depth without creating one', async () => {
    const create = vi.fn()
    await expect(createBlankSideTask(
      { create } as never,
      parentFixture(2),
      2,
      new AbortController().signal,
    )).rejects.toThrow('depth limit')
    expect(create).not.toHaveBeenCalled()
  })
})

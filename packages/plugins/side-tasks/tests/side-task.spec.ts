import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import { discardSideTask, startSideTask, type SideTaskStarter } from '../src/side-task.ts'
import { SIDE_TASK_LABEL_PREFIX } from '../src/shared.ts'

function fixture() {
  const parent = { id: 'parent-session' as SessionId } as Agent
  const activation = {
    childId: 'child-session' as SessionId,
    result: Promise.resolve({ stopReason: 'completed' }),
  } as SubagentActivation
  const startActivation = vi.fn(async (_spec: SubagentActivationSpec) => activation)
  const starter: SideTaskStarter = { startActivation }
  return { parent, activation, startActivation, starter }
}

function queryFor(provider: string, label = `${SIDE_TASK_LABEL_PREFIX}investigate`) {
  const dispose = vi.fn()
  return {
    dispose,
    query: {
      observeSession: vi.fn(async () => ({
        events: [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider, label } }],
        inheritedEventCount: 0,
        [Symbol.dispose]: dispose,
      })),
    },
  }
}

describe('startSideTask', () => {
  it('uses the dedicated context-inheriting provider and caller-only delivery', async () => {
    const { parent, startActivation, starter } = fixture()
    const result = await startSideTask(starter, parent, '  investigate failures  ', new AbortController().signal)
    expect(startActivation).toHaveBeenCalledOnce()
    const spec = startActivation.mock.calls[0]?.[0]
    expect(spec?.provider).toBe('side-task')
    expect(spec?.delivery).toBe('caller')
    expect(spec?.label.startsWith(SIDE_TASK_LABEL_PREFIX)).toBe(true)
    expect(spec?.request.parent).toBe(parent)
    expect(spec?.request.prompt).toEqual([{ type: 'text', text: 'investigate failures' }])
    expect(result).toEqual({
      parentSessionId: 'parent-session',
      childSessionId: 'child-session',
      mode: 'continuable',
    })
  })

  it('forwards the profile delegation depth cap', async () => {
    const { parent, startActivation, starter } = fixture()
    await startSideTask(starter, parent, 'task', new AbortController().signal, 2)
    expect(startActivation.mock.calls[0]?.[0].request.maxDepth).toBe(2)
  })

  it('rejects an empty prompt on the prompt-start path', async () => {
    const { parent, startActivation, starter } = fixture()
    await expect(startSideTask(starter, parent, '   ', new AbortController().signal)).rejects.toThrow('non-empty')
    expect(startActivation).not.toHaveBeenCalled()
  })

  it('honours cancellation before allocating a child', async () => {
    const { parent, startActivation, starter } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(startSideTask(starter, parent, 'task', controller.signal)).rejects.toThrow()
    expect(startActivation).not.toHaveBeenCalled()
  })
})

describe('discardSideTask', () => {
  it('stops and archives only a child owned by this plugin', async () => {
    const { parent } = fixture()
    const listChildren = vi.fn(async () => [{
      id: 'child-session' as SessionId,
      createdAt: 1,
      mode: 'continuable' as const,
      label: `${SIDE_TASK_LABEL_PREFIX}investigate`,
    }])
    const drainChildren = vi.fn(async () => {})
    const archiveSession = vi.fn(async () => {})
    const { query, dispose } = queryFor('side-task')
    const result = await discardSideTask(
      { listChildren, drainChildren } as never,
      { archiveSession } as never,
      query as never,
      parent.id,
      parent,
      'child-session' as SessionId,
      new AbortController().signal,
    )
    expect(drainChildren).toHaveBeenCalledWith(parent, ['child-session'])
    expect(archiveSession).toHaveBeenCalledWith('child-session', { stopActivity: true })
    expect(dispose).toHaveBeenCalledOnce()
    expect(result).toEqual({ discarded: true })
  })

  it('archives when the parent Agent is offline', async () => {
    const { parent } = fixture()
    const listChildren = vi.fn(async () => [{
      id: 'child-session' as SessionId,
      createdAt: 1,
      mode: 'continuable' as const,
      label: `${SIDE_TASK_LABEL_PREFIX}investigate`,
    }])
    const drainChildren = vi.fn(async () => {})
    const archiveSession = vi.fn(async () => {})
    const { query } = queryFor('side-task')
    await expect(discardSideTask(
      { listChildren, drainChildren } as never,
      { archiveSession } as never,
      query as never,
      parent.id,
      undefined,
      'child-session' as SessionId,
      new AbortController().signal,
    )).resolves.toEqual({ discarded: true })
    expect(archiveSession).toHaveBeenCalledWith('child-session', { stopActivity: true })
    expect(drainChildren).not.toHaveBeenCalled()
  })

  it('refuses a model-delegated child even when its label spoofs the prefix', async () => {
    const { parent } = fixture()
    const drainChildren = vi.fn(async () => {})
    const archiveSession = vi.fn(async () => {})
    const { query } = queryFor('fork')
    const subagents = {
      listChildren: vi.fn(async () => [{
        id: 'other' as SessionId,
        createdAt: 1,
        mode: 'continuable' as const,
        label: `${SIDE_TASK_LABEL_PREFIX}spoofed`,
      }]),
      drainChildren,
    }
    await expect(discardSideTask(
      subagents as never,
      { archiveSession } as never,
      query as never,
      parent.id,
      parent,
      'other' as SessionId,
      new AbortController().signal,
    )).rejects.toThrow('not created by the side-task plugin')
    expect(drainChildren).not.toHaveBeenCalled()
    expect(archiveSession).not.toHaveBeenCalled()
  })
})

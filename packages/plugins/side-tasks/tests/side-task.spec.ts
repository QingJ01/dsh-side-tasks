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

describe('startSideTask', () => {
  it('uses a context-inheriting fork and caller-only delivery', async () => {
    const { parent, startActivation, starter } = fixture()
    const result = await startSideTask(starter, parent, '  investigate failures  ', new AbortController().signal)
    expect(startActivation).toHaveBeenCalledOnce()
    const spec = startActivation.mock.calls[0]?.[0]
    expect(spec?.provider).toBe('fork')
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

  it('rejects an empty prompt before allocating a child', async () => {
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
    const result = await discardSideTask(
      { listChildren, drainChildren } as never,
      { archiveSession } as never,
      parent,
      'child-session' as SessionId,
      new AbortController().signal,
    )
    expect(drainChildren).toHaveBeenCalledWith(parent, ['child-session'])
    expect(archiveSession).toHaveBeenCalledWith('child-session', { stopActivity: true })
    expect(result).toEqual({ discarded: true })
  })

  it('refuses to discard a model-delegated or unrelated child', async () => {
    const { parent } = fixture()
    const drainChildren = vi.fn(async () => {})
    const archiveSession = vi.fn(async () => {})
    const subagents = {
      listChildren: vi.fn(async () => [{
        id: 'other' as SessionId,
        createdAt: 1,
        mode: 'continuable' as const,
        label: 'ordinary delegation',
      }]),
      drainChildren,
    }
    await expect(discardSideTask(
      subagents as never,
      { archiveSession } as never,
      parent,
      'other' as SessionId,
      new AbortController().signal,
    )).rejects.toThrow('not a side task')
    expect(drainChildren).not.toHaveBeenCalled()
    expect(archiveSession).not.toHaveBeenCalled()
  })
})

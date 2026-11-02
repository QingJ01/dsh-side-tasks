import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import { startSideTask, type SideTaskStarter } from '../src/side-task.ts'
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

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { discardSideTask } from '../src/side-task.ts'

function observation(origin: string, parentSession?: string, events: readonly object[] = []) {
  const dispose = vi.fn()
  return {
    dispose,
    value: {
      header: { origin, ...(parentSession === undefined ? {} : { parentSession }) },
      events,
      inheritedEventCount: 0,
      [Symbol.dispose]: dispose,
    },
  }
}

describe('side-chat archive', () => {
  it('archives only the independently owned child', async () => {
    const source = observation('sidechat', undefined, [{
      type: 'plugin:side-tasks/descriptor',
      ignorable: true,
      data: { version: 1, sourceSessionId: 'source', childSessionId: 'child', label: 'test' },
    }])
    const agents = { get: vi.fn() }
    const archiveSession = vi.fn(async () => {})
    const query = { observeSession: vi.fn(async () => source.value) }
    await expect(discardSideTask(
      agents as never,
      { archiveSession } as never,
      query as never,
      { parentSessionId: 'source' as SessionId, childSessionId: 'child' as SessionId },
      new AbortController().signal,
    )).resolves.toEqual({ discarded: true })
    expect(agents.get).not.toHaveBeenCalled()
    expect(archiveSession).toHaveBeenCalledExactlyOnceWith('child', { stopActivity: true })
    expect(source.dispose).toHaveBeenCalledOnce()
  })

  it('allows cold legacy archive without retaining or stopping the child', async () => {
    const source = observation('subagent', 'source', [{
      type: 'subagent/descriptor',
      data: { version: 3, mode: 'continuable', provider: 'side-task' },
    }])
    const agents = { get: vi.fn(() => undefined) }
    const archiveSession = vi.fn(async () => {})
    await discardSideTask(
      agents as never,
      { archiveSession } as never,
      { observeSession: vi.fn(async () => source.value) } as never,
      { parentSessionId: 'source' as SessionId, childSessionId: 'child' as SessionId },
      new AbortController().signal,
    )
    expect(agents.get).toHaveBeenCalledWith('child')
    expect(archiveSession).toHaveBeenCalledWith('child', { stopActivity: true })
  })

  it('refuses to archive a resident legacy child', async () => {
    const source = observation('subagent', 'source', [{
      type: 'subagent/descriptor',
      data: { version: 3, mode: 'continuable', provider: 'side-task' },
    }])
    const archiveSession = vi.fn(async () => {})
    await expect(discardSideTask(
      { get: vi.fn(() => ({})) } as never,
      { archiveSession } as never,
      { observeSession: vi.fn(async () => source.value) } as never,
      { parentSessionId: 'source' as SessionId, childSessionId: 'child' as SessionId },
      new AbortController().signal,
    )).rejects.toThrow('Restart Harness')
    expect(archiveSession).not.toHaveBeenCalled()
  })

  it('rejects forged ownership', async () => {
    const source = observation('sidechat', undefined, [{
      type: 'plugin:side-tasks/descriptor',
      ignorable: true,
      data: { version: 1, sourceSessionId: 'source', childSessionId: 'other', label: 'test' },
    }])
    const archiveSession = vi.fn(async () => {})
    await expect(discardSideTask(
      { get: vi.fn() } as never,
      { archiveSession } as never,
      { observeSession: vi.fn(async () => source.value) } as never,
      { parentSessionId: 'source' as SessionId, childSessionId: 'child' as SessionId },
      new AbortController().signal,
    )).rejects.toThrow('not created by the side-task plugin')
    expect(archiveSession).not.toHaveBeenCalled()
  })
})

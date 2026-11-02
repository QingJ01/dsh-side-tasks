import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContinuableCreateRequest } from '@deepseek-ai/dsh-subagent'
import { SideTaskProvider, SIDE_TASK_PROVIDER } from '../src/provider.ts'

function requestFor(events: SessionEvent[]): ContinuableCreateRequest {
  const parent = {
    id: 'parent',
    session: { snapshotEvents: () => events },
  }
  return { parent, cwd: '/tmp', signal: new AbortController().signal } as never
}

describe('SideTaskProvider', () => {
  it('publishes a distinct durable provider identity', () => {
    expect(new SideTaskProvider().name).toBe(SIDE_TASK_PROVIDER)
    expect(SIDE_TASK_PROVIDER).not.toBe('fork')
  })

  it('seeds through the latest completed turn only', async () => {
    const events = [
      { type: 'turn/end', seq: 1 },
      { type: 'message', seq: 2 },
      { type: 'turn/end', seq: 3 },
      { type: 'user/message', seq: 4 },
    ] as never
    const provider = new SideTaskProvider()
    const spec = await provider.prepareContinuable(requestFor(events))
    expect(spec.seed).toEqual(events.slice(0, 4))
  })

  it('starts without a seed before the first completed turn', async () => {
    const provider = new SideTaskProvider()
    expect(await provider.prepareContinuable(requestFor([]))).toEqual({})
  })
})

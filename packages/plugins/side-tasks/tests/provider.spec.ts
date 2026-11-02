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

  it('never seeds parent events into a prompt-started child', async () => {
    const events = [
      { type: 'turn/start', seq: 0 },
      { type: 'user/message', seq: 1 },
      { type: 'turn/end', seq: 2 },
    ] as never
    const provider = new SideTaskProvider()
    // A seeded prefix would surface the parent conversation in the child's
    // transcript and count its usage; inherited background is prompt context.
    expect(await provider.prepareContinuable(requestFor(events))).toEqual({})
    expect(await provider.prepareContinuable(requestFor([]))).toEqual({})
  })
})

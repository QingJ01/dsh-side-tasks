import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { completedEvents, inheritedContextText } from '../src/context.ts'

const turn = (seq: number, events: unknown[]) => events.map((event, index) => ({ ...(event as object), seq: seq + index }))
const user = (text: string) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assistant = (text: string) => ({
  type: 'assistant/message',
  data: {
    turn: 0, step: 0, stream: [],
    message: { id: 'reply' as SessionEvent<'assistant/message'>['data']['message']['id'], role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test-model' }, content: [{ type: 'text', text }] },
  },
} satisfies Pick<SessionEvent<'assistant/message'>, 'type' | 'data'>)

describe('inherited parent context', () => {
  it('renders completed human and assistant messages and nothing else', () => {
    const events = [
      ...turn(0, [{ type: 'turn/start' }, user('门禁暗号是 ORCA-77'), assistant('PARENT_CTX_OK'), { type: 'turn/end' }]),
    ]
    const text = inheritedContextText(events)
    expect(text).toContain('User:\n门禁暗号是 ORCA-77')
    expect(text).toContain('Assistant:\nPARENT_CTX_OK')
    expect(text).toContain('do not summarize')
  })

  it('drops an in-flight parent turn and non-human context messages', () => {
    const events = [
      ...turn(0, [{ type: 'turn/start' }, user('finished'), assistant('done'), { type: 'turn/end' }]),
      ...turn(4, [{ type: 'turn/start' }, user('still running'), assistant('unfinished reply')]),
      { type: 'user/message', data: { source: { kind: 'context' }, content: [{ type: 'text', text: 'skill catalog' }] } },
    ]
    expect(completedEvents(events)).toHaveLength(4)
    const text = inheritedContextText(events)
    expect(text).toContain('finished')
    expect(text).not.toContain('still running')
    expect(text).not.toContain('unfinished reply')
    expect(text).not.toContain('skill catalog')
  })

  it('returns nothing when the parent has no completed human turn', () => {
    expect(inheritedContextText([])).toBeUndefined()
    expect(inheritedContextText(turn(0, [{ type: 'turn/start' }, user('pending')]))).toBeUndefined()
  })
})

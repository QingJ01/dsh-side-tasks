import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createSideTaskLabel,
  isSideTaskDescriptor,
  isSideTaskLabel,
  normalizeSideTaskPrompt,
  parseSideTaskChatAddress,
  sideTaskChatAddress,
  sideTaskDisplayLabel,
} from '../src/shared.ts'

describe('side-task labels and addresses', () => {
  it('normalizes outer whitespace and preserves the prompt body', () => {
    expect(normalizeSideTaskPrompt('  inspect\n tests  ')).toBe('inspect\n tests')
  })

  it('marks, summarizes, and truncates durable labels', () => {
    const label = createSideTaskLabel(`  ${'x'.repeat(200)}  `)
    expect(isSideTaskLabel(label)).toBe(true)
    expect(label.length).toBeLessThanOrEqual(96)
    expect(label.endsWith('…')).toBe(true)
    expect(sideTaskDisplayLabel(label).startsWith('Side task · ')).toBe(false)
    expect(isSideTaskLabel('ordinary delegation')).toBe(false)
  })

  it('round-trips child identity through the existing sidebar resource grammar', () => {
    const address = sideTaskChatAddress({
      parentSessionId: 'parent/1' as SessionId,
      childSessionId: 'child/1' as SessionId,
      mode: 'independent',
    })
    const url = new URL(address)
    expect(url.protocol).toBe('dsh-resource:')
    expect(url.hostname).toBe('sidechat')
    expect(url.searchParams.get('parent')).toBe('parent/1')
    expect(url.searchParams.get('mode')).toBe('independent')
    expect(decodeURIComponent(url.pathname.split('/').at(-1) ?? '')).toBe('child/1')
    expect(parseSideTaskChatAddress(address)).toEqual({
      parentSessionId: 'parent/1',
      childSessionId: 'child/1',
      mode: 'independent',
    })
    expect(parseSideTaskChatAddress(address.replace('sidechat', 'subagentchat'))).toBeUndefined()
  })

  it('authenticates the latest valid child-owned descriptor', () => {
    const descriptor = (childSessionId: string, ignorable = true) => [{
      type: 'plugin:side-tasks/descriptor',
      ignorable,
      data: { version: 1, sourceSessionId: 'source', childSessionId, label: 'x' },
    }]
    expect(isSideTaskDescriptor(descriptor('child'), 0)?.childSessionId).toBe('child')
    expect(isSideTaskDescriptor([...descriptor('child'), ...descriptor('newest')], 0)?.childSessionId).toBe('newest')
    expect(isSideTaskDescriptor(descriptor('child', false), 0)).toBeUndefined()
    expect(isSideTaskDescriptor(descriptor('child'), 1)).toBeUndefined()
  })
})

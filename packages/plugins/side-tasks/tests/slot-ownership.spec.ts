import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { SIDE_CHAT_SLOT } from '../src/client/sidebar-chat.tsx'

const Comp = (() => null) as never

function frameWithBuiltInSubagentPanel() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'single', scope: 'session' },
      'sidebar.chat.conversation': { kind: 'single', scope: 'session' },
    },
  }, Comp)
  core.register({ name: 'sidebar.chat.conversation' }, Comp)
  return core
}

describe('right-sidebar slot ownership', () => {
  it('registers the side-chat body without redeclaring ui-subagent conversation', () => {
    const core = frameWithBuiltInSubagentPanel()
    expect(() => core.register({
      name: 'sidebar.right.pane.tab',
      children: { [SIDE_CHAT_SLOT]: { kind: 'single', scope: 'session' } },
    }, Comp)).not.toThrow()
    core.register({ name: SIDE_CHAT_SLOT }, Comp)
    expect(core.entries(SIDE_CHAT_SLOT)).toHaveLength(1)
  })

  it('rejects the old colliding declaration', () => {
    const core = frameWithBuiltInSubagentPanel()
    expect(() => core.register({
      name: 'sidebar.right.pane.tab',
      children: { 'sidebar.chat.conversation': { kind: 'single', scope: 'session' } },
    }, Comp)).toThrow(/already declared/)
  })
})

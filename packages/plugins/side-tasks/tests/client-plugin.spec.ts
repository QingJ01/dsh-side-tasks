import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from '../src/types.ts'
import { apply } from '../src/client/index.ts'

const address: SideTaskAddress = {
  parentSessionId: 'parent' as SessionId,
  childSessionId: 'child' as SessionId,
  mode: 'continuable',
}

describe('client creation and reopening', () => {
  it('opens the created child and reopens existing children without another create call', async () => {
    let registration: { definition: { inject: (id: SessionId) => {
      createSideTask: (prompt: string) => Promise<unknown>
      openSideTask: (address: SideTaskAddress) => void
      refreshSideTasks: () => void
    } } } | undefined
    const create = vi.fn(async () => ({ ok: true as const, value: address }))
    const openResource = vi.fn()
    const refreshProjections = vi.fn()
    const ctx = {
      effect: (callback: () => unknown) => callback(),
      locale: { register: vi.fn() },
      slots: {
        inject: (_seat: string, callback: () => unknown) => { registration = callback() as typeof registration },
        register: (definition: unknown) => ({ definition }),
      },
      remote: { sideTasks: { create } },
      sessions: { refreshProjections },
      sidebarRight: { openResource },
    }
    apply(ctx as never)

    expect(registration).toBeDefined()
    const actions = registration!.definition.inject('parent' as SessionId)
    await actions.createSideTask('investigate')
    expect(create).toHaveBeenCalledWith('parent', { prompt: 'investigate' })
    expect(openResource).toHaveBeenCalledTimes(1)

    const existing: SideTaskAddress = { ...address, childSessionId: 'existing' as SessionId }
    actions.openSideTask(existing)
    expect(openResource).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(1)
    expect(openResource.mock.calls[1]?.[0]).toContain(encodeURIComponent('existing'))
    expect(openResource.mock.calls[1]?.[1]).toEqual({ kind: 'subagentchat', preferNewPane: true })
  })
})

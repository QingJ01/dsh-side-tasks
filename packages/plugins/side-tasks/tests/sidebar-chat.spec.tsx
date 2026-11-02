// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideChatEmptyState, SideChatStartPage } from '../src/client/sidebar-chat.tsx'
import { en, type SideTaskKey } from '../src/client/locales.ts'

afterEach(cleanup)

describe('SideChatEmptyState', () => {
  it('explains that closing the tab ends and archives the temporary chat', () => {
    const t = ((key: SideTaskKey) => en[key]) as never
    render(<SideChatEmptyState t={t} />)
    expect(screen.getByRole('heading', { name: en['empty.title'] })).toBeTruthy()
    expect(screen.getByText(en['empty.description'])).toBeTruthy()
    expect(en['empty.description']).toContain('Closing its tab ends and archives it')
  })

  it('blocks creation from a child or archived session', () => {
    const t = ((key: SideTaskKey) => en[key]) as never
    render(<SideChatStartPage
      parentSessionId={'child' as SessionId}
      createSideTask={vi.fn()}
      onCreated={vi.fn()}
      t={t}
      blocked
    />)
    expect(screen.getByText(en['create.blocked'])).toBeTruthy()
    expect(screen.queryByLabelText(en['prompt.label'])).toBeNull()
  })

  it('creates from the guide start page and opens the resulting child', async () => {
    const t = ((key: SideTaskKey) => en[key]) as never
    const address = {
      parentSessionId: 'parent' as SessionId,
      childSessionId: 'child' as SessionId,
      mode: 'continuable' as const,
    }
    const createSideTask = vi.fn(async () => ({ ok: true as const, value: address }))
    const onCreated = vi.fn()
    render(<SideChatStartPage parentSessionId={'parent' as SessionId} createSideTask={createSideTask} onCreated={onCreated} t={t} />)
    expect(screen.getByText(en['empty.description'])).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en['prompt.label']), { target: { value: 'inspect the failures' } })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    await waitFor(() => expect(createSideTask).toHaveBeenCalledWith('parent', 'inspect the failures'))
    expect(onCreated).toHaveBeenCalledWith(address)
  })
})

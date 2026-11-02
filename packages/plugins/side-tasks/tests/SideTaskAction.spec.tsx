// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from '../src/types.ts'
import { SideTaskAction, type SideTaskActionProps } from '../src/client/SideTaskAction.tsx'
import { en, type SideTaskKey } from '../src/client/locales.ts'

const parentId = 'parent' as SessionId
const address: SideTaskAddress = {
  parentSessionId: parentId,
  childSessionId: 'child' as SessionId,
  mode: 'continuable',
}

function translate(key: SideTaskKey, params?: Record<string, string | number>): string {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function renderAction(overrides: Partial<SideTaskActionProps> = {}) {
  const state = {
    byId: { parent: {} },
    projectionsBySession: {},
  }
  const props = {
    sessionId: parentId,
    useSessions: (selector: (value: typeof state) => unknown) => selector(state),
    useWorkspaces: (selector: (value: { archivedSessionIds: SessionId[] }) => unknown) => selector({ archivedSessionIds: [] }),
    createSideTask: vi.fn(async () => ({ ok: true as const, value: address })),
    t: translate,
    ...overrides,
  } as SideTaskActionProps
  render(<SideTaskAction {...props} />)
  return props
}

afterEach(cleanup)

describe('SideTaskAction', () => {
  it('submits a trimmed first task', async () => {
    const props = renderAction()
    fireEvent.click(screen.getByRole('button', { name: en['action.open'] }))
    fireEvent.change(screen.getByLabelText(en['prompt.label']), { target: { value: '  inspect failures  ' } })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    await waitFor(() => expect(props.createSideTask).toHaveBeenCalledWith('inspect failures'))
  })

  it('is not rendered for archived parent sessions', () => {
    const useWorkspaces = ((selector: (value: { archivedSessionIds: SessionId[] }) => unknown) => (
      selector({ archivedSessionIds: [parentId] })
    )) as SideTaskActionProps['useWorkspaces']
    renderAction({ useWorkspaces })
    expect(screen.queryByRole('button', { name: en['action.open'] })).toBeNull()
  })

  it('is not rendered on subagent child sessions', () => {
    const useSessions = ((selector: (value: {
      byId: Record<string, { origin?: string }>
      projectionsBySession: Record<string, never>
    }) => unknown) => selector({
      byId: { parent: { origin: 'subagent' } },
      projectionsBySession: {},
    })) as SideTaskActionProps['useSessions']
    renderAction({ useSessions })
    expect(screen.queryByRole('button', { name: en['action.open'] })).toBeNull()
  })

  it('keeps the dialog open with an actionable error on failure', async () => {
    const createSideTask = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'parent offline' },
    }))
    const props = renderAction({ createSideTask: createSideTask as SideTaskActionProps['createSideTask'] })
    fireEvent.click(screen.getByRole('button', { name: en['action.open'] }))
    fireEvent.change(screen.getByLabelText(en['prompt.label']), { target: { value: 'task' } })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('parent offline')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

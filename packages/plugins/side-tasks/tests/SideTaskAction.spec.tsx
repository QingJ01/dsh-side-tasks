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
    projectionsBySession: {
      parent: {
        values: {
          subagentCatalog: [{
            id: 'existing' as SessionId,
            createdAt: 1,
            mode: 'continuable' as const,
            label: 'Side task · Existing investigation',
          }],
        },
      },
    },
  }
  const props = {
    sessionId: parentId,
    useSessions: (selector: (value: typeof state) => unknown) => selector(state),
    useWorkspaces: (selector: (value: { archivedSessionIds: SessionId[] }) => unknown) => selector({ archivedSessionIds: [] }),
    refreshSideTasks: vi.fn(),
    createSideTask: vi.fn(async () => ({ ok: true as const, value: address })),
    openSideTask: vi.fn(),
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

  it('reopens an existing child without invoking creation', () => {
    const props = renderAction()
    fireEvent.click(screen.getByRole('button', { name: en['action.open'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Existing investigation in the right sidebar' }))
    expect(props.openSideTask).toHaveBeenCalledWith({
      parentSessionId: parentId,
      childSessionId: 'existing',
      mode: 'continuable',
    })
    expect(props.createSideTask).not.toHaveBeenCalled()
  })

  it('hides discarded children from the reopen list', () => {
    const useWorkspaces = ((selector: (value: { archivedSessionIds: SessionId[] }) => unknown) => (
      selector({ archivedSessionIds: ['existing' as SessionId] })
    )) as SideTaskActionProps['useWorkspaces']
    renderAction({ useWorkspaces })
    fireEvent.click(screen.getByRole('button', { name: en['action.open'] }))
    expect(screen.queryByRole('button', { name: 'Reopen Existing investigation in the right sidebar' })).toBeNull()
    expect(screen.getByText(en['existing.empty'])).toBeTruthy()
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
    expect(props.openSideTask).not.toHaveBeenCalled()
  })
})

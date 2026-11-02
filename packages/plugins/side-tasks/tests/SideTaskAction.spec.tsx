// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SideTaskAction, type SideTaskActionProps } from '../src/client/SideTaskAction.tsx'
import { en, type SideTaskKey } from '../src/client/locales.ts'

const parentId = 'parent' as SessionId

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
    openSideChat: vi.fn(),
    t: translate,
    ...overrides,
  } as SideTaskActionProps
  render(<SideTaskAction {...props} />)
  return props
}

afterEach(cleanup)

describe('SideTaskAction', () => {
  it('opens the right-side dialog directly without a modal', () => {
    const props = renderAction()
    fireEvent.click(screen.getByRole('button', { name: en['action.label'] }))
    expect(props.openSideChat).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is not rendered for archived parent sessions', () => {
    const useWorkspaces = ((selector: (value: { archivedSessionIds: SessionId[] }) => unknown) => (
      selector({ archivedSessionIds: [parentId] })
    )) as SideTaskActionProps['useWorkspaces']
    renderAction({ useWorkspaces })
    expect(screen.queryByRole('button', { name: en['action.label'] })).toBeNull()
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
    expect(screen.queryByRole('button', { name: en['action.label'] })).toBeNull()
  })
})

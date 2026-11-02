// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SideChatEmptyState } from '../src/client/sidebar-chat.tsx'
import { en, type SideTaskKey } from '../src/client/locales.ts'

afterEach(cleanup)

describe('SideChatEmptyState', () => {
  it('explains that closing the tab ends and removes the temporary chat', () => {
    const t = ((key: SideTaskKey) => en[key]) as never
    render(<SideChatEmptyState t={t} />)
    expect(screen.getByRole('heading', { name: en['empty.title'] })).toBeTruthy()
    expect(screen.getByText(en['empty.description'])).toBeTruthy()
    expect(en['empty.description']).toContain('Closing its tab ends and removes it')
  })
})

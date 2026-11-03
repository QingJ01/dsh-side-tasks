// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { DiscardNotice } from '../src/client/DiscardNotice.tsx'

describe('pending discard notice', () => {
  it('shows pending work, disables Retry while busy, and invokes the callback', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const state = { pending: 2, busy: false }
    const retryDiscards = vi.fn()
    const props = {
      usePendingDiscards: (select: (value: typeof state) => unknown) => select(state),
      retryDiscards,
      t: (key: string, values?: { count?: number }) =>
        key === 'discard.pending' ? `${values?.count ?? 0} pending` : key,
    } as Parameters<typeof DiscardNotice>[0]
    try {
      act(() => { root.render(React.createElement(DiscardNotice, props)) })
      const notice = document.body.querySelector('[role="alert"]')
      expect(notice?.parentElement).toBe(document.body)
      expect(notice?.textContent).toContain('2 pending')
      const button = notice?.querySelector('button')
      expect(button?.disabled).toBe(false)
      act(() => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(retryDiscards).toHaveBeenCalledOnce()

      state.busy = true
      act(() => { root.render(React.createElement(DiscardNotice, props)) })
      expect(document.body.querySelector('button')?.disabled).toBe(true)
    } finally {
      act(() => { root.unmount() })
      expect(document.body.querySelector('[role="alert"]')).toBeNull()
      container.remove()
    }
  })
})

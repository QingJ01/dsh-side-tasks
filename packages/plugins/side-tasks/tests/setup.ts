import { createElement, type ReactNode } from 'react'
import { vi } from 'vitest'

// Visual primitives are outside these behavior tests. Keeping the test doubles
// semantic still exercises buttons, forms, dialogs, and accessible names.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, icon, ...props }: { children?: ReactNode; icon?: ReactNode }) => (
    createElement('button', { type: 'button', ...props }, icon, children)
  ),
  Modal: ({ open, title, description, children, footer }: {
    open: boolean
    title: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
  }) => open
    ? createElement('div', { role: 'dialog', 'aria-label': title },
      createElement('h2', null, title),
      description,
      children,
      footer)
    : null,
  IconBranchOutlineRegular: () => null,
  IconChevronRightOutlineRegular: () => null,
}))

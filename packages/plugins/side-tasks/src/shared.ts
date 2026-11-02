import type { SideTaskAddress } from './types.ts'

/** Durable label marker distinguishing user-created side tasks from model delegations. */
export const SIDE_TASK_LABEL_PREFIX = 'Side task · '

const SIDEBAR_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/'
const MAX_LABEL_LENGTH = 96

/** Normalize a first prompt without changing its internal whitespace. */
export function normalizeSideTaskPrompt(prompt: string): string {
  return prompt.trim()
}

/** Build the durable catalog label for a side task. */
export function createSideTaskLabel(prompt: string): string {
  const normalized = normalizeSideTaskPrompt(prompt).replaceAll(/\s+/gu, ' ')
  const available = Math.max(1, MAX_LABEL_LENGTH - SIDE_TASK_LABEL_PREFIX.length - 1)
  const summary = normalized.length > available ? `${normalized.slice(0, available)}…` : normalized
  return `${SIDE_TASK_LABEL_PREFIX}${summary}`
}

/** Test whether a catalog label belongs to this plugin. */
export function isSideTaskLabel(label: string | undefined): label is string {
  return label?.startsWith(SIDE_TASK_LABEL_PREFIX) === true
}

/** Remove the internal catalog marker for display. */
export function sideTaskDisplayLabel(label: string): string {
  return isSideTaskLabel(label) ? label.slice(SIDE_TASK_LABEL_PREFIX.length) : label
}

/** Encode an existing child as the built-in right-sidebar chat resource. */
export function sideTaskChatAddress(address: SideTaskAddress): string {
  const query = new URLSearchParams({
    parent: address.parentSessionId,
    mode: address.mode,
  })
  return `${SIDEBAR_CHAT_ADDRESS}${encodeURIComponent(address.childSessionId)}?${query}`
}

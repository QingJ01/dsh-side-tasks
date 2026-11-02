import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideTaskAddress } from './types.ts'

/** Durable label marker distinguishing user-created side tasks from model delegations. */
export const SIDE_TASK_LABEL_PREFIX = 'Side task · '
/** Durable marker for an idle side chat created without a first prompt. */
export const SIDE_TASK_BLANK_LABEL = 'New side chat'

export const SIDE_CHAT_KIND = 'sidechat'
export const SIDE_CHAT_PAGE_ADDRESS = 'sidebar://sidechat'
const SIDEBAR_CHAT_ADDRESS = 'dsh-resource://sidechat/session/'
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

/** Whether a durable label names the placeholder blank side chat. */
export function isBlankSideTaskLabel(label: string | undefined): boolean {
  return label !== undefined && sideTaskDisplayLabel(label) === SIDE_TASK_BLANK_LABEL
}

/**
 * Authenticate a child from its own persisted creation descriptor. This is a
 * deliberately local, version-tolerant structural check: resolving a peer's
 * fold helper can select an older Harness copy whose descriptor version and
 * parser no longer match the running Host.
 */
export function isSideTaskDescriptor(
  events: readonly { readonly type: string; readonly data?: unknown }[],
  inheritedEventCount: number,
): boolean {
  const descriptor = events.slice(inheritedEventCount).find(event => event.type === 'subagent/descriptor')
  const data = descriptor?.data
  return typeof data === 'object'
    && data !== null
    && (data as { mode?: unknown }).mode === 'continuable'
    && (data as { provider?: unknown }).provider === 'side-task'
}

/** Encode an existing child as this plugin's right-sidebar chat resource. */
export function sideTaskChatAddress(address: SideTaskAddress): string {
  const query = new URLSearchParams({
    parent: address.parentSessionId,
    mode: address.mode,
  })
  if (address.contextThrough !== undefined) query.set('contextThrough', String(address.contextThrough))
  return `${SIDEBAR_CHAT_ADDRESS}${encodeURIComponent(address.childSessionId)}?${query}`
}

/** Parse a side-chat resource address, rejecting other resource owners. */
export function parseSideTaskChatAddress(value: string): SideTaskAddress | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== SIDE_CHAT_KIND) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session') return undefined
  const parentSessionId = url.searchParams.get('parent')
  if (parentSessionId === null || parentSessionId === '' || url.searchParams.get('mode') !== 'continuable') return undefined
  const boundary = url.searchParams.get('contextThrough')
  const contextThrough = boundary === null ? undefined : Number(boundary)
  if (contextThrough !== undefined && (!Number.isSafeInteger(contextThrough) || contextThrough < -1)) return undefined
  try {
    return {
      ...(contextThrough === undefined ? {} : { contextThrough }),
      parentSessionId: parentSessionId as SessionId,
      childSessionId: decodeURIComponent(parts[1] as string) as SessionId,
      mode: 'continuable',
    }
  } catch {
    return undefined
  }
}

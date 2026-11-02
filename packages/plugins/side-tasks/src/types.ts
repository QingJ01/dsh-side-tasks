import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** User-authored first message for a side task. */
export interface CreateSideTaskRequest {
  readonly prompt: string
}

/** Durable direct-parent address used by Harness to reopen a continuable child. */
export interface SideTaskAddress {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  readonly mode: 'continuable'
}

/** Child to stop and archive when its side-chat tab closes. */
export interface DiscardSideTaskRequest {
  readonly childSessionId: SessionId
}

/** Confirmation that the close lifecycle was admitted. */
export interface DiscardSideTaskResult {
  readonly discarded: true
}

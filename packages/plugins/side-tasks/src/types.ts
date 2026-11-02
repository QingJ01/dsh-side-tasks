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
  /** Last inherited parent event; keeps the initial chat view empty. */
  readonly contextThrough?: number
}

/** Parent/child pair to stop and archive when its side-chat tab closes. */
export interface DiscardSideTaskRequest {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
}

/** User-selected model, including its adapter-owned reasoning effort. */
export interface SideChatModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Mutations are addressed to one authenticated child, never the parent. */
export type ConfigureSideTaskRequest = DiscardSideTaskRequest & (
  | { readonly kind: 'model'; readonly selection: SideChatModel }
  | { readonly kind: 'permission'; readonly preset: string }
)

export interface ConfigureSideTaskResult { readonly configured: true }

/** Confirmation that the close lifecycle was admitted. */
export interface DiscardSideTaskResult {
  readonly discarded: true
}

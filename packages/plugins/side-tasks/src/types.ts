import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface SideTaskDescriptor {
  readonly version: 1
  readonly sourceSessionId: SessionId
  readonly childSessionId: SessionId
  readonly label: string
}

export interface SideTaskContextRecord {
  readonly version: 1
  readonly sourceSessionId: SessionId
  readonly text: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'permission/preset': { readonly preset: string }
    'sandbox/mode': { readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access' }
    'approval/policy': { readonly policy: 'ask' | 'never' }
  }

  interface PluginRecordMap {
    'plugin:side-tasks/descriptor': SideTaskDescriptor
    'plugin:side-tasks/context': SideTaskContextRecord
  }
}

/** User-authored first message for a side task. */
export interface CreateSideTaskRequest {
  readonly prompt: string
}

export interface SideTaskCapabilities {
  readonly supportsSideChatSessions: boolean
}

/** Durable child identity used to reopen an independent side chat or close a legacy one. */
export interface SideTaskAddress {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  readonly mode: 'independent' | 'continuable'
  /** Last inherited parent event; keeps the initial chat view empty. */
  readonly contextThrough?: number
}

/** Parent/child pair to stop and archive when its side-chat tab closes. */
export interface DiscardSideTaskRequest {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
}

/** User-selected model, including its adapter-owned reasoning effort. */
export type SideChatModel = ModelSelection

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

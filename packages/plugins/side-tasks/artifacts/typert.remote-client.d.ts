import type { RemoteResult, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConfigureSideTaskRequest,
  ConfigureSideTaskResult,
  CreateSideTaskRequest,
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskCapabilities,
  SideTaskAddress,
} from 'dsh-side-tasks/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$736964655461736b73 {
    create: (sourceSessionId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
    capabilities: () => Promise<RemoteResult<SideTaskCapabilities>>
    configure: (request: ConfigureSideTaskRequest) => Promise<RemoteResult<ConfigureSideTaskResult>>
    discard: (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>
  }
  interface TypertRemoteMap {
    'sideTasks/create': (sourceSessionId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
    'sideTasks/capabilities': () => Promise<RemoteResult<SideTaskCapabilities>>
    'sideTasks/configure': (request: ConfigureSideTaskRequest) => Promise<RemoteResult<ConfigureSideTaskResult>>
    'sideTasks/discard': (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>
  }
  interface TypertRemoteNamespaceMap {
    sideTasks: TypertRemoteNamespace$736964655461736b73
  }
}

export declare const TYPERT_REMOTE: TypertRemoteInfo<{
  readonly 'sideTasks/create': TypertRemoteMethod<{
    readonly sourceSessionId: SessionId
    readonly request: CreateSideTaskRequest
  }, SideTaskAddress>
  readonly 'sideTasks/capabilities': TypertRemoteMethod<{}, SideTaskCapabilities>
  readonly 'sideTasks/configure': TypertRemoteMethod<{ readonly request: ConfigureSideTaskRequest }, ConfigureSideTaskResult>
  readonly 'sideTasks/discard': TypertRemoteMethod<{
    readonly request: DiscardSideTaskRequest
  }, DiscardSideTaskResult>
}>
export default TYPERT_REMOTE

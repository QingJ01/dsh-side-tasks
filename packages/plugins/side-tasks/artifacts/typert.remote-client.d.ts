import type { RemoteResult, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CreateSideTaskRequest,
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskAddress,
} from 'dsh-side-tasks/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$736964655461736b73 {
    create: (agentId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
    discard: (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>
  }
  interface TypertRemoteMap {
    'sideTasks/create': (agentId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
    'sideTasks/discard': (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>
  }
  interface TypertRemoteNamespaceMap {
    sideTasks: TypertRemoteNamespace$736964655461736b73
  }
  interface TypertRemoteScopeMap {
    'agent:sideTasks/create': (request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
  }
}

export declare const TYPERT_REMOTE: TypertRemoteInfo<{
  readonly 'sideTasks/create': TypertRemoteMethod<{
    readonly agentId: SessionId
    readonly request: CreateSideTaskRequest
  }, SideTaskAddress>
  readonly 'sideTasks/discard': TypertRemoteMethod<{
    readonly request: DiscardSideTaskRequest
  }, DiscardSideTaskResult>
}>
export default TYPERT_REMOTE

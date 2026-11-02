import type { RemoteResult, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CreateSideTaskRequest, SideTaskAddress } from 'dsh-side-tasks'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$736964655461736b73 {
    create: (agentId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
  }
  interface TypertRemoteMap {
    'sideTasks/create': (agentId: SessionId, request: CreateSideTaskRequest) => Promise<RemoteResult<SideTaskAddress>>
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
}>
export default TYPERT_REMOTE

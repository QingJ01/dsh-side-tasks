/** Host service for user-created, context-inheriting side tasks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'
import { SideTaskProvider } from './provider.ts'
import { discardSideTask, startSideTask } from './side-task.ts'
import type {
  CreateSideTaskRequest,
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskAddress,
} from './types.ts'

export type {
  CreateSideTaskRequest,
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskAddress,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sideTasks: SideTaskService
  }
}

/** Remote namespace (`ctx.remote.sideTasks`) and host lifecycle owner. */
export class SideTaskService extends TypertRemoteService {
  static inject = ['agents', 'subagents', 'workspaceRegistry', 'sessionQuery']

  constructor(ctx: Context) {
    super(ctx, 'sideTasks')
    ctx.effect(() => ctx.subagents.registerProvider(new SideTaskProvider()), 'side-tasks: provider')
  }

  /**
   * Create one child without creating or selecting an ordinary session.
   * @param agent - exact live parent resolved from the session wire identity.
   * @param request - first user message for the child.
   * @param signal - RPC cancellation before the initial message is accepted.
   * @returns durable address used to open the child in the right sidebar.
   */
  @Remote('create')
  async create(
    agent: Agent,
    request: CreateSideTaskRequest,
    signal: AbortSignal,
  ): Promise<SideTaskAddress> {
    return await startSideTask(
      this.ctx.subagents,
      agent,
      request.prompt,
      signal,
      this.ctx.subagents.resolveMaxDepth(),
    )
  }

  /** Stop and archive one plugin-owned child when its tab closes. */
  @Remote('discard')
  async discard(
    request: DiscardSideTaskRequest,
    signal: AbortSignal,
  ): Promise<DiscardSideTaskResult> {
    return await discardSideTask(
      this.ctx.subagents,
      this.ctx.workspaceRegistry,
      this.ctx.sessionQuery,
      request.parentSessionId,
      this.ctx.agents.get(request.parentSessionId),
      request.childSessionId,
      signal,
    )
  }
}

export default SideTaskService

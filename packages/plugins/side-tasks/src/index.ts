/** Host service for user-created, context-inheriting side tasks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-subagent'
import { startSideTask } from './side-task.ts'
import type { CreateSideTaskRequest, SideTaskAddress } from './types.ts'

export type { CreateSideTaskRequest, SideTaskAddress } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sideTasks: SideTaskService
  }
}

/** Remote namespace (`ctx.remote.sideTasks`) and host lifecycle owner. */
export class SideTaskService extends TypertRemoteService {
  static inject = ['agents', 'subagents']

  constructor(ctx: Context) {
    super(ctx, 'sideTasks')
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
    return await startSideTask(this.ctx.subagents, agent, request.prompt, signal)
  }
}

export default SideTaskService

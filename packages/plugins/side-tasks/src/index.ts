/** Host service for user-created, context-inheriting side tasks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBlankSideTask } from './blank.ts'
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

  private readonly blankHandles = new Map<SessionId, AgentHandle>()

  constructor(ctx: Context) {
    super(ctx, 'sideTasks')
    ctx.effect(() => ctx.subagents.registerProvider(new SideTaskProvider()), 'side-tasks: provider')
    ctx.effect(() => () => {
      for (const handle of this.blankHandles.values()) void handle.dispose().catch(() => undefined)
      this.blankHandles.clear()
    }, 'side-tasks: blank children')
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
    const maxDepth = this.ctx.subagents.resolveMaxDepth()
    if (request.prompt.trim() === '') {
      const blank = await createBlankSideTask(this.ctx.agents, agent, maxDepth, signal)
      this.blankHandles.set(blank.address.childSessionId, blank.handle)
      return blank.address
    }
    return await startSideTask(
      this.ctx.subagents,
      agent,
      request.prompt,
      signal,
      maxDepth,
    )
  }

  /** Stop and archive one plugin-owned child when its tab closes. */
  @Remote('discard')
  async discard(
    request: DiscardSideTaskRequest,
    signal: AbortSignal,
  ): Promise<DiscardSideTaskResult> {
    const result = await discardSideTask(
      this.ctx.subagents,
      this.ctx.workspaceRegistry,
      this.ctx.sessionQuery,
      request.parentSessionId,
      this.ctx.agents.get(request.parentSessionId),
      request.childSessionId,
      signal,
    )
    const handle = this.blankHandles.get(request.childSessionId)
    if (handle !== undefined) {
      this.blankHandles.delete(request.childSessionId)
      await handle.dispose().catch(() => undefined)
    }
    return result
  }
}

export default SideTaskService

/** Dedicated subagent backend for user-created side chats. */
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'

/** Durable provider identity written into every side-task descriptor. */
export const SIDE_TASK_PROVIDER = 'side-task'

/**
 * In-process provider for side chats. It deliberately seeds no parent events:
 * a prompt-started child gets the parent conversation through the same
 * per-agent prompt context as an idle side chat, so its transcript and token
 * usage stay its own.
 */
export class SideTaskProvider implements SubagentProvider {
  readonly name = SIDE_TASK_PROVIDER
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    agentPreset: false,
    outputSchema: true,
    depthLimit: true,
  }
  readonly inheritsParentContext = true

  prepareContinuable(_request: ContinuableCreateRequest): Promise<ContinuableCreateSpec> {
    return Promise.resolve({})
  }
}

/** Dedicated subagent backend that seeds a child with the parent's completed turns. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'

/** Durable provider identity written into every side-task descriptor. */
export const SIDE_TASK_PROVIDER = 'side-task'

/** The balanced completed-turn prefix of a parent log. */
function completedTurnPrefix(parent: Agent): SessionEvent[] {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing history read; same contract as the fork provider.
  const events = parent.session.snapshotEvents()
  const lastEnd = events.findLast(event => event.type === 'turn/end')
  return lastEnd === undefined ? [] : events.slice(0, lastEnd.seq + 1)
}

/** In-process provider that copies context once, at child creation. */
export class SideTaskProvider implements SubagentProvider {
  readonly name = SIDE_TASK_PROVIDER
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    agentPreset: false,
    outputSchema: true,
    depthLimit: true,
  }
  readonly inheritsParentContext = true

  prepareContinuable(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec> {
    const seed = completedTurnPrefix(request.parent)
    return Promise.resolve(seed.length === 0 ? {} : { seed })
  }
}

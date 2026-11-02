import type {} from '@deepseek-ai/dsh-api-session-controller'
import { randomUUID } from 'node:crypto'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import {
  appendDelegatedPolicyOverrides, applyChildComposition, captureDelegatedPolicyOverrides,
  childSessionMeta, resolveChildAgentOptions, resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import { createSideTaskLabel, SIDE_TASK_BLANK_LABEL } from './shared.ts'
import { completedTurnPrefix, SIDE_TASK_PROVIDER } from './provider.ts'
import type { SideTaskAddress } from './types.ts'

/** Prepare durable continuation state, then release the writer before the UI can send.
 * The first native composer submission cold-resumes this child through the
 * subagent manager. Keeping the creation AgentHandle alive would collide with
 * that manager's agents.resume and leave the prompt rejected.
 */
export async function createBlankSideTask(
  agents: Pick<AgentRegistry, 'create'>,
  parent: Agent,
  maxDepth: number | undefined,
  signal: AbortSignal,
  archiveFailed: (id: SessionId) => Promise<void>,
): Promise<SideTaskAddress> {
  signal.throwIfAborted()
  const depth = resolveChildDepth(parent, maxDepth)
  const options = resolveChildAgentOptions(parent, undefined, depth)
  const policy = captureDelegatedPolicyOverrides(parent)
  const permissionPresets = parent.ctx.get('permissionPresets') as {
    current(session: Agent['session']): string
    set(session: Agent['session'], preset: string): void
  } | undefined
  const parentPreset = permissionPresets?.current(parent.session)
  const seed = completedTurnPrefix(parent)
  const label = createSideTaskLabel(SIDE_TASK_BLANK_LABEL)
  const cwd = parent.session.header.cwd
  const childId = randomUUID() as SessionId
  const handle = await agents.create({
    sessionId: childId,
    parentAgent: parent,
    meta: childSessionMeta(parent, depth, seed.length > 0),
    inheritedEventCount: seed.length as SessionLogOffset,
    ...(seed.length === 0 ? {} : { seed }),
    agentOptions: options,
    signal,
    setup: async (childCtx, child) => {
      await applyChildComposition(childCtx, parent, {})
      if (cwd !== undefined) {
        const workingDirectory = childCtx.get('workingDirectory') as {
          set(agent: Agent, path: string, signal: AbortSignal): Promise<void>
        } | undefined
        await workingDirectory?.set(child, cwd, signal)
      }
      child.session.append('subagent/descriptor', {
        version: 3,
        mode: 'continuable',
        provider: SIDE_TASK_PROVIDER,
        label,
        ...(options.provider === undefined ? {} : { agentProvider: options.provider }),
        ...(options.model === undefined ? {} : { agentModel: options.model }),
        ...(options.reasoningEffort === undefined ? {} : { agentReasoningEffort: options.reasoningEffort }),
      })
      appendDelegatedPolicyOverrides(child.session, policy)
      // A user-opened side chat starts with the parent's explicit menu preset;
      // subsequent user choices belong solely to this child's own log.
      if (parentPreset !== undefined && parentPreset !== 'custom') permissionPresets?.set(child.session, parentPreset)
      if (options.provider !== undefined && options.model !== undefined) child.session.append('model/selection', {
        provider: options.provider, model: options.model,
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      })
    },
  })
  const childCreatedAt = handle.agent.session.header.createdAt
  try {
    // An idle Agent has never entered a turn: releasing it adds no synthetic
    // user message or stopped turn. Await the full writer/store teardown.
    await handle.dispose()
    signal.throwIfAborted()
    parent.session.append('subagent/catalog', {
      version: 0, childId, childCreatedAt, mode: 'continuable', label,
    })
    return { parentSessionId: parent.id, childSessionId: childId, mode: 'continuable', contextThrough: seed.length - 1 }
  } catch (error: unknown) {
    await handle.dispose().catch(() => undefined)
    await archiveFailed(childId).catch(() => undefined)
    throw error
  }
}

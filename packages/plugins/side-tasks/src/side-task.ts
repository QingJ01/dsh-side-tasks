import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  foldSubagentDescriptor,
  type SubagentActivation,
  type SubagentActivationSpec,
  type SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { createSideTaskLabel, normalizeSideTaskPrompt } from './shared.ts'
import { SIDE_TASK_PROVIDER } from './provider.ts'
import type { DiscardSideTaskResult, SideTaskAddress } from './types.ts'

/** Narrow subagent runtime surface used by side-task creation. */
export interface SideTaskStarter {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
}

/** One disposable observation of a child log. */
export interface SideTaskObservation {
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount: number
  [Symbol.dispose](): void
}

/** Narrow session-query surface used to authenticate a persisted side task. */
export interface SideTaskQuery {
  observeSession(
    sessionId: SessionId,
    options: { projectionMode: 'none'; signal: AbortSignal },
  ): Promise<SideTaskObservation>
}

/**
 * Create a continuable child with the parent's completed-turn context.
 * Caller delivery keeps settlement out of the parent's conversation; the
 * durable child remains in the parent's subagent catalog for later reopening.
 */
export async function startSideTask(
  starter: SideTaskStarter,
  parent: Agent,
  prompt: string,
  signal: AbortSignal,
  maxDepth?: number,
): Promise<SideTaskAddress> {
  const normalized = normalizeSideTaskPrompt(prompt)
  if (normalized === '') throw new Error('A side task requires a non-empty prompt.')
  signal.throwIfAborted()
  const started = await starter.startActivation({
    provider: SIDE_TASK_PROVIDER,
    label: createSideTaskLabel(normalized),
    request: {
      parent,
      prompt: [{ type: 'text', text: normalized }],
      ...(maxDepth === undefined ? {} : { maxDepth }),
    },
    signal,
    delivery: 'caller',
  })
  // The transcript owns user-visible failures. Observing the unused result
  // prevents an unhandled rejection without waking the parent conversation.
  void started.result.catch(() => undefined)
  return {
    parentSessionId: parent.id,
    childSessionId: started.childId,
    mode: 'continuable',
  }
}

/** Stop a plugin-owned child and archive it without touching session files. */
export async function discardSideTask(
  subagents: Pick<SubagentRuntime, 'listChildren' | 'drainChildren'>,
  workspace: Pick<WorkspaceRegistry, 'archiveSession'>,
  query: SideTaskQuery,
  parent: Agent,
  childSessionId: SessionId,
  signal: AbortSignal,
): Promise<DiscardSideTaskResult> {
  const children = await subagents.listChildren(parent.id, signal)
  const child = children.find(entry => entry.id === childSessionId)
  if (child === undefined || child.mode !== 'continuable') {
    throw new Error(`Session "${childSessionId}" is not a child of "${parent.id}".`)
  }

  using observation = await query.observeSession(childSessionId, { projectionMode: 'none', signal })
  const descriptor = foldSubagentDescriptor(observation.events.slice(observation.inheritedEventCount))
  // The descriptor provider is durable and not model- or user-editable.
  const owned = descriptor?.mode === 'continuable' && descriptor.provider === SIDE_TASK_PROVIDER
  if (!owned) {
    throw new Error(`Session "${childSessionId}" was not created by the side-task plugin.`)
  }

  signal.throwIfAborted()
  // Archive is the durable half: make the child unreachable before optional
  // teardown. The archive provider stops active work itself.
  await workspace.archiveSession(childSessionId, { stopActivity: true })
  try {
    await subagents.drainChildren(parent, [childSessionId])
  } catch {
    // The session is already archived and stopped; a resident activation that
    // refuses teardown must not resurrect it or fail the close command.
  }
  return { discarded: true }
}

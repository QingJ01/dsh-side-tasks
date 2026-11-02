import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { createSideTaskLabel, isSideTaskLabel, normalizeSideTaskPrompt } from './shared.ts'
import type { DiscardSideTaskResult, SideTaskAddress } from './types.ts'

/** Narrow subagent runtime surface used by side-task creation. */
export interface SideTaskStarter {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
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
): Promise<SideTaskAddress> {
  const normalized = normalizeSideTaskPrompt(prompt)
  if (normalized === '') throw new Error('A side task requires a non-empty prompt.')
  signal.throwIfAborted()
  const started = await starter.startActivation({
    provider: 'fork',
    label: createSideTaskLabel(normalized),
    request: {
      parent,
      prompt: [{ type: 'text', text: normalized }],
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
  parent: Agent,
  childSessionId: SessionId,
  signal: AbortSignal,
): Promise<DiscardSideTaskResult> {
  const children = await subagents.listChildren(parent.id, signal)
  const child = children.find(entry => entry.id === childSessionId)
  if (child === undefined || child.mode !== 'continuable' || !isSideTaskLabel(child.label)) {
    throw new Error(`Session "${childSessionId}" is not a side task of "${parent.id}".`)
  }
  signal.throwIfAborted()
  await subagents.drainChildren(parent, [childSessionId])
  signal.throwIfAborted()
  await workspace.archiveSession(childSessionId, { stopActivity: true })
  return { discarded: true }
}

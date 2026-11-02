import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-subagent'
import { createSideTaskLabel, SIDE_TASK_BLANK_LABEL } from './shared.ts'
import { completedTurnPrefix, SIDE_TASK_PROVIDER } from './provider.ts'
import type { SideTaskAddress } from './types.ts'

const DESCRIPTOR_VERSION = 3

/** A blank child and the live handle the plugin must release when its tab closes. */
export interface BlankSideTask {
  readonly address: SideTaskAddress
  readonly handle: AgentHandle
}

function parentDepth(parent: Agent): number {
  return Math.max(
    parent.session.header.delegationDepth ?? 0,
    parent.options.subagentDepth ?? 0,
  )
}

/** Create an idle, catalogued subagent session with no initial model turn. */
export async function createBlankSideTask(
  agents: Pick<AgentRegistry, 'create'>,
  parent: Agent,
  maxDepth: number | undefined,
  signal: AbortSignal,
): Promise<BlankSideTask> {
  const depth = parentDepth(parent) + 1
  if (maxDepth !== undefined && depth > maxDepth) {
    throw new Error(`Side chat would exceed the subagent depth limit (${maxDepth}).`)
  }
  const seed = completedTurnPrefix(parent)
  const label = createSideTaskLabel(SIDE_TASK_BLANK_LABEL)
  const cwd = parent.session.header.cwd
  const childId = randomUUID() as SessionId
  const handle = await agents.create({
    sessionId: childId,
    parentAgent: parent,
    meta: {
      ...(cwd === undefined ? {} : { cwd }),
      parentSession: parent.id,
      isSeeded: seed.length > 0,
      origin: 'subagent',
      delegationDepth: depth,
    },
    inheritedEventCount: seed.length as SessionLogOffset,
    ...(seed.length === 0 ? {} : { seed }),
    agentOptions: { ...parent.options, subagentDepth: depth },
    signal,
    setup: async (childCtx, child) => {
      const presets = childCtx.get('agentPresets') as {
        composeFrom?: (childCtx: Context, parentCtx: Context) => void
      } | undefined
      presets?.composeFrom?.(childCtx, parent.ctx)
      if (cwd !== undefined) {
        const workingDirectory = childCtx.get('workingDirectory') as {
          set(agent: Agent, path: string, signal: AbortSignal): Promise<void>
        } | undefined
        await workingDirectory?.set(child, cwd, signal)
      }
      child.session.append('subagent/descriptor', {
        version: DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: SIDE_TASK_PROVIDER,
        label,
      })
    },
  })
  try {
    parent.session.append('subagent/catalog', {
      version: 0,
      childId,
      childCreatedAt: handle.agent.session.header.createdAt,
      mode: 'continuable',
      label,
    })
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }
  return {
    address: { parentSessionId: parent.id, childSessionId: childId, mode: 'continuable' },
    handle,
  }
}

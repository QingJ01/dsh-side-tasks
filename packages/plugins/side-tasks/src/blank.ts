import { randomUUID } from 'node:crypto'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSideTaskLabel, SIDE_TASK_BLANK_LABEL } from './shared.ts'
import type { SideTaskAddress, SideTaskContextRecord, SideTaskDescriptor } from './types.ts'

export interface SideTaskSource {
  readonly id: SessionId
  readonly cwd?: string
  readonly preset?: string
  readonly model?: AgentOptions
  readonly permissions?: {
    readonly preset?: string
    readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
    readonly approval?: 'ask' | 'never'
  }
}

interface Presets {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(ctx: Context, id?: string): Promise<{ readonly id: string }>
}

export async function createBlankSideTask(
  agents: Pick<AgentRegistry, 'create'>,
  presets: Presets,
  source: SideTaskSource,
  contextText: string | undefined,
  prompt: string,
  signal: AbortSignal,
  archiveFailed: (id: SessionId) => Promise<void>,
): Promise<SideTaskAddress> {
  signal.throwIfAborted()
  const label = createSideTaskLabel(prompt.trim() === '' ? SIDE_TASK_BLANK_LABEL : prompt)
  const childId = randomUUID() as SessionId
  const selectedPreset = await presets.resolve(source.preset)
  const handle = await agents.create({
    sessionId: childId,
    meta: {
      ...(source.cwd === undefined ? {} : { cwd: source.cwd }),
      // rc.5's published type omits the patched same-version origin literal.
      origin: 'sidechat' as never,
      agentPreset: selectedPreset.id,
    },
    ...(source.model === undefined ? {} : { agentOptions: source.model }),
    signal,
    setup: async (childCtx, child: Agent) => {
      await presets.mount(childCtx, selectedPreset.id)
      const descriptor: SideTaskDescriptor = {
        version: 1, sourceSessionId: source.id, childSessionId: childId, label,
      }
      if (source.model?.provider !== undefined && source.model.model !== undefined) {
        child.session.append('model/selection', {
          provider: source.model.provider,
          model: source.model.model,
          ...(source.model.reasoningEffort === undefined ? {} : { reasoningEffort: source.model.reasoningEffort }),
        })
      }
      if (source.permissions?.preset !== undefined) {
        child.session.append('permission/preset', { preset: source.permissions.preset })
      }
      if (source.permissions?.sandbox !== undefined) {
        child.session.append('sandbox/mode', { mode: source.permissions.sandbox })
      }
      if (source.permissions?.approval !== undefined) {
        child.session.append('approval/policy', { policy: source.permissions.approval })
      }
      appendPluginRecord(child.session, 'plugin:side-tasks/descriptor', descriptor)
      if (contextText !== undefined) {
        const record: SideTaskContextRecord = {
          version: 1, sourceSessionId: source.id, text: contextText,
        }
        appendPluginRecord(child.session, 'plugin:side-tasks/context', record)
      }
    },
  })
  try {
    await handle.dispose()
    signal.throwIfAborted()
    return { parentSessionId: source.id, childSessionId: childId, mode: 'independent', contextThrough: -1 }
  } catch (error: unknown) {
    await handle.dispose().catch(() => undefined)
    await archiveFailed(childId).catch(() => undefined)
    throw error
  }
}

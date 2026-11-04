/** Host service for independent right-sidebar side chats. */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { createBlankSideTask, type SideTaskSource } from './blank.ts'
import { SideChatSettings } from './settings.ts'
import { discardSideTask } from './side-task.ts'
import { inheritedContextText } from './context.ts'
import type {
  ConfigureSideTaskRequest, ConfigureSideTaskResult, CreateSideTaskRequest,
  DiscardSideTaskRequest, DiscardSideTaskResult, SideTaskAddress, SideTaskCapabilities,
} from './types.ts'

export type {
  ConfigureSideTaskRequest, ConfigureSideTaskResult, CreateSideTaskRequest,
  DiscardSideTaskRequest, DiscardSideTaskResult, SideTaskAddress, SideTaskCapabilities,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { sideTasks: SideTaskService }
}

interface Observation {
  header: { readonly parentSession?: SessionId; readonly origin?: string; readonly cwd?: string; readonly agentPreset?: string }
  events: readonly SessionEvent[]
  inheritedEventCount: number
  projections?: { values: {
    modelSelection?: { next?: ModelSelection | null }
    workingDirectory?: string | null
    agentPreset?: string | null
  } }
  [Symbol.dispose](): void
}
interface Query { observeSession(id: SessionId, options: { projectionMode: 'all'; signal: AbortSignal }): Promise<Observation> }
interface Presets { resolve(id?: string): Promise<{ readonly id: string }>; mount(ctx: Context, id?: string): Promise<{ readonly id: string }> }
interface Controller {
  readonly supportsSideChatSessions?: boolean
  prompt(request: {
    readonly requestId: SessionRequestId
    readonly sessionId: SessionId
    readonly mode: 'queue' | 'steer'
    readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  }, signal: AbortSignal): Promise<{ readonly accepted: boolean }>
}
interface PermissionPresets {
  readonly defaultPreset: string
  resolve(name: string): {
    readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
    readonly approval: 'ask' | 'never'
  }
}

export class SideTaskService extends TypertRemoteService {
  static inject = ['agents', 'workspaceRegistry', 'sessionQuery', 'agentPresets', 'sessionController', 'permissionPresets']
  private readonly settings: SideChatSettings

  constructor(ctx: Context) {
    super(ctx, 'sideTasks')
    this.settings = new SideChatSettings(ctx)
  }

  @Remote({ name: 'create', resources: { session: (sourceSessionId: SessionId) => sourceSessionId } })
  async create(sourceSessionId: SessionId, request: CreateSideTaskRequest, signal: AbortSignal): Promise<SideTaskAddress> {
    const controller = this.ctx.get('sessionController') as Controller | undefined
    const presets = this.ctx.get('agentPresets') as Presets | undefined
    const permissionPresets = this.ctx.get('permissionPresets') as PermissionPresets | undefined
    if (controller?.supportsSideChatSessions !== true || typeof controller.prompt !== 'function'
      || presets === undefined || permissionPresets === undefined) {
      throw new RemoteError('side-tasks/unsupported-harness', 'This Harness does not support independent side chats.', {})
    }
    signal.throwIfAborted()
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sourceSessionId)) throw new RemoteError('side-tasks/archived-source', 'An archived parent cannot create a side chat.', {})
    const observed = await (this.ctx.sessionQuery as Query).observeSession(sourceSessionId, { projectionMode: 'all', signal })
    try {
      const { header, events } = observed
      if (header.origin !== undefined) throw new RemoteError('side-tasks/non-ordinary-source', 'Side chats require an ordinary Session.', {})
      const projected = observed.projections?.values
      const modelSelection = projected?.modelSelection?.next
      const model: AgentOptions | undefined = modelSelection === null || modelSelection === undefined
        ? undefined
        : { ...modelSelection }
      const permissionEvents = events
      const permissionPreset = permissionEvents.findLast(event => event.type === 'permission/preset')
      const sandboxMode = permissionEvents.findLast(event => event.type === 'sandbox/mode')
      const approvalPolicy = permissionEvents.findLast(event => event.type === 'approval/policy')
      const defaultPermission = permissionPresets.resolve(
        permissionPreset?.type === 'permission/preset' ? permissionPreset.data.preset : permissionPresets.defaultPreset,
      )
      const permissions = {
        preset: permissionPreset?.type === 'permission/preset' ? permissionPreset.data.preset : permissionPresets.defaultPreset,
        sandbox: sandboxMode?.type === 'sandbox/mode' ? sandboxMode.data.mode : defaultPermission?.sandbox,
        approval: approvalPolicy?.type === 'approval/policy' ? approvalPolicy.data.policy : defaultPermission?.approval,
      }
      const resolvedPreset = await presets.resolve(projected?.agentPreset ?? header.agentPreset)
      const source: SideTaskSource = {
        id: sourceSessionId,
        ...((projected?.workingDirectory ?? header.cwd) === undefined || (projected?.workingDirectory ?? header.cwd) === null
          ? {} : { cwd: projected?.workingDirectory ?? header.cwd }),
        preset: resolvedPreset.id,
        permissions,
        ...(model === undefined ? {} : { model }),
      }
      const contextText = inheritedContextText(events)
      const address = await createBlankSideTask(
        this.ctx.agents, presets, source, contextText, request.prompt, signal,
        id => this.ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }),
      )
      const prompt = request.prompt.trim()
      if (prompt !== '') {
        try {
          const result = await controller.prompt({
            requestId: randomUUID() as SessionRequestId,
            sessionId: address.childSessionId,
            mode: 'queue',
            content: [{ type: 'text', text: prompt }],
          }, signal)
          if (!result.accepted) throw new Error('The native Session controller did not accept the initial side-chat prompt.')
        } catch (error: unknown) {
          await this.ctx.workspaceRegistry.archiveSession(address.childSessionId, { stopActivity: true })
            .catch((archiveError: unknown) => console.error(`side-tasks: failed to archive rejected creation: ${String(archiveError)}`))
          throw error
        }
      }
      return address
    } catch (error) {
      throw error
    } finally {
      observed[Symbol.dispose]()
    }
  }

  @Remote('capabilities')
  capabilities(): SideTaskCapabilities {
    return { supportsSideChatSessions: (this.ctx.get('sessionController') as Controller | undefined)?.supportsSideChatSessions === true }
  }

  @Remote({ name: 'configure', resources: { session: (request: ConfigureSideTaskRequest) => [request.parentSessionId, request.childSessionId] } })
  configure(request: ConfigureSideTaskRequest, signal: AbortSignal): Promise<ConfigureSideTaskResult> {
    return this.settings.configure(request, signal)
  }

  @Remote({ name: 'discard', resources: { session: (request: DiscardSideTaskRequest) => [request.parentSessionId, request.childSessionId] } })
  discard(request: DiscardSideTaskRequest, signal: AbortSignal): Promise<DiscardSideTaskResult> {
    return this.settings.exclusive(request.childSessionId, () =>
      discardSideTask(this.ctx.agents, this.ctx.workspaceRegistry, this.ctx.sessionQuery, request, signal))
  }
}

export default SideTaskService

import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { applyChildComposition } from '@deepseek-ai/dsh-subagent'
import { inheritedContextText, parentEvents, registerInheritedContext } from './context.ts'
import { isSideTaskDescriptor } from './shared.ts'
import type { ConfigureSideTaskRequest, ConfigureSideTaskResult, SideChatModel } from './types.ts'

interface ModelResolver {
  resolveCallConfig(selection: SideChatModel, signal: AbortSignal): Promise<SideChatModel>
  resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<unknown>
}
interface Commands {
  execute(agent: Agent, line: string, attachments: readonly never[], signal: AbortSignal): Promise<{
    result: { kind: string; text?: string }
  } | undefined>
}

/** Settings belong to the exact child Agent and its own durable log. */
export class SideChatSettings {
  private readonly selections = new WeakMap<Agent, ModelSelectionRef>()
  private readonly installed = new Map<Agent, () => void>()
  private readonly contexts = new Map<Agent, () => void>()
  private readonly serial = new Map<SessionId, Promise<unknown>>()

  constructor(private readonly ctx: Context) {
    ctx.on('agent/created', ({ agent }) => this.attach(agent))
    ctx.on('agent/disposed', ({ agent }) => { this.release(agent) })
    ctx.effect(() => () => {
      for (const agent of [...this.installed.keys()]) this.release(agent)
      for (const agent of [...this.contexts.keys()]) this.release(agent)
    }, 'side-tasks: child settings middleware')
    for (const agent of ctx.agents.list()) this.attach(agent)
  }

  exclusive<T>(id: SessionId, action: () => Promise<T>): Promise<T> {
    const previous = this.serial.get(id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(action)
    this.serial.set(id, run)
    void run.finally(() => { if (this.serial.get(id) === run) this.serial.delete(id) }).catch(() => undefined)
    return run
  }

  /** Whether this Agent is one of the plugin's own side-chat children. */
  owned(agent: Agent): boolean {
    if (agent.session.header.origin !== 'subagent') return false
    return isSideTaskDescriptor(agent.session.snapshotEvents(), agent.session.inheritedEventCount)
  }

  /** Install before a resumed manager child admits its first model request. */
  restore(agent: Agent): void {
    if (this.selections.has(agent) || !this.owned(agent)) return
    const events = agent.session.snapshotEvents()
    const own = events.slice(agent.session.inheritedEventCount)
    const picked = own.findLast(event => event.type === 'model/selection')
    const lastUsed = own.findLast(event => event.type === 'request/header')
    const selection = picked?.data as SideChatModel | undefined
      ?? (lastUsed?.data as { header?: { config?: SideChatModel } } | undefined)?.header?.config
    if (selection === undefined) return
    const ref: ModelSelectionRef = { current: selection as ModelSelectionRef['current'], assembled: undefined }
    this.selections.set(agent, ref)
    this.applyOptions(agent, selection)
    this.installed.set(agent, installModelSelection(agent.ctx, ref))
  }

  private release(agent: Agent): void {
    this.installed.get(agent)?.()
    this.installed.delete(agent)
    this.contexts.get(agent)?.()
    this.contexts.delete(agent)
    this.selections.delete(agent)
  }

  /**
   * Attach child-owned settings and inherited background at creation/resume.
   * Serial creation dispatch waits for this, so the first request already sees
   * the parent conversation; failures never fail an unrelated agent.
   */
  private attach(agent: Agent): Promise<undefined> | undefined {
    try {
      if (!this.owned(agent)) return undefined
      this.restore(agent)
      const parentSessionId = agent.session.header.parentSession
      if (parentSessionId === undefined || this.contexts.has(agent)) return undefined
      const signal = AbortSignal.timeout(15_000)
      return parentEvents(this.ctx, parentSessionId, signal).then((events) => {
        const text = inheritedContextText(events)
        if (text !== undefined && !this.contexts.has(agent)) {
          this.contexts.set(agent, registerInheritedContext(agent.ctx, text))
        }
        return undefined
      }).catch(() => undefined)
    } catch {
      // A settings failure must never break creation of an unrelated Agent.
      return undefined
    }
  }

  private applyOptions(agent: Agent, selection: SideChatModel): void {
    // The manager uses these same public options for image-modality admission.
    agent.options.provider = selection.provider
    agent.options.model = selection.model
    if (selection.reasoningEffort === undefined) delete agent.options.reasoningEffort
    else agent.options.reasoningEffort = selection.reasoningEffort as never
  }

  configure(request: ConfigureSideTaskRequest, signal: AbortSignal): Promise<ConfigureSideTaskResult> {
    return this.exclusive(request.childSessionId, async () => {
      signal.throwIfAborted()
      const parent = this.ctx.agents.get(request.parentSessionId)
      if (parent === undefined) throw new Error('The direct parent is unavailable.')
      if (this.ctx.workspaceRegistry.archivedSessionIds.includes(request.childSessionId)) throw new Error('The side chat is archived.')
      const children = await this.ctx.subagents.listChildren(request.parentSessionId)
      if (!children.some(child => child.id === request.childSessionId && child.mode === 'continuable')) {
        throw new Error('The requested session is not a continuable child of this parent.')
      }
      using observed = await this.ctx.sessionQuery.observeSession(request.childSessionId, { projectionMode: 'none', signal })
      if (observed.header.parentSession !== parent.id || observed.header.origin !== 'subagent'
        || !isSideTaskDescriptor(observed.events, observed.inheritedEventCount)) {
        throw new Error('The requested child is not owned by this plugin.')
      }
      let selected: SideChatModel | undefined
      if (request.kind === 'model') {
        const llm = this.ctx.get('llm') as ModelResolver | undefined
        if (llm === undefined) throw new Error('Model service is unavailable.')
        await llm.resolveModelInfo(request.selection.provider, request.selection.model, signal)
        const resolved = await llm.resolveCallConfig(request.selection, signal)
        selected = { provider: resolved.provider, model: resolved.model,
          ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }) }
      } else {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(request.preset)) throw new Error('Invalid permission preset.')
        const presets = this.ctx.get('permissionPresets') as { resolve(name: string): unknown } | undefined
        if (presets === undefined) throw new Error('Permission presets are unavailable.')
        presets.resolve(request.preset)
      }
      signal.throwIfAborted()
      let owned: AgentHandle | undefined
      let agent = this.ctx.agents.get(request.childSessionId)
      for (let attempt = 0; agent === undefined; attempt++) {
        agent = this.ctx.agents.get(request.childSessionId)
        if (agent !== undefined) break
        try {
          owned = await this.ctx.agents.resume({
            resumeSessionId: request.childSessionId,
            parentAgent: parent,
            signal,
            setup: async (childCtx, child) => {
              if (child.session.header.parentSession !== parent.id
                || !isSideTaskDescriptor(child.session.snapshotEvents(), child.session.inheritedEventCount)) {
                throw new Error('Side-chat ownership changed.')
              }
              await applyChildComposition(childCtx, parent, {})
            },
          })
          agent = owned.agent
        } catch (error: unknown) {
          // Native admission may have acquired this identity since our read.
          // Join its published Agent; never steal or close its writer lease.
          agent = this.ctx.agents.get(request.childSessionId)
          if (agent !== undefined) break
          const message = error instanceof Error ? error.message : String(error)
          if (attempt >= 4 || !/writer|write ownership|already registered/i.test(message)) throw error
          await delay(25, undefined, { signal })
        }
      }
      try {
        if (this.ctx.workspaceRegistry.archivedSessionIds.includes(agent.id)) throw new Error('The side chat is archived.')
        if (selected !== undefined) {
          agent.session.append('model/selection', selected as never)
          this.restore(agent)
          const ref = this.selections.get(agent)
          if (ref === undefined) throw new Error('Could not install side-chat model selection.')
          ref.current = selected as ModelSelectionRef['current']
          this.applyOptions(agent, selected)
        } else if (request.kind === 'permission') {
          const commands = this.ctx.get('commands') as Commands | undefined
          if (commands === undefined) throw new Error('Permission commands are unavailable.')
          const execution = await commands.execute(agent, `/permission ${request.preset}`, [], signal)
          if (execution?.result.kind !== 'success') throw new Error(execution?.result.text ?? 'Permission change failed.')
        }
        return { configured: true }
      } finally {
        // Only dispose our temporary writer, never a manager-owned live Agent.
        await owned?.dispose()
      }
    })
  }
}

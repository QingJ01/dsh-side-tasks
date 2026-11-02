import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inheritedContextText, registerInheritedContext } from './context.ts'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { isSideTaskDescriptor, sideTaskContext } from './shared.ts'
import type { ConfigureSideTaskRequest, ConfigureSideTaskResult, SideChatModel } from './types.ts'

interface ModelResolver {
  resolveCallConfig(selection: SideChatModel, signal: AbortSignal): Promise<SideChatModel>
  resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<unknown>
}
/** Latest durable selection the child itself recorded. */
function latestSelection(agent: Agent): SideChatModel | undefined {
  const events = agent.session.snapshotEvents().slice(agent.session.inheritedEventCount)
  const selected = events.findLast(event => event.type === 'model/selection')?.data
  return selected === undefined ? undefined : {
    provider: selected.provider,
    model: selected.model,
    ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }),
  }
}

function sameSelection(left: SideChatModel, right: SideChatModel): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && (left.reasoningEffort ?? undefined) === (right.reasoningEffort ?? undefined)
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
  private readonly contexts = new Map<Agent, { text: string; dispose?: () => void }>()
  private readonly attaching = new Map<Agent, { controller: AbortController; promise: Promise<undefined> }>()
  private readonly serial = new Map<SessionId, Promise<unknown>>()
  private active = true

  constructor(private readonly ctx: Context) {
    ctx.on('agent/created', ({ agent }) => this.attach(agent))
    ctx.on('agent/disposed', ({ agent }) => { this.release(agent) })
    ctx.effect(() => () => {
      this.active = false
      for (const agent of new Set([...this.installed.keys(), ...this.contexts.keys(), ...this.attaching.keys()])) {
        this.release(agent)
      }
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
    const origin: string | undefined = agent.session.header.origin
    if (origin !== 'sidechat') return false
    return agent.session.header.parentSession === undefined
      && isSideTaskDescriptor(agent.session.snapshotEvents(), agent.session.inheritedEventCount)?.childSessionId === agent.id
  }

  /** Install before a resumed manager child admits its first model request. */
  restore(agent: Agent): void {
    if (!this.active || this.selections.has(agent) || !this.owned(agent)) return
    const events = agent.session.snapshotEvents()
    const own = events.slice(agent.session.inheritedEventCount)
    const picked = own.findLast(event => event.type === 'model/selection')
    const lastUsed = own.findLast(event => event.type === 'request/header')
    const selected = picked?.data ?? lastUsed?.data.header.config
    const selection = selected === undefined ? undefined : {
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }),
    }
    if (selection === undefined) return
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    this.selections.set(agent, ref)
    this.applyOptions(agent, selection)
    this.installed.set(agent, installModelSelection(agent.ctx, ref))
  }

  private release(agent: Agent): void {
    this.attaching.get(agent)?.controller.abort()
    this.attaching.delete(agent)
    this.installed.get(agent)?.()
    this.installed.delete(agent)
    this.contexts.get(agent)?.dispose?.()
    this.contexts.delete(agent)
    this.selections.delete(agent)
  }

  /**
   * Attach child-owned settings and inherited background at creation/resume.
   * Serial creation dispatch waits for this, so the first request already sees
   * the inherited background; source failures fail this side-chat admission.
   */
  private attach(agent: Agent): Promise<undefined> | undefined {
    try {
      if (!this.active || !this.owned(agent)) return undefined
      const pending = this.attaching.get(agent)
      if (pending !== undefined) return pending.promise
      this.restore(agent)
      if (this.contexts.has(agent)) return undefined
      const descriptor = isSideTaskDescriptor(agent.session.snapshotEvents(), agent.session.inheritedEventCount)
      if (descriptor === undefined || descriptor.childSessionId !== agent.id) return undefined
      const record = sideTaskContext(agent.session.snapshotEvents(), agent.session.inheritedEventCount, descriptor.sourceSessionId)
      let contextState: { text: string; dispose?: () => void } | undefined
      if (record !== undefined) {
        contextState = {
          text: record.text,
          ...(record.text === '' ? {} : { dispose: registerInheritedContext(agent.ctx, record.text) }),
        }
        this.contexts.set(agent, contextState)
      }
      const controller = new AbortController()
      const promise = Promise.resolve().then(async () => {
        let text = record?.text
        if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(descriptor.sourceSessionId)) {
          try {
            using source = await this.ctx.sessionQuery.observeSession(descriptor.sourceSessionId, {
              projectionMode: 'all',
              signal: controller.signal,
            })
            text = inheritedContextText(source.events) ?? ''
            if (text !== record?.text && this.active && !controller.signal.aborted) {
              appendPluginRecord(agent.session, 'plugin:side-tasks/context', {
                version: 1, sourceSessionId: descriptor.sourceSessionId, text,
              })
            }
          } catch (error: unknown) {
            if (!(error instanceof SessionQueryError) || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
          }
        }
        if (text !== undefined && this.active && !controller.signal.aborted && contextState?.text !== text) {
          contextState?.dispose?.()
          contextState = {
            text,
            ...(text === '' ? {} : { dispose: registerInheritedContext(agent.ctx, text) }),
          }
          this.contexts.set(agent, contextState)
        }
        return undefined
      }).catch(error => {
        if (!this.active || controller.signal.aborted) return undefined
        throw error
      }).finally(() => {
        if (this.attaching.get(agent)?.controller === controller) this.attaching.delete(agent)
      })
      this.attaching.set(agent, { controller, promise })
      return promise
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
    else agent.options.reasoningEffort = selection.reasoningEffort
  }

  configure(request: ConfigureSideTaskRequest, signal: AbortSignal): Promise<ConfigureSideTaskResult> {
    return this.exclusive(request.childSessionId, async () => {
      signal.throwIfAborted()
      if (this.ctx.workspaceRegistry.archivedSessionIds.includes(request.childSessionId)) throw new Error('The side chat is archived.')
      using observed = await this.ctx.sessionQuery.observeSession(request.childSessionId, { projectionMode: 'none', signal })
      const descriptor = isSideTaskDescriptor(observed.events, observed.inheritedEventCount)
      const origin: string | undefined = observed.header.origin
      if (origin !== 'sidechat' || observed.header.parentSession !== undefined
        || descriptor?.sourceSessionId !== request.parentSessionId
        || descriptor.childSessionId !== request.childSessionId) {
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
            signal,
            setup: async (childCtx, child) => {
              const origin: string | undefined = child.session.header.origin
              const childDescriptor = isSideTaskDescriptor(
                child.session.snapshotEvents(),
                child.session.inheritedEventCount,
              )
              if (origin !== 'sidechat' || child.session.header.parentSession !== undefined
                || childDescriptor?.childSessionId !== child.id
                || childDescriptor.sourceSessionId !== request.parentSessionId) {
                throw new Error('Side-chat ownership changed.')
              }
              const preset = child.session.header.agentPreset
              if (preset !== undefined) await (this.ctx.get('agentPresets') as { mount(ctx: Context, id: string): Promise<unknown> }).mount(childCtx, preset)
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
          // Re-selecting the current model must not append a duplicate
          // selection event on every menu click.
          const previous = latestSelection(agent)
          if (previous === undefined || !sameSelection(previous, selected)) {
            agent.session.append('model/selection', selected)
          }
          this.restore(agent)
          const ref = this.selections.get(agent)
          if (ref === undefined) throw new Error('Could not install side-chat model selection.')
          ref.current = selected
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

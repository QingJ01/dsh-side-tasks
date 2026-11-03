import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inheritedContextText, registerInheritedContext } from './context.ts'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { isSideTaskDescriptor, sideTaskContext } from './shared.ts'
import type { ConfigureSideTaskRequest, ConfigureSideTaskResult } from './types.ts'

interface Commands {
  execute(agent: Agent, line: string, attachments: readonly never[], signal: AbortSignal): Promise<{
    result: { kind: string; text?: string }
  } | undefined>
}

/** Settings belong to the exact child Agent and its own durable log. */
export class SideChatSettings {
  private readonly contexts = new Map<Agent, { text: string; dispose?: () => void }>()
  private readonly attaching = new Map<Agent, { controller: AbortController; promise: Promise<undefined> }>()
  private readonly outstanding = new Set<Promise<undefined>>()
  private readonly serial = new Map<SessionId, Promise<unknown>>()
  private active = true

  constructor(private readonly ctx: Context) {
    ctx.on('agent/created', ({ agent }) => this.attach(agent))
    ctx.on('agent/disposed', ({ agent }) => this.release(agent))
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (!this.owned(agent)) return next()
      try {
        await this.attach(agent)
      } catch (error: unknown) {
        this.warnAttachFailure(agent)
        throw error
      }
      return next()
    })
    ctx.effect(() => async () => {
      this.active = false
      const agents = new Set([...this.contexts.keys(), ...this.attaching.keys()])
      await Promise.allSettled([...agents].map(agent => this.release(agent)))
      await Promise.allSettled([...this.outstanding])
    }, 'side-tasks: child settings middleware')
    for (const agent of ctx.agents.list()) {
      const pending = this.attach(agent)
      if (pending !== undefined) void pending.catch(() => { this.warnAttachFailure(agent) })
    }
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

  private warnAttachFailure(agent: Agent): void {
    this.ctx.logger.warn(
      `side-tasks: child "${agent.id}": context attachment failed; side-chat admission was blocked.`,
    )
  }

  private warnContextFallback(agent: Agent): void {
    this.ctx.logger.warn(
      `side-tasks: child "${agent.id}": source context refresh failed; using saved context. Restart Harness to retry the refresh.`,
    )
  }

  private async release(agent: Agent): Promise<void> {
    const pending = this.attaching.get(agent)
    pending?.controller.abort()
    this.attaching.delete(agent)
    try {
      this.contexts.get(agent)?.dispose?.()
    } catch {
      this.ctx.logger.warn(`side-tasks: child "${agent.id}": context cleanup failed.`)
    }
    this.contexts.delete(agent)
    await pending?.promise.catch(() => undefined)
  }

  /**
   * Attach child-owned settings and inherited background at creation/resume.
   * Serial creation dispatch waits for this, so the first request already sees
   * the inherited background; source acquisition failures use a validated
   * saved context record when available and otherwise fail admission.
   */
  private attach(agent: Agent): Promise<undefined> | undefined {
    if (!this.active || !this.owned(agent)) return undefined
    const pending = this.attaching.get(agent)
    if (pending !== undefined) return pending.promise
    if (this.contexts.has(agent)) return undefined
    const descriptor = isSideTaskDescriptor(agent.session.snapshotEvents(), agent.session.inheritedEventCount)
    if (descriptor === undefined || descriptor.childSessionId !== agent.id) return undefined
    const record = sideTaskContext(
      agent.session.snapshotEvents(),
      agent.session.inheritedEventCount,
      descriptor.sourceSessionId,
    )
    const controller = new AbortController()
    const promise = Promise.resolve().then(async () => {
      if (!this.active || controller.signal.aborted) return undefined
      let contextState: { text: string; dispose?: () => void } | undefined
      if (record !== undefined) {
        contextState = {
          text: record.text,
          ...(record.text === '' ? {} : { dispose: registerInheritedContext(agent.ctx, record.text) }),
        }
        this.contexts.set(agent, contextState)
      }
      let text = record?.text
      let sourceReadFailed = false
      if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(descriptor.sourceSessionId)) {
        let source: Awaited<ReturnType<typeof this.ctx.sessionQuery.observeSession>> | undefined
        try {
          source = await this.ctx.sessionQuery.observeSession(descriptor.sourceSessionId, {
            projectionMode: 'all',
            signal: controller.signal,
          })
        } catch (error: unknown) {
          if (controller.signal.aborted) throw error
          if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
            sourceReadFailed = true
          } else if (record !== undefined) {
            sourceReadFailed = true
            this.warnContextFallback(agent)
          } else {
            throw error
          }
        }
        if (source !== undefined) {
          try {
            if (!this.active || controller.signal.aborted) return undefined
            text = inheritedContextText(source.events) ?? ''
          } finally {
            source[Symbol.dispose]()
          }
        }
        if (sourceReadFailed && record === undefined) text = undefined
      }
      if (!sourceReadFailed && text !== record?.text && this.active && !controller.signal.aborted) {
        appendPluginRecord(agent.session, 'plugin:side-tasks/context', {
          version: 1, sourceSessionId: descriptor.sourceSessionId, text: text ?? '',
        })
      }
      if (text !== undefined && this.active && !controller.signal.aborted && contextState?.text !== text) {
        const nextContext = {
          text,
          ...(text === '' ? {} : { dispose: registerInheritedContext(agent.ctx, text) }),
        }
        contextState?.dispose?.()
        contextState = nextContext
        this.contexts.set(agent, contextState)
      }
      return undefined
    }).catch(error => {
      if (!this.active || controller.signal.aborted) return undefined
      try {
        this.contexts.get(agent)?.dispose?.()
      } catch {
        this.ctx.logger.warn(`side-tasks: child "${agent.id}": context cleanup failed.`)
      }
      this.contexts.delete(agent)
      throw error
    }).finally(() => {
      if (this.attaching.get(agent)?.controller === controller) this.attaching.delete(agent)
    })
    this.attaching.set(agent, { controller, promise })
    this.outstanding.add(promise)
    void promise.then(
      () => { this.outstanding.delete(promise) },
      () => { this.outstanding.delete(promise) },
    )
    return promise
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
      if (request.kind === 'model') {
        signal.throwIfAborted()
        await this.ctx.sessionController.selectModel({ sessionId: request.childSessionId, ...request.selection })
        return { configured: true }
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(request.preset)) throw new Error('Invalid permission preset.')
      const presets = this.ctx.get('permissionPresets') as { resolve(name: string): unknown } | undefined
      if (presets === undefined) throw new Error('Permission presets are unavailable.')
      presets.resolve(request.preset)
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
        const commands = this.ctx.get('commands') as Commands | undefined
        if (commands === undefined) throw new Error('Permission commands are unavailable.')
        const execution = await commands.execute(agent, `/permission ${request.preset}`, [], signal)
        if (execution?.result.kind !== 'success') throw new Error(execution?.result.text ?? 'Permission change failed.')
        return { configured: true }
      } finally {
        // Only dispose our temporary writer, never a manager-owned live Agent.
        await owned?.dispose()
      }
    })
  }
}

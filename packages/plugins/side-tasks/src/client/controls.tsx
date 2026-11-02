import { createElement, useState, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ComposerBlock, ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import type { ISessions, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime, PropsRenderSlots, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigureSideTaskRequest, ConfigureSideTaskResult, SideChatModel, SideTaskAddress } from '../types.ts'

interface DirectoryStore {
  getSnapshot(): { current: SideChatModel | null }
  update(update: (state: { status: string; pending: SideChatModel | null; error: string | null }) => void): void
}
interface NativeModelInjection {
  available: boolean
  directory: DirectoryStore
  load(): void
  select(selection: SideChatModel): Promise<RemoteResult<void> | undefined>
}
type Configure = (request: ConfigureSideTaskRequest) => Promise<RemoteResult<ConfigureSideTaskResult>>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Native model caption fallback for the side-chat-owned toolbar entry. */
    'dsh-side-tasks.model.label': { kind: 'single'; scope: 'session'; inline: true; owner: object }
  }
}

type ModelSeatProps = PropsRuntime<'conversation.input.right'>
  & PropsRenderSlots<'dsh-side-tasks.model.label'> & {
    active: boolean
    native: ComponentType<Record<string, unknown>>
    nativeProps?: NativeModelInjection
  }

/** The actual registered DSH ModelSelect component, with child-only transport. */
function SideChatModelSeat(props: ModelSeatProps) {
  const state = props.useSession((value: SessionSnapshot) => value)
  if (!props.active || props.nativeProps === undefined) return null
  return createElement(props.native, {
    ...props, ...props.nativeProps,
    locked: state.removed
      || state.pendingSubmissions.length > 0 || state.awaitingFirstTurn,
    renderSlot: (_name: string, owner: object, options?: unknown) =>
      props.renderSlot('dsh-side-tasks.model.label', owner, options as never),
  })
}

/** Reuse DSH's preset menu and full-access confirmation, including its icons. */
function PermissionSeat({ native, ...props }: Record<string, unknown> & { native: ComponentType<Record<string, unknown>> }) {
  const [error, setError] = useState<string | undefined>()
  const session = (props.useSession as (selector: (value: SessionSnapshot) => SessionSnapshot) => SessionSnapshot)(value => value)
  const admissionPending = props.sideChatOwned === true && (session.pendingSubmissions.length > 0 || session.awaitingFirstTurn)
  const select = props.select as (preset: string) => Promise<boolean>
  return <>
    {createElement(native, { ...props, locked: props.locked === true || admissionPending, select: async (preset: string) => {
      setError(undefined)
      try { return await select(preset) } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      }
    } })}
    {error === undefined ? null : <span role="alert" style={{ color: 'var(--dsw-alias-text-error)', fontSize: 12 }}>{error}</span>}
  </>
}

/** Native menu implementations are public Slot entries; keep their component,
 * locale, and projected state, adapting only the mutation route for our children.
 * Ordinary main conversations retain their original model entry and transport.
 */
export function registerSideChatControls(
  ctx: Context,
  sessions: Pick<ISessions, 'binding' | 'refreshProjections'>,
  addresses: Map<SessionId, SideTaskAddress>,
  configure: Configure,
): void {
  const pending = new Map<SessionId, { count: number; block: ComposerBlock; previous: ComposerBlock | undefined }>()
  let alive = true
  ctx.effect(() => () => {
    alive = false
    const blocks = (ctx.get('conversation') as { blocks: ComposerBlocks } | undefined)?.blocks
    for (const [id, entry] of pending) {
      if (blocks?.storeFor(id).getSnapshot() === entry.block) blocks.set(id, entry.previous)
    }
    pending.clear()
  }, 'side-tasks: configuration send blocks')
  const configureChild: Configure = async request => {
    if (!alive) throw new Error('Side-chat controls were unloaded.')
    // Recheck synchronously: an already-open menu can outlive a Send click.
    const session = sessions.binding(request.childSessionId)?.session.getSnapshot()
    if (session === undefined) throw new Error('The side chat is no longer retained.')
    if (session.pendingSubmissions.length > 0 || session.awaitingFirstTurn) {
      throw new Error(ctx.locale.bind(NS)('settings.waitForSend'))
    }
    const conversation = ctx.get('conversation') as { blocks: ComposerBlocks } | undefined
    const blocks = conversation?.blocks
    if (blocks === undefined) throw new Error('Native conversation controls are unavailable.')
    let entry = pending.get(request.childSessionId)
    if (entry === undefined) {
      entry = { count: 0, block: { reason: ctx.locale.bind(NS)('settings.pending') },
        previous: blocks.storeFor(request.childSessionId).getSnapshot() }
      pending.set(request.childSessionId, entry)
      blocks.set(request.childSessionId, entry.block)
    }
    entry.count++
    try { return await configure(request) } finally {
      entry.count--
      if (entry.count === 0 && alive) {
        pending.delete(request.childSessionId)
        if (blocks.storeFor(request.childSessionId).getSnapshot() === entry.block) blocks.set(request.childSessionId, entry.previous)
      }
    }
  }
  const inject = (entry: StoredEntry, id: SessionId): Record<string, unknown> =>
    (entry.inject as ((sessionId: SessionId) => Record<string, unknown>) | undefined)?.(id) ?? {}

  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const install = () => {
      if (dispose !== undefined) return
      const base = ctx.slots.entries('conversation.input.model')[0]
      if (base === undefined) return
      dispose = ctx.slots.register({
        name: 'conversation.input.right', id: 'side-tasks:model', order: 100,
        locale: base.locale,
        children: { 'dsh-side-tasks.model.label': { kind: 'single', scope: 'session', inline: true } },
        inject: (sessionId: SessionId) => {
          const address = addresses.get(sessionId)
          if (address === undefined) return { active: false, native: base.component }
          const native = inject(base, sessionId) as unknown as NativeModelInjection
          const modelProps: NativeModelInjection = {
            ...native, available: true,
            load: native.load,
            select: async selection => {
              native.directory.update(state => { state.status = 'selecting'; state.pending = selection; state.error = null })
              try {
                const result = await configureChild({ parentSessionId: address.parentSessionId, childSessionId: sessionId, kind: 'model', selection })
                if (result.ok) {
                  await sessions.refreshProjections(sessionId)
                  native.directory.update(state => { state.status = 'ready'; state.pending = null; state.error = null })
                  return { ok: true, value: undefined }
                }
                native.directory.update(state => { state.status = 'error'; state.pending = null; state.error = result.error.message })
                return result
              } catch (error: unknown) {
                native.directory.update(state => { state.status = 'error'; state.pending = null; state.error = String(error) })
                throw error
              }
            },
          }
          return { active: true, native: base.component, nativeProps: modelProps }
        },
      } as never, SideChatModelSeat as never)
    }
    const unsubscribe = ctx.slots.subscribe('conversation.input.model', install)
    install()
    return () => { unsubscribe(); dispose?.() }
  }, 'side-tasks: native model selector')

  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const install = () => {
      if (dispose !== undefined) return
      const base = ctx.slots.entries('conversation.input.permission')[0]
      if (base === undefined) return
      // Registering the shadow synchronously notifies subscribers; retain an
      // installation guard before entering the registry.
      dispose = () => {}
      dispose = ctx.slots.register({
        name: 'conversation.input.permission', priority: (base.options.priority ?? 0) - 1,
        locale: base.locale,
        inject: (sessionId: SessionId) => {
          const original = inject(base, sessionId)
          const address = addresses.get(sessionId)
          if (address === undefined) return { ...original, native: base.component }
          return { ...original, native: base.component, sideChatOwned: true, select: async (preset: string) => {
            const result = await configureChild({ parentSessionId: address.parentSessionId, childSessionId: sessionId, kind: 'permission', preset })
            if (!result.ok) throw new Error(result.error.message)
            await sessions.refreshProjections(sessionId)
            return true
          } }
        },
      } as never, PermissionSeat as never)
    }
    const unsubscribe = ctx.slots.subscribe('conversation.input.permission', install)
    install()
    return () => { unsubscribe(); dispose?.() }
  }, 'side-tasks: native permission selector')
}

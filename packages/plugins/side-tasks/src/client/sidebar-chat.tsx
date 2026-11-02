/** Right-sidebar adapter for temporary side-chat sessions. */
import { useEffect, useState } from 'react'
import { SideChatPreparations } from './preparation.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionEventWindow, SessionListState, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarRightTabDefinition, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  Button,
  IconNewChatOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRenderSlots,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SideTaskAddress } from '../types.ts'
import {
  parseSideTaskChatAddress,
  SIDE_CHAT_KIND,
  SIDE_CHAT_PAGE_ADDRESS,
  sideTaskChatAddress,
  isBlankSideTaskLabel,
  sideTaskDisplayLabel,
} from '../shared.ts'
import { NS } from './locales.ts'

export const SIDE_CHAT_SLOT = 'dsh-side-tasks.conversation'
const SIDEBAR_CHAT_ID = 'dsh-side-tasks'
const SIDEBAR_CHAT_ADDRESS = 'dsh-resource://sidechat/session/'

interface SideChatResource {
  readonly address: SideTaskAddress
  readonly reference: SessionReference
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    sidebarChat: unknown
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The side-chat resource URL is malformed. */
    'sidechat/invalid-address': Record<string, never>
    /** The child session could not be retained by the browser. */
    'sidechat/retain-failed': Record<string, never>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    sidechat: SideChatResource
  }
  interface SlotMap {
    'dsh-side-tasks.conversation': { kind: 'single'; scope: 'session' }
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

export function sideChatResourceProvider(
  sessions: ISessions,
  boundaries = new Map<SessionId, number>(),
  addresses = new Map<SessionId, SideTaskAddress>(),
): ResourceProvider<'sidechat'> {
  const leases = new Map<SessionId, Set<SideTaskAddress>>()
  const publish = (id: SessionId, retained: Set<SideTaskAddress>) => {
    const latest = [...retained].at(-1)
    if (latest === undefined) {
      leases.delete(id)
      addresses.delete(id)
      boundaries.delete(id)
    } else {
      addresses.set(id, latest)
      if (latest.contextThrough === undefined) boundaries.delete(id)
      else boundaries.set(id, latest.contextThrough)
    }
  }
  return {
    protocol: 'sidechat',
    async *open(resourceAddress, { signal }) {
      const address = parseSideTaskChatAddress(resourceAddress)
      if (address === undefined) {
        yield {
          ok: false,
          error: new RemoteError('sidechat/invalid-address', `Invalid side-chat resource "${resourceAddress}".`, {}),
        }
        return
      }
      if (signal.aborted) return
      let reference: SessionReference
      try {
        reference = sessions.retain(address, { source: 'sidebarChat', signal })
      } catch (error: unknown) {
        yield {
          ok: false,
          error: new RemoteError(
            'sidechat/retain-failed',
            error instanceof Error ? error.message : String(error),
            {},
          ),
        }
        return
      }
      const retained = leases.get(address.childSessionId) ?? new Set<SideTaskAddress>()
      try {
        if (signal.aborted) return
        retained.add(address)
        leases.set(address.childSessionId, retained)
        publish(address.childSessionId, retained)
        yield { ok: true, value: { address, reference } }
        await waitForAbort(signal)
      } finally {
        retained.delete(address)
        publish(address.childSessionId, retained)
        reference.release()
      }
    },
  }
}

function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Centered temporary-chat notice shown while the child has no messages. */
export function SideChatEmptyState({ t }: Pick<PropsLocale<typeof NS>, 't'>) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 120,
      pointerEvents: 'none', textAlign: 'center',
    }}>
      <IconNewChatOutlineRegular size={34} />
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{t('empty.title')}</h2>
      <p style={{ margin: 0, opacity: 0.65 }}>{t('empty.description')}</p>
    </div>
  )
}

/** Inherited parent turns are context, not a first side-chat exchange. */
export function hasOwnSideChatTurn(window: SessionEventWindow, contextThrough: number | undefined): boolean {
  // Older resource addresses have no boundary and retain their normal view.
  if (contextThrough === undefined) return true
  return window.entries.some(({ event }) => event.seq > contextThrough && (
    event.type === 'turn/start'
    || event.type === 'assistant/message'
    || event.type === 'assistant/live-chunk'
    || (event.type === 'user/message' && event.data.source.kind === 'user')
  ))
}

function EmptyChatView() { return <div style={{ flex: '1 0 auto' }} /> }

type ConversationSlotPanelProps =
  PropsRuntime<typeof SIDE_CHAT_SLOT> & PropsRenderFactories & PropsLocale<typeof NS> & {
    readonly useSideChatOwn: <T>(selector: (own: boolean) => T) => T
  }

function ConversationSlotPanel({
  useSession, useSideChatOwn, renderFactorySlot, t,
}: ConversationSlotPanelProps) {
  const session = useSession((value: SessionSnapshot) => value)
  const own = useSideChatOwn(value => value)
  const settling = session.openState === 'loading'
    || (session.subagent?.address.mode === 'continuable' && session.subagent.parentAvailable === undefined)
  const hero = !own && !session.promptAttempted && !session.running && session.openState === 'open'
  return (
    <>
      {hero && <SideChatEmptyState t={t} />}
      {renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : 'active', hero: false }, {
        slots: { views: own || session.promptAttempted ? FixedChatConversationView : EmptyChatView },
      })}
    </>
  )
}

interface SideChatStartPageProps {
  readonly parentSessionId: SessionId
  readonly tab: SidebarRightTabInfo['tab']
  readonly preparations: SideChatPreparations
  readonly t: TranslateNS<typeof NS>
  readonly blocked?: boolean
}

/** Prepare an idle child; all editable UI comes from the native Conversation. */
export function SideChatStartPage({
  parentSessionId, tab, preparations, t, blocked = false,
}: SideChatStartPageProps) {
  const [error, setError] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (blocked) return
    let mounted = true
    setError(undefined)
    void preparations.prepare(parentSessionId, tab.id).then(result => {
      if (!mounted) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      preparations.transfer(parentSessionId, tab.id, address => {
        tab.actions.openResource(sideTaskChatAddress(address), { replaceTab: true })
      })
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    // Hiding a tab or switching parents is not closing it. The explicit close
    // handler owns cancellation and late-result cleanup across remounts.
    return () => { mounted = false }
  }, [parentSessionId, tab.id, preparations, blocked, attempt])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }} data-side-chat-preparing="">
      {blocked ? t('create.blocked') : error === undefined ? t('loading') : (
        <>
          <p role="alert">{t('create.failed', { message: error })}</p>
          <Button onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
        </>
      )}
    </div>
  )
}

type SideChatTitleProps =
  PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<typeof NS>

/** Live chip label; the static tab title remains the fallback. */
function SideChatTitle({ useTabInfo, useSessions, t }: SideChatTitleProps) {
  const { tab } = useTabInfo()
  const parsed = parseSideTaskChatAddress(tab.contentId)
  const label = useSessions((state: SessionListState) => {
    if (parsed === undefined) return undefined
    return state.projectionsBySession[parsed.parentSessionId]?.values.subagentCatalog
      ?.find(entry => entry.id === parsed.childSessionId)?.label
  })
  return label === undefined || isBlankSideTaskLabel(label)
    ? t('empty.title')
    : sideTaskDisplayLabel(label)
}

type SideChatTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<typeof SIDE_CHAT_SLOT> & PropsLocale<typeof NS>

type SideChatResourceTabProps = Omit<SideChatTabProps, 'useTabInfo'> & {
  readonly tab: SidebarRightTabInfo['tab']
}

function SideChatResourceTab({ tab, useResource, SessionProvider, renderSlot, t }: SideChatResourceTabProps) {
  const resource = useResource<'sidechat'>(tab.contentId)
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }} data-side-chat="">
      {resource.value === undefined && resource.failure !== undefined ? (
        <p role="alert" style={{ margin: 'auto', opacity: 0.8 }}>
          {t('load.failed', { message: resource.failure.message })}
        </p>
      ) : resource.value === undefined ? (
        <p style={{ margin: 'auto', opacity: 0.7 }}>{t('loading')}</p>
      ) : (
        <SessionProvider session={resource.value.reference}>
          {renderSlot(SIDE_CHAT_SLOT, {})}
        </SessionProvider>
      )}
    </div>
  )
}

function sideChatTab(preparations: SideChatPreparations) {
  return function SideChatTab(props: SideChatTabProps) {
    const { useTabInfo, useSessions, useWorkspaces, ...rest } = props
    const { tab } = useTabInfo()
    const isChild = useSessions((state: SessionListState) => state.byId[props.sessionId]?.origin === 'subagent')
    const isArchived = useWorkspaces(
      (state: { archivedSessionIds: readonly SessionId[] }) => state.archivedSessionIds.includes(props.sessionId),
    )
    if (tab.contentId === SIDE_CHAT_PAGE_ADDRESS) {
      return (
        <SideChatStartPage
          parentSessionId={props.sessionId}
          tab={tab}
          preparations={preparations}
          t={props.t}
          blocked={isChild || isArchived}
        />
      )
    }
    return <SideChatResourceTab {...rest} useSessions={useSessions} useWorkspaces={useWorkspaces} tab={tab} />
  }
}

/** Register the independent resource, tab body, guide entry, and temporary empty state. */
export function registerSideChat(
  ctx: Context,
  sessions: ISessions,
  t: TranslateNS<typeof NS>,
  preparations: SideChatPreparations,
  addresses = new Map<SessionId, SideTaskAddress>(),
): void {
  const boundaries = new Map<SessionId, number>()
  ctx.effect(() => ctx.resources.register(sideChatResourceProvider(sessions, boundaries, addresses)), 'side-tasks: chat resources')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: SIDEBAR_CHAT_ID,
    kind: SIDE_CHAT_KIND,
    patterns: [`${SIDEBAR_CHAT_ADDRESS}**`],
    canOpen: address => parseSideTaskChatAddress(address) !== undefined,
    title: (address) => {
      const parsed = parseSideTaskChatAddress(address)
      if (parsed === undefined) return t('empty.title')
      const catalog = sessions.list.getSnapshot()
        .projectionsBySession[parsed.parentSessionId]?.values.subagentCatalog
      const label = catalog?.find(
        (entry: { id: SessionId; label?: string }) => entry.id === parsed.childSessionId,
      )?.label
      return label === undefined || isBlankSideTaskLabel(label)
        ? t('empty.title')
        : sideTaskDisplayLabel(label)
    },
    guide: [{
      id: 'new',
      order: 25,
      title: () => t('empty.title'),
      description: () => t('guide.description'),
      icon: IconNewChatOutlineRegular,
    }],
  } satisfies SidebarRightTabDefinition), 'side-tasks: chat type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDEBAR_CHAT_ID,
    locale: NS,
    children: { [SIDE_CHAT_SLOT]: { kind: 'single', scope: 'session' } },
  }, sideChatTab(preparations))), 'side-tasks: chat body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: SIDEBAR_CHAT_ID,
    locale: NS,
  }, SideChatTitle)), 'side-tasks: chat title')
  ctx.effect(() => ctx.slots.inject(SIDE_CHAT_SLOT, () => ctx.slots.register({
    name: SIDE_CHAT_SLOT,
    locale: NS,
    inject: (sessionId: SessionId) => {
      const feed = sessions.binding(sessionId)?.eventSource
      return { hooks: { sideChatOwn: {
        getSnapshot: () => feed === undefined ? false : hasOwnSideChatTurn(feed.getSnapshot(), boundaries.get(sessionId)),
        subscribe: (listener: () => void) => feed?.subscribe(listener) ?? (() => {}),
      } } }
    },
  }, ConversationSlotPanel)), 'side-tasks: chat conversation')
}

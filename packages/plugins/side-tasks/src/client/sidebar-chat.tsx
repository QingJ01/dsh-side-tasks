/** Right-sidebar adapter for temporary side-chat sessions. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionListState, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationSnapshot, ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRenderSlots,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SideTaskAddress } from '../types.ts'
import { parseSideTaskChatAddress, SIDE_CHAT_KIND, sideTaskDisplayLabel } from '../shared.ts'
import { NS } from './locales.ts'

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

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    sidechat: SideChatResource
  }
  interface SlotMap {
    'sidebar.chat.conversation': { kind: 'single'; scope: 'session' }
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

function sideChatResourceProvider(sessions: ISessions): ResourceProvider<'sidechat'> {
  return {
    protocol: 'sidechat',
    async *open(resourceAddress, { signal }) {
      const address = parseSideTaskChatAddress(resourceAddress)
      if (address === undefined) throw new Error(`side-tasks: invalid chat resource "${resourceAddress}"`)
      if (signal.aborted) return
      const reference = sessions.retain(address, { source: 'sidebarChat', signal })
      try {
        yield { ok: true, value: { address, reference } }
        await waitForAbort(signal)
      } finally {
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

type ConversationSlotPanelProps =
  PropsRuntime<'sidebar.chat.conversation'> & PropsRenderFactories & PropsLocale<typeof NS>

function ConversationSlotPanel({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot, t,
}: ConversationSlotPanelProps) {
  const session = useSession((value: SessionSnapshot) => value)
  const conversation = useConversation((value: ConversationSnapshot) => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions((state: SessionListState) => state.byId[sessionId]?.blank)
  const parentAvailabilityPending = session.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : 'active'
  return (
    <>
      {hero && <SideChatEmptyState t={t} />}
      {renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero: false }, {
        slots: { views: FixedChatConversationView },
      })}
    </>
  )
}

type SideChatTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'sidebar.chat.conversation'>

function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot }: SideChatTabProps) {
  const { tab } = useTabInfo()
  const resource = useResource<'sidechat'>(tab.contentId)
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }} data-side-chat="">
      {resource.value === undefined ? null : (
        <SessionProvider session={resource.value.reference}>
          {renderSlot('sidebar.chat.conversation', {})}
        </SessionProvider>
      )}
    </div>
  )
}

/** Register the independent resource, tab body, and temporary empty state. */
export function registerSideChat(ctx: Context, t: TranslateNS<typeof NS>): void {
  ctx.effect(() => ctx.resources.register(sideChatResourceProvider(ctx.sessions)), 'side-tasks: chat resources')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: SIDEBAR_CHAT_ID,
    kind: SIDE_CHAT_KIND,
    patterns: [`${SIDEBAR_CHAT_ADDRESS}**`],
    canOpen: address => parseSideTaskChatAddress(address) !== undefined,
    title: (address) => {
      const child = parseSideTaskChatAddress(address)?.childSessionId
      if (child === undefined) return t('empty.title')
      const label = ctx.sessions.list.getSnapshot().byId[child]?.projectionValues?.subagent?.label
      return label === undefined ? t('empty.title') : sideTaskDisplayLabel(label)
    },
  } satisfies SidebarRightTabDefinition), 'side-tasks: chat type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDEBAR_CHAT_ID,
    locale: NS,
    children: { 'sidebar.chat.conversation': { kind: 'single', scope: 'session' } },
  }, SideChatTab)), 'side-tasks: chat body')
  ctx.effect(() => ctx.slots.inject('sidebar.chat.conversation', () => ctx.slots.register({
    name: 'sidebar.chat.conversation',
    locale: NS,
  }, ConversationSlotPanel)), 'side-tasks: chat conversation')
}

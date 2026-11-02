/** Right-sidebar adapter for temporary side-chat sessions. */
import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionListState, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationSnapshot, ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarRightTabDefinition, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { Button, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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
  PropsRuntime<typeof SIDE_CHAT_SLOT> & PropsRenderFactories & PropsLocale<typeof NS>

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

type CreateSideTask = (parentSessionId: SessionId, prompt: string) => Promise<RemoteResult<SideTaskAddress>>

interface SideChatStartPageProps {
  readonly parentSessionId: SessionId
  readonly createSideTask: CreateSideTask
  readonly onCreated: (address: SideTaskAddress) => void
  readonly t: TranslateNS<typeof NS>
}

/** Guide destination with the same temporary notice and a first-task composer. */
export function SideChatStartPage({
  parentSessionId, createSideTask, onCreated, t, blocked = false,
}: SideChatStartPageProps & { readonly blocked?: boolean }) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const create = async (): Promise<void> => {
    const prompt = draft.trim()
    if (prompt === '') {
      setError(t('prompt.required'))
      return
    }
    setPending(true)
    setError(undefined)
    try {
      const result = await createSideTask(parentSessionId, prompt)
      if (!result.ok) {
        setError(t('create.failed', { message: result.error.message }))
        return
      }
      onCreated(result.value)
    } catch (cause: unknown) {
      setError(t('create.failed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setPending(false)
    }
  }
  if (blocked) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }} data-side-chat-start="">
        <SideChatEmptyState t={t} />
        <p style={{
          position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          margin: 0, width: 'min(560px, calc(100% - 48px))', textAlign: 'center', opacity: 0.75,
        }}>{t('create.blocked')}</p>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} data-side-chat-start="">
      <SideChatEmptyState t={t} />
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        width: 'min(560px, calc(100% - 48px))', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <textarea
          aria-label={t('prompt.label')}
          placeholder={t('prompt.placeholder')}
          value={draft}
          disabled={pending}
          onChange={event => { setDraft(event.target.value); setError(undefined) }}
          style={{
            boxSizing: 'border-box', width: '100%', minHeight: 88, resize: 'vertical', padding: 12,
            border: '1px solid var(--dsw-alias-border-primary, #8886)', borderRadius: 12,
            color: 'var(--dsw-alias-text-primary, inherit)', background: 'var(--dsw-alias-bg-primary, transparent)',
            font: 'inherit', lineHeight: 1.5,
          }}
        />
        {error !== undefined && <p role="alert">{error}</p>}
        <Button variant="primary" disabled={pending} onClick={() => { void create() }}>
          {pending ? t('create.pending') : t('create')}
        </Button>
      </div>
    </div>
  )
}

type SideChatTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<typeof SIDE_CHAT_SLOT> & PropsLocale<typeof NS>

type SideChatResourceTabProps = Omit<SideChatTabProps, 'useTabInfo'> & {
  readonly tab: SidebarRightTabInfo['tab']
}

function SideChatResourceTab({ tab, useResource, SessionProvider, renderSlot }: SideChatResourceTabProps) {
  const resource = useResource<'sidechat'>(tab.contentId)
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }} data-side-chat="">
      {resource.value === undefined ? null : (
        <SessionProvider session={resource.value.reference}>
          {renderSlot(SIDE_CHAT_SLOT, {})}
        </SessionProvider>
      )}
    </div>
  )
}

function sideChatTab(createSideTask: CreateSideTask) {
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
          createSideTask={createSideTask}
          onCreated={(address) => { tab.actions.openResource(sideTaskChatAddress(address), { replaceTab: true }) }}
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
  createSideTask: CreateSideTask,
): void {
  ctx.effect(() => ctx.resources.register(sideChatResourceProvider(sessions)), 'side-tasks: chat resources')
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
      return label === undefined ? t('empty.title') : sideTaskDisplayLabel(label)
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
  }, sideChatTab(createSideTask))), 'side-tasks: chat body')
  ctx.effect(() => ctx.slots.inject(SIDE_CHAT_SLOT, () => ctx.slots.register({
    name: SIDE_CHAT_SLOT,
    locale: NS,
  }, ConversationSlotPanel)), 'side-tasks: chat conversation')
}

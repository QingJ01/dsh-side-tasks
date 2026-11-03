/** Browser entry for temporary, context-inheriting side chats. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import remoteContribution from 'dsh-side-tasks/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskAddress,
} from '../types.ts'
import { parseSideTaskChatAddress, SIDE_CHAT_KIND, SIDE_CHAT_PAGE_ADDRESS } from '../shared.ts'
import {
  browserDiscardStorage,
  enqueuePendingDiscard,
  flushPendingDiscards,
  removePendingDiscard,
} from './discard-queue.ts'
import { SideTaskAction } from './SideTaskAction.tsx'
import { registerSideChat } from './sidebar-chat.tsx'
import { SideChatPreparations } from './preparation.ts'
import { en, NS, zh, type SideTaskKey } from './locales.ts'

interface SideTasksRemote {
  capabilities(): Promise<RemoteResult<{ readonly supportsSideChatSessions: boolean }>>
  create(parentSessionId: SessionId, request: { prompt: string }): Promise<RemoteResult<SideTaskAddress>>
  discard(request: DiscardSideTaskRequest): Promise<RemoteResult<DiscardSideTaskResult>>
}

type SideTaskRemote = ClientContext['remote'] & { sideTasks: SideTasksRemote }
type SideChatSessions = Pick<ISessions, 'retain' | 'retainInfo' | 'list' | 'binding' | 'refreshProjections'>

function isSideChatSessions(value: unknown): value is SideChatSessions {
  if (typeof value !== 'object' || value === null) return false
  return 'retain' in value && typeof value.retain === 'function'
    && 'retainInfo' in value && typeof value.retainInfo === 'function'
    && 'list' in value && typeof value.list === 'object'
    && 'binding' in value && typeof value.binding === 'function'
    && 'refreshProjections' in value && typeof value.refreshProjections === 'function'
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sideTasks: SideTaskKey
  }
}

// `remote.sideTasks` is intentionally absent here. It is awaited inside a
// child injection so a Host-side registration failure disables this feature
// instead of leaving the whole Web boot waiting forever.
export const inject = ['slots', 'sessions', 'remote', 'locale', 'sidebarRight', 'uiWorkspace']

/** Register the header entry, side-chat tab type, and close lifecycle. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const storage = browserDiscardStorage()
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-tasks: dictionaries')
  } catch (error: unknown) {
    console.error(`side-tasks: locale registration failed: ${String(error)}`)
    return async () => {}
  }
  let unmountRemote: (() => Promise<void>) | undefined
  try {
    unmountRemote = await ctx.remote.$mount(remoteContribution)
  } catch (error: unknown) {
    console.error(`side-tasks: Remote mount failed: ${String(error)}`)
    return async () => {}
  }
  let ui: ReturnType<typeof ctx.inject> | undefined
  try {
    ui = ctx.inject(['resources', 'sidebarRightTabs', 'remote.sideTasks'], (scope) => {
    const remote = (scope.remote as SideTaskRemote).sideTasks
    const t = scope.locale.bind(NS)
    // Host and browser faces merge `Context.sessions` differently in one
    // standalone TypeScript project; the client injection owns ISessions.
    const candidate: unknown = scope.sessions
    if (!isSideChatSessions(candidate)) throw new Error(t('client.missing'))
    const sessions = candidate
    const clientCapability = scope.uiWorkspace as typeof scope.uiWorkspace & { readonly supportsSideChatSessions?: boolean }
    const createSideTask = async (parentSessionId: SessionId, prompt: string) => {
      if (clientCapability.supportsSideChatSessions !== true) {
        throw new Error(t('client.missing'))
      }
      if (typeof remote.capabilities !== 'function') throw new Error(t('host.missing'))
      const hostCapabilities = await remote.capabilities()
      if (!hostCapabilities.ok || hostCapabilities.value.supportsSideChatSessions !== true) {
        throw new Error(t('host.missing'))
      }
      if (typeof remote.create !== 'function') throw new Error(t('host.missing'))
      const result = await remote.create(parentSessionId, { prompt })
      return result
    }

    const discard = (address: SideTaskAddress) => {
      const request = { parentSessionId: address.parentSessionId, childSessionId: address.childSessionId }
      enqueuePendingDiscard(storage, request)
      void remote.discard(request).then(result => {
        if (result.ok) removePendingDiscard(storage, request)
        else console.error(`side-tasks: discard failed: ${result.error.message}`)
      }).catch((error: unknown) => {
        console.error(`side-tasks: discard failed: ${String(error)}`)
      })
    }
    const preparations = new SideChatPreparations(createSideTask, discard)
    scope.effect(() => () => { preparations.dispose() }, 'side-tasks: pending creations')
    const addresses = new Map<SessionId, SideTaskAddress>()
    registerSideChat(scope, sessions, t, preparations, addresses)
    void flushPendingDiscards(storage, request => remote.discard(request), {
      shouldSkip: request => sessions.retainInfo(request.childSessionId).getSnapshot().referenceCount > 0
        || scope.sidebarRight.openTabs.getSnapshot().some((tab: { contentId: string }) =>
          parseSideTaskChatAddress(tab.contentId)?.childSessionId === request.childSessionId),
    })

    scope.effect(() => scope.sidebarRight.registerCloseHandler(SIDE_CHAT_KIND, (parentSessionId, tab) => {
      if (tab.contentId === SIDE_CHAT_PAGE_ADDRESS) {
        preparations.close(parentSessionId, tab.id)
        return
      }
      const address = parseSideTaskChatAddress(tab.contentId)
      if (address === undefined || address.parentSessionId !== parentSessionId) {
        console.error(`side-tasks: tab "${tab.id}" does not belong to session "${parentSessionId}"`)
        return
      }
      const otherOccurrences = scope.sidebarRight.openTabs.getSnapshot().some((other: { tabId: string; contentId: string }) =>
        other.tabId !== tab.id && parseSideTaskChatAddress(other.contentId)?.childSessionId === address.childSessionId)
      if (!otherOccurrences) discard(address)
    }), 'side-tasks: close lifecycle')

    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'side-tasks',
      order: -7,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        openSideChat() {
          // Reopening the header action focuses the existing side chat instead
          // of minting another child and another tab for the same parent.
          const existing = scope.sidebarRight.openTabs.getSnapshot().find(
            (tab: { sessionId: SessionId; tabId: string; kind: string }) =>
              tab.sessionId === sessionId && tab.kind === SIDE_CHAT_KIND,
          )
          if (existing !== undefined) {
            scope.sidebarRight.focus(existing.tabId as never)
            if (!scope.sidebarRight.isExpanded()) scope.sidebarRight.toggleExpanded()
            return
          }
          scope.sidebarRight.openTab(SIDE_CHAT_KIND, { preferNewPane: false })
        },
      }),
    }, SideTaskAction))
    })
    await ui
  } catch (error: unknown) {
    await ui?.dispose().catch(() => undefined)
    await unmountRemote().catch(() => undefined)
    console.error(`side-tasks: UI registration failed: ${String(error)}`)
    return async () => {}
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

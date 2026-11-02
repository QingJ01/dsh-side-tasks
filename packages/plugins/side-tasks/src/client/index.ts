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
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {
  DiscardSideTaskRequest,
  DiscardSideTaskResult,
  SideTaskAddress,
} from '../types.ts'
import { parseSideTaskChatAddress, SIDE_CHAT_KIND, SIDE_CHAT_PAGE_ADDRESS, sideTaskChatAddress } from '../shared.ts'
import {
  browserDiscardStorage,
  enqueuePendingDiscard,
  flushPendingDiscards,
  removePendingDiscard,
} from './discard-queue.ts'
import { SideTaskAction } from './SideTaskAction.tsx'
import { registerSideChat } from './sidebar-chat.tsx'
import { en, NS, zh, type SideTaskKey } from './locales.ts'

interface SideTasksRemote {
  create(parentSessionId: SessionId, request: { prompt: string }): Promise<RemoteResult<SideTaskAddress>>
  discard(request: DiscardSideTaskRequest): Promise<RemoteResult<DiscardSideTaskResult>>
}

type SideTaskRemote = ClientContext['remote'] & { sideTasks: SideTasksRemote }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sideTasks: SideTaskKey
  }
}

// `remote.sideTasks` is intentionally absent here. It is awaited inside a
// child injection so a Host-side registration failure disables this feature
// instead of leaving the whole Web boot waiting forever.
export const inject = ['slots', 'sessions', 'remote', 'locale', 'sidebarRight']

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
    // Host and browser faces merge `Context.sessions` differently in one
    // standalone TypeScript project; the client injection owns ISessions.
    const sessions = scope.sessions as unknown as ISessions
    const createSideTask = async (parentSessionId: SessionId, prompt: string) => {
      const result = await remote.create(parentSessionId, { prompt })
      if (result.ok) {
        try {
          // The tab title is captured at open time from the projected catalog.
          // Let the new descriptor arrive before mounting the tab.
          await sessions.refreshProjections(parentSessionId)
        } catch (error: unknown) {
          console.error(`side-tasks: projection refresh failed: ${String(error)}`)
        }
      }
      return result
    }

    const discardCreatedChild = async (
      parentSessionId: SessionId,
      childSessionId: SessionId,
    ): Promise<void> => {
      const request = { parentSessionId, childSessionId }
      enqueuePendingDiscard(storage, request)
      try {
        const result = await remote.discard(request)
        if (result.ok) removePendingDiscard(storage, request)
      } catch {
        // The pending marker retries this cleanup on the next activation.
      }
    }

    registerSideChat(scope, sessions, scope.locale.bind(NS), createSideTask)
    void flushPendingDiscards(storage, request => remote.discard(request), {
      shouldSkip: request => sessions.retainInfo(request.childSessionId).getSnapshot().referenceCount > 0,
    })

    scope.effect(() => scope.sidebarRight.registerCloseHandler(SIDE_CHAT_KIND, (parentSessionId, tab) => {
      if (tab.contentId === SIDE_CHAT_PAGE_ADDRESS) return
      const address = parseSideTaskChatAddress(tab.contentId)
      if (address === undefined || address.parentSessionId !== parentSessionId) {
        console.error(`side-tasks: tab "${tab.id}" does not belong to session "${parentSessionId}"`)
        return
      }
      const request = { parentSessionId, childSessionId: address.childSessionId }
      enqueuePendingDiscard(storage, request)
      void remote.discard(request).then((result) => {
        if (result.ok) removePendingDiscard(storage, request)
        else console.error(`side-tasks: discard failed: ${result.error.message}`)
      }).catch((error: unknown) => {
        console.error(`side-tasks: discard failed: ${String(error)}`)
      })
    }), 'side-tasks: close lifecycle')

    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'side-tasks',
      order: -7,
      locale: NS,
      inject: (parentSessionId: SessionId) => ({
        async createSideTask(prompt: string) {
          const result = await createSideTask(parentSessionId, prompt)
          if (result.ok) {
            // The header action's session can differ from the currently mounted
            // one when a create round-trip overlaps a session switch.
            const tabs = scope.sidebarRight as unknown as {
              openResourceIn(
                sessionId: SessionId,
                address: string,
                options: { kind: string; preferNewPane: boolean },
              ): void
              tabsIn?(sessionId: SessionId): readonly { contentId: string }[]
            }
            const address = sideTaskChatAddress(result.value)
            try {
              tabs.openResourceIn(parentSessionId, address, {
                kind: SIDE_CHAT_KIND,
                preferNewPane: true,
              })
              await Promise.resolve()
              const placed = typeof tabs.tabsIn !== 'function'
                || tabs.tabsIn(parentSessionId).some(tab => tab.contentId === address)
              if (!placed) throw new Error('the side-chat tab was not committed')
            } catch (error: unknown) {
              await discardCreatedChild(parentSessionId, result.value.childSessionId)
              throw new Error(`The side chat was created but could not be opened: ${String(error)}`)
            }
          }
          return result
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

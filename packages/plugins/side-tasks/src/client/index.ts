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
import { SideTaskAction } from './SideTaskAction.tsx'
import { registerSideChat } from './sidebar-chat.tsx'
import { en, NS, zh, type SideTaskKey } from './locales.ts'

interface SideTasksRemote {
  create(parentSessionId: SessionId, request: { prompt: string }): Promise<RemoteResult<SideTaskAddress>>
  discard(parentSessionId: SessionId, request: DiscardSideTaskRequest): Promise<RemoteResult<DiscardSideTaskResult>>
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-tasks: dictionaries')
  let unmountRemote: (() => Promise<void>) | undefined
  try {
    unmountRemote = await ctx.remote.$mount(remoteContribution)
  } catch (error: unknown) {
    console.error(`side-tasks: Remote mount failed: ${String(error)}`)
    return async () => {}
  }
  let ui: ReturnType<typeof ctx.inject>
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

    registerSideChat(scope, sessions, scope.locale.bind(NS), createSideTask)

    scope.effect(() => scope.sidebarRight.registerCloseHandler(SIDE_CHAT_KIND, (parentSessionId, tab) => {
      if (tab.contentId === SIDE_CHAT_PAGE_ADDRESS) return
      const address = parseSideTaskChatAddress(tab.contentId)
      if (address === undefined || address.parentSessionId !== parentSessionId) {
        console.error(`side-tasks: tab "${tab.id}" does not belong to session "${parentSessionId}"`)
        return
      }
      void remote.discard(parentSessionId, {
        childSessionId: address.childSessionId,
      }).then((result) => {
        if (!result.ok) console.error(`side-tasks: discard failed: ${result.error.message}`)
      }).catch((error: unknown) => {
        console.error(`side-tasks: discard failed: ${String(error)}`)
      })
    }), 'side-tasks: close lifecycle')

    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions',
      id: 'side-tasks',
      order: 12,
      locale: NS,
      inject: (parentSessionId: SessionId) => ({
        async createSideTask(prompt: string) {
          const result = await createSideTask(parentSessionId, prompt)
          if (result.ok) {
            scope.sidebarRight.openResource(sideTaskChatAddress(result.value), {
              kind: SIDE_CHAT_KIND,
              preferNewPane: true,
            })
          }
          return result
        },
      }),
    }, SideTaskAction))
    })
  } catch (error: unknown) {
    await unmountRemote().catch(() => undefined)
    console.error(`side-tasks: UI registration failed: ${String(error)}`)
    return async () => {}
  }
  // Do not await the UI fiber: a missing optional UI service must never keep
  // the whole Web boot pending. Its failure is isolated to this feature.
  void Promise.resolve(ui).catch((error: unknown) => {
    console.error(`side-tasks: UI registration failed: ${String(error)}`)
  })
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

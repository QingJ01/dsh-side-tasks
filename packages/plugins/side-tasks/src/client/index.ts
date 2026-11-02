/** Browser entry for temporary, context-inheriting side chats. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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
import { parseSideTaskChatAddress, SIDE_CHAT_KIND, sideTaskChatAddress } from '../shared.ts'
import { SideTaskAction } from './SideTaskAction.tsx'
import { registerSideChat } from './sidebar-chat.tsx'
import { en, NS, zh, type SideTaskKey } from './locales.ts'

interface SideTasksRemote {
  create(parentSessionId: SessionId, request: { prompt: string }): Promise<RemoteResult<SideTaskAddress>>
  discard(parentSessionId: SessionId, request: DiscardSideTaskRequest): Promise<RemoteResult<DiscardSideTaskResult>>
}

type SideTaskClientContext = ClientContext & {
  remote: { sideTasks: SideTasksRemote }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sideTasks: SideTaskKey
  }
}

export const inject = ['slots', 'sessions', 'remote', 'remote.sideTasks', 'locale', 'sidebarRight']

/** Register the header entry, side-chat tab type, and close lifecycle. */
export function apply(ctx: SideTaskClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-tasks: dictionaries')
  ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
    registerSideChat(scope, ctx.locale.bind(NS))
  })
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(SIDE_CHAT_KIND, (parentSessionId, tab) => {
    const address = parseSideTaskChatAddress(tab.contentId)
    if (address === undefined || address.parentSessionId !== parentSessionId) {
      throw new Error(`side-tasks: tab "${tab.id}" does not belong to session "${parentSessionId}"`)
    }
    void ctx.remote.sideTasks.discard(parentSessionId, {
      childSessionId: address.childSessionId,
    }).then((result) => {
      if (!result.ok) console.error(`side-tasks: discard failed: ${result.error.message}`)
    }).catch((error: unknown) => {
      console.error(`side-tasks: discard failed: ${String(error)}`)
    })
  }), 'side-tasks: close lifecycle')

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'side-tasks',
    order: 12,
    locale: NS,
    inject: (parentSessionId: SessionId) => ({
      refreshSideTasks() {
        void ctx.sessions.refreshProjections(parentSessionId)
      },
      async createSideTask(prompt: string) {
        const result = await ctx.remote.sideTasks.create(parentSessionId, { prompt })
        if (result.ok) {
          void ctx.sessions.refreshProjections(parentSessionId)
          ctx.sidebarRight.openResource(sideTaskChatAddress(result.value), {
            kind: SIDE_CHAT_KIND,
            preferNewPane: true,
          })
        }
        return result
      },
      openSideTask(address: SideTaskAddress) {
        ctx.sidebarRight.openResource(sideTaskChatAddress(address), {
          kind: SIDE_CHAT_KIND,
          preferNewPane: true,
        })
      },
    }),
  }, SideTaskAction))
}

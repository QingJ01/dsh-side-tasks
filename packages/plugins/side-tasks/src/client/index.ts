/** Browser entry for context-inheriting side tasks. */
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
import type { SideTaskAddress } from '../types.ts'
import { sideTaskChatAddress } from '../shared.ts'
import { SideTaskAction } from './SideTaskAction.tsx'
import { en, NS, zh, type SideTaskKey } from './locales.ts'

interface SideTasksRemote {
  create(parentSessionId: SessionId, request: { prompt: string }): Promise<RemoteResult<SideTaskAddress>>
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

/** Register the header entry and its create/reopen actions. */
export function apply(ctx: SideTaskClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-tasks: dictionaries')
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
            kind: 'subagentchat',
            preferNewPane: true,
          })
        }
        return result
      },
      openSideTask(address: SideTaskAddress) {
        // Reopening only retains an existing child resource. It never invokes
        // Workspace.startSession, Session.fork, or the creation Remote.
        ctx.sidebarRight.openResource(sideTaskChatAddress(address), {
          kind: 'subagentchat',
          preferNewPane: true,
        })
      },
    }),
  }, SideTaskAction))
}

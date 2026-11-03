import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { isSideTaskDescriptor } from './shared.ts'
import type { DiscardSideTaskResult } from './types.ts'

interface Query {
  observeSession(id: SessionId, options: { projectionMode: 'none'; signal: AbortSignal }): Promise<{
    header: { readonly origin?: string; readonly parentSession?: SessionId }
    events: readonly SessionEvent[]
    inheritedEventCount: number
    [Symbol.dispose](): void
  }>
}

export async function discardSideTask(
  agents: Pick<AgentRegistry, 'get'>,
  workspace: Pick<WorkspaceRegistry, 'archiveSession'>,
  query: Query,
  request: { readonly parentSessionId: SessionId; readonly childSessionId: SessionId },
  signal: AbortSignal,
): Promise<DiscardSideTaskResult> {
  using observation = await query.observeSession(request.childSessionId, { projectionMode: 'none', signal })
  if (observation.header.origin === 'sidechat') {
    const descriptor = isSideTaskDescriptor(observation.events, observation.inheritedEventCount)
    if (observation.header.parentSession !== undefined || descriptor?.sourceSessionId !== request.parentSessionId
      || descriptor.childSessionId !== request.childSessionId) {
      throw new Error(`Session "${request.childSessionId}" was not created by the side-task plugin.`)
    }
  } else if (observation.header.origin === 'subagent' && observation.header.parentSession === request.parentSessionId) {
    if (agents.get(request.childSessionId) !== undefined) {
      throw new Error('Restart Harness before closing this legacy side chat; archiving a live legacy child could wake its parent.')
    }
    const legacyOwned = observation.events.slice(observation.inheritedEventCount).some(event => {
      const eventType: string = event.type
      if (eventType !== 'subagent/descriptor') return false
      const data: unknown = event.data
      return typeof data === 'object' && data !== null && 'mode' in data && data.mode === 'continuable'
        && 'provider' in data && data.provider === 'side-task'
    })
    if (!legacyOwned) throw new Error(`Session "${request.childSessionId}" was not created by the side-task plugin.`)
  } else {
    throw new Error(`Session "${request.childSessionId}" was not created by the side-task plugin.`)
  }
  await workspace.archiveSession(request.childSessionId, { stopActivity: true })
  return { discarded: true }
}

import {
  Button,
  IconNewChatOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locales.ts'

/** Actions supplied by the client plugin, keeping transport out of React. */
export interface SideTaskActionInjected {
  readonly openSideChat: () => void
}

export type SideTaskActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & SideTaskActionInjected
  & PropsLocale<typeof NS>

/** Small right-aligned header control that opens a fresh side-chat dialog. */
export function SideTaskAction({
  sessionId,
  useSessions,
  useWorkspaces,
  openSideChat,
  t,
}: SideTaskActionProps) {
  const isChild = useSessions((state: SessionListState) => state.byId[sessionId]?.origin === 'subagent')
  const archivedSessionIds = useWorkspaces(
    (state: { archivedSessionIds: readonly SessionId[] }) => state.archivedSessionIds,
  )

  if (isChild || archivedSessionIds.includes(sessionId)) return null

  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<IconNewChatOutlineRegular size={15} />}
      style={{ width: 28, padding: 0 }}
      aria-label={t('action.label')}
      title={t('action.open')}
      onClick={openSideChat}
    />
  )
}

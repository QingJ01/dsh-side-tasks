import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  Button,
  IconBranchOutlineRegular,
  IconChevronRightOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionListState, SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideTaskAddress } from '../types.ts'
import { isSideTaskLabel, sideTaskDisplayLabel } from '../shared.ts'
import { NS } from './locales.ts'

/** Actions supplied by the client plugin, keeping transport out of React. */
export interface SideTaskActionInjected {
  readonly refreshSideTasks: () => void
  readonly createSideTask: (prompt: string) => Promise<RemoteResult<SideTaskAddress>>
  readonly openSideTask: (address: SideTaskAddress) => void
}

export type SideTaskActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & SideTaskActionInjected
  & PropsLocale<typeof NS>

const textareaStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 112,
  resize: 'vertical',
  padding: 12,
  border: '1px solid var(--dsw-alias-border-primary, #8886)',
  borderRadius: 10,
  outline: 'none',
  color: 'var(--dsw-alias-text-primary, inherit)',
  background: 'var(--dsw-alias-bg-primary, transparent)',
  font: 'inherit',
  lineHeight: 1.55,
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 12,
}

const existingButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-primary, #8886)',
  borderRadius: 8,
  color: 'inherit',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
}

/** Session-header create/reopen dialog. */
export function SideTaskAction({
  sessionId,
  useSessions,
  refreshSideTasks,
  createSideTask,
  openSideTask,
  t,
}: SideTaskActionProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const isChild = useSessions((state: SessionListState) => state.byId[sessionId]?.origin === 'subagent')
  const catalog: SessionProjectionMap['subagentCatalog'] | undefined = useSessions(
    (state: SessionListState) => state.projectionsBySession[sessionId]?.values.subagentCatalog,
  )
  const sideTasks = (catalog ?? []).filter(entry => entry.mode === 'continuable' && isSideTaskLabel(entry.label))

  useEffect(() => {
    if (open) refreshSideTasks()
  }, [open, sessionId])

  if (isChild) return null

  const close = (): void => {
    if (!pending) setOpen(false)
  }

  const create = async (): Promise<void> => {
    const prompt = draft.trim()
    if (prompt === '') {
      setError(t('prompt.required'))
      return
    }
    setPending(true)
    setError(undefined)
    try {
      const result = await createSideTask(prompt)
      if (!result.ok) {
        setError(t('create.failed', { message: result.error.message }))
        return
      }
      setDraft('')
      setOpen(false)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(t('create.failed', { message }))
    } finally {
      setPending(false)
    }
  }

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!pending) void create()
    }
  }

  return (
    <>
      <Button
        variant="toolbar"
        size="sm"
        icon={<IconBranchOutlineRegular size={15} />}
        aria-label={t('action.open')}
        title={t('action.open')}
        onClick={() => { setError(undefined); setOpen(true) }}
      >
        {t('action.label')}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t('modal.title')}
        closeLabel={t('close')}
        description={t('modal.description')}
        footer={(
          <>
            <Button variant="ghost" disabled={pending} onClick={close}>{t('cancel')}</Button>
            <Button variant="primary" disabled={pending} onClick={() => { void create() }}>
              {pending ? t('create.pending') : t('create')}
            </Button>
          </>
        )}
      >
        <label htmlFor={`side-task-prompt-${sessionId}`}>{t('prompt.label')}</label>
        <textarea
          id={`side-task-prompt-${sessionId}`}
          data-modal-autofocus
          style={textareaStyle}
          value={draft}
          disabled={pending}
          placeholder={t('prompt.placeholder')}
          aria-label={t('prompt.label')}
          onChange={event => { setDraft(event.target.value); setError(undefined) }}
          onKeyDown={onPromptKeyDown}
        />
        {error !== undefined && <p role="alert">{error}</p>}
        <h3>{t('existing')}</h3>
        {sideTasks.length === 0 ? <p>{t('existing.empty')}</p> : (
          <div style={listStyle}>
            {sideTasks.map(entry => {
              const label = sideTaskDisplayLabel(entry.label ?? '')
              const address: SideTaskAddress = {
                parentSessionId: sessionId,
                childSessionId: entry.id,
                mode: 'continuable',
              }
              return (
                <button
                  type="button"
                  key={entry.id}
                  style={existingButtonStyle}
                  aria-label={t('open.aria', { label })}
                  onClick={() => {
                    openSideTask(address)
                    setOpen(false)
                  }}
                >
                  <span>{label}</span>
                  <IconChevronRightOutlineRegular size={14} />
                </button>
              )
            })}
          </div>
        )}
      </Modal>
    </>
  )
}

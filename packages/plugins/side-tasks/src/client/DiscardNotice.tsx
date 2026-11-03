import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS } from './locales.ts'

export interface DiscardNoticeState {
  readonly pending: number
  readonly busy: boolean
}

export interface DiscardNoticeFace {
  hooks: { pendingDiscards: HostObservable<DiscardNoticeState> }
  retryDiscards: () => void
}

export function DiscardNotice({ usePendingDiscards, retryDiscards, t }:
  PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<DiscardNoticeFace>) {
  const state = usePendingDiscards((value: DiscardNoticeState) => value)
  if (state.pending === 0) return null
  return <aside role="alert" style={{
    position: 'fixed', bottom: 20, right: 20, maxWidth: 'min(420px, calc(100vw - 40px))',
    padding: 16, borderRadius: 'var(--dsw-radius-lg)', background: 'var(--dsw-alias-toast-bg)',
    color: 'var(--dsw-alias-toast-label)', zIndex: 1100,
    boxShadow: 'var(--dsw-shadow-lv3)', pointerEvents: 'auto',
  }}>
    <p style={{ margin: '0 0 12px' }}>{t('discard.pending', { count: state.pending })}</p>
    <Button variant="primary" size="sm" disabled={state.busy} onClick={retryDiscards}>
      {t(state.busy ? 'discard.retrying' : 'retry')}
    </Button>
  </aside>
}

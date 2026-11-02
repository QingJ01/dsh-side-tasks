import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Structurally typed Session events: inherited context reads only first-party payloads. */
interface EventLike {
  readonly type: string
  readonly data?: unknown
}

/** Bound on inherited background so one huge parent cannot dominate every turn. */
const MAX_MESSAGES = 120
const MAX_CHARS = 100_000

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const value = block as { type?: unknown; text?: unknown }
    if (value.type === 'text' && typeof value.text === 'string') parts.push(value.text)
  }
  return parts.join('\n')
}

/** Messages up to the parent's last completed turn; an in-flight turn is excluded. */
export function completedEvents(events: readonly EventLike[]): readonly EventLike[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/end') return events.slice(0, index + 1)
  }
  return []
}

/**
 * Render a parent conversation as background context. The child keeps its own
 * transcript: the parent's turns never become displayed events or counted
 * usage, so the side chat opens empty and its footer reports its own work.
 */
export function inheritedContextText(events: readonly EventLike[]): string | undefined {
  const messages: string[] = []
  for (const event of completedEvents(events)) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const data = (event.data ?? {}) as {
      readonly content?: unknown
      readonly message?: { readonly content?: unknown }
      readonly source?: { readonly kind?: unknown }
    }
    // Only human input and the model's replies belong in inherited background.
    if (event.type === 'user/message' && data.source?.kind !== 'user') continue
    const text = textOf(event.type === 'assistant/message' ? data.message?.content : data.content).trim()
    if (text === '') continue
    messages.push(`${event.type === 'user/message' ? 'User' : 'Assistant'}:\n${text}`)
  }
  if (messages.length === 0) return undefined
  let body = messages.slice(-MAX_MESSAGES).join('\n\n')
  if (body.length > MAX_CHARS) body = body.slice(-MAX_CHARS)
  return [
    'This side chat inherits the conversation it was opened from. Its completed messages follow',
    'as background. Continue the work from here; do not summarize them unless the user asks.',
    '',
    body,
  ].join('\n')
}

/** Register the background as per-agent runtime context (never a transcript event). */
export function registerInheritedContext(agentCtx: Context, text: string): () => void {
  const systemPrompt = agentCtx.get('systemPrompt') as {
    getContextOrder(name: 'SUBAGENT_DELEGATION'): number
    context(contribution: { name: string; order: number; text: () => string }): () => void
  } | undefined
  if (systemPrompt === undefined) return () => {}
  return systemPrompt.context({
    name: 'side-task:parent-context',
    order: systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 1,
    text: () => text,
  })
}

/** Read a parent conversation through whichever live or durable source exists. */
export async function parentEvents(
  ctx: Context,
  parentSessionId: SessionId,
  signal: AbortSignal,
): Promise<readonly EventLike[]> {
  const live = ctx.agents.get(parentSessionId)
  if (live !== undefined) return live.session.snapshotEvents() as readonly EventLike[]
  const query = ctx.get('sessionQuery') as {
    observeSession(id: SessionId, options: { projectionMode: 'none'; signal: AbortSignal }): Promise<{
      events: readonly EventLike[]
      [Symbol.dispose]?: () => void
    }>
  } | undefined
  if (query === undefined) return []
  const observed = await query.observeSession(parentSessionId, { projectionMode: 'none', signal })
  try {
    return observed.events
  } finally {
    observed[Symbol.dispose]?.()
  }
}

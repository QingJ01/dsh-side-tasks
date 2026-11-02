import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SideTaskAddress } from '../types.ts'

interface Preparation {
  promise: Promise<RemoteResult<SideTaskAddress>>
  address?: SideTaskAddress
  closed: boolean
  transferred: boolean
  discarded: boolean
}

/** One create per tab occurrence, independent of React effects and rerenders.
 * Late accepted results after close are discarded rather than reopening a tab.
 */
export class SideChatPreparations {
  private readonly entries = new Map<string, Preparation>()
  constructor(
    private readonly create: (parent: SessionId, prompt: string) => Promise<RemoteResult<SideTaskAddress>>,
    private readonly discard: (address: SideTaskAddress) => void,
  ) {}

  private key(parent: SessionId, tab: string): string { return JSON.stringify([parent, tab]) }

  prepare(parent: SessionId, tab: string): Promise<RemoteResult<SideTaskAddress>> {
    const key = this.key(parent, tab)
    const existing = this.entries.get(key)
    if (existing !== undefined) return existing.promise
    const entry: Preparation = { promise: undefined as never, closed: false, transferred: false, discarded: false }
    // Register synchronously before any transport or component callback runs.
    this.entries.set(key, entry)
    entry.promise = Promise.resolve().then(() => this.create(parent, '')).then(result => {
      if (result.ok) {
        entry.address = result.value
        if (entry.closed) this.discardOnce(entry)
      } else if (this.entries.get(key) === entry) this.entries.delete(key)
      return result
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    })
    return entry.promise
  }

  transfer(parent: SessionId, tab: string, navigate: (address: SideTaskAddress) => void): void {
    const entry = this.entries.get(this.key(parent, tab))
    if (entry === undefined || entry.closed || entry.transferred || entry.address === undefined) return
    // Replacing the draft fires its close handler synchronously. Mark the
    // ownership transfer first so that replacement does not archive the child.
    entry.transferred = true
    try { navigate(entry.address) } catch (error: unknown) {
      entry.transferred = false
      this.discardOnce(entry)
      this.entries.delete(this.key(parent, tab))
      throw error
    }
  }

  close(parent: SessionId, tab: string): void {
    const key = this.key(parent, tab)
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.delete(key)
    entry.closed = true
    if (!entry.transferred) this.discardOnce(entry)
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.closed = true
      if (!entry.transferred) this.discardOnce(entry)
    }
    this.entries.clear()
  }

  private discardOnce(entry: Preparation): void {
    if (entry.address === undefined || entry.discarded) return
    entry.discarded = true
    this.discard(entry.address)
  }
}

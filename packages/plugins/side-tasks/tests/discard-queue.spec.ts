import { describe, expect, it, vi } from 'vitest'
import {
  browserDiscardStorage,
  createDiscardQueue,
  enqueuePendingDiscard,
  flushPendingDiscards,
  readPendingDiscards,
  removePendingDiscard,
  type DiscardStorage,
} from '../src/client/discard-queue.ts'

function memoryStorage(): DiscardStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

const request = {
  parentSessionId: 'parent' as never,
  childSessionId: 'child' as never,
}

describe('pending discard queue', () => {
  it('deduplicates and removes acknowledged requests', () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    enqueuePendingDiscard(storage, request)
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining(request)])
    removePendingDiscard(storage, request)
    expect(readPendingDiscards(storage)).toEqual([])
    expect(storage.values.size).toBe(0)
  })

  it('retries failed archives and clears successful ones', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    const failed = vi.fn(async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'offline' } }))
    await flushPendingDiscards(storage, failed as never)
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining(request)])

    const succeeded = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    await flushPendingDiscards(storage, succeeded as never)
    expect(readPendingDiscards(storage)).toEqual([])
    expect(succeeded).toHaveBeenCalledWith(request)
  })

  it('treats a throwing localStorage getter as unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('blocked') },
    })
    try {
      expect(browserDiscardStorage()).toBeUndefined()
    } finally {
      if (descriptor === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
      else Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('never lets storage failures block the immediate close', () => {
    const broken: DiscardStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(() => enqueuePendingDiscard(broken, request)).not.toThrow()
    expect(readPendingDiscards(broken)).toEqual([])
    expect(() => removePendingDiscard(broken, request)).not.toThrow()
  })

  it('keeps the marker when the Remote call throws', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    await flushPendingDiscards(storage, async () => { throw new Error('connection lost') })
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining(request)])
  })

  it('retains terminal, exhausted, and old markers for explicit retry', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    await flushPendingDiscards(storage, async () => ({
      ok: false as const,
      error: { code: 'gateway/bad-request', message: 'no longer a child' },
    }) as never)
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining({ ...request, attempts: 1, terminal: true })])

    removePendingDiscard(storage, request)
    enqueuePendingDiscard(storage, request)
    const transient = async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'offline' } })
    await flushPendingDiscards(storage, transient as never, { maxAttempts: 1 })
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining({ ...request, attempts: 1, terminal: false })])
  })

  it('keeps a marker while the child is still retained elsewhere', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    const discard = vi.fn()
    await flushPendingDiscards(storage, discard, { shouldSkip: () => true })
    expect(discard).not.toHaveBeenCalled()
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining(request)])
  })

  it('preserves new closes and acknowledgements while a retry is awaiting RPC', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    const pending = Promise.withResolvers<never>()
    const flush = flushPendingDiscards(storage, () => pending.promise)
    const other = { ...request, childSessionId: 'other' as never }
    enqueuePendingDiscard(storage, other)
    removePendingDiscard(storage, request)
    pending.resolve({ ok: false, error: { code: 'gateway/internal' } } as never)
    await flush
    expect(readPendingDiscards(storage)).toEqual([expect.objectContaining(other)])
  })

  it('does not expire markers by their original creation time', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    const first = readPendingDiscards(storage)[0]!
    storage.setItem('dsh-side-tasks:pending-discards:v1', JSON.stringify([
      { ...first, createdAt: 10, updatedAt: 900 },
    ]))
    const discard = vi.fn(async () => { throw new Error('still unavailable') })
    await flushPendingDiscards(storage, discard, { now: 1000 })
    expect(discard).toHaveBeenCalledOnce()
    expect(readPendingDiscards(storage)).toEqual([
      expect.objectContaining({ ...request, createdAt: 10, attempts: 1 }),
    ])
  })

  it('clamps corrupt attempt counts so a bad record cannot bypass the retry bound', () => {
    const storage = memoryStorage()
    storage.setItem('dsh-side-tasks:pending-discards:v1', JSON.stringify([
      { ...request, attempts: -3, createdAt: 1, updatedAt: 1 },
      { ...request, childSessionId: 'second', attempts: 2.5, createdAt: 1, updatedAt: 1 },
      { ...request, childSessionId: 'third', attempts: Number.POSITIVE_INFINITY, createdAt: 1, updatedAt: 1 },
    ]))
    expect(readPendingDiscards(storage).map(row => row.attempts)).toEqual([0, 0, 0])
  })

  it('keeps markers another client enqueued between its own successful writes', () => {
    const storage = memoryStorage()
    const queue = createDiscardQueue({ storage, discard: vi.fn() as never, shouldSkip: () => true })
    try {
      queue.enqueue(request)
      const other = { ...request, childSessionId: 'other' as never }
      enqueuePendingDiscard(storage, other)
      queue.enqueue({ ...request, childSessionId: 'third' as never })
      expect(readPendingDiscards(storage).map(row => row.childSessionId)).toEqual(['child', 'other', 'third'])
    } finally {
      queue.stop()
    }
  })

  it('revalidates a forced close queued behind a stalled request and rechecks it with a bounded schedule', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const stalled = Promise.withResolvers<never>()
    const second = { ...request, childSessionId: 'second' as never }
    let reopened = true
    const discard = vi.fn((input: typeof request) =>
      input.childSessionId === request.childSessionId
        ? stalled.promise
        : Promise.resolve({ ok: true, value: { discarded: true } } as never))
    const queue = createDiscardQueue({
      storage,
      discard: discard as never,
      shouldSkip: input => input.childSessionId === second.childSessionId && reopened,
      canForce: input => !(input.childSessionId === second.childSessionId && reopened),
    })
    try {
      queue.enqueue(request, true)
      await vi.advanceTimersByTimeAsync(0)
      queue.enqueue(second, true)
      stalled.resolve({ ok: true, value: { discarded: true } } as never)
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(1)
      // Rechecks stay bounded while the child remains retained elsewhere.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(discard).toHaveBeenCalledTimes(1)
      expect(readPendingDiscards(storage).map(row => row.childSessionId)).toEqual(['second'])

      reopened = false
      queue.reset()
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(2)
      expect(readPendingDiscards(storage)).toEqual([])
    } finally {
      await queue.dispose()
      vi.useRealTimers()
    }
  })

  it('auto-retries a transient close in the same client lifetime', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const discard = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
      .mockResolvedValueOnce({ ok: true, value: { discarded: true } })
    const queue = createDiscardQueue({ storage, discard: discard as never })
    try {
      queue.enqueue(request, true)
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(1)
      expect(queue.hooks.pendingDiscards.getSnapshot()).toEqual({ pending: 1, busy: false })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(discard).toHaveBeenCalledTimes(2)
      expect(queue.hooks.pendingDiscards.getSnapshot()).toEqual({ pending: 0, busy: false })
    } finally {
      await queue.dispose()
      vi.useRealTimers()
    }
  })

  it('starts a fresh bounded burst on reconnect after exhaustion and manual retry clears terminal rows', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const discard = vi.fn(async () => ({
      ok: false as const, error: { code: 'gateway/internal', message: 'offline' },
    }))
    const queue = createDiscardQueue({ storage, discard: discard as never })
    try {
      queue.enqueue(request, true)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(discard).toHaveBeenCalledTimes(5)
      expect(readPendingDiscards(storage)).toEqual([expect.objectContaining({ attempts: 5 })])

      discard.mockResolvedValue({ ok: true, value: { discarded: true } })
      queue.reset()
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(6)
      expect(readPendingDiscards(storage)).toEqual([])

      enqueuePendingDiscard(storage, request)
      discard.mockResolvedValue({
        ok: false, error: { code: 'gateway/bad-request', message: 'terminal' },
      } as never)
      queue.enqueue(request, true)
      await vi.advanceTimersByTimeAsync(0)
      expect(readPendingDiscards(storage)).toEqual([expect.objectContaining({ terminal: true })])
      const callsAtTerminal = discard.mock.calls.length
      discard.mockResolvedValue({ ok: true, value: { discarded: true } })
      queue.reset()
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(callsAtTerminal)
      queue.retry()
      await vi.advanceTimersByTimeAsync(0)
      expect(discard).toHaveBeenCalledTimes(callsAtTerminal + 1)
      expect(readPendingDiscards(storage)).toEqual([])
    } finally {
      await queue.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps an in-memory marker and retries when storage is unavailable', async () => {
    vi.useFakeTimers()
    const broken: DiscardStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const discard = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
      .mockResolvedValueOnce({ ok: true, value: { discarded: true } })
    const queue = createDiscardQueue({ storage: broken, discard: discard as never })
    try {
      queue.enqueue(request, true)
      await vi.advanceTimersByTimeAsync(0)
      expect(queue.hooks.pendingDiscards.getSnapshot().pending).toBe(1)
      expect(warn).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(discard).toHaveBeenCalledTimes(2)
      expect(queue.hooks.pendingDiscards.getSnapshot().pending).toBe(0)
    } finally {
      await queue.dispose()
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('serializes close requests and awaits the in-flight RPC before disposal', async () => {
    const storage = memoryStorage()
    const pending = Promise.withResolvers<never>()
    const other = { ...request, childSessionId: 'other' as never }
    const discard = vi.fn(() => pending.promise)
    const queue = createDiscardQueue({ storage, discard: discard as never })
    queue.enqueue(request, true)
    await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce())
    queue.enqueue(other, true)
    let disposed = false
    const disposal = queue.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    pending.resolve({ ok: false, error: { code: 'gateway/internal' } } as never)
    await disposal
    expect(discard).toHaveBeenCalledOnce()
    expect(readPendingDiscards(storage).map(row => row.childSessionId)).toEqual(['child', 'other'])
  })

  it('keeps markers for active references elsewhere', async () => {
    const storage = memoryStorage()
    const skip = vi.fn(() => true)
    const discard = vi.fn(async () => ({ ok: true as const, value: { discarded: true as const } }))
    const queue = createDiscardQueue({ storage, discard, shouldSkip: skip })
    queue.enqueue(request)
    await Promise.resolve()
    await Promise.resolve()
    expect(discard).not.toHaveBeenCalled()
    expect(queue.hooks.pendingDiscards.getSnapshot().pending).toBe(1)
    await queue.dispose()
  })
})

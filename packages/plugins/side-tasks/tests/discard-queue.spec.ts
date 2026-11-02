import { describe, expect, it, vi } from 'vitest'
import {
  browserDiscardStorage,
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

  it('drops terminal bad requests and exhausted retries', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    await flushPendingDiscards(storage, async () => ({
      ok: false as const,
      error: { code: 'gateway/bad-request', message: 'no longer a child' },
    }) as never)
    expect(readPendingDiscards(storage)).toEqual([])

    enqueuePendingDiscard(storage, request)
    const transient = async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'offline' } })
    await flushPendingDiscards(storage, transient as never, { maxAttempts: 1 })
    expect(readPendingDiscards(storage)).toEqual([])
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

  it('expires by original creation time even after recent failures', async () => {
    const storage = memoryStorage()
    enqueuePendingDiscard(storage, request)
    const first = readPendingDiscards(storage)[0]!
    storage.setItem('dsh-side-tasks:pending-discards:v1', JSON.stringify([
      { ...first, createdAt: 10, updatedAt: 900 },
    ]))
    const discard = vi.fn()
    await flushPendingDiscards(storage, discard, { now: 1000, maxAgeMs: 500 })
    expect(discard).not.toHaveBeenCalled()
    expect(readPendingDiscards(storage)).toEqual([])
  })
})

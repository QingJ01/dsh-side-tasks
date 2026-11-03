import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DiscardSideTaskRequest, DiscardSideTaskResult } from '../types.ts'

const STORAGE_KEY = 'dsh-side-tasks:pending-discards:v1'
const MAX_ATTEMPTS = 5
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const

/** Minimal synchronous storage surface used by the durable close queue. */
export interface DiscardStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A close request plus its bounded retry metadata. */
export interface PendingDiscard extends DiscardSideTaskRequest {
  readonly attempts: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly terminal: boolean
}

/** Reading the storage getter itself can throw in a blocked/opaque origin. */
export function browserDiscardStorage(): DiscardStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parse(value: string | null): PendingDiscard[] {
  if (value === null) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    const rows: PendingDiscard[] = []
    for (const row of parsed) {
      if (!isRecord(row) || typeof row.parentSessionId !== 'string' || typeof row.childSessionId !== 'string') continue
      rows.push({
        parentSessionId: row.parentSessionId as SessionId,
        childSessionId: row.childSessionId as SessionId,
        attempts: typeof row.attempts === 'number' ? row.attempts : 0,
        createdAt: typeof row.createdAt === 'number' ? row.createdAt
          : typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
        terminal: row.terminal === true,
      })
    }
    return rows
  } catch {
    return []
  }
}

function keyOf(request: DiscardSideTaskRequest): string {
  return `${request.parentSessionId}\u0000${request.childSessionId}`
}

function write(storage: DiscardStorage, rows: readonly PendingDiscard[]): void {
  try {
    if (rows.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch {
    // The queue is best-effort and must never block the immediate RPC.
  }
}

/** Read and validate the durable pending-discard set. */
export function readPendingDiscards(storage: DiscardStorage | undefined): PendingDiscard[] {
  if (storage === undefined) return []
  try {
    return parse(storage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

/** Add one request before issuing its Remote call. */
export function enqueuePendingDiscard(
  storage: DiscardStorage | undefined,
  request: DiscardSideTaskRequest,
): void {
  if (storage === undefined) return
  const current = readPendingDiscards(storage)
  if (current.some(row => keyOf(row) === keyOf(request))) return
  const now = Date.now()
  write(storage, [...current, { ...request, attempts: 0, createdAt: now, updatedAt: now, terminal: false }])
}

/** Remove one acknowledged request. */
export function removePendingDiscard(
  storage: DiscardStorage | undefined,
  request: DiscardSideTaskRequest,
): void {
  if (storage === undefined) return
  write(storage, readPendingDiscards(storage).filter(row => keyOf(row) !== keyOf(request)))
}

/** Update one marker without replacing changes made while its RPC was pending. */
export function updatePendingDiscard(
  storage: DiscardStorage | undefined,
  request: DiscardSideTaskRequest,
  update: (row: PendingDiscard) => PendingDiscard,
): void {
  if (storage === undefined) return
  const rows = readPendingDiscards(storage)
  write(storage, rows.map(row => keyOf(row) === keyOf(request) ? update(row) : row))
}

/** Options for one serial pass over pending archive markers. */
export interface FlushPendingDiscardsOptions {
  readonly now?: number
  readonly maxAttempts?: number
  readonly maxAgeMs?: number
  readonly request?: DiscardSideTaskRequest
  readonly force?: boolean
  readonly shouldSkip?: ((request: DiscardSideTaskRequest) => boolean) | undefined
}

/**
 * Attempt pending archives once. Successful markers are removed; failed,
 * terminal, exhausted, and old markers remain for explicit retry.
 */
export async function flushPendingDiscards(
  storage: DiscardStorage | undefined,
  discard: (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>,
  options: FlushPendingDiscardsOptions = {},
): Promise<void> {
  if (storage === undefined) return
  const now = options.now ?? Date.now()
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const pending = readPendingDiscards(storage)
  for (const row of pending) {
    const request = { parentSessionId: row.parentSessionId, childSessionId: row.childSessionId }
    if (options.request !== undefined && keyOf(request) !== keyOf(options.request)) continue
    if (!options.force && (row.terminal === true || row.attempts >= maxAttempts)) continue
    if (!options.force && options.shouldSkip?.(request) === true) continue
    let result: RemoteResult<DiscardSideTaskResult> | undefined
    try {
      result = await discard(request)
    } catch {
      // The marker remains durable for a later bounded retry.
    }
    if (result?.ok === true) {
      removePendingDiscard(storage, request)
      continue
    }
    const terminal = result !== undefined && !result.ok && result.error.code === 'gateway/bad-request'
    const current = readPendingDiscards(storage)
    const latest = current.find(item => keyOf(item) === keyOf(row))
    if (latest === undefined || latest.attempts !== row.attempts || latest.updatedAt !== row.updatedAt) continue
    updatePendingDiscard(storage, request, item => ({
      ...item,
      attempts: item.attempts + 1,
      updatedAt: now,
      ...(terminal ? { terminal: true } : {}),
    }))
  }
}

export interface DiscardQueueSnapshot {
  readonly pending: number
  readonly busy: boolean
}

export interface DiscardQueueObservable {
  getSnapshot(): DiscardQueueSnapshot
  subscribe(listener: () => void): () => void
}

export interface DiscardQueue {
  readonly hooks: { readonly pendingDiscards: DiscardQueueObservable }
  enqueue(request: DiscardSideTaskRequest, forceFirstAttempt?: boolean): void
  retry(): void
  reset(): void
  dispose(): Promise<void>
}

interface DiscardQueueOptions {
  readonly storage?: DiscardStorage | undefined
  readonly discard: (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>
  readonly shouldSkip?: ((request: DiscardSideTaskRequest) => boolean) | undefined
}

class ResilientDiscardStorage implements DiscardStorage {
  private memory: string | null | undefined
  private warned = false

  constructor(private readonly durable: DiscardStorage | undefined) {
    if (durable === undefined) this.warn()
  }

  getItem(key: string): string | null {
    if (this.memory !== undefined) return this.memory
    try {
      return this.durable?.getItem(key) ?? null
    } catch {
      this.warn()
      return null
    }
  }

  setItem(key: string, value: string): void {
    this.memory = value
    try {
      this.durable?.setItem(key, value)
    } catch {
      this.warn()
    }
  }

  removeItem(key: string): void {
    this.memory = null
    try {
      this.durable?.removeItem(key)
    } catch {
      this.warn()
    }
  }

  private warn(): void {
    if (this.warned) return
    this.warned = true
    console.warn('side-tasks: local storage is unavailable; pending closes will retry while this application remains open.')
  }
}

/**
 * Own one client's pending-close lifecycle, including durable markers,
 * reconnect/manual triggers, bounded retry bursts, and disposal ordering.
 */
export function createDiscardQueue(options: DiscardQueueOptions): DiscardQueue {
  const storage = new ResilientDiscardStorage(options.storage)
  const listeners = new Set<() => void>()
  let snapshot: DiscardQueueSnapshot = { pending: readPendingDiscards(storage).length, busy: false }
  let running: Promise<void> | undefined
  let rerun = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAt: number | undefined
  let disposed = false
  let inFlightKey: string | undefined
  const forceFirst = new Set<string>()

  const publish = (): void => {
    const next = { pending: readPendingDiscards(storage).length, busy: snapshot.busy }
    if (next.pending === snapshot.pending && next.busy === snapshot.busy) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const setBusy = (busy: boolean): void => {
    if (snapshot.busy === busy) return
    snapshot = { ...snapshot, busy }
    for (const listener of listeners) listener()
  }
  const schedule = (attempts: number): void => {
    if (disposed || attempts >= MAX_ATTEMPTS) return
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 8_000
    const nextAt = Date.now() + delay
    if (retryAt !== undefined && retryAt <= nextAt) return
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryAt = nextAt
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      retryAt = undefined
      start()
    }, delay)
  }
  const drain = async (): Promise<void> => {
    if (disposed) return
    setBusy(true)
    const seen = new Set<string>()
    try {
      while (!disposed) {
        const row = readPendingDiscards(storage).find(item => !seen.has(keyOf(item)))
        if (row === undefined) break
        const request = { parentSessionId: row.parentSessionId, childSessionId: row.childSessionId }
        const key = keyOf(request)
        seen.add(key)
        const force = forceFirst.delete(key)
        inFlightKey = key
        await flushPendingDiscards(storage, options.discard, {
          request,
          force,
          shouldSkip: options.shouldSkip,
        })
        if (inFlightKey === key) inFlightKey = undefined
        const latest = readPendingDiscards(storage).find(item => keyOf(item) === key)
        if (latest !== undefined && latest.attempts > row.attempts && latest.terminal !== true) {
          schedule(latest.attempts)
        }
        publish()
      }
    } finally {
      inFlightKey = undefined
      setBusy(false)
      publish()
    }
  }
  function start(): void {
    if (disposed) return
    if (running !== undefined) {
      rerun = true
      return
    }
    const task = drain().catch(() => {
      console.error('side-tasks: discard queue stopped unexpectedly; pending markers remain available for retry.')
    }).finally(() => {
      if (running === task) running = undefined
      if (rerun && !disposed) {
        rerun = false
        start()
      }
    })
    running = task
  }
  const queue: DiscardQueue = {
    hooks: {
      pendingDiscards: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    enqueue(request, forceFirstAttempt = false) {
      enqueuePendingDiscard(storage, request)
      if (forceFirstAttempt && inFlightKey !== keyOf(request)) forceFirst.add(keyOf(request))
      publish()
      start()
    },
    retry() {
      if (disposed) return
      const now = Date.now()
      for (const row of readPendingDiscards(storage)) {
        updatePendingDiscard(storage, row, item => ({
          ...item, attempts: 0, updatedAt: now, terminal: false,
        }))
      }
      publish()
      start()
    },
    reset() {
      if (disposed) return
      const now = Date.now()
      for (const row of readPendingDiscards(storage)) {
        if (row.terminal === true) continue
        updatePendingDiscard(storage, row, item => ({ ...item, attempts: 0, updatedAt: now }))
      }
      publish()
      start()
    },
    async dispose() {
      disposed = true
      rerun = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      retryTimer = undefined
      retryAt = undefined
      await running
      publish()
    },
  }
  start()
  return queue
}

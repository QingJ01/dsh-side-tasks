import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DiscardSideTaskRequest, DiscardSideTaskResult } from '../types.ts'

const STORAGE_KEY = 'dsh-side-tasks:pending-discards:v1'
const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Minimal synchronous storage surface used by the durable close queue. */
export interface DiscardStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A close request plus its bounded retry metadata. */
export interface PendingDiscard extends DiscardSideTaskRequest {
  readonly attempts: number
  readonly updatedAt: number
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
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
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
  write(storage, [...current, { ...request, attempts: 0, updatedAt: Date.now() }])
}

/** Remove one acknowledged request. */
export function removePendingDiscard(
  storage: DiscardStorage | undefined,
  request: DiscardSideTaskRequest,
): void {
  if (storage === undefined) return
  write(storage, readPendingDiscards(storage).filter(row => keyOf(row) !== keyOf(request)))
}

/** Options that keep retries bounded and avoid archiving a child in active use. */
export interface FlushPendingDiscardsOptions {
  readonly now?: number
  readonly maxAttempts?: number
  readonly maxAgeMs?: number
  readonly shouldSkip?: (request: DiscardSideTaskRequest) => boolean
}

/**
 * Retry pending archives. Markers are dropped on success, terminal bad
 * requests, exhausted attempts, or age, so a dead entry cannot live forever.
 */
export async function flushPendingDiscards(
  storage: DiscardStorage | undefined,
  discard: (request: DiscardSideTaskRequest) => Promise<RemoteResult<DiscardSideTaskResult>>,
  options: FlushPendingDiscardsOptions = {},
): Promise<void> {
  if (storage === undefined) return
  const now = options.now ?? Date.now()
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS
  const pending = readPendingDiscards(storage)
  const keep: PendingDiscard[] = []
  for (const row of pending) {
    const request = { parentSessionId: row.parentSessionId, childSessionId: row.childSessionId }
    try {
      if (options.shouldSkip?.(request) === true) {
        keep.push(row)
        continue
      }
      const result = await discard(request)
      if (result.ok) continue
      if (result.error.code === 'gateway/bad-request') continue
    } catch {
      // Retry a transient failure below.
    }
    const attempts = row.attempts + 1
    if (attempts >= maxAttempts || now - row.updatedAt >= maxAgeMs) continue
    keep.push({ ...row, attempts, updatedAt: now })
  }
  write(storage, keep)
}

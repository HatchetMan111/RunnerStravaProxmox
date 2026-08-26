import { api } from '../api/client'
import {
  deleteOp,
  deletePendingFile,
  enqueueOp,
  getPendingFile,
  listOps,
  savePendingFile,
  updateOp,
} from '../db/idb'
import type { OutboxOp } from '../db/idb'

type Listener = () => void

const listeners = new Set<Listener>()
let syncing = false
let initialized = false

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  listeners.forEach((listener) => listener())
}

export async function pendingCount(): Promise<number> {
  return (await listOps()).length
}

export async function queueActivity(payload: unknown, label: string): Promise<void> {
  await enqueueOp({
    operation_id: crypto.randomUUID(),
    kind: 'activity.create',
    payload,
    created_at: Date.now(),
    attempts: 0,
    next_attempt_at: 0,
    last_error: null,
    label,
  })
  emit()
  scheduleDrain()
}

export async function queueFileImport(file: File, label: string): Promise<void> {
  const operationId = crypto.randomUUID()
  await savePendingFile(operationId, file, file.name)
  await enqueueOp({
    operation_id: operationId,
    kind: 'import.file',
    created_at: Date.now(),
    attempts: 0,
    next_attempt_at: 0,
    last_error: null,
    label,
  })
  emit()
  scheduleDrain()
}

export function scheduleDrain(delayMs = 250): void {
  setTimeout(() => {
    void drain()
  }, delayMs)
}

export function initEngine(): void {
  if (initialized) return
  initialized = true
  window.addEventListener('online', () => scheduleDrain(500))
  setInterval(() => {
    if (navigator.onLine) scheduleDrain()
  }, 60_000)
}

export async function drain(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    for (;;) {
      const ops = (await listOps()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
      const now = Date.now()
      const next = ops.find((op) => op.next_attempt_at <= now)
      if (!next) break

      next.attempts += 1
      await updateOp(next)
      emit()

      try {
        const done = await processOp(next)
        if (done) {
          await deleteOp(next.id as number)
          if (next.kind === 'import.file') await deletePendingFile(next.operation_id)
        }
        emit()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const backoffSeconds = Math.min(5 * 2 ** next.attempts, 300)
        next.last_error = message
        next.next_attempt_at = Date.now() + backoffSeconds * 1000
        await updateOp(next)
        emit()
        if (!navigator.onLine || isNetworkError(message)) break
      }
    }
  } finally {
    syncing = false
    emit()
  }
}

function isNetworkError(message: string): boolean {
  return (
    message.includes('fetch') ||
    message.includes('NetworkError') ||
    message.includes('Failed to fetch') ||
    message.includes('network')
  )
}

async function processOp(op: OutboxOp): Promise<boolean> {
  if (op.kind === 'activity.create') {
    const response = await api.post<{
      results: Array<{ status: string; error?: string }>
    }>('/api/v1/sync', {
      operations: [
        {
          operation_id: op.operation_id,
          kind: 'activity.create',
          payload: op.payload,
        },
      ],
    })
    const result = response.results[0]
    if (result.status === 'accepted' || result.status === 'duplicate') return true
    throw new PermanentSyncError(result.error || `rejected: ${result.status}`)
  }

  if (op.kind === 'import.file') {
    const stored = await getPendingFile(op.operation_id)
    if (!stored) return true
    const form = new FormData()
    form.append('file', stored.blob, stored.filename)
    const response = await api.post<{ status: string; error?: string }>(
      '/api/v1/imports',
      form,
      { 'X-Operation-Id': op.operation_id }
    )
    if (response.status === 'imported' || response.status === 'duplicate_file') return true
    throw new PermanentSyncError(response.error || `rejected: ${response.status}`)
  }

  return true
}

class PermanentSyncError extends Error {}

export async function retryFailedNow(): Promise<void> {
  const ops = await listOps()
  for (const op of ops) {
    op.next_attempt_at = 0
    op.last_error = null
    op.attempts = 0
    await updateOp(op)
  }
  emit()
  scheduleDrain()
}

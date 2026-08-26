export interface OutboxOp {
  id?: number
  operation_id: string
  kind: 'activity.create' | 'import.file'
  payload?: unknown
  created_at: number
  attempts: number
  next_attempt_at: number
  last_error: string | null
  label: string
}

const DB_NAME = 'localtrack'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('ops')) {
        const store = db.createObjectStore('ops', { keyPath: 'id', autoIncrement: true })
        store.createIndex('operation_id', 'operation_id', { unique: true })
        store.createIndex('status', 'status', { unique: false })
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'operation_id' })
      }
      if (!db.objectStoreNames.contains('draft')) {
        db.createObjectStore('draft', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (storesMap: Record<string, IDBObjectStore>) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(stores, mode)
        const map: Record<string, IDBObjectStore> = {}
        for (const name of stores) map[name] = transaction.objectStore(name)
        const request = run(map)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
  )
}

export async function enqueueOp(op: Omit<OutboxOp, 'id'>): Promise<void> {
  await tx(['ops'], 'readwrite', ({ ops }) => ops.add(op as OutboxOp))
}

export async function listOps(): Promise<OutboxOp[]> {
  return tx(['ops'], 'readonly', ({ ops }) => ops.getAll() as IDBRequest<OutboxOp[]>)
}

export async function updateOp(op: OutboxOp): Promise<void> {
  await tx(['ops'], 'readwrite', ({ ops }) => ops.put(op))
}

export async function deleteOp(id: number): Promise<void> {
  await tx(['ops'], 'readwrite', ({ ops }) => ops.delete(id as unknown as IDBValidKey))
}

export async function savePendingFile(operationId: string, blob: Blob, filename: string): Promise<void> {
  await tx(['files'], 'readwrite', ({ files }) =>
    files.put({ operation_id: operationId, blob, filename })
  )
}

export async function getPendingFile(
  operationId: string
): Promise<{ operation_id: string; blob: Blob; filename: string } | undefined> {
  return tx(['files'], 'readonly', ({ files }) => files.get(operationId))
}

export async function deletePendingFile(operationId: string): Promise<void> {
  await tx(['files'], 'readwrite', ({ files }) => files.delete(operationId))
}

export interface RecordingDraft {
  key: string
  points: Array<{
    t: number
    lat: number | null
    lon: number | null
    alt: number | null
    speed: number | null
  }>
  started_at_epoch_s: number
  sport_type: string
  updated_at: number
}

export async function saveDraft(draft: Omit<RecordingDraft, 'key' | 'updated_at'>): Promise<void> {
  await tx(['draft'], 'readwrite', ({ draft: store }) =>
    store.put({ ...draft, key: 'current', updated_at: Date.now() })
  )
}

export async function loadDraft(): Promise<RecordingDraft | undefined> {
  const value = await tx(['draft'], 'readonly', ({ draft }) => draft.get('current'))
  return value as RecordingDraft | undefined
}

export async function clearDraft(): Promise<void> {
  await tx(['draft'], 'readwrite', ({ draft }) => draft.delete('current'))
}

export function newOperationId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return (
    'op-' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}

import {
  DETAILED_CHART_STORAGE_KEY,
  type DetailedChartPayload,
} from './detailPayload'

const DETAIL_IDB_NAME = 'data-visualizer-detail-store'
const DETAIL_IDB_STORE = 'detail_payloads'
const DETAIL_IDB_KEY = 'latest'

type SaveDetailLocation = 'localStorage' | 'indexedDB'

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

function openDetailDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DETAIL_IDB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DETAIL_IDB_STORE)) {
        db.createObjectStore(DETAIL_IDB_STORE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB for detail payload.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
  })
}

export async function saveDetailedPayload(payload: DetailedChartPayload): Promise<SaveDetailLocation> {
  const serialized = JSON.stringify(payload)

  try {
    localStorage.setItem(DETAILED_CHART_STORAGE_KEY, serialized)
    return 'localStorage'
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error
    }
  }

  if (typeof indexedDB === 'undefined') {
    throw new Error('Browser storage is full and IndexedDB is unavailable.')
  }

  const db = await openDetailDb()
  try {
    const transaction = db.transaction(DETAIL_IDB_STORE, 'readwrite')
    const store = transaction.objectStore(DETAIL_IDB_STORE)
    store.put(serialized, DETAIL_IDB_KEY)
    await transactionDone(transaction)
  } finally {
    db.close()
  }

  try {
    localStorage.removeItem(DETAILED_CHART_STORAGE_KEY)
  } catch {
    // Ignore localStorage cleanup failures.
  }

  return 'indexedDB'
}

export async function loadDetailedPayload(): Promise<DetailedChartPayload | null> {
  try {
    const raw = localStorage.getItem(DETAILED_CHART_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DetailedChartPayload
      if (parsed && parsed.version === 1) {
        return parsed
      }
    }
  } catch {
    // Ignore malformed localStorage payload.
  }

  if (typeof indexedDB === 'undefined') {
    return null
  }

  const db = await openDetailDb()
  try {
    const transaction = db.transaction(DETAIL_IDB_STORE, 'readonly')
    const store = transaction.objectStore(DETAIL_IDB_STORE)

    const raw = await new Promise<unknown>((resolve, reject) => {
      const request = store.get(DETAIL_IDB_KEY)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to read detail payload from IndexedDB.'))
    })

    if (typeof raw !== 'string') {
      return null
    }

    const parsed = JSON.parse(raw) as DetailedChartPayload
    return parsed && parsed.version === 1 ? parsed : null
  } finally {
    db.close()
  }
}

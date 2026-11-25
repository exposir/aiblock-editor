import { WORKSPACE_STORAGE_KEY } from './page-store'
import { isImageAssetMetadata } from './asset-format'
import type { ImageAssetMetadata } from './asset-format'
import { readWorkspaceAssetReferences, selectOrphanAssetIds } from './asset-gc'
import { isPageId, isWorkspaceCommit, isWorkspaceIndex, splitLegacyWorkspace } from './workspace-format'
import type { PageShard, WorkspaceCommit, WorkspaceIndex, WorkspacePersistence } from './workspace-format'

const databaseName = 'aiblock-editor'
const indexKey = 'workspace'
const fallbackIndex = `${WORKSPACE_STORAGE_KEY}.v2.index`
const fallbackPage = (id: string) => `${WORKSPACE_STORAGE_KEY}.v2.page.${id}`

export function openWorkspaceDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      for (const store of ['meta', 'pages', 'assets']) request.result.createObjectStore(store)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Workspace database upgrade is blocked'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (blocked) { database.close(); return }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function idbCommit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Workspace transaction aborted'))
  })
}

export function listIndexedAssetMetadata(store: IDBObjectStore, useLastSave = false): Promise<ImageAssetMetadata[]> {
  return new Promise((resolve, reject) => {
    const entries: ImageAssetMetadata[] = []
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(entries); return }
      const metadata: unknown = cursor.value?.metadata
      const lastSavedAt: unknown = cursor.value?.lastSavedAt
      if (!isImageAssetMetadata(metadata) || cursor.key !== metadata.id) {
        reject(new Error('Invalid stored image asset'))
        return
      }
      if (lastSavedAt !== undefined && (typeof lastSavedAt !== 'number' || !Number.isFinite(lastSavedAt))) {
        reject(new Error('Invalid image save timestamp'))
        return
      }
      entries.push(useLastSave && lastSavedAt !== undefined ? { ...metadata, createdAt: lastSavedAt } : metadata)
      cursor.continue()
    }
  })
}

function verifiedIndex(value: unknown): WorkspaceIndex {
  if (!isWorkspaceIndex(value)) throw new Error('Invalid workspace index')
  return value
}

function fallbackStorage(storage: Storage | null): WorkspacePersistence {
  const write = ({ index, pages, removedPageIds }: WorkspaceCommit) => {
    if (!storage) throw new Error('Workspace storage is unavailable')
    for (const page of pages) storage.setItem(fallbackPage(page.id), JSON.stringify(page))
    if (index) storage.setItem(fallbackIndex, JSON.stringify(index))
    for (const id of removedPageIds) storage.removeItem(fallbackPage(id))
  }
  return {
    async readIndex() {
      const index = storage?.getItem(fallbackIndex)
      if (index != null) return verifiedIndex(JSON.parse(index))
      const raw = storage?.getItem(WORKSPACE_STORAGE_KEY)
      const legacy = raw ? splitLegacyWorkspace(raw) : null
      if (!legacy) return null
      write({ ...legacy, removedPageIds: [] })
      try { storage?.removeItem(WORKSPACE_STORAGE_KEY) } catch { /* The fallback index is now authoritative. */ }
      return legacy.index
    },
    async readPage(id) {
      if (!isPageId(id)) throw new TypeError('Invalid page ID')
      return JSON.parse(storage?.getItem(fallbackPage(id)) ?? 'null') as PageShard | null
    },
    async commit(changes) {
      if (!isWorkspaceCommit(changes)) throw new TypeError('Invalid workspace changes')
      write(changes)
    },
  }
}

export function browserWorkspaceStorage(
  storage: Storage | null,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): WorkspacePersistence {
  if (!factory) return fallbackStorage(storage)
  let opened: Promise<IDBDatabase> | undefined
  const database = () => opened ??= openWorkspaceDatabase(factory).catch(error => { opened = undefined; throw error })
  return {
    async readIndex() {
      const db = await database()
      const saved = await idbResult(db.transaction('meta').objectStore('meta').get(indexKey))
      if (saved !== undefined) return verifiedIndex(saved)
      // A denied localStorage read must not stop an IndexedDB-only workspace from opening.
      let raw: string | null = null
      let fallbackRaw: string | null = null
      try {
        raw = storage?.getItem(WORKSPACE_STORAGE_KEY) ?? null
        fallbackRaw = storage?.getItem(fallbackIndex) ?? null
      } catch {}
      const fallback = fallbackRaw === null ? null : verifiedIndex(JSON.parse(fallbackRaw))
      const legacy = !fallback && raw ? splitLegacyWorkspace(raw) : null
      if (!legacy && !fallback) return null
      const pages = legacy?.pages ?? [...fallback!.pages, ...fallback!.trash ?? []].map(page =>
        JSON.parse(storage!.getItem(fallbackPage(page.id)) ?? 'null') as PageShard)
      const index = legacy?.index ?? fallback!
      if (!isWorkspaceCommit({ index, pages, removedPageIds: [] })) throw new Error('Invalid migrated workspace')
      const transaction = db.transaction(['meta', 'pages'], 'readwrite')
      const finished = idbCommit(transaction)
      const meta = transaction.objectStore('meta')
      const existing = meta.get(indexKey)
      existing.onsuccess = () => {
        if (existing.result !== undefined) return
        const shards = transaction.objectStore('pages')
        for (const page of pages) shards.put(page, page.id)
        meta.put(index, indexKey)
      }
      await finished
      if (existing.result !== undefined) return verifiedIndex(existing.result)
      try {
        if (legacy || (fallback && raw)) storage?.removeItem(WORKSPACE_STORAGE_KEY)
        if (fallback) {
          storage?.removeItem(fallbackIndex)
          for (const page of pages) storage?.removeItem(fallbackPage(page.id))
        }
      } catch { /* The committed IndexedDB index prevents a second migration. */ }
      return index
    },
    async readPage(id) {
      if (!isPageId(id)) throw new TypeError('Invalid page ID')
      const db = await database()
      return await idbResult(db.transaction('pages').objectStore('pages').get(id)) ?? null
    },
    async commit(changes) {
      if (!isWorkspaceCommit(changes)) throw new TypeError('Invalid workspace changes')
      const db = await database()
      const stores = changes.index ? ['meta'] : []
      if (changes.pages.length || changes.removedPageIds.length) stores.push('pages')
      if (!stores.length) return
      const transaction = db.transaction(stores, 'readwrite')
      const finished = idbCommit(transaction)
      try {
        if (changes.index) transaction.objectStore('meta').put(changes.index, indexKey)
        for (const page of changes.pages) transaction.objectStore('pages').put(page, page.id)
        for (const id of changes.removedPageIds) transaction.objectStore('pages').delete(id)
        transaction.commit?.()
      } catch (error) {
        transaction.abort()
        await finished.catch(() => {})
        throw error
      }
      await finished
    },
    async pruneOrphanAssets(graceMs, protectedIds) {
      if (graceMs !== undefined && (!Number.isFinite(graceMs) || graceMs < 0)) throw new TypeError('Invalid asset grace period')
      const db = await database()
      const transaction = db.transaction(['meta', 'pages', 'assets'], 'readwrite')
      const finished = idbCommit(transaction)
      try {
        const index = verifiedIndex(await idbResult(transaction.objectStore('meta').get(indexKey)))
        const pages = transaction.objectStore('pages')
        const referenced = await readWorkspaceAssetReferences(index, async id => await idbResult(pages.get(id)) ?? null, protectedIds)
        const assets = transaction.objectStore('assets')
        const stored = await listIndexedAssetMetadata(assets, true)
        const orphans = selectOrphanAssetIds(stored, referenced, Date.now(), graceMs)
        for (const id of orphans) assets.delete(id)
        await finished
        return { removedCount: orphans.length, keptCount: stored.length - orphans.length }
      } catch (error) {
        try { transaction.abort() } catch { /* Already finished. */ }
        await finished.catch(() => {})
        throw error
      }
    },
  }
}

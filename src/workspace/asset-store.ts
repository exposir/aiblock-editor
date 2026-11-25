import { getDesktopBridge } from '../desktop/bridge'
import { imageAssetMetadata, imageAssetUrlPrefix, isAssetId, isImageAssetMetadata, maxImageBytes, validateImageInput } from './asset-format'
import type { ImageAssetInput, ImageAssetMetadata } from './asset-format'
import { idbCommit, idbResult, openWorkspaceDatabase } from './workspace-storage'

type BlobImageInput = Omit<ImageAssetInput, 'bytes'> & { readonly blob: Blob }

export interface AssetUrlLease {
  readonly url: Promise<string | null>
  release(): void
}

export interface AssetStore {
  saveImageAsset(input: ImageAssetInput | BlobImageInput): Promise<ImageAssetMetadata>
  readImageAssets(ids: readonly string[]): Promise<readonly (ImageAssetMetadata | null)[]>
  acquireAssetUrl(id: string): AssetUrlLease
  resolveAssetUrl(id: string): Promise<string | null>
  releaseAssetUrl(id: string): void
}

interface StoredImage { readonly metadata: ImageAssetMetadata; readonly blob: Blob }
interface BlobLease {
  references: number
  promise: Promise<string | null>
  url?: string
}

const leasesByDatabase = new WeakMap<IDBFactory, Map<string, BlobLease>>()

function assetIds(ids: readonly string[]) {
  if (ids.length > 200 || !Array.from(ids).every(isAssetId)) throw new TypeError('Invalid asset IDs')
  return [...ids]
}

async function imageBytes(input: ImageAssetInput | BlobImageInput): Promise<ImageAssetInput> {
  if (!('blob' in input)) return input
  if (input.blob.size > maxImageBytes) throw new TypeError('Image asset is too large')
  const { blob, ...metadata } = input
  return { ...metadata, bytes: new Uint8Array(await blob.arrayBuffer()) }
}

export function createBrowserAssetStore(factory: IDBFactory | undefined = globalThis.indexedDB): AssetStore {
  let opened: Promise<IDBDatabase> | undefined
  const leases = (factory ? leasesByDatabase.get(factory) : undefined) ?? new Map<string, BlobLease>()
  if (factory) leasesByDatabase.set(factory, leases)
  function database() {
    if (!factory) throw new Error('Image storage requires IndexedDB')
    return opened ??= openWorkspaceDatabase(factory).catch(error => { opened = undefined; throw error })
  }

  async function loadImages(ids: readonly string[]): Promise<(StoredImage | null)[]> {
    if (!ids.length) return []
    const store = (await database()).transaction('assets').objectStore('assets')
    return Promise.all(ids.map(async id => {
      const found: StoredImage | undefined = await idbResult(store.get(id))
      if (!found) return null
      if (!isImageAssetMetadata(found.metadata) || found.metadata.id !== id ||
          found.blob?.size !== found.metadata.byteLength || found.blob.type !== found.metadata.mime) {
        throw new Error('Invalid stored image asset')
      }
      return found
    }))
  }

  function acquireAssetUrl(id: string): AssetUrlLease {
    if (!isAssetId(id)) return { url: Promise.reject(new TypeError('Invalid asset ID')), release() {} }
    let entry = leases.get(id)
    if (entry) {
      entry.references++
    } else {
      const lease: BlobLease = {
        references: 1,
        promise: loadImages([id]).then(([image]) => {
          if (!image || leases.get(id) !== lease) {
            if (leases.get(id) === lease) leases.delete(id)
            return null
          }
          return lease.url = URL.createObjectURL(image.blob)
        }).catch(error => {
          if (leases.get(id) === lease) leases.delete(id)
          throw error
        }),
      }
      leases.set(id, entry = lease)
    }
    const lease = entry
    let released = false
    return {
      url: lease.promise,
      release() {
        if (released) return
        released = true
        if (--lease.references > 0) return
        if (leases.get(id) === lease) leases.delete(id)
        if (lease.url) URL.revokeObjectURL(lease.url)
      },
    }
  }

  const legacyLeases = new Map<string, Set<AssetUrlLease>>()
  return {
    async saveImageAsset(input) {
      const image = await imageBytes(input)
      validateImageInput(image)
      const bytes = image.bytes.slice()
      const subtle = globalThis.crypto?.subtle
      if (!subtle) throw new Error('Image storage requires Web Crypto in a secure context')
      const hash = await subtle.digest('SHA-256', bytes)
      const metadata = imageAssetMetadata({ ...image, bytes },
        Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''))
      const transaction = (await database()).transaction('assets', 'readwrite')
      const finished = idbCommit(transaction)
      const store = transaction.objectStore('assets')
      const request = store.get(metadata.id)
      request.onsuccess = () => {
        if (request.result === undefined) store.add({ metadata, blob: new Blob([bytes], { type: metadata.mime }) }, metadata.id)
      }
      await finished
      return (request.result as StoredImage | undefined)?.metadata ?? metadata
    },
    async readImageAssets(ids) {
      return (await loadImages(assetIds(ids))).map(image => image?.metadata ?? null)
    },
    acquireAssetUrl,
    resolveAssetUrl(id) {
      const lease = acquireAssetUrl(id)
      const entries = legacyLeases.get(id) ?? new Set<AssetUrlLease>()
      legacyLeases.set(id, entries)
      entries.add(lease)
      const forget = () => {
        entries.delete(lease)
        if (!entries.size && legacyLeases.get(id) === entries) legacyLeases.delete(id)
        lease.release()
      }
      void lease.url.then(url => { if (!url) forget() }, forget)
      return lease.url
    },
    releaseAssetUrl(id) {
      const entries = legacyLeases.get(id)
      const lease = entries?.values().next().value
      if (!lease || !entries) return
      entries.delete(lease)
      if (!entries.size) legacyLeases.delete(id)
      lease.release()
    },

  }
}

export function createAssetStore(bridge = getDesktopBridge()): AssetStore {
  if (!bridge) return createBrowserAssetStore()
  const resolve = async (id: string) => {
    const [metadata] = await bridge.readImageAssets(assetIds([id]))
    return metadata ? `${imageAssetUrlPrefix}${id}` : null
  }
  return {
    async saveImageAsset(input) { return bridge.saveImageAsset(await imageBytes(input)) },
    async readImageAssets(ids) { return bridge.readImageAssets(assetIds(ids)) },
    acquireAssetUrl: id => ({ url: resolve(id), release() {} }),
    resolveAssetUrl: resolve,
    releaseAssetUrl() {},
  }
}

/** Maintenance only. Call after closing all editors/tabs and checking persisted references. */
export async function removeBrowserImageAssets(ids: readonly string[], factory = globalThis.indexedDB): Promise<void> {
  const checked = assetIds(ids)
  if (!factory) throw new Error('Image storage requires IndexedDB')
  const db = await openWorkspaceDatabase(factory)
  try {
    if (checked.some(id => leasesByDatabase.get(factory)?.has(id))) throw new Error('Image assets are in use')
    const transaction = db.transaction('assets', 'readwrite')
    const finished = idbCommit(transaction)
    for (const id of checked) transaction.objectStore('assets').delete(id)
    await finished
  } finally {
    db.close()
  }
}

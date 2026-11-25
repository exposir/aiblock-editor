import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { imageHeaderSize } from '../editor/extensions/image-header.js'
import { detectImageMime, imageAssetMetadata, isAssetId, isImageAssetMetadata, maxImageBytes, validImageDimensions, validateImageInput } from './asset-format.js'
import type { ImageAssetInput, ImageAssetMetadata } from './asset-format.js'
import { assetGraceMs, readWorkspaceAssetReferences, selectOrphanAssetIds } from './asset-gc.js'
import type { PageShard } from './workspace-format.js'
import { writeAtomicFile, writeAtomicText } from './workspace-files.js'
import type { WorkspaceFiles } from './workspace-files.js'

function operationQueue() {
  let operations = Promise.resolve()
  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = operations.then(operation)
      operations = next.then(() => {}, () => {})
      return next
    },
    drain: () => operations,
  }
}

async function openStoredFile(path: string, followSymlinks = false) {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (followSymlinks ? 0 : constants.O_NOFOLLOW))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readBounded(path: string, limit: number, followSymlinks = false) {
  const file = await openStoredFile(path, followSymlinks)
  if (!file) return null
  try {
    const stats = await file.stat()
    if (!stats.isFile() || stats.size > limit) throw new TypeError(`Invalid file type or size (maximum ${limit} bytes)`)
    const bytes = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset)
      if (!bytesRead) throw new Error('Stored file changed while reading')
      offset += bytesRead
    }
    return bytes
  } finally {
    await file.close()
  }
}

async function readJSON(path: string, limit: number): Promise<unknown> {
  const bytes = await readBounded(path, limit)
  return bytes === null ? undefined : JSON.parse(bytes.toString('utf8'))
}

type StoredImageMetadata = ImageAssetMetadata & { lastSavedAt?: number }

export async function readImageImport(path: string): Promise<ImageAssetInput | null> {
  const bytes = await readBounded(path, maxImageBytes, true)
  if (!bytes) return null
  const mime = detectImageMime(bytes)
  const dimensions = mime && imageHeaderSize(bytes, mime)
  if (!mime || !dimensions) throw new TypeError('无法识别图片格式或尺寸。')
  return { bytes, mime, ...dimensions, name: basename(path).slice(0, 255) }
}

export function openImageAssetFiles(workspaceDirectory: string) {
  const queue = operationQueue()
  const directory = join(workspaceDirectory, 'assets')
  const imagePath = (id: string) => join(directory, id)
  const metaPath = (id: string) => join(directory, `${id}.json`)

  async function readStoredMetadata(id: string): Promise<StoredImageMetadata | null> {
    const metadata = await readJSON(metaPath(id), 4096) as StoredImageMetadata | undefined
    if (metadata === undefined) return null
    if (!isImageAssetMetadata(metadata) || metadata.id !== id ||
        (metadata.lastSavedAt !== undefined && !Number.isFinite(metadata.lastSavedAt))) throw new Error('Invalid asset metadata')
    return metadata
  }

  async function readMetadata(id: string) {
    const stored = await readStoredMetadata(id)
    if (!stored) return null
    const { lastSavedAt: _lastSavedAt, ...metadata } = stored
    return metadata
  }

  function importImage(input: unknown, dryRun = false) {
    return queue.enqueue(async () => {
      validateImageInput(input)
      const header = imageHeaderSize(input.bytes, input.mime)
      if (!header || !validImageDimensions(header.width, header.height)) throw new TypeError('Invalid image header dimensions')
      const metadata = imageAssetMetadata(input, createHash('sha256').update(input.bytes).digest('hex'))
      const existing = await readMetadata(metadata.id)
      if (dryRun) return { asset: existing ?? metadata, created: !existing }
      const now = Date.now()
      if (existing) {
        const file = await lstat(imagePath(metadata.id)).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (!file?.isFile() || file.size !== metadata.byteLength) await writeAtomicFile(imagePath(metadata.id), input.bytes)
        await writeAtomicText(metaPath(metadata.id), JSON.stringify({ ...existing, lastSavedAt: now }))
        return { asset: existing, created: false }
      }
      const asset = { ...metadata, createdAt: now }
      await writeAtomicFile(imagePath(metadata.id), input.bytes)
      await writeAtomicText(metaPath(metadata.id), JSON.stringify(asset))
      return { asset, created: true }
    })
  }

  return {
    importImage,
    async save(input: unknown) { return (await importImage(input)).asset },
    async readMetadata(ids: unknown) {
      if (!Array.isArray(ids) || ids.length > 200 || !Array.from(ids).every(isAssetId)) throw new TypeError('Invalid asset IDs')
      return Promise.all(ids.map(readMetadata))
    },
    listMetadata: () => queue.enqueue(async () => {
      const files = await readdir(directory).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })
      const entries = []
      for (const name of files.sort()) {
        const id = name.endsWith('.json') ? name.slice(0, -5) : null
        if (!isAssetId(id)) continue
        const metadata = await readStoredMetadata(id)
        if (metadata) entries.push(metadata)
      }
      return entries
    }),
    async openImage(id: string) {
      if (!isAssetId(id)) return null
      const metadata = await readMetadata(id)
      if (!metadata) return null
      const file = await openStoredFile(imagePath(id))
      if (!file) return null
      let ready = false
      try {
        const stats = await file.stat()
        if (!stats.isFile() || stats.size !== metadata.byteLength) return null
        const header = Buffer.alloc(Math.min(metadata.byteLength, 12))
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        if (bytesRead !== header.length) return null
        validateImageInput({ ...metadata, bytes: header })
        ready = true
        return { metadata, file }
      } finally {
        if (!ready) await file.close()
      }
    },
    // Callers must hold the workspace lock and check references before deleting.
    remove: (ids: readonly string[], cutoff?: number) => queue.enqueue(async () => {
      if (ids.length > 200 || !Array.from(ids).every(isAssetId)) throw new TypeError('Invalid asset IDs')
      let removedCount = 0
      let reclaimedBytes = 0
      for (const id of ids) {
        if (cutoff !== undefined) {
          const entry = await readStoredMetadata(id)
          if (!entry || (entry.lastSavedAt ?? entry.createdAt ?? -Infinity) > cutoff) continue
        }
        const path = imagePath(id)
        const file = await lstat(path).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        await rm(path, { force: true })
        await rm(metaPath(id), { force: true })
        removedCount++
        if (file?.isFile()) reclaimedBytes += file.size
      }
      return { removedCount, reclaimedBytes }
    }),
  }
}

export function scanOrphanImageAssets(workspace: WorkspaceFiles, assets: ReturnType<typeof openImageAssetFiles>, {
  graceMs = assetGraceMs, protectedIds = [], dryRun = false, validatePage,
}: {
  graceMs?: number
  protectedIds?: readonly string[]
  dryRun?: boolean
  validatePage?: (page: PageShard) => void
} = {}) {
  return workspace.mutate(async transaction => {
    const now = Date.now()
    const index = await transaction.readIndex()
    if (!index) throw new Error('Cannot check assets without a valid workspace index')
    const referenced = await readWorkspaceAssetReferences(index, async id => {
      const page = await transaction.readPage(id)
      if (page) validatePage?.(page)
      return page
    }, protectedIds)
    const stored = await assets.listMetadata()
    const orphanIds = selectOrphanAssetIds(stored.map(entry => ({ id: entry.id, createdAt: entry.lastSavedAt ?? entry.createdAt })),
      referenced, now, graceMs)
    let removedCount = 0
    let reclaimedBytes = 0
    if (!dryRun) for (let i = 0; i < orphanIds.length; i += 200) {
      const batch = await assets.remove(orphanIds.slice(i, i + 200), now - graceMs)
      removedCount += batch.removedCount
      reclaimedBytes += batch.reclaimedBytes
    }
    return { scannedPages: index.pages.length + (index.trash?.length ?? 0), referencedCount: referenced.size,
      orphanIds, removedCount, reclaimedBytes, keptCount: stored.length - removedCount }
  })
}


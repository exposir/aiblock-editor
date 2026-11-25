import { createAssetStore } from '../../workspace/asset-store'
import type { AssetStore } from '../../workspace/asset-store'
import { hasImageSignature, imageAssetMetadata, maxImageBytes, validImageDimensions } from '../../workspace/asset-format'
import type { ImageAssetMetadata } from '../../workspace/asset-format'
import type { PageShard } from '../../workspace/workspace-format'
import { imageAttributes } from './image-attributes'
import type { ImageAttributes } from './image-attributes'

import { DeadlineExceeded, withDeadline } from '../../workspace/deadline'
import { imageHeaderSize } from './image-header'

const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const mimeTypes = new Set(Object.values(imageTypes))
export const acceptedImages = [...mimeTypes].join(',')
export const maxBatchImages = 200
export const imageDecodeTimeout = 5000

function fileMime(file: File) {
  if (mimeTypes.has(file.type)) return file.type
  const extension = /\.([a-z]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  return !file.type && extension && Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined
}

export function isImageFile(file: File) {
  return fileMime(file) !== undefined
}

interface PreparedImage {
  file: File
  metadata: ImageAssetMetadata
}

let store: AssetStore | undefined
const assets = () => store ??= createAssetStore()

async function dimensions(file: File, signal: AbortSignal) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        signal.throwIfAborted()
        return { width: bitmap.width, height: bitmap.height }
      } finally { bitmap.close() }
    } catch {
      signal.throwIfAborted()
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  const cancel = () => { image.removeAttribute('src') }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image decode failed'))
      // Removing the source does not reliably fire a load/error event.
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      image.src = url
    })
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    image.onload = image.onerror = null
    signal.removeEventListener('abort', cancel)
    URL.revokeObjectURL(url)
  }
}

const reasons = {
  limit: '超出每批 200 张上限', format: '格式或文件签名不匹配', size: '超过 32 MiB',
  dimensions: '像素尺寸超限', decode: '文件损坏或解码失败', timeout: '解码超时',
} as const
type ImageRejections = Partial<Record<keyof typeof reasons, number>>

export function imageRejectionNotice(rejected: ImageRejections) {
  const groups = (Object.keys(reasons) as (keyof ImageRejections)[]).flatMap(reason =>
    rejected[reason] ? [`${rejected[reason]} 张${reasons[reason]}`] : [])
  return groups.length ? `部分图片未插入（${groups.join('，')}）。` : ''
}

export async function prepareImages(files: readonly File[]): Promise<{ images: PreparedImage[]; rejected: ImageRejections }> {
  const input = files.slice(0, maxBatchImages)
  const output: (PreparedImage | undefined)[] = new Array(input.length)
  const rejected: ImageRejections = {}
  if (files.length > input.length) rejected.limit = files.length - input.length
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, input.length) }, async () => {
    for (let index = cursor++; index < input.length; index = cursor++) {
      const file = input[index]!
      let reason: keyof ImageRejections
      try {
        const prepared = await withDeadline(imageDecodeTimeout, async signal => {
          const mime = fileMime(file)
          if (!mime) return 'format'
          if (file.size > maxImageBytes) return 'size'
          const bytes = new Uint8Array(await file.arrayBuffer())
          signal.throwIfAborted()
          if (bytes.byteLength > maxImageBytes) return 'size'
          if (!hasImageSignature(bytes, mime)) return 'format'
          const header = imageHeaderSize(bytes, mime)
          if (!header) return 'decode'
          if (!validImageDimensions(header.width, header.height)) return 'dimensions'
          const size = await dimensions(file, signal)
          if (!validImageDimensions(size.width, size.height)) return 'dimensions'
          const hash = await crypto.subtle.digest('SHA-256', bytes)
          const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
          return { file, metadata: imageAssetMetadata({ bytes, mime, ...size, name: file.name.slice(0, 255) }, id) }
        })
        if (typeof prepared !== 'string') { output[index] = prepared; continue }
        reason = prepared
      } catch (error) {
        reason = error instanceof DeadlineExceeded ? 'timeout' : 'decode'
      }
      rejected[reason] = (rejected[reason] ?? 0) + 1
    }
  }))
  return { images: output.filter((image): image is PreparedImage => !!image), rejected }
}

interface Upload {
  file: File
  metadata: ImageAssetMetadata
  origin: string | undefined
  promise?: Promise<void>
  failed: boolean
  reconciled: boolean
  url?: string
  references: number
  ready: Set<() => void>
}

const uploads = new Map<string, Upload>()
const pageReferences = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
const queue: (() => void)[] = []
let running = 0
let activePageId: string | undefined
let failedCount = 0

function referencedIds() {
  return new Set([...pageReferences.values()].flatMap(ids => [...ids]))
}

function publishFailures() {
  const referenced = referencedIds()
  let next = 0
  for (const [id, upload] of uploads) {
    if (!upload.failed) continue
    if (referenced.has(id)) next++
    else if (upload.reconciled && upload.origin !== activePageId) uploads.delete(id)
  }
  if (next === failedCount) return
  failedCount = next
  for (const notify of listeners) notify()
}

export function imageUploadFailures() { return failedCount }

export function subscribeImageUploads(notify: () => void) {
  listeners.add(notify)
  return () => { listeners.delete(notify) }
}

function nextUpload() {
  while (running < 4 && queue.length) {
    running++
    queue.shift()!()
  }
}

function persist(upload: Upload) {
  if (upload.promise) return upload.promise
  const { id, mime, width, height, name } = upload.metadata
  const promise = new Promise<void>((resolve, reject) => {
    queue.push(() => {
      void Promise.resolve().then(async () => {
        if (uploads.get(id) !== upload) return
        const saved = await assets().saveImageAsset({ blob: upload.file, mime, width, height, name })
        if (saved.id !== id) throw new Error('Image identity changed')
        if (uploads.get(id) === upload) {
          uploads.delete(id)
          for (const [pageId, ids] of pageReferences) {
            ids.delete(id)
            if (!ids.size) pageReferences.delete(pageId)
          }
          for (const ready of upload.ready) ready()
          upload.ready.clear()
        }
      }).then(resolve, error => {
        upload.promise = undefined
        upload.failed = true
        reject(error)
      }).finally(() => {
        publishFailures()
        running--
        nextUpload()
      })
    })
  })
  upload.promise = promise
  nextUpload()
  return promise
}

export function queueImages(images: readonly PreparedImage[], pageId?: string): ImageAttributes[] {
  return images.map(({ file, metadata }) => {
    const id = metadata.id
    let upload = uploads.get(id)
    if (!upload) {
      upload = { file, metadata, origin: pageId, failed: false, reconciled: false, references: 0, ready: new Set() }
      uploads.set(id, upload)
    }
    void persist(upload).catch(() => {})
    return imageAttributes({ assetId: id, alt: metadata.name, width: metadata.width, height: metadata.height })
  })
}

// Track only unresolved uploads. Durable page saves never wait for binary I/O.
export function recordImageReferences(pages: readonly PageShard[], removed: readonly string[], active: string | undefined) {
  activePageId = active
  for (const id of removed) pageReferences.delete(id)
  if (!uploads.size) {
    pageReferences.clear()
    return
  }
  const reconciled = new Set([...pages.map(page => page.id), ...removed])
  for (const upload of uploads.values()) {
    if (upload.origin && reconciled.has(upload.origin)) upload.reconciled = true
  }
  for (const page of pages) {
    const referenced = new Set<string>()
    const nodes = [page.content]
    while (nodes.length) {
      const node = nodes.pop()!
      if (node.type === 'imageBlock' && uploads.has(node.attrs?.assetId)) referenced.add(node.attrs?.assetId)
      if (node.content) for (const child of node.content) nodes.push(child)
    }
    if (referenced.size) pageReferences.set(page.id, referenced)
    else pageReferences.delete(page.id)
  }
  publishFailures()
}

export async function retryImageUploads() {
  const retries = [...referencedIds()].flatMap(id => {
    const upload = uploads.get(id)
    return upload?.failed ? [persist(upload)] : []
  })
  await Promise.allSettled(retries)
}

export async function waitForImageUploads() {
  const pending = [...referencedIds()].flatMap(id => {
    const upload = uploads.get(id)
    return upload?.promise ? [upload.promise] : []
  })
  await Promise.allSettled(pending)
}

export function hasUnsavedImages() {
  return [...referencedIds()].some(id => uploads.has(id))
}

export function resetImageUploads() {
  uploads.clear()
  store = undefined
  pageReferences.clear()
  activePageId = undefined
  publishFailures()
}

export function watchImageSource(image: ImageAttributes, notify: (url: string | null) => void): () => void {
  const id = image.assetId
  if (!id) {
    notify(image.src)
    return () => {}
  }
  let active = true
  let lease: ReturnType<AssetStore['acquireAssetUrl']> | undefined
  let upload = uploads.get(id)
  if (upload) {
    upload.references++
    upload.url ??= URL.createObjectURL(upload.file)
    notify(upload.url)
  }
  function releaseTemporary() {
    if (!upload) return
    upload.ready.delete(useStored)
    if (--upload.references === 0 && upload.url) {
      URL.revokeObjectURL(upload.url)
      upload.url = undefined
    }
    upload = undefined
  }
  function useStored() {
    if (!active) return
    lease = assets().acquireAssetUrl(id!)
    void lease.url.then(url => {
      if (active) notify(url ?? image.src)
    }, () => {
      if (active) notify(image.src)
    }).finally(releaseTemporary)
  }
  if (upload) upload.ready.add(useStored)
  else useStored()
  return () => {
    active = false
    lease?.release()
    releaseTemporary()
  }
}

export async function withImageSource<T>(image: ImageAttributes, action: (url: string) => Promise<T>): Promise<T> {
  const id = image.assetId
  const upload = id ? uploads.get(id) : undefined
  if (upload) {
    const url = URL.createObjectURL(upload.file)
    try { return await action(url) } finally { URL.revokeObjectURL(url) }
  }
  const lease = id ? assets().acquireAssetUrl(id) : undefined
  try {
    const url = (lease && await lease.url.catch(() => null)) || image.src
    if (!url) throw new Error('Image unavailable')
    return await action(url)
  } finally {
    lease?.release()
  }
}

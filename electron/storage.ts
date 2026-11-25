import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { open, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { imageAssetMetadata, imageAssetUrlPrefix, isAssetId, isImageAssetMetadata, maxImageBytes, validateImageInput } from '../src/workspace/asset-format.js'
import { createWorkspaceFiles, readOptionalText, writeAtomicFile, writeAtomicText } from '../src/workspace/workspace-files.js'
import type { MarkdownFile, SaveFileOptions } from '../src/desktop/bridge.js'

export { createWorkspaceFiles, readOptionalText, writeAtomicText }

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

async function openStoredFile(path: string) {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readBounded(path: string, limit: number) {
  const file = await openStoredFile(path)
  if (!file) return null
  try {
    const stats = await file.stat()
    if (!stats.isFile() || stats.size > limit) throw new Error('Invalid stored file size')
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

export function assetRequestId(url: string): string | null {
  if (!url.startsWith(imageAssetUrlPrefix)) return null
  const id = url.slice(imageAssetUrlPrefix.length)
  return isAssetId(id) ? id : null
}

export function createImageAssetFiles(userData: string) {
  const queue = operationQueue()
  const directory = join(userData, 'workspace', 'assets')
  const imagePath = (id: string) => join(directory, id)
  const metaPath = (id: string) => join(directory, `${id}.json`)

  async function readMetadata(id: string) {
    const metadata = await readJSON(metaPath(id), 4096)
    if (metadata === undefined) return null
    if (!isImageAssetMetadata(metadata) || metadata.id !== id) throw new Error('Invalid asset metadata')
    return metadata
  }

  return {
    save: (input: unknown) => queue.enqueue(async () => {
      validateImageInput(input)
      const metadata = imageAssetMetadata(input, createHash('sha256').update(input.bytes).digest('hex'))
      const existing = await readMetadata(metadata.id)
      if (existing) return existing
      await writeAtomicFile(imagePath(metadata.id), input.bytes)
      await writeAtomicText(metaPath(metadata.id), JSON.stringify(metadata))
      return metadata
    }),
    async readMetadata(ids: unknown) {
      if (!Array.isArray(ids) || ids.length > 200 || !Array.from(ids).every(isAssetId)) throw new TypeError('Invalid asset IDs')
      return Promise.all(ids.map(readMetadata))
    },
    async respond(request: Request, applicationUrl?: string) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const id = assetRequestId(request.url)
      if (!id) return new Response(null, { status: 404 })
      let file: FileHandle | null = null
      try {
        const metadata = await readMetadata(id)
        if (!metadata) return new Response(null, { status: 404 })
        file = await openStoredFile(imagePath(id))
        if (!file) return new Response(null, { status: 404 })
        const stats = await file.stat()
        if (!stats.isFile() || stats.size !== metadata.byteLength) return new Response(null, { status: 404 })
        const header = Buffer.alloc(Math.min(metadata.byteLength, 12))
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        if (bytesRead !== header.length) return new Response(null, { status: 404 })
        validateImageInput({ ...metadata, bytes: header })
        const origin = request.headers.get('Origin')
        const application = applicationUrl ? new URL(applicationUrl) : null
        // Chromium may serialize the application's file origin as either file:// or null.
        const appOrigin = origin !== null && application &&
          (application.protocol === 'file:' ? origin === 'null' || origin === 'file://' : origin === application.origin)
        const headers = {
          Vary: 'Origin',
          ...(appOrigin ? { 'Access-Control-Allow-Origin': origin } : {}),
          'Content-Type': metadata.mime, 'Content-Length': String(metadata.byteLength),
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
        }
        if (request.method === 'HEAD') return new Response(null, { headers })
        const stream = file.createReadStream({ start: 0, end: metadata.byteLength - 1 })
        // The stream now owns the handle, including on cancellation.
        file = null
        // Node and DOM typings differ for the same WHATWG stream at runtime.
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { headers })
      } catch {
        return new Response(null, { status: 404 })
      } finally {
        await file?.close().catch(() => {})
      }
    },
    // Maintenance only. Close all editors and check persisted references before using.
    remove: (ids: readonly string[]) => queue.enqueue(async () => {
      if (ids.length > 200 || !Array.from(ids).every(isAssetId)) throw new TypeError('Invalid asset IDs')
      for (const id of ids) {
        await rm(metaPath(id), { force: true })
        await rm(imagePath(id), { force: true })
      }
    }),
  }
}

export async function readMarkdownFile(path: string): Promise<MarkdownFile> {
  if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new TypeError('Expected a Markdown file')
  return { name: basename(path), contents: await readFile(path, 'utf8') }
}

export function isSaveFileOptions(value: unknown): value is SaveFileOptions {
  return !!value && typeof value === 'object' && 'format' in value &&
    (value.format === 'markdown' || value.format === 'json' || value.format === 'svg') &&
    'name' in value && typeof value.name === 'string' && 'contents' in value && typeof value.contents === 'string'
}

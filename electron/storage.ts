import type { FileHandle } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { imageAssetUrlPrefix, isAssetId } from '../src/workspace/asset-format.js'
import { openImageAssetFiles, scanOrphanImageAssets } from '../src/workspace/asset-files.js'
import { createWorkspaceFiles, readOptionalText, writeAtomicText } from '../src/workspace/workspace-files.js'
import type { WorkspaceFiles } from '../src/workspace/workspace-files.js'
import type { MarkdownFile, SaveFileOptions } from '../src/desktop/bridge.js'

export { createWorkspaceFiles, readOptionalText, writeAtomicText }

export function assetRequestId(url: string): string | null {
  if (!url.startsWith(imageAssetUrlPrefix)) return null
  const id = url.slice(imageAssetUrlPrefix.length)
  return isAssetId(id) ? id : null
}

export function createImageAssetFiles(userData: string) {
  const assets = openImageAssetFiles(join(userData, 'workspace'))
  return {
    ...assets,
    async respond(request: Request, applicationUrl?: string) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const id = assetRequestId(request.url)
      if (!id) return new Response(null, { status: 404 })
      let file: FileHandle | null = null
      try {
        const image = await assets.openImage(id)
        if (!image) return new Response(null, { status: 404 })
        const { metadata } = image
        file = image.file
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
  }
}

export async function pruneOrphanImageAssets(workspace: WorkspaceFiles, assets: ReturnType<typeof createImageAssetFiles>, request: unknown) {
  if (request !== undefined && (!request || typeof request !== 'object' || Array.isArray(request))) {
    throw new TypeError('Invalid asset pruning options')
  }
  const { graceMs, protectedIds = [] } = (request ?? {}) as { graceMs?: number; protectedIds?: unknown }
  if ((graceMs !== undefined && (!Number.isFinite(graceMs) || graceMs < 0)) ||
      !Array.isArray(protectedIds) || !Array.from(protectedIds).every(isAssetId)) throw new TypeError('Invalid asset pruning options')
  const { removedCount, keptCount } = await scanOrphanImageAssets(workspace, assets, { graceMs, protectedIds })
  return { removedCount, keptCount }
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

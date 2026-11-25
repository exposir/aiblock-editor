import type { JSONContent } from '@tiptap/core'
import { isAssetId, parseImageAssetId } from './asset-format.js'
import { isPageShard, isWorkspaceIndex } from './workspace-format.js'
import type { PageShard, WorkspaceIndex } from './workspace-format.js'

export const assetGraceMs = 5 * 60_000

export function collectReferencedAssetIds(doc: JSONContent, target = new Set<string>()): Set<string> {
  const pending = [doc]
  while (pending.length) {
    const node = pending.pop()!
    if (!node || typeof node.type !== 'string' || (node.content !== undefined && !Array.isArray(node.content)) ||
        (node.type === 'text' && typeof node.text !== 'string') ||
        (node.attrs !== undefined && (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs)))) {
      throw new Error('Invalid document node while checking image references')
    }
    if (node.type === 'imageBlock' || node.type === 'image') {
      const id = node.attrs?.assetId
      const source = parseImageAssetId(node.attrs?.src)
      if (isAssetId(id)) target.add(id)
      if (source) target.add(source)
    }
    if (node.content) for (let i = node.content.length - 1; i >= 0; i--) pending.push(node.content[i]!)
  }
  return target
}

export function selectOrphanAssetIds(
  stored: readonly { id: string; createdAt?: number }[], referenced: ReadonlySet<string>, now: number, graceMs = assetGraceMs,
): string[] {
  const orphans = new Set<string>()
  for (const { id, createdAt } of stored) {
    if (isAssetId(id) && !referenced.has(id) &&
        (createdAt === undefined || Number.isFinite(createdAt) && now - createdAt >= graceMs)) orphans.add(id)
  }
  return [...orphans]
}

export async function readWorkspaceAssetReferences(
  index: WorkspaceIndex | null, readPage: (id: string) => Promise<PageShard | null>, protectedIds: readonly string[] = [],
) {
  if (!isWorkspaceIndex(index)) throw new Error('Cannot check assets without a valid workspace index')
  const referenced = new Set(protectedIds)
  for (const { id } of [...index.pages, ...index.trash ?? []]) {
    const shard = await readPage(id)
    if (!isPageShard(shard) || shard.id !== id) throw new Error('Cannot check assets: missing or invalid page ' + id)
    collectReferencedAssetIds(shard.content, referenced)
  }
  return referenced
}

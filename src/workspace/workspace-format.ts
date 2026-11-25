import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import type { CommentThread } from '../editor/comments.js'

export interface PageMetadata {
  readonly id: string
  readonly parentId: string | null
  readonly title: string
  readonly icon: string
  readonly comments: readonly CommentThread[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly order: number
}

export interface PageShard {
  readonly id: string
  readonly content: JSONContent
  readonly updatedAt: number
}

export interface TrashedPageMetadata extends PageMetadata {
  readonly deletedAt: number
}

export interface WorkspaceIndex {
  readonly version: 2
  readonly activePageId: string
  readonly pages: readonly PageMetadata[]
  readonly trash?: readonly TrashedPageMetadata[]
  readonly demoVersion?: number
}

export interface WorkspaceCommit {
  readonly index?: WorkspaceIndex
  readonly pages: readonly PageShard[]
  readonly removedPageIds: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isPageId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
}

function isThread(value: unknown): value is CommentThread {
  return isRecord(value) && typeof value.id === 'string' && typeof value.quote === 'string' &&
    typeof value.resolved === 'boolean' && Array.isArray(value.messages) && value.messages.every(message =>
      isRecord(message) && typeof message.id === 'string' && typeof message.author === 'string' && typeof message.text === 'string')
}

function isPageMetadata(value: unknown): value is PageMetadata {
  return isRecord(value) && isPageId(value.id) && (value.parentId === null || isPageId(value.parentId)) &&
    typeof value.title === 'string' && typeof value.icon === 'string' && !!value.icon &&
    Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt) &&
    typeof value.order === 'number' && Number.isSafeInteger(value.order) && value.order >= 0 &&
    Array.isArray(value.comments) && value.comments.every(isThread)
}

export function pageMetadata(page: PageMetadata): PageMetadata {
  const { id, parentId, title, icon, order, createdAt, updatedAt, comments } = page
  return { id, parentId, title, icon, order, createdAt, updatedAt, comments }
}

export function isPageShard(value: unknown): value is PageShard {
  return isRecord(value) && isPageId(value.id) && Number.isFinite(value.updatedAt) &&
    isRecord(value.content) && value.content.type === 'doc'
}

export function checkedPageShard(schema: Schema, shard: unknown, id: string): PageShard {
  if (!isPageShard(shard) || shard.id !== id) throw new Error('Invalid page shard')
  schema.nodeFromJSON(shard.content).check()
  return shard
}

function isTree(activePageId: string, pages: readonly PageMetadata[]): boolean {
  const children = new Map<string | null, string[]>()
  const ids = new Set<string>()
  for (const page of pages) {
    // Reject aliases on systems with case-insensitive file names.
    const id = page.id.toLowerCase()
    if (ids.has(id)) return false
    ids.add(id)
    const siblings = children.get(page.parentId) ?? []
    siblings.push(page.id)
    children.set(page.parentId, siblings)
  }
  const visited = new Set(children.get(null))
  for (const id of visited) for (const child of children.get(id) ?? []) visited.add(child)
  return visited.size === pages.length && visited.has(activePageId)
}

function isTrash(value: unknown, pages: readonly PageMetadata[]): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  const ids = new Set(pages.map(page => page.id.toLowerCase()))
  const parents = new Map<string, string | null>()
  for (const page of value) {
    if (!isRecord(page) || !isPageMetadata(page) || !Number.isFinite(page.deletedAt) || Object.hasOwn(page, 'content')) return false
    const id = page.id.toLowerCase()
    if (ids.has(id)) return false
    ids.add(id)
    parents.set(id, page.parentId?.toLowerCase() ?? null)
  }
  const checked = new Set<string>()
  for (const id of parents.keys()) {
    const path = new Set<string>()
    let next: string | null | undefined = id
    while (next && parents.has(next) && !checked.has(next)) {
      if (path.has(next)) return false
      path.add(next)
      next = parents.get(next)
    }
    for (const ancestor of path) checked.add(ancestor)
  }
  return true
}

export function isWorkspaceIndex(value: unknown): value is WorkspaceIndex {
  return isRecord(value) && value.version === 2 && isPageId(value.activePageId) &&
    (value.demoVersion === undefined || typeof value.demoVersion === 'number' &&
      Number.isSafeInteger(value.demoVersion) && value.demoVersion > 0) &&
    Array.isArray(value.pages) && value.pages.length > 0 &&
    Array.from(value.pages).every(page => isPageMetadata(page) && !Object.hasOwn(page, 'content')) &&
    isTree(value.activePageId, value.pages) && isTrash(value.trash, value.pages)
}

export function isWorkspaceCommit(value: unknown): value is WorkspaceCommit {
  if (!isRecord(value) || (value.index !== undefined && !isWorkspaceIndex(value.index)) ||
      !Array.isArray(value.pages) || !Array.from(value.pages).every(isPageShard) ||
      !Array.isArray(value.removedPageIds) || !Array.from(value.removedPageIds).every(isPageId)) return false
  const index = value.index as WorkspaceIndex | undefined
  if (!index && value.removedPageIds.length) return false
  const retained = index && new Set([...index.pages, ...index.trash ?? []].map(page => page.id))
  const written = new Set<string>()
  for (const page of value.pages) {
    const id = page.id.toLowerCase()
    if (written.has(id) || (retained && !retained.has(page.id))) return false
    written.add(id)
  }
  const retainedFiles = retained && new Set([...retained].map(id => id.toLowerCase()))
  return value.removedPageIds.every(pageId => {
    const id = pageId.toLowerCase()
    if (written.has(id) || retainedFiles?.has(id)) return false
    written.add(id)
    return true
  })
}

export function splitLegacyWorkspace(raw: string): { index: WorkspaceIndex; pages: PageShard[] } | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!isRecord(value) || !isPageId(value.activePageId) || !Array.isArray(value.pages) ||
      !value.pages.every(page => isPageMetadata(page) && isPageShard(page))) return null
  const index: WorkspaceIndex = {
    version: 2, activePageId: value.activePageId, pages: value.pages.map(pageMetadata),
    ...(typeof value.demoVersion === 'number' && Number.isSafeInteger(value.demoVersion) && value.demoVersion > 0
      ? { demoVersion: value.demoVersion } : {}),
  }
  if (!isWorkspaceIndex(index)) return null
  return {
    index,
    pages: value.pages.map((page: PageShard) => ({ id: page.id, content: page.content, updatedAt: page.updatedAt })),
  }
}

export type WorkspaceCloseResult = 'saved' | 'images-pending' | 'workspace-failed'

export interface WorkspaceExternalChange {
  readonly indexChanged: boolean
  readonly pageIds: readonly string[]
}

export function isWorkspaceExternalChange(value: unknown): value is WorkspaceExternalChange {
  return isRecord(value) && typeof value.indexChanged === 'boolean' &&
    Array.isArray(value.pageIds) && value.pageIds.every(isPageId)
}

export interface WorkspaceCommitOptions {
  readonly force?: boolean
  readonly base?: WorkspaceBase
}

export interface WorkspaceBase {
  readonly index?: string | null
  readonly pages?: Readonly<Record<string, string | null>>
}

export interface WorkspaceCommitResult {
  readonly conflict: boolean
  readonly files?: readonly string[]
  readonly locked?: boolean
}

export interface WorkspacePersistence {
  readIndex(): Promise<WorkspaceIndex | null>
  readPage(id: string): Promise<PageShard | null>
  peekPage?(id: string): Promise<PageShard | null>
  commit(changes: WorkspaceCommit, options?: WorkspaceCommitOptions): Promise<WorkspaceCommitResult | void>
  pruneOrphanAssets?(graceMs?: number, protectedIds?: readonly string[]): Promise<AssetPruneResult>
  onClosing?(listener: () => WorkspaceCloseResult | Promise<WorkspaceCloseResult>): () => void
  onExternalChange?(listener: (change: WorkspaceExternalChange) => void): () => void
}

export interface AssetPruneResult {
  readonly removedCount: number
  readonly keptCount: number
}


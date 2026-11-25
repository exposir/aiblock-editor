import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import type { CommentThread } from '../editor/comments'
import { markdownToDoc } from '../editor/markdown/markdown-codec'
import { importedTitle } from '../editor/markdown/markdown-files'

export interface PageRecord {
  readonly id: string
  readonly parentId: string | null
  readonly title: string
  readonly icon: string
  readonly content: JSONContent
  readonly comments: readonly CommentThread[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly order: number
}

export interface WorkspaceState {
  readonly activePageId: string
  readonly pages: readonly PageRecord[]
  readonly demoVersion?: number
}

export interface PageIdentity {
  readonly id: string
  readonly now: number
}

export type PageChanges = Partial<Pick<PageRecord, 'title' | 'icon' | 'content' | 'comments'>>
type NewPage = PageChanges & { parentId?: string | null }

export const DEFAULT_PAGE_TITLE = '无标题文档'
export const WORKSPACE_STORAGE_KEY = 'lark-block-editor.workspace.v1'

export function pageTitle(page: PageRecord): string {
  return page.title.trim() || DEFAULT_PAGE_TITLE
}

export function hasPageContent(page: PageRecord): boolean {
  return page.comments.length > 0 || (page.content.content ?? []).some(node =>
    node.type !== 'paragraph' || !!node.content?.length ||
    !!(node.attrs?.blockBg && node.attrs.blockBg !== 'default'),
  )
}

function makePage({ id, now }: PageIdentity, order: number, initial: NewPage): PageRecord {
  return {
    id, order, parentId: initial.parentId ?? null,
    title: initial.title ?? DEFAULT_PAGE_TITLE,
    icon: initial.icon ?? '📄',
    content: initial.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    comments: initial.comments ?? [],
    createdAt: now, updatedAt: now,
  }
}

export function createWorkspace(identity: PageIdentity, initial: PageChanges = {}): WorkspaceState {
  return { activePageId: identity.id, pages: [makePage(identity, 0, initial)] }
}

export function findPage(workspace: WorkspaceState, id: string | null): PageRecord | undefined {
  return workspace.pages.find(page => page.id === id)
}

export function pagesByParent(workspace: WorkspaceState) {
  const index = new Map<string | null, PageRecord[]>()
  for (const page of workspace.pages) {
    const siblings = index.get(page.parentId)
    if (siblings) siblings.push(page)
    else index.set(page.parentId, [page])
  }
  for (const siblings of index.values()) siblings.sort((a, b) => a.order - b.order)
  return index
}

export function pageAncestors(workspace: WorkspaceState, id: string): PageRecord[] {
  const ancestors: PageRecord[] = []
  let parent = findPage(workspace, findPage(workspace, id)?.parentId ?? null)
  while (parent) {
    ancestors.push(parent)
    parent = findPage(workspace, parent.parentId)
  }
  return ancestors.reverse()
}

function collectTree(index: ReturnType<typeof pagesByParent>, roots: string[]): Set<string> {
  const ids = new Set(roots)
  for (const id of ids) {
    for (const child of index.get(id) ?? []) ids.add(child.id)
  }
  return ids
}

export function pageSubtree(workspace: WorkspaceState, id: string): Set<string> {
  return collectTree(pagesByParent(workspace), [id])
}

function nextOrder(workspace: WorkspaceState, parentId: string | null): number {
  let order = 0
  for (const page of workspace.pages) {
    if (page.parentId === parentId) order = Math.max(order, page.order + 1)
  }
  return order
}

export function addPage(workspace: WorkspaceState, identity: PageIdentity, initial: NewPage = {}): WorkspaceState {
  const parentId = initial.parentId ?? null
  if ((parentId !== null && !findPage(workspace, parentId)) || findPage(workspace, identity.id)) return workspace
  const page = makePage(identity, nextOrder(workspace, parentId), initial)
  return { ...workspace, activePageId: page.id, pages: [...workspace.pages, page] }
}

export function activatePage(workspace: WorkspaceState, id: string): WorkspaceState {
  return id !== workspace.activePageId && findPage(workspace, id) ? { ...workspace, activePageId: id } : workspace
}

export function updatePage(workspace: WorkspaceState, id: string, changes: PageChanges, now: number): WorkspaceState {
  const page = findPage(workspace, id)
  if (!page || (Object.keys(changes) as (keyof PageChanges)[]).every(key => page[key] === changes[key])) return workspace
  return replacePage(workspace, { ...page, ...changes, updatedAt: now })
}

function replacePage(workspace: WorkspaceState, replacement: PageRecord): WorkspaceState {
  return { ...workspace, pages: workspace.pages.map(page => page.id === replacement.id ? replacement : page) }
}

export function copyPage(workspace: WorkspaceState, id: string, identity: PageIdentity): WorkspaceState {
  const page = findPage(workspace, id)
  if (!page) return workspace
  return addPage(workspace, identity, {
    parentId: page.parentId,
    title: `${pageTitle(page)}（副本）`,
    icon: page.icon,
    content: structuredClone(page.content),
    comments: structuredClone(page.comments),
  })
}

export function movePage(workspace: WorkspaceState, id: string, parentId: string | null, now: number): WorkspaceState {
  const page = findPage(workspace, id)
  if (!page || page.parentId === parentId) return workspace
  if (parentId !== null && (!findPage(workspace, parentId) || pageSubtree(workspace, id).has(parentId))) return workspace
  return replacePage(workspace, { ...page, parentId, order: nextOrder(workspace, parentId), updatedAt: now })
}

export function removePage(workspace: WorkspaceState, id: string, fallback: PageIdentity): WorkspaceState {
  const page = findPage(workspace, id)
  if (!page) return workspace
  const index = pagesByParent(workspace)
  const removed = collectTree(index, [id])
  const pages = workspace.pages.filter(candidate => !removed.has(candidate.id))
  if (!pages.length) return { ...workspace, ...createWorkspace(fallback) }
  if (!removed.has(workspace.activePageId)) return { ...workspace, pages }

  const siblings = index.get(page.parentId) ?? []
  const at = siblings.indexOf(page)
  const activePageId = siblings[at + 1]?.id ?? siblings[at - 1]?.id ?? page.parentId ?? pages[0]!.id
  return { ...workspace, activePageId, pages }
}

export function importMarkdownPage(
  workspace: WorkspaceState, schema: Schema, identity: PageIdentity, fileName: string, markdown: string,
): WorkspaceState {
  return addPage(workspace, identity, {
    title: importedTitle(fileName, markdown),
    content: markdownToDoc(schema, markdown).toJSON(),
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isThread(value: unknown): value is CommentThread {
  return isObject(value) && typeof value.id === 'string' && typeof value.quote === 'string' &&
    typeof value.resolved === 'boolean' && Array.isArray(value.messages) && value.messages.every(message =>
      isObject(message) && typeof message.id === 'string' && typeof message.author === 'string' && typeof message.text === 'string',
    )
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isPage(value: unknown, schema: Schema): value is PageRecord {
  if (!isObject(value) || typeof value.id !== 'string' || !uuidPattern.test(value.id) ||
      (value.parentId !== null && typeof value.parentId !== 'string') ||
      typeof value.title !== 'string' || typeof value.icon !== 'string' || !value.icon ||
      !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) ||
      typeof value.order !== 'number' || !Number.isSafeInteger(value.order) || value.order < 0 ||
      !Array.isArray(value.comments) || !value.comments.every(isThread) ||
      !isObject(value.content) || value.content.type !== schema.topNodeType.name) return false
  schema.nodeFromJSON(value.content).check()
  return true
}

function decodeWorkspace(schema: Schema, raw: string): WorkspaceState | null {
  const value: unknown = JSON.parse(raw)
  if (!isObject(value) || typeof value.activePageId !== 'string' || !Array.isArray(value.pages) ||
      !value.pages.length || !value.pages.every(page => isPage(page, schema))) return null

  const workspace: WorkspaceState = {
    activePageId: value.activePageId,
    pages: value.pages,
    ...(typeof value.demoVersion === 'number' && Number.isSafeInteger(value.demoVersion) && value.demoVersion > 0
      ? { demoVersion: value.demoVersion } : {}),
  }
  const index = pagesByParent(workspace)
  const reachable = collectTree(index, (index.get(null) ?? []).map(page => page.id))
  return reachable.size === workspace.pages.length && reachable.has(workspace.activePageId) ? workspace : null
}

export function restoreWorkspace(raw: string | null, schema: Schema, fallback: () => WorkspaceState): WorkspaceState {
  if (raw) {
    try {
      const stored = decodeWorkspace(schema, raw)
      if (stored) return stored
    } catch {
      // A file or browser record can contain invalid JSON or an unsupported document.
    }
  }
  return fallback()
}

export function loadWorkspace(storage: Storage | null, schema: Schema, fallback: () => WorkspaceState): WorkspaceState {
  let raw: string | null = null
  try { raw = storage?.getItem(WORKSPACE_STORAGE_KEY) ?? null } catch { /* Browser storage is unavailable. */ }
  return restoreWorkspace(raw, schema, fallback)
}

export function saveWorkspace(storage: Storage | null, workspace: WorkspaceState): boolean {
  if (!storage) return false
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace))
    return true
  } catch {
    return false
  }
}

export function clearWorkspace(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    storage.removeItem(WORKSPACE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function parsePageHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const pageId = params.get('page') || null
  return { pageId, blockId: pageId ? params.get('block') || null : null }
}

export function parseLegacyBlockHash(hash: string): string | null {
  if (!hash.startsWith('#block-')) return null
  try {
    return decodeURIComponent(hash.slice('#block-'.length)) || null
  } catch {
    return null
  }
}

export function formatPageHash(id: string, blockId?: string | null): string {
  const params = new URLSearchParams({ page: id })
  if (blockId) params.set('block', blockId)
  return `#${params}`
}

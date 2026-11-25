import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { markdownToDoc } from '../editor/markdown/markdown-codec'
import { importedTitle } from '../editor/markdown/markdown-files'
import { checkedPageShard } from './workspace-format'
import type { PageMetadata, PageShard } from './workspace-format'

export interface PageRecord extends PageMetadata {
  readonly content: JSONContent
}

export interface WorkspacePage extends PageMetadata {
  readonly content?: JSONContent
}

export interface WorkspaceState<P extends PageMetadata = PageRecord> {
  readonly activePageId: string
  readonly pages: readonly P[]
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

export function pageTitle(page: PageMetadata): string {
  return page.title.trim() || DEFAULT_PAGE_TITLE
}

export function hasPageContent(page: WorkspacePage): boolean {
  return !page.content || page.comments.length > 0 || (page.content.content ?? []).some(node =>
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

export function findPage<P extends PageMetadata>(workspace: WorkspaceState<P>, id: string | null): P | undefined {
  return workspace.pages.find(page => page.id === id)
}

export function pagesByParent<P extends PageMetadata>(workspace: WorkspaceState<P>) {
  const index = new Map<string | null, P[]>()
  for (const page of workspace.pages) {
    const siblings = index.get(page.parentId)
    if (siblings) siblings.push(page)
    else index.set(page.parentId, [page])
  }
  for (const siblings of index.values()) siblings.sort((a, b) => a.order - b.order)
  return index
}

export function pageAncestors<P extends PageMetadata>(workspace: WorkspaceState<P>, id: string): P[] {
  const ancestors: P[] = []
  let parent = findPage(workspace, findPage(workspace, id)?.parentId ?? null)
  while (parent) {
    ancestors.push(parent)
    parent = findPage(workspace, parent.parentId)
  }
  return ancestors.reverse()
}

function collectTree(index: ReadonlyMap<string | null, readonly PageMetadata[]>, roots: string[]): Set<string> {
  const ids = new Set(roots)
  for (const id of ids) {
    for (const child of index.get(id) ?? []) ids.add(child.id)
  }
  return ids
}

export function pageSubtree(workspace: WorkspaceState<PageMetadata>, id: string): Set<string> {
  return collectTree(pagesByParent(workspace), [id])
}

function nextOrder(workspace: WorkspaceState<PageMetadata>, parentId: string | null): number {
  let order = 0
  for (const page of workspace.pages) {
    if (page.parentId === parentId) order = Math.max(order, page.order + 1)
  }
  return order
}

export function addPage<P extends WorkspacePage>(workspace: WorkspaceState<P>, identity: PageIdentity, initial: NewPage = {}): WorkspaceState<P | PageRecord> {
  const parentId = initial.parentId ?? null
  if ((parentId !== null && !findPage(workspace, parentId)) || findPage(workspace, identity.id)) return workspace
  const page = makePage(identity, nextOrder(workspace, parentId), initial)
  return { ...workspace, activePageId: page.id, pages: [...workspace.pages, page] }
}

export function activatePage<P extends PageMetadata>(workspace: WorkspaceState<P>, id: string): WorkspaceState<P> {
  return id !== workspace.activePageId && findPage(workspace, id) ? { ...workspace, activePageId: id } : workspace
}

export function updatePage<P extends WorkspacePage>(workspace: WorkspaceState<P>, id: string, changes: PageChanges, now: number): WorkspaceState<P> {
  const page = findPage(workspace, id)
  if (!page || (Object.keys(changes) as (keyof PageChanges)[]).every(key => page[key] === changes[key])) return workspace
  return replacePage(workspace, { ...page, ...changes, updatedAt: now })
}

function replacePage<P extends WorkspacePage>(workspace: WorkspaceState<P>, replacement: P): WorkspaceState<P> {
  return { ...workspace, pages: workspace.pages.map(page => page.id === replacement.id ? replacement : page) }
}

export function copyPage<P extends WorkspacePage>(
  workspace: WorkspaceState<P>, id: string, identity: PageIdentity, loadedContent?: JSONContent,
): WorkspaceState<P | PageRecord> {
  const page = findPage(workspace, id)
  const content = loadedContent ?? page?.content
  if (!page || !content) return workspace
  return addPage(workspace, identity, {
    parentId: page.parentId,
    title: `${pageTitle(page)}（副本）`,
    icon: page.icon,
    content: structuredClone(content),
    comments: structuredClone(page.comments),
  })
}

export function movePage<P extends WorkspacePage>(workspace: WorkspaceState<P>, id: string, parentId: string | null, now: number): WorkspaceState<P> {
  const page = findPage(workspace, id)
  if (!page || page.parentId === parentId) return workspace
  if (parentId !== null && (!findPage(workspace, parentId) || pageSubtree(workspace, id).has(parentId))) return workspace
  return replacePage(workspace, { ...page, parentId, order: nextOrder(workspace, parentId), updatedAt: now })
}

export function removePage<P extends WorkspacePage>(workspace: WorkspaceState<P>, id: string, fallback: PageIdentity): WorkspaceState<P | PageRecord> {
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

export function importMarkdownPage<P extends WorkspacePage>(
  workspace: WorkspaceState<P>, schema: Schema, identity: PageIdentity, fileName: string, markdown: string,
): WorkspaceState<P | PageRecord> {
  return addPage(workspace, identity, {
    title: importedTitle(fileName, markdown),
    content: markdownToDoc(schema, markdown).toJSON(),
  })
}

export function checkedPageContent(schema: Schema, shard: unknown, id: string): PageShard {
  return checkedPageShard(schema, shard, id)
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

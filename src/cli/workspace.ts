import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { appSlug } from '../app-identity'
import { assignMissingBlockIds } from '../editor/extensions/block-id'
import { docToMarkdown, markdownToDoc } from '../editor/markdown/markdown-codec'
import { createDocumentSchema } from '../editor/schema'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { BlockPatchError, extractDocumentOutline, listTopLevelBlocks, patchDocument, selectDocumentBlocks, sliceDocumentMarkdown } from '../editor/markdown/block-patch'
import type { BlockPatchOperation } from '../editor/markdown/block-patch'
import { openImageAssetFiles, readImageImport, scanOrphanImageAssets } from '../workspace/asset-files'
import { isPageId, isWorkspaceIndex, pageMetadata } from '../workspace/workspace-format'
import type { PageMetadata, PageShard, WorkspaceIndex } from '../workspace/workspace-format'
import { movePage as storedMovePage, pageSubtree, restoreTrashedPage, trashPage } from '../workspace/page-store'
import type { WorkspaceState } from '../workspace/page-store'
import { searchWorkspacePages } from '../workspace/workspace-search'
import { openWorkspaceFiles } from '../workspace/workspace-files'
import type { WorkspaceFiles } from '../workspace/workspace-files'
import { CliError, conflictError, contentError, notFoundError } from './errors'

export const defaultPageTitle = '无标题文档'
export const defaultPageIcon = '📄'
export const workspaceSchema = createDocumentSchema()

export function defaultUserDataRoot() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', appSlug)
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appSlug)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appSlug)
}

export function resolveWorkspacePath(input?: string) {
  const value = input ?? process.env.AIBLOCK_WORKSPACE
  return value ? resolve(value) : join(defaultUserDataRoot(), 'workspace')
}

export function openCliWorkspace(path: string): WorkspaceFiles {
  const nested = join(path, 'workspace')
  if (!existsSync(join(path, 'index.json')) && existsSync(nested)) {
    return openWorkspaceFiles(nested, join(path, 'workspace.json'))
  }
  return openWorkspaceFiles(path, join(dirname(path), 'workspace.json'))
}

function emptyDoc(schema: Schema) {
  return schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })
}

function parseMarkdown(schema: Schema, markdown: string) {
  try {
    const doc = assignMissingBlockIds(markdownToDoc(schema, markdown))
    doc.check()
    return doc
  } catch (error) {
    throw contentError('Markdown 无法转换为页面内容。', error instanceof Error ? error.message : undefined)
  }
}

function pageContent(schema: Schema, shard: PageShard) {
  try {
    const doc = schema.nodeFromJSON(shard.content)
    doc.check()
    return doc
  } catch (error) {
    throw contentError('页面内容不符合当前文档格式。', error instanceof Error ? error.message : undefined)
  }
}

function hasVisibleContent(doc: ProseMirrorNode) {
  let visible = false
  doc.descendants(node => {
    if (node.isText && node.text?.trim()) visible = true
    if (node.type.name === 'imageBlock' || node.type.name === 'image' ||
        node.type.name === 'horizontalRule' || node.type.name === 'table' ||
        node.type.name === 'inlineMath' && String(node.attrs.latex ?? '').trim()) visible = true
  })
  return visible
}

function metadata(page: PageMetadata) {
  const { id, parentId, title, icon, order, updatedAt } = page
  return { id, parentId, title, icon, order, updatedAt }
}

function nextOrder(index: WorkspaceIndex, parentId: string | null) {
  let order = 0
  for (const page of index.pages) if (page.parentId === parentId) order = Math.max(order, page.order + 1)
  return order
}

function requireIndex(index: WorkspaceIndex | null): WorkspaceIndex {
  if (!index) throw notFoundError('工作区尚未初始化。', '先运行 aiblock-doc create 创建第一页。')
  return index
}

export function isPageReference(id: string) {
  return id === '@active' || isPageId(id)
}

function resolvePageId(index: WorkspaceIndex, id: string) {
  if (id !== '@active') return id
  if (!index.pages.some(page => page.id === index.activePageId)) {
    throw notFoundError('工作区没有活动页。', '先用 create --activate 创建页面或运行 list 检查工作区。')
  }
  return index.activePageId
}

function findIndexPage(index: WorkspaceIndex, id: string) {
  const page = index.pages.find(candidate => candidate.id === id)
  if (!page) throw notFoundError(`页面不存在：${id}`)
  return page
}

function findTrashedPage(index: WorkspaceIndex, id: string) {
  const page = index.trash?.find(candidate => candidate.id === id)
  if (!page) throw notFoundError(`回收站中没有该页面：${id}`, '先用 trash-list 查看已删除页面。')
  return page
}

function workspaceOf(index: WorkspaceIndex): WorkspaceState<PageMetadata> {
  return { activePageId: index.activePageId, pages: index.pages, trash: index.trash, demoVersion: index.demoVersion }
}

function indexOf(index: WorkspaceIndex, workspace: WorkspaceState<PageMetadata>): WorkspaceIndex {
  const trash = workspace.trash === undefined ? index.trash : workspace.trash
  return {
    ...index,
    activePageId: workspace.activePageId,
    pages: workspace.pages.map(pageMetadata),
    ...(trash === undefined ? {} : { trash }),
  }
}

function blockPatchError(error: BlockPatchError) {
  return error.code === 'block_not_found' ? notFoundError(error.message) : contentError(error.message)
}

function checkEtag(actual: string | null, expected: string, label: string) {
  if (actual !== expected) throw conflictError(`${label} etag 已变化。`, '重新读取页面后使用新的 etag 重试。')
}

function shard(id: string, content: unknown, now: number): PageShard {
  return { id, content: content as PageShard['content'], updatedAt: now }
}

export async function listPages(files: WorkspaceFiles) {
  const index = await files.readIndexSnapshot()
  return {
    activePageId: index.value?.activePageId ?? null,
    pages: index.value?.pages.map(metadata) ?? [],
    indexEtag: index.etag,
  }
}

export async function searchPages(files: WorkspaceFiles, query: string, limit: number) {
  const indexSnapshot = await files.readIndexSnapshot()
  const index = indexSnapshot.value
  if (!index) return { query, matches: [] }
  const hits = await searchWorkspacePages(index.pages, async id => (await files.readPage(id))?.content ?? null, query, { limit })
  const pages = new Map(index.pages.map(page => [page.id, page]))
  return {
    query,
    matches: hits.map(hit => ({
      page: metadata(pages.get(hit.pageId)!),
      titleMatch: hit.match === 'title',
      snippets: hit.match === 'body' ? [hit.snippet] : [],
    })),
  }
}

export async function getPage(files: WorkspaceFiles, id: string, format: 'markdown' | 'json', options: {
  blockId?: string
  sectionBlockId?: string
  withBlockIds?: boolean
} = {}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const index = await files.readIndexSnapshot()
  if (!index.value) throw notFoundError('工作区尚未初始化。', '先运行 aiblock-doc create 创建第一页。')
  const pageId = resolvePageId(index.value, id)
  const page = findIndexPage(index.value, pageId)
  const snapshot = await files.readPageSnapshot(pageId)
  if (!snapshot.value) throw notFoundError(`页面不存在：${pageId}`)
  const doc = pageContent(workspaceSchema, snapshot.value)
  const sliced = options.blockId !== undefined || options.sectionBlockId !== undefined
  let content: string | object
  try {
    content = format === 'json'
      ? sliced
        ? { type: 'doc', content: selectDocumentBlocks(doc, options).map(node => node.toJSON()) }
        : doc.toJSON()
      : sliced || options.withBlockIds
        ? sliceDocumentMarkdown(doc, options)
        : docToMarkdown(doc)
  } catch (error) {
    if (error instanceof BlockPatchError) throw blockPatchError(error)
    throw error
  }
  return {
    page: metadata(page),
    etag: snapshot.etag,
    indexEtag: index.etag,
    format,
    content,
  }
}

export async function outlinePage(files: WorkspaceFiles, id: string, includeBlocks: boolean) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const index = await files.readIndexSnapshot()
  if (!index.value) throw notFoundError('工作区尚未初始化。', '先运行 aiblock-doc create 创建第一页。')
  const pageId = resolvePageId(index.value, id)
  const page = findIndexPage(index.value, pageId)
  const snapshot = await files.readPageSnapshot(pageId)
  if (!snapshot.value) throw notFoundError(`页面不存在：${pageId}`)
  const doc = pageContent(workspaceSchema, snapshot.value)
  const outline = extractDocumentOutline(doc)
  return {
    page: metadata(page),
    etag: snapshot.etag,
    indexEtag: index.etag,
    blockCount: outline.blockCount,
    outline: outline.outline,
    ...(includeBlocks ? { blocks: listTopLevelBlocks(doc) } : {}),
  }
}

export async function createPage(files: WorkspaceFiles, input: {
  title: string
  parentId: string | null
  icon: string
  markdown: string | null
  activate: boolean
  dryRun: boolean
}) {
  const title = input.title.trim()
  if (!title) throw contentError('标题不能为空。')
  const icon = input.icon.trim() || defaultPageIcon
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const existing = indexSnapshot.value
    if (input.parentId && (!existing || !existing.pages.some(page => page.id === input.parentId))) {
      throw notFoundError(`父页面不存在：${input.parentId}`)
    }
    const now = Date.now()
    const id = randomUUID()
    const doc = input.markdown === null || input.markdown === '' ? emptyDoc(workspaceSchema) : parseMarkdown(workspaceSchema, input.markdown)
    const assigned = assignMissingBlockIds(doc)
    const content = assigned.toJSON()
    const shardValue = shard(id, content, now)
    const page: PageMetadata = {
      id,
      parentId: input.parentId,
      title,
      icon,
      comments: [],
      createdAt: now,
      updatedAt: now,
      order: existing ? nextOrder(existing, input.parentId) : 0,
    }
    const index: WorkspaceIndex = existing
      ? { ...existing, activePageId: input.activate ? id : existing.activePageId, pages: [...existing.pages, pageMetadata(page)] }
      : { version: 2, activePageId: id, pages: [pageMetadata(page)] }
    if (!isWorkspaceIndex(index)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, page: metadata(page), etag: null, indexEtag: null }
    await transaction.write({ index, pages: [shardValue], removedPageIds: [] })
    const nextIndex = await transaction.readIndexSnapshot()
    const nextPage = await transaction.readPageSnapshot(id)
    return { page: metadata(page), etag: nextPage.etag, indexEtag: nextIndex.etag }
  })
}

export async function appendPage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  markdown: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  if (!input.markdown.trim()) throw contentError('追加内容为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    findIndexPage(index, pageId)
    const pageSnapshot = await transaction.readPageSnapshot(pageId)
    if (!pageSnapshot.value) throw notFoundError(`页面不存在：${pageId}`)
    checkEtag(pageSnapshot.etag, input.ifMatch, '页面')
    const now = Date.now()
    const current = pageContent(workspaceSchema, pageSnapshot.value)
    const incoming = parseMarkdown(workspaceSchema, input.markdown)
    const merged = assignMissingBlockIds(current.copy(current.content.append(incoming.content)))
    merged.check()
    const nextPage = shard(pageId, merged.toJSON(), now)
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === pageId ? { ...page, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId, etag: pageSnapshot.etag, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [nextPage], removedPageIds: [] })
    const nextPageSnapshot = await transaction.readPageSnapshot(pageId)
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId, etag: nextPageSnapshot.etag, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function updatePage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  markdown: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  if (!input.markdown.trim()) throw contentError('替换内容为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    findIndexPage(index, pageId)
    const pageSnapshot = await transaction.readPageSnapshot(pageId)
    if (!pageSnapshot.value) throw notFoundError(`页面不存在：${pageId}`)
    checkEtag(pageSnapshot.etag, input.ifMatch, '页面')
    const doc = parseMarkdown(workspaceSchema, input.markdown)
    if (!hasVisibleContent(doc)) throw contentError('替换内容为空。', '提供至少一个可见块。')
    const now = Date.now()
    const nextPage = shard(pageId, doc.toJSON(), now)
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === pageId ? { ...page, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId, etag: pageSnapshot.etag, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [nextPage], removedPageIds: [] })
    const nextPageSnapshot = await transaction.readPageSnapshot(pageId)
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId, etag: nextPageSnapshot.etag, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function renamePage(files: WorkspaceFiles, id: string, input: {
  title: string
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const title = input.title.trim()
  if (!title) throw contentError('标题不能为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    findIndexPage(index, pageId)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const now = Date.now()
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === pageId ? { ...page, title, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId, title, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [], removedPageIds: [] })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId, title, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function deletePage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  dryRun: boolean
  permanent: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    const target = findIndexPage(index, pageId)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const removed = pageSubtree(index, pageId)
    const removedPageIds = [...removed]
    const now = Date.now()

    if (!input.permanent) {
      const fallbackId = randomUUID()
      const trashed = trashPage(workspaceOf(index), pageId, { id: fallbackId, now })
      const nextIndex = indexOf(index, trashed)
      const replacement = nextIndex.pages.some(page => page.id === fallbackId)
        ? shard(fallbackId, assignMissingBlockIds(emptyDoc(workspaceSchema)).toJSON(), now)
        : null
      if (!isWorkspaceIndex(nextIndex)) throw contentError('删除后无法生成有效的工作区索引。')
      if (input.dryRun) {
        return { dryRun: true, removedPageIds, activePageId: nextIndex.activePageId, indexEtag: indexSnapshot.etag, trashed: true }
      }
      await transaction.write({ index: nextIndex, pages: replacement ? [replacement] : [], removedPageIds: [] })
      const nextIndexSnapshot = await transaction.readIndexSnapshot()
      return { removedPageIds, activePageId: nextIndex.activePageId, indexEtag: nextIndexSnapshot.etag, trashed: true }
    }

    const remaining = index.pages.filter(page => !removed.has(page.id))
    let activePageId = index.activePageId
    let replacement: PageShard | null = null
    if (!remaining.length) {
      const fallbackId = randomUUID()
      const fallback: PageMetadata = {
        id: fallbackId,
        parentId: null,
        title: defaultPageTitle,
        icon: defaultPageIcon,
        comments: [],
        createdAt: now,
        updatedAt: now,
        order: 0,
      }
      remaining.push(fallback)
      activePageId = fallbackId
      replacement = shard(fallbackId, assignMissingBlockIds(emptyDoc(workspaceSchema)).toJSON(), now)
    } else if (removed.has(activePageId)) {
      const siblings = index.pages.filter(page => page.parentId === target.parentId)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      const at = siblings.findIndex(page => page.id === target.id)
      activePageId = siblings[at + 1]?.id ?? siblings[at - 1]?.id ?? target.parentId ?? remaining[0]!.id
    }
    const nextIndex: WorkspaceIndex = { ...index, activePageId, pages: remaining }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('删除后无法生成有效的工作区索引。')
    if (input.dryRun) {
      return { dryRun: true, removedPageIds, activePageId, indexEtag: indexSnapshot.etag, trashed: false }
    }
    await transaction.write({
      index: nextIndex,
      pages: replacement ? [replacement] : [],
      removedPageIds,
    })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { removedPageIds, activePageId, indexEtag: nextIndexSnapshot.etag, trashed: false }
  })
}

function patchOperation(input: {
  operation: BlockPatchOperation['operation']
  targetBlockId: string
  markdown: string
}): BlockPatchOperation {
  if (input.operation === 'delete-block') return { operation: 'delete-block', targetBlockId: input.targetBlockId }
  return { operation: input.operation, targetBlockId: input.targetBlockId, markdown: input.markdown }
}

export async function patchPage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  operation: BlockPatchOperation['operation']
  targetBlockId: string
  markdown: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    findIndexPage(index, pageId)
    const pageSnapshot = await transaction.readPageSnapshot(pageId)
    if (!pageSnapshot.value) throw notFoundError(`页面不存在：${pageId}`)
    checkEtag(pageSnapshot.etag, input.ifMatch, '页面')
    const doc = pageContent(workspaceSchema, pageSnapshot.value)
    let nextDoc: ProseMirrorNode
    try {
      nextDoc = patchDocument(workspaceSchema, doc, patchOperation(input))
    } catch (error) {
      if (error instanceof BlockPatchError) throw blockPatchError(error)
      throw error
    }
    const now = Date.now()
    const nextPage = shard(pageId, nextDoc.toJSON(), now)
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === pageId ? { ...page, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    const result = { pageId, operation: input.operation, targetBlockId: input.targetBlockId }
    if (input.dryRun) {
      return { ...result, dryRun: true, etag: pageSnapshot.etag, indexEtag: indexSnapshot.etag }
    }
    await transaction.write({ index: nextIndex, pages: [nextPage], removedPageIds: [] })
    const nextPageSnapshot = await transaction.readPageSnapshot(pageId)
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { ...result, etag: nextPageSnapshot.etag, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function commentsPage(files: WorkspaceFiles, id: string, unresolved: boolean) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const indexSnapshot = await files.readIndexSnapshot()
  const index = requireIndex(indexSnapshot.value)
  const pageId = resolvePageId(index, id)
  const page = findIndexPage(index, pageId)
  return {
    page: metadata(page),
    indexEtag: indexSnapshot.etag,
    comments: unresolved ? page.comments.filter(thread => !thread.resolved) : page.comments,
  }
}

export async function replyToComment(files: WorkspaceFiles, id: string, threadId: string, input: {
  text: string
  author?: string
  resolve: boolean
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  if (!input.text.trim()) throw contentError('回复内容为空。')
  const author = input.author?.trim() || 'AI'
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    const page = findIndexPage(index, pageId)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const thread = page.comments.find(candidate => candidate.id === threadId)
    if (!thread) throw notFoundError(`评论线程不存在：${threadId}`, '先用 comments 查看线程 ID。')
    const now = Date.now()
    const message = { id: randomUUID(), author, text: input.text }
    const resolved = input.resolve || thread.resolved
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(candidate => candidate.id === pageId ? {
        ...candidate,
        updatedAt: now,
        comments: candidate.comments.map(item => item.id === threadId
          ? { ...item, messages: [...item.messages, message], resolved }
          : item),
      } : candidate),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    const result = { pageId, threadId, message, resolved }
    if (input.dryRun) return { ...result, dryRun: true, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [], removedPageIds: [] })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { ...result, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function movePageCli(files: WorkspaceFiles, id: string, input: {
  parent: string
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageReference(id)) throw notFoundError(`页面 ID 无效：${id}`)
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const pageId = resolvePageId(index, id)
    const page = findIndexPage(index, pageId)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const parentId = input.parent === 'root' ? null : input.parent
    if (parentId !== null) {
      if (!isPageId(parentId)) throw contentError(`父页面 ID 无效：${parentId}`)
      findIndexPage(index, parentId)
      if (parentId === pageId || pageSubtree(workspaceOf(index), pageId).has(parentId)) {
        throw contentError('不能把页面移动到自身或其后代下。')
      }
    }
    const now = Date.now()
    let nextIndex: WorkspaceIndex
    if (page.parentId === parentId) {
      const order = nextOrder(index, parentId)
      nextIndex = {
        ...index,
        pages: index.pages.map(candidate => candidate.id === pageId ? { ...candidate, order, updatedAt: now } : candidate),
      }
    } else {
      nextIndex = indexOf(index, storedMovePage(workspaceOf(index), pageId, parentId, now))
    }
    const moved = nextIndex.pages.find(candidate => candidate.id === pageId)!
    if (!isWorkspaceIndex(nextIndex)) throw contentError('移动后无法生成有效的工作区索引。')
    const result = { pageId, parentId: moved.parentId, order: moved.order }
    if (input.dryRun) return { ...result, dryRun: true, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [], removedPageIds: [] })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { ...result, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function trashList(files: WorkspaceFiles) {
  const indexSnapshot = await files.readIndexSnapshot()
  return {
    trash: (indexSnapshot.value?.trash ?? []).map(({ id, parentId, title, icon, deletedAt }) => ({
      id, parentId, title, icon, deletedAt,
    })),
    indexEtag: indexSnapshot.etag,
  }
}

export async function restorePage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    findTrashedPage(index, id)
    const before = index.trash ?? []
    const nextIndex = indexOf(index, restoreTrashedPage(workspaceOf(index), id))
    const remaining = new Set((nextIndex.trash ?? []).map(page => page.id))
    const restoredPageIds = before.filter(page => !remaining.has(page.id)).map(page => page.id)
    const page = nextIndex.pages.find(candidate => candidate.id === id)
    if (!page) throw contentError('恢复后无法找到页面。')
    if (!isWorkspaceIndex(nextIndex)) throw contentError('恢复后无法生成有效的工作区索引。')
    const result = { restoredPageIds, page: metadata(page) }
    if (input.dryRun) return { ...result, dryRun: true, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [], removedPageIds: [] })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { ...result, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function addImageAsset(files: WorkspaceFiles, path: string, dryRun: boolean) {
  const input = await readImageImport(path)
  if (!input) throw notFoundError(`图片文件不存在：${path}`, '检查文件路径后重试。')
  const imported = dryRun
    ? await openImageAssetFiles(files.directory).importImage(input, true)
    : await files.mutate(async () => openImageAssetFiles(files.directory).importImage(input))
  const result = { asset: imported.asset, markdown: `![](asset:${imported.asset.id})`, created: imported.created }
  return dryRun ? { ...result, dryRun: true } : result
}

export async function collectGarbage(files: WorkspaceFiles, input: { graceMs: number; dryRun: boolean }) {
  const assets = openImageAssetFiles(files.directory)
  const result = await scanOrphanImageAssets(files, assets, {
    graceMs: input.graceMs,
    dryRun: input.dryRun,
    validatePage: page => { pageContent(workspaceSchema, page) },
  })
  const report = {
    scannedPages: result.scannedPages,
    referencedCount: result.referencedCount,
    orphanIds: result.orphanIds,
    removedCount: result.removedCount,
    reclaimedBytes: result.reclaimedBytes,
  }
  return input.dryRun ? { ...report, dryRun: true } : report
}

export async function readMarkdownInput(value: string | undefined, options: {
  required: boolean
  readStdin: () => Promise<string>
  cwd: string
}): Promise<string | null> {
  if (value === undefined) {
    if (!options.required) return null
    return options.readStdin()
  }
  if (value === '-') return options.readStdin()
  let bytes: Buffer
  try {
    bytes = await readFile(resolve(options.cwd, value))
  } catch (error) {
    throw new CliError('io_error', `无法读取 Markdown 文件：${value}`, error instanceof Error ? error.message : undefined)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw contentError(`Markdown 文件不是有效的 UTF-8：${value}`, '改用 UTF-8 编码保存后重试。')
  }
}


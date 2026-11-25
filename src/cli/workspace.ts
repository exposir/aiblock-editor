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
import { openImageAssetFiles, readImageImport, scanOrphanImageAssets } from '../workspace/asset-files'
import { isPageId, isWorkspaceIndex, pageMetadata } from '../workspace/workspace-format'
import type { PageMetadata, PageShard, WorkspaceIndex } from '../workspace/workspace-format'
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

function findIndexPage(index: WorkspaceIndex, id: string) {
  const page = index.pages.find(candidate => candidate.id === id)
  if (!page) throw notFoundError(`页面不存在：${id}`)
  return page
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

export async function getPage(files: WorkspaceFiles, id: string, format: 'markdown' | 'json') {
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const index = await files.readIndexSnapshot()
  if (!index.value) throw notFoundError('工作区尚未初始化。', '先运行 aiblock-doc create 创建第一页。')
  const page = findIndexPage(index.value, id)
  const snapshot = await files.readPageSnapshot(id)
  if (!snapshot.value) throw notFoundError(`页面不存在：${id}`)
  const doc = pageContent(workspaceSchema, snapshot.value)
  return {
    page: metadata(page),
    etag: snapshot.etag,
    indexEtag: index.etag,
    format,
    content: format === 'json' ? doc.toJSON() : docToMarkdown(doc),
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
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  if (!input.markdown.trim()) throw contentError('追加内容为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    findIndexPage(index, id)
    const pageSnapshot = await transaction.readPageSnapshot(id)
    if (!pageSnapshot.value) throw notFoundError(`页面不存在：${id}`)
    checkEtag(pageSnapshot.etag, input.ifMatch, '页面')
    const now = Date.now()
    const current = pageContent(workspaceSchema, pageSnapshot.value)
    const incoming = parseMarkdown(workspaceSchema, input.markdown)
    const merged = assignMissingBlockIds(current.copy(current.content.append(incoming.content)))
    merged.check()
    const nextPage = shard(id, merged.toJSON(), now)
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === id ? { ...page, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId: id, etag: pageSnapshot.etag, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [nextPage], removedPageIds: [] })
    const nextPageSnapshot = await transaction.readPageSnapshot(id)
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId: id, etag: nextPageSnapshot.etag, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function updatePage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  markdown: string
  dryRun: boolean
}) {
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  if (!input.markdown.trim()) throw contentError('替换内容为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    findIndexPage(index, id)
    const pageSnapshot = await transaction.readPageSnapshot(id)
    if (!pageSnapshot.value) throw notFoundError(`页面不存在：${id}`)
    checkEtag(pageSnapshot.etag, input.ifMatch, '页面')
    const doc = parseMarkdown(workspaceSchema, input.markdown)
    if (!hasVisibleContent(doc)) throw contentError('替换内容为空。', '提供至少一个可见块。')
    const now = Date.now()
    const nextPage = shard(id, doc.toJSON(), now)
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === id ? { ...page, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId: id, etag: pageSnapshot.etag, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [nextPage], removedPageIds: [] })
    const nextPageSnapshot = await transaction.readPageSnapshot(id)
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId: id, etag: nextPageSnapshot.etag, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function renamePage(files: WorkspaceFiles, id: string, input: {
  title: string
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  const title = input.title.trim()
  if (!title) throw contentError('标题不能为空。')
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    findIndexPage(index, id)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const now = Date.now()
    const nextIndex: WorkspaceIndex = {
      ...index,
      pages: index.pages.map(page => page.id === id ? { ...page, title, updatedAt: now } : page),
    }
    if (!isWorkspaceIndex(nextIndex)) throw contentError('生成的索引不符合工作区格式。')
    if (input.dryRun) return { dryRun: true, pageId: id, title, indexEtag: indexSnapshot.etag }
    await transaction.write({ index: nextIndex, pages: [], removedPageIds: [] })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { pageId: id, title, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function deletePage(files: WorkspaceFiles, id: string, input: {
  ifMatch: string
  dryRun: boolean
}) {
  if (!isPageId(id)) throw notFoundError(`页面 ID 无效：${id}`)
  return files.mutate(async transaction => {
    const indexSnapshot = await transaction.readIndexSnapshot()
    const index = requireIndex(indexSnapshot.value)
    const target = findIndexPage(index, id)
    checkEtag(indexSnapshot.etag, input.ifMatch, '索引')
    const removed = new Set<string>()
    const pending = [id]
    while (pending.length) {
      const current = pending.pop()!
      if (removed.has(current)) continue
      removed.add(current)
      for (const page of index.pages) if (page.parentId === current) pending.push(page.id)
    }
    const remaining = index.pages.filter(page => !removed.has(page.id))
    const now = Date.now()
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
      return { dryRun: true, removedPageIds: [...removed], activePageId, indexEtag: indexSnapshot.etag }
    }
    await transaction.write({
      index: nextIndex,
      pages: replacement ? [replacement] : [],
      removedPageIds: [...removed],
    })
    const nextIndexSnapshot = await transaction.readIndexSnapshot()
    return { removedPageIds: [...removed], activePageId, indexEtag: nextIndexSnapshot.etag }
  })
}

export async function addImageAsset(files: WorkspaceFiles, path: string, dryRun: boolean) {
  const input = await readImageImport(path)
  if (!input) throw notFoundError(`图片文件不存在：${path}`, '检查文件路径后重试。')
  const imported = await openImageAssetFiles(files.directory).importImage(input, dryRun)
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


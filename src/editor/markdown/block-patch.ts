import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import { assignMissingBlockIds } from '../extensions/block-id'
import { docToMarkdown, markdownToDoc } from './markdown-codec'

export interface DocumentOutlineEntry {
  readonly blockId: string | null
  readonly level: number
  readonly text: string
  readonly blockIndex: number
}

export interface DocumentOutline {
  readonly blockCount: number
  readonly outline: readonly DocumentOutlineEntry[]
}

export interface TopLevelBlockSummary {
  readonly blockId: string | null
  readonly type: string
  readonly preview: string
}

export interface DocumentSliceOptions {
  readonly blockId?: string
  readonly sectionBlockId?: string
  readonly withBlockIds?: boolean
}

export type BlockPatchOperation =
  | { readonly operation: 'replace-block'; readonly targetBlockId: string; readonly markdown: string }
  | { readonly operation: 'insert-before'; readonly targetBlockId: string; readonly markdown: string }
  | { readonly operation: 'insert-after'; readonly targetBlockId: string; readonly markdown: string }
  | { readonly operation: 'delete-block'; readonly targetBlockId: string }
  | { readonly operation: 'replace-section'; readonly targetBlockId: string; readonly markdown: string }

export type BlockPatchErrorCode = 'block_not_found' | 'invalid_target' | 'empty_content' | 'invalid_markdown'

export class BlockPatchError extends Error {
  readonly code: BlockPatchErrorCode

  constructor(code: BlockPatchErrorCode, message: string) {
    super(message)
    this.name = 'BlockPatchError'
    this.code = code
  }
}

const previewLength = 80

function blockIdOf(node: ProseMirrorNode): string | null {
  const value = node.attrs?.blockId
  return typeof value === 'string' && value.trim() ? value : null
}

function nodesOf(doc: ProseMirrorNode): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  doc.forEach(node => nodes.push(node))
  return nodes
}

function documentOf(doc: ProseMirrorNode, nodes: readonly ProseMirrorNode[]) {
  return doc.type.create(doc.attrs, Fragment.fromArray(nodes))
}

function findBlockIndex(doc: ProseMirrorNode, blockId: string) {
  for (let index = 0; index < doc.childCount; index++) {
    if (blockIdOf(doc.child(index)) === blockId) return index
  }
  throw new BlockPatchError('block_not_found', `未找到顶层块：${blockId}`)
}

function sectionEnd(doc: ProseMirrorNode, start: number) {
  const heading = doc.child(start)
  if (heading.type.name !== 'heading') {
    throw new BlockPatchError('invalid_target', `小节目标必须是标题块：${blockIdOf(heading) ?? start}`)
  }
  const level = Number(heading.attrs.level)
  let end = start + 1
  while (end < doc.childCount) {
    const node = doc.child(end)
    if (node.type.name === 'heading' && Number(node.attrs.level) <= level) break
    end++
  }
  return end
}

export function extractDocumentOutline(doc: ProseMirrorNode): DocumentOutline {
  const outline: DocumentOutlineEntry[] = []
  for (let index = 0; index < doc.childCount; index++) {
    const node = doc.child(index)
    if (node.type.name !== 'heading') continue
    outline.push({
      blockId: blockIdOf(node),
      level: Number(node.attrs.level),
      text: node.textContent,
      blockIndex: index,
    })
  }
  return { blockCount: doc.childCount, outline }
}

export function listTopLevelBlocks(doc: ProseMirrorNode): TopLevelBlockSummary[] {
  return nodesOf(doc).map(node => ({
    blockId: blockIdOf(node),
    type: node.type.name,
    preview: node.textContent.replace(/\s+/g, ' ').trim().slice(0, previewLength),
  }))
}

export function selectDocumentBlocks(doc: ProseMirrorNode, options: DocumentSliceOptions = {}): ProseMirrorNode[] {
  if (options.blockId !== undefined && options.sectionBlockId !== undefined) {
    throw new BlockPatchError('invalid_target', '只能选择单个块或一个小节之一。')
  }
  if (options.blockId !== undefined) {
    return [doc.child(findBlockIndex(doc, options.blockId))]
  }
  if (options.sectionBlockId !== undefined) {
    const start = findBlockIndex(doc, options.sectionBlockId)
    return nodesOf(doc).slice(start, sectionEnd(doc, start))
  }
  return nodesOf(doc)
}

export function sliceDocumentMarkdown(doc: ProseMirrorNode, options: DocumentSliceOptions = {}): string {
  const blocks = selectDocumentBlocks(doc, options)
  if (!options.withBlockIds) return docToMarkdown(documentOf(doc, blocks))

  const parts: string[] = []
  for (const block of blocks) {
    const markdown = docToMarkdown(documentOf(doc, [block])).trimEnd()
    const id = blockIdOf(block)
    const part = id ? `<!-- block:${id} -->${markdown ? `\n${markdown}` : ''}` : markdown
    if (part) parts.push(part)
  }
  return parts.length ? `${parts.join('\n\n').trimEnd()}\n` : '\n'
}

function hasVisibleContent(doc: ProseMirrorNode) {
  if (doc.textContent.trim()) return true
  let visible = false
  doc.descendants(node => {
    if (node.type.name === 'imageBlock' || node.type.name === 'image' ||
        node.type.name === 'horizontalRule' || node.type.name === 'table' ||
        node.type.name === 'inlineMath' && String(node.attrs.latex ?? '').trim()) visible = true
  })
  return visible
}

function parsePatchMarkdown(schema: Schema, markdown: string) {
  let parsed: ProseMirrorNode
  try {
    parsed = markdownToDoc(schema, markdown)
    parsed.check()
  } catch (error) {
    throw new BlockPatchError('invalid_markdown', `Markdown 无法转换为页面内容：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed.childCount || !hasVisibleContent(parsed)) throw new BlockPatchError('empty_content', '替换内容为空。')
  return nodesOf(assignMissingBlockIds(parsed))
}

export function patchDocument(schema: Schema, doc: ProseMirrorNode, operation: BlockPatchOperation): ProseMirrorNode {
  const index = findBlockIndex(doc, operation.targetBlockId)
  const original = nodesOf(doc)

  if (operation.operation === 'delete-block') {
    original.splice(index, 1)
    if (!original.length) {
      const paragraph = schema.nodes.paragraph?.createAndFill()
      if (!paragraph) throw new BlockPatchError('invalid_target', '文档缺少段落节点，无法保留空白页。')
      return assignMissingBlockIds(documentOf(doc, [paragraph]))
    }
    return documentOf(doc, original)
  }

  const incoming = parsePatchMarkdown(schema, operation.markdown)
  if (operation.operation === 'replace-block') {
    original.splice(index, 1, ...incoming)
  } else if (operation.operation === 'insert-before') {
    original.splice(index, 0, ...incoming)
  } else if (operation.operation === 'insert-after') {
    original.splice(index + 1, 0, ...incoming)
  } else {
    const end = sectionEnd(doc, index)
    original.splice(index, end - index, ...incoming)
  }
  return documentOf(doc, original)
}

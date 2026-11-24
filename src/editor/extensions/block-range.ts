import { callOrReturn, getExtensionField } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'

export function blockNodeTypes(extensions: Extensions): string[] {
  return extensions.filter(extension => {
    if (extension.type !== 'node' || extension.name === 'text') return false
    const context = { name: extension.name, options: extension.options, storage: extension.storage }
    return !callOrReturn(getExtensionField(extension, 'topNode', context)) &&
      !callOrReturn(getExtensionField(extension, 'inline', context))
  }).map(extension => extension.name)
}

export function isBlock(node: ProseMirrorNode | null): node is ProseMirrorNode {
  return !!node && node.type.isInGroup('block')
}

export function blockAt(doc: ProseMirrorNode, pos: number) {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null
  const $pos = doc.resolve(pos)
  const node = $pos.nodeAfter
  return !$pos.textOffset && isBlock(node) ? { $pos, node, pos } : null
}

export function nearestBlock($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (isBlock($pos.node(depth))) return $pos.before(depth)
  }
  return blockAt($pos.doc, $pos.pos)?.pos ?? null
}

export function blockRange(doc: ProseMirrorNode, anchor: number, head: number = anchor) {
  const start = blockAt(doc, Math.min(anchor, head))
  const end = blockAt(doc, Math.max(anchor, head))
  if (!start || !end || !start.$pos.sameParent(end.$pos)) return null

  const $from = start.$pos
  const $to = doc.resolve(end.pos + end.node.nodeSize)
  const blocks = $from.parent.children.slice($from.index(), $to.index())
  if (!blocks.every(isBlock)) return null

  return { $from, $to, blocks, from: $from.pos, to: $to.pos }
}

export type BlockRange = NonNullable<ReturnType<typeof blockRange>>

export function exactBlockReplacement(range: BlockRange, content: Fragment): Fragment | null {
  const { $from, $to } = range
  if ($from.parent.canReplace($from.index(), $to.index(), content)) return content
  if (content.size) return null

  const paragraph = $from.doc.type.schema.nodes.paragraph?.createAndFill()
  const fallback = Fragment.from(paragraph)
  return paragraph && $from.parent.canReplace($from.index(), $to.index(), fallback) ? fallback : null
}

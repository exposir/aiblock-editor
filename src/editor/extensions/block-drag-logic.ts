import { closeHistory } from '@tiptap/pm/history'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { MAX_COLUMNS } from './column-widths'
import { insertBlockIntoColumnEdge, removeColumn } from './columns'
import { blockAt, blockRange, exactBlockReplacement } from './block-range'
import type { BlockRange } from './block-range'
import { selectInsertedBlocks } from './multi-block-selection'

export type BlockDropSide = 'left' | 'right' | 'top' | 'bottom'

export interface BlockDragSource {
  readonly anchorBlockPos: number
  readonly headBlockPos: number
}

export interface BlockDropTarget {
  readonly blockPos: number
  readonly side: BlockDropSide
}

export interface Point {
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function getBlockDropSide(rect: Rect, point: Point, allowEdges: boolean): BlockDropSide {
  if (allowEdges) {
    const edge = Math.min((rect.right - rect.left) * 0.22, 56)
    if (point.x <= rect.left + edge) return 'left'
    if (point.x >= rect.right - edge) return 'right'
  }
  return point.y < (rect.top + rect.bottom) / 2 ? 'top' : 'bottom'
}

function containingColumns($pos: ResolvedPos) {
  if ($pos.depth < 2 || $pos.parent.type.name !== 'column') return null
  const listDepth = $pos.depth - 1
  const list = $pos.node(listDepth)
  if (list.type.name !== 'columnList') return null
  return { list, listPos: $pos.before(listDepth), columnIndex: $pos.index(listDepth) }
}

function containsColumnList(node: ProseMirrorNode): boolean {
  if (node.type.name === 'columnList') return true
  return node.children.some(containsColumnList)
}

export function allowsColumnDrop(doc: ProseMirrorNode, source: BlockDragSource, targetPos: number): boolean {
  const range = blockRange(doc, source.anchorBlockPos, source.headBlockPos)
  const target = blockAt(doc, targetPos)
  const columnList = doc.type.schema.nodes.columnList
  const column = doc.type.schema.nodes.column
  if (!range || !target || !columnList || !column || target.node.type === columnList ||
      range.blocks.some(containsColumnList) || !column.validContent(Fragment.fromArray([...range.blocks]))) return false

  const columns = containingColumns(target.$pos)
  if (columns) return columns.list.childCount < MAX_COLUMNS
  const index = target.$pos.index()
  return target.$pos.parent.canReplaceWith(index, index + 1, columnList)
}

function removeSource(tr: Transaction, range: BlockRange): boolean {
  const columns = containingColumns(range.$from)
  if (columns && range.blocks.length === range.$from.parent.childCount) {
    return removeColumn(tr, columns.listPos, columns.columnIndex)
  }
  const replacement = exactBlockReplacement(range, Fragment.empty)
  if (!replacement) return false
  tr.step(new ReplaceStep(range.from, range.to, new Slice(replacement, 0, 0)))
  return true
}

function firstBlockInColumn(doc: ProseMirrorNode, listPos: number, index: number): number {
  const list = doc.nodeAt(listPos)!
  let pos = listPos + 2
  for (let i = 0; i < index; i++) pos += list.child(i).nodeSize
  return pos
}

export function createBlockMoveTransaction(
  state: EditorState,
  source: BlockDragSource,
  target: BlockDropTarget,
): Transaction | null {
  const { doc } = state
  const range = blockRange(doc, source.anchorBlockPos, source.headBlockPos)
  const destination = blockAt(doc, target.blockPos)
  if (!range || !destination || (destination.pos >= range.from && destination.pos < range.to)) return null

  const { side } = target
  const sideways = side === 'left' || side === 'right'
  if (sideways && !allowsColumnDrop(doc, source, target.blockPos)) return null
  const originalInsertion = side === 'top' ? destination.pos : destination.pos + destination.node.nodeSize
  if (!sideways && range.$from.sameParent(destination.$pos) &&
      (originalInsertion === range.from || originalInsertion === range.to)) return null

  const tr = state.tr
  if (!removeSource(tr, range)) return null
  const mapped = tr.mapping.mapResult(target.blockPos, 1)
  const afterRemoval = mapped.deleted ? null : blockAt(tr.doc, mapped.pos)
  if (!afterRemoval) return null

  const blocks = Fragment.fromArray([...range.blocks])
  let insertAt: number
  if (sideways) {
    const columns = containingColumns(afterRemoval.$pos)
    const edge = columns
      ? { columnListPos: columns.listPos, columnIndex: columns.columnIndex, side }
      : { blockPos: afterRemoval.pos, side }
    if (!insertBlockIntoColumnEdge(state, tr, edge, range.blocks)) return null
    const index = columns ? columns.columnIndex + (side === 'right' ? 1 : 0) : side === 'right' ? 1 : 0
    insertAt = firstBlockInColumn(tr.doc, columns?.listPos ?? afterRemoval.pos, index)
  } else {
    insertAt = side === 'top' ? afterRemoval.pos : afterRemoval.pos + afterRemoval.node.nodeSize
    const $insertion = tr.doc.resolve(insertAt)
    const index = $insertion.index()
    if (!$insertion.parent.canReplace(index, index, blocks)) return null
    tr.step(new ReplaceStep(insertAt, insertAt, new Slice(blocks, 0, 0)))
  }

  if (tr.doc.eq(doc)) return null
  const selection = selectInsertedBlocks(tr.doc, insertAt, insertAt + blocks.size,
    source.anchorBlockPos > source.headBlockPos)
  if (!selection) return null
  return closeHistory(tr.setSelection(selection)).setMeta('uiEvent', 'drop')
}

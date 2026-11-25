import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode, NodeType, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep, Transform } from '@tiptap/pm/transform'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ColumnEdgeTarget, ColumnLayout, ColumnLayoutInput } from '../types'
import { ColumnListView } from '../views/column-list-view'
import { MAX_COLUMNS, normalizeColumnWidths, resizedColumnWidths } from './column-widths'
import { createNodeIndex, textEdits } from './document-changes'

const columnLayoutKey = new PluginKey('columnLayout')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (layout: ColumnLayout) => ReturnType
      removeColumn: (listPos: number, index: number) => ReturnType
      unwrapColumnList: (listPos: number) => ReturnType
      resizeColumns: (listPos: number, leftIndex: number, delta: number) => ReturnType
    }
  }
}

function nodeAt(doc: ProseMirrorNode, pos: number): ProseMirrorNode | null {
  return Number.isInteger(pos) && pos >= 0 && pos < doc.content.size ? doc.nodeAt(pos) : null
}

function listAt(doc: ProseMirrorNode, pos: number): ProseMirrorNode | null {
  const node = nodeAt(doc, pos)
  return node?.type.name === 'columnList' ? node : null
}

function createColumn(type: NodeType, blocks: readonly ProseMirrorNode[], width: number) {
  return type.createAndFill({ width }, Fragment.fromArray([...blocks]))
}

export function createColumns(schema: Schema, layout: ColumnLayoutInput): ProseMirrorNode | null {
  const count = typeof layout === 'number' ? layout : layout.length
  const { column, columnList } = schema.nodes
  if (!column || !columnList || !Number.isInteger(count) || count < 2 || count > MAX_COLUMNS) return null

  const columns: ProseMirrorNode[] = []
  const widths = normalizeColumnWidths(Array.from({ length: count }))
  for (const [index, width] of widths.entries()) {
    const node = createColumn(column, typeof layout === 'number' ? [] : layout[index] as readonly ProseMirrorNode[], width)
    if (!node) return null
    columns.push(node)
  }
  return columnList.createChecked(null, columns)
}

function removeList(tr: Transform, listPos: number, list: ProseMirrorNode): boolean {
  const $list = tr.doc.resolve(listPos)
  const index = $list.index()
  const paragraph = tr.doc.type.schema.nodes.paragraph?.createAndFill()
  const replacement = $list.parent.canReplace(index, index + 1) ? Fragment.empty : Fragment.from(paragraph)
  if (!$list.parent.canReplace(index, index + 1, replacement)) return false
  tr.step(new ReplaceStep(listPos, listPos + list.nodeSize, new Slice(replacement, 0, 0)))
  return true
}

function joinColumns(tr: Transform, listPos: number, list: ProseMirrorNode, keep: number) {
  const joins: number[] = []
  list.forEach((_node, offset, index) => {
    if (index >= keep) joins.push(listPos + 1 + offset)
  })
  for (const pos of joins.reverse()) tr.join(pos)
}

export function unwrapColumnList(tr: Transform, listPos: number): boolean {
  const list = listAt(tr.doc, listPos)
  if (!list) return false
  let blocks = Fragment.empty
  list.forEach(column => { blocks = blocks.append(column.content) })
  if (!blocks.size) return removeList(tr, listPos, list)

  const $list = tr.doc.resolve(listPos)
  const index = $list.index()
  if (!$list.parent.canReplace(index, index + 1, blocks)) return false

  joinColumns(tr, listPos, list, 1)
  // Keep the gap mapped so selection and decorations follow the lifted blocks.
  const from = listPos + 2
  const to = from + blocks.size
  tr.step(new ReplaceAroundStep(listPos, to + 2, from, to, Slice.empty, 0))
  return true
}

export function removeColumn(tr: Transform, listPos: number, index: number): boolean {
  const list = listAt(tr.doc, listPos)
  if (!list || !Number.isInteger(index) || index < 0 || index >= list.childCount) return false
  if (list.childCount === 1) return removeList(tr, listPos, list)

  const pos = listPos + 1 + columnOffset(list, index)
  tr.delete(pos, pos + list.child(index).nodeSize)
  return true
}

function columnOffset(list: ProseMirrorNode, index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) offset += list.child(i).nodeSize
  return offset
}

function writeWidths(tr: Transform, listPos: number, list: ProseMirrorNode, widths: readonly number[]) {
  list.forEach((column, offset, index) => {
    const width = widths[index]
    if (width !== undefined && column.attrs.width !== width) {
      tr.setNodeAttribute(listPos + 1 + offset, 'width', width)
    }
  })
}

export function resizeColumns(tr: Transform, listPos: number, leftIndex: number, delta: number): boolean {
  const list = listAt(tr.doc, listPos)
  if (!list || list.childCount < 2 || list.childCount > MAX_COLUMNS) return false
  const widths = resizedColumnWidths(normalizeColumnWidths(list.children.map(column => column.attrs.width)), leftIndex, delta)
  if (!widths) return false

  writeWidths(tr, listPos, list, widths)
  return true
}

/** Target positions are in tr.doc. The caller owns the source of blocks and dispatches the transaction. */
export function insertBlockIntoColumnEdge(
  state: EditorState,
  tr: Transaction,
  target: ColumnEdgeTarget,
  blocks: readonly ProseMirrorNode[],
): boolean {
  const { column, columnList } = state.schema.nodes
  if (!column || !columnList || !blocks.length || !column.validContent(Fragment.fromArray([...blocks]))) return false

  if ('columnListPos' in target) {
    const { columnListPos, columnIndex, side } = target
    const list = listAt(tr.doc, columnListPos)
    if (!list || list.childCount >= MAX_COLUMNS || !Number.isInteger(columnIndex) ||
        columnIndex < 0 || columnIndex >= list.childCount) return false

    const count = list.childCount
    const index = side === 'left' ? columnIndex : columnIndex + 1
    const newWidth = 100 / (count + 1)
    const weights = normalizeColumnWidths(list.children.map(child => child.attrs.width))
      .map(width => width * count / (count + 1))
    weights.splice(index, 0, newWidth)
    tr.insert(columnListPos + 1 + columnOffset(list, index), column.createChecked({ width: newWidth }, [...blocks]))
    writeWidths(tr, columnListPos, tr.doc.nodeAt(columnListPos)!, normalizeColumnWidths(weights))
    return true
  }

  const { blockPos, side } = target
  const block = nodeAt(tr.doc, blockPos)
  if (!block || block.type === columnList || !column.validContent(Fragment.from(block))) return false
  const $block = tr.doc.resolve(blockPos)
  const index = $block.index()
  if (!$block.parent.canReplaceWith(index, index + 1, columnList)) return false

  const added = column.createChecked({ width: 50 }, [...blocks])
  const receiving = column.create({ width: 50 })
  const shell = columnList.create(null, side === 'left' ? [added, receiving] : [receiving, added])
  const end = blockPos + block.nodeSize
  const insertAt = 2 + (side === 'left' ? added.nodeSize : 0)
  return !tr.maybeStep(new ReplaceAroundStep(
    blockPos, end, blockPos, end, new Slice(Fragment.from(shell), 0, 0), insertAt,
  )).failed
}

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column-list]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column-list': '' }), 0]
  },

  addCommands() {
    return {
      insertColumns: layout => ({ state, commands }) => {
        const list = createColumns(state.schema, layout)
        return list ? commands.insertContent(list) : false
      },
      removeColumn: (listPos, index) => ({ tr, dispatch }) =>
        removeColumn(dispatch ? tr : new Transform(tr.doc), listPos, index),
      unwrapColumnList: listPos => ({ tr, dispatch }) =>
        unwrapColumnList(dispatch ? tr : new Transform(tr.doc), listPos),
      resizeColumns: (listPos, leftIndex, delta) => ({ tr, dispatch }) =>
        resizeColumns(dispatch ? tr : new Transform(tr.doc), listPos, leftIndex, delta),
    }
  },

  onBeforeCreate() {
    this.editor.on('mount', ({ editor }) => {
      editor.view.dispatch(editor.state.tr.setMeta(columnLayoutKey, true).setMeta('addToHistory', false))
    })
  },

  addProseMirrorPlugins() {
    const type = this.type
    const columns = createNodeIndex(node => node.type === type)
    return [new Plugin({
      key: columnLayoutKey,
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.getMeta(columnLayoutKey) || (tr.docChanged && textEdits(tr) === null))) return null
        const positions = columns(state.doc).map(({ pos }) => pos)

        const tr = state.tr
        for (const pos of positions.reverse()) {
          let list = tr.doc.nodeAt(pos)!
          if (list.childCount < 2) {
            unwrapColumnList(tr, pos)
            continue
          }
          if (list.childCount > MAX_COLUMNS) {
            joinColumns(tr, pos, list, MAX_COLUMNS)
            list = tr.doc.nodeAt(pos)!
          }
          writeWidths(tr, pos, list, normalizeColumnWidths(list.children.map(column => column.attrs.width)))
        }
        return tr.docChanged ? tr : null
      },
    })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnListView, { attrs: ({ HTMLAttributes }) => HTMLAttributes })
  },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: element => {
          const width = Number(element.getAttribute('data-width'))
          return Number.isFinite(width) && width > 0 ? width : null
        },
        renderHTML: attrs => typeof attrs.width === 'number' ? { 'data-width': attrs.width } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '' }), 0]
  },
})

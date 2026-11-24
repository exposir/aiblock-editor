import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { CellSelection, TableMap, cellAround } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'

export { default as TableRow } from '@tiptap/extension-table-row'
export const EnhancedTable = Table.configure({ resizable: true, cellMinWidth: 72 })
export const EnhancedTableCell = TableCell.extend({ content: 'block+' })
export const EnhancedTableHeader = TableHeader.extend({ content: 'block+' })

export type TableAction =
  | 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'toggleHeaderRow'
  | 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn' | 'toggleHeaderColumn' | 'deleteTable'

function cellPosition(editor: Editor, cell: HTMLTableCellElement) {
  const { view } = editor
  if (!view.dom.contains(cell)) return null
  return cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)))
}

export function edgeTableCell(editor: Editor, cell: HTMLTableCellElement, edge: 'right' | 'bottom') {
  const $cell = cellPosition(editor, cell)
  if (!$cell) return null
  const map = TableMap.get($cell.node(-1))
  const index = edge === 'right' ? map.width - 1 : (map.height - 1) * map.width
  const offset = map.map[index]
  const dom = offset === undefined ? null : editor.view.nodeDOM($cell.start(-1) + offset)
  return dom instanceof HTMLTableCellElement ? dom : null
}

function toggleAxisHeaders(tr: Transaction, cellPos: number, axis: 'row' | 'column', apply: boolean) {
  const $cell = tr.doc.resolve(cellPos)
  const table = $cell.node(-1)
  const start = $cell.start(-1)
  const map = TableMap.get(table)
  const { top, left } = map.findCell(cellPos - start)
  const { tableCell, tableHeader } = tr.doc.type.schema.nodes
  if (!tableCell || !tableHeader) return false
  const offsets = axis === 'row' ? map.map.slice(top * map.width, (top + 1) * map.width)
    : Array.from({ length: map.height }, (_, row) => map.map[row * map.width + left]!)
  const cells = [...new Set(offsets)].map(offset => ({ offset, node: table.nodeAt(offset)! }))
  const type = cells.every(({ node }) => node.type === tableHeader) ? tableCell : tableHeader
  if (apply) for (const { offset, node } of cells) {
    if (node.type !== type) tr.setNodeMarkup(start + offset, type, node.attrs)
  }
  return true
}

export function runTableAction(editor: Editor, cell: HTMLTableCellElement, action: TableAction): boolean {
  const { view } = editor
  const $cell = cellPosition(editor, cell)
  if (!$cell) return false
  const chain = editor.chain().command(({ tr }) => {
    tr.setSelection(CellSelection.create(tr.doc, $cell.pos))
    return true
  })
  const applied = action === 'toggleHeaderRow' || action === 'toggleHeaderColumn'
    ? chain.command(({ tr, dispatch }) =>
      toggleAxisHeaders(tr, $cell.pos, action === 'toggleHeaderRow' ? 'row' : 'column', !!dispatch)).run()
    : chain[action]().run()
  view.focus()
  return applied
}

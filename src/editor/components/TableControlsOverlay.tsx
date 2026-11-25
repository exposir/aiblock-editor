import type { Editor } from '@tiptap/core'
import { CellSelection, cellAround, columnResizingPluginKey } from '@tiptap/pm/tables'
import { Ellipsis, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { edgeTableCell, runTableAction } from '../extensions/enhanced-table'
import type { TableAction } from '../extensions/enhanced-table'
import { useAnchoredPosition, useEditorSelector, useOverlayRect } from './editor-ui'

const rowActions: readonly [TableAction, string][] = [
  ['addRowBefore', '在上方插入行'], ['addRowAfter', '在下方插入行'],
  ['toggleHeaderRow', '切换表头行'], ['deleteRow', '删除行'],
]
const columnActions: readonly [TableAction, string][] = [
  ['addColumnBefore', '在左侧插入列'], ['addColumnAfter', '在右侧插入列'],
  ['toggleHeaderColumn', '切换表头列'], ['deleteColumn', '删除列'],
]

interface TableMenu {
  readonly axis: 'row' | 'column'
  readonly anchor: HTMLButtonElement
  readonly cell: HTMLTableCellElement
}

const axisSize = 20
const railSize = 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function readTableSelection(editor: Editor | null) {
  if (!editor) return { near: null, edge: null }
  const state = editor.state
  const cell = state.selection instanceof CellSelection ? state.selection.$headCell : cellAround(state.selection.$head)
  const resize = columnResizingPluginKey.getState(state)
  return {
    near: cell ? editor.view.nodeDOM(cell.pos) : null,
    edge: resize && resize.activeHandle >= 0 ? editor.view.nodeDOM(resize.activeHandle) : null,
  }
}

function sameTableSelection(a: ReturnType<typeof readTableSelection>, b: ReturnType<typeof readTableSelection>) {
  return a.near === b.near && a.edge === b.edge
}

export function TableControlsOverlay({ editor, host }: { editor: Editor; host: HTMLElement }) {
  const { near, edge } = useEditorSelector(editor, readTableSelection, sameTableSelection)
  const layer = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HTMLTableCellElement | null>(null)
  const [menu, setMenu] = useState<TableMenu | null>(null)
  const dom = editor.view.dom
  const owner = dom.ownerDocument
  const validMenu = menu?.cell.isConnected && menu.anchor.isConnected &&
    dom.contains(menu.cell) && !menu.cell.closest('[inert]') ? menu : null
  const cell = validMenu?.cell ?? (hover?.isConnected && dom.contains(hover) ? hover :
    near instanceof HTMLTableCellElement && near.isConnected ? near : null)
  const table = cell?.closest('table') ?? null
  const wrapper = table?.closest<HTMLElement>('.tableWrapper') ?? table
  const resizeCell = edge instanceof HTMLElement ? edge : null
  const tableRect = useOverlayRect(table, host, dom)
  const wrapperRect = useOverlayRect(wrapper, host, dom)
  const cellRect = useOverlayRect(cell, host, dom)
  const edgeRect = useOverlayRect(resizeCell, host, dom)
  const left = Math.max(0, wrapperRect?.left ?? 0)
  const right = wrapperRect?.right ?? 0
  const visibleLeft = Math.max(left, tableRect?.left ?? 0)
  const visibleRight = Math.min(right, tableRect?.right ?? 0)
  const visible = !!(tableRect && wrapperRect && cellRect && tableRect.width > 0 && tableRect.height > 0 &&
    visibleRight - visibleLeft >= axisSize)
  const activeMenu = visible ? validMenu : null
  useAnchoredPosition(panel, activeMenu?.anchor ?? null, activeMenu?.axis === 'row' ? 'right-start' : 'bottom-start')

  useEffect(() => {
    if (menu && !validMenu) setMenu(null)
  }, [menu, validMenu])

  useEffect(() => {
    const dom = editor.view.dom
    const doc = dom.ownerDocument
    function move(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element) || layer.current?.contains(target) || panel.current?.contains(target)) return
      const hit = target.closest('td, th')
      if (hit instanceof HTMLTableCellElement && dom.contains(hit)) {
        setHover(hit)
        return
      }
      setHover(previous => {
        const wrapper = previous?.closest<HTMLElement>('.tableWrapper')
        const rect = wrapper?.getBoundingClientRect()
        if (rect && event.clientX >= rect.left - 32 && event.clientX <= rect.right + 26 &&
            event.clientY >= rect.top - 26 && event.clientY <= rect.bottom + 26) return previous
        return null
      })
    }
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !layer.current?.contains(event.target) &&
          !panel.current?.contains(event.target)) setMenu(null)
    }
    doc.addEventListener('pointermove', move, { passive: true })
    doc.addEventListener('pointerdown', dismiss, true)
    return () => {
      doc.removeEventListener('pointermove', move)
      doc.removeEventListener('pointerdown', dismiss, true)
    }
  }, [editor])

  if (!editor.isEditable || !table || !cell || table.closest('[inert]')) return null

  function append(edge: 'right' | 'bottom') {
    const edgeCell = edgeTableCell(editor, cell!, edge)
    if (edgeCell) runTableAction(editor, edgeCell, edge === 'right' ? 'addColumnAfter' : 'addRowAfter')
  }

  function choose(action: TableAction) {
    if (!activeMenu) return
    setMenu(null)
    runTableAction(editor, activeMenu.cell, action)
  }

  return createPortal(
    <>
      <div ref={layer} className="table-controls-layer" data-editor-overlay="">
        {visible && tableRect && cellRect && <>
          <button className="table-add-rail table-add-right" type="button" aria-label="在表格右侧新增列"
            style={{ left: clamp(tableRect.right + 3, left, right - railSize), top: tableRect.top, height: tableRect.height }}
            onMouseDown={event => event.preventDefault()} onClick={() => append('right')}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button className="table-add-rail table-add-bottom" type="button" aria-label="在表格底部新增行"
            style={{ left: visibleLeft, top: tableRect.bottom + 3, width: visibleRight - visibleLeft }}
            onMouseDown={event => event.preventDefault()} onClick={() => append('bottom')}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button className="table-axis-trigger" type="button" aria-label="当前行操作" aria-expanded={activeMenu?.axis === 'row'}
            style={{ left: clamp(tableRect.left - axisSize - 2, left, right - axisSize),
              top: clamp(cellRect.top + (cellRect.height - axisSize) / 2, tableRect.top, tableRect.bottom - axisSize) }}
            onClick={event => setMenu(activeMenu?.axis === 'row' ? null : { axis: 'row', anchor: event.currentTarget, cell })}>
            <Ellipsis size={14} aria-hidden="true" />
          </button>
          <button className="table-axis-trigger" type="button" aria-label="当前列操作" aria-expanded={activeMenu?.axis === 'column'}
            style={{ left: clamp(cellRect.left + (cellRect.width - axisSize) / 2, visibleLeft, visibleRight - axisSize),
              top: Math.max(0, tableRect.top - 24) }}
            onClick={event => setMenu(activeMenu?.axis === 'column' ? null : { axis: 'column', anchor: event.currentTarget, cell })}>
            <Ellipsis size={14} aria-hidden="true" />
          </button>
          {edgeRect && edgeRect.right >= visibleLeft && edgeRect.right <= visibleRight &&
            resizeCell?.closest('table') === table && <span className="table-resize-indicator" aria-hidden="true"
            style={{ left: edgeRect.right - 1, top: tableRect.top, height: tableRect.height }} />}
        </>}
      </div>
      {activeMenu && <div ref={panel} className="overlay-card table-action-menu" role="group" data-editor-overlay=""
        aria-label={activeMenu.axis === 'row' ? '表格行操作' : '表格列操作'}
        onKeyDown={event => {
          if (event.key === 'Escape') { setMenu(null); activeMenu.anchor.focus() }
        }}>
        {(activeMenu.axis === 'row' ? rowActions : columnActions).map(([action, label]) => (
          <button key={action} type="button" onClick={() => choose(action)}>{label}</button>
        ))}
        <button className="block-delete" type="button" onClick={() => choose('deleteTable')}>删除整表</button>
      </div>}
    </>,
    host,
  )
}

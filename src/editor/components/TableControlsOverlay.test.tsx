import { Editor } from '@tiptap/core'
import { TableMap, cellAround } from '@tiptap/pm/tables'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { TableControlsOverlay } from './TableControlsOverlay'

const editors: Editor[] = []
const rects = new WeakMap<Element, DOMRect>()

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function setRect(element: Element, left: number, top: number, width: number, height: number) {
  rects.set(element, domRect(left, top, width, height))
}

const tableHtml = `<table><tbody>
  <tr><th><p>H1</p></th><th><p>H2</p></th><th><p>H3</p></th></tr>
  <tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr>
  <tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr>
</tbody></table>`

interface Fixture {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly table: HTMLTableElement
  readonly wrapper: HTMLElement
  readonly cells: HTMLTableCellElement[]
  readonly target: HTMLTableCellElement
  readonly view: ReturnType<typeof render>
}

function mountTable({ select = true, content = tableHtml }: { select?: boolean; content?: string } = {}): Fixture {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(editor)
  document.body.append(editor.view.dom)
  const host = document.createElement('div')
  host.setAttribute('data-document-overlays', '')
  document.body.append(host)
  setRect(host, 0, 0, 800, 600)
  const table = editor.view.dom.querySelector('table')!
  const wrapper = table.closest<HTMLElement>('.tableWrapper') ?? table
  setRect(wrapper, 0, 0, 600, 260)
  setRect(table, 20, 20, 560, 180)
  const cells = [...table.querySelectorAll<HTMLTableCellElement>('td, th')]
  cells.forEach((cell, index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    setRect(cell, 20 + column * (560 / 3), 20 + row * 60, 560 / 3, 60)
  })
  const target = cells.find(cell => cell.tagName === 'TD' && cell.textContent === 'B') ?? cells[0]!
  if (select) {
    const $cell = cellAround(editor.state.doc.resolve(editor.view.posAtDOM(target, 0)))
    if ($cell) editor.commands.setTextSelection($cell.pos + 1)
  }
  const view = render(<TableControlsOverlay editor={editor} host={host} />)
  return { editor, host, table, wrapper, cells, target, view }
}

function tableNode(editor: Editor): import('@tiptap/pm/model').Node | null {
  const found: import('@tiptap/pm/model').Node[] = []
  editor.state.doc.descendants(node => { if (node.type.name === 'table') found.push(node) })
  return found[0] ?? null
}

function nodesNamed(editor: Editor, name: string) {
  let count = 0
  editor.state.doc.descendants(node => { if (node.type.name === name) count++ })
  return count
}

async function choose(action: string, axis: 'row' | 'column') {
  fireEvent.click(screen.getByRole('button', { name: axis === 'row' ? '当前行操作' : '当前列操作' }))
  await waitFor(() => expect(document.querySelector('.table-action-menu')).not.toBeNull())
  const menu = document.querySelector('.table-action-menu')!
  const button = [...menu.querySelectorAll('button')].find(item => item.textContent?.trim() === action)
  expect(button, action).toBeDefined()
  fireEvent.click(button!)
  await waitFor(() => expect(document.querySelector('.table-action-menu')).toBeNull())
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const zero = domRect(0, 0, 0, 0)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? zero
  })
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  vi.restoreAllMocks()
})

describe('TableControlsOverlay', () => {
  /*
   * Testing strategy
   * @partition render: 悬停与聚焦单元格时在外部 Portal 渲染右缘/底缘/行列触发器
   * @partition clamp: 宽表横向滚动时所有浮层夹紧在 .tableWrapper 可视矩形内
   * @partition rails: 右缘 + 调 edgeTableCell 增列，底缘 + 增行
   * @partition actions: 行列菜单全部动作和删除整表
   * @partition undo: Undo 移除表格后菜单检测断连并自动关闭
   */
  it('render: 聚焦单元格时渲染右缘/底缘 + 和行列操作按钮', async () => {
    mountTable()
    expect(await screen.findByRole('button', { name: '在表格右侧新增列' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在表格底部新增行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前行操作' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前列操作' })).toBeInTheDocument()
    expect(document.querySelector('.table-controls-layer')?.querySelectorAll('button')).toHaveLength(4)
  })

  it('render: 悬停单元格时渲染浮层，移出表格后收起', async () => {
    const { editor, table, target } = mountTable({ select: false, content: '<p>outside</p>' + tableHtml })
    expect(screen.queryByRole('button', { name: '在表格右侧新增列' })).toBeNull()
    fireEvent.pointerMove(target, { bubbles: true })
    expect(await screen.findByRole('button', { name: '在表格右侧新增列' })).toBeInTheDocument()
    fireEvent(document.body, new MouseEvent('pointermove', { bubbles: true, clientX: 900, clientY: 900 }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '在表格右侧新增列' })).toBeNull())
    expect(table).toBe(editor.view.dom.querySelector('table'))
  })

  it('clamp: 宽表横向滚动时浮层夹紧在 wrapper 内', async () => {
    const { wrapper, cells } = mountTable()
    await screen.findByRole('button', { name: '在表格右侧新增列' })
    setRect(wrapper, 0, 0, 600, 260)
    const table = wrapper.querySelector('table')!
    setRect(table, -200, 20, 900, 180)
    cells.forEach((cell, index) => {
      setRect(cell, -200 + (index % 3) * 300, 20 + Math.floor(index / 3) * 60, 300, 60)
    })
    Object.defineProperty(wrapper, 'scrollLeft', { configurable: true, value: 200 })
    fireEvent.scroll(wrapper)
    await waitFor(() => {
      const rightRail = screen.getByRole('button', { name: '在表格右侧新增列' })
      expect(parseFloat(rightRail.style.left)).toBeLessThanOrEqual(600 - 16)
      expect(parseFloat(rightRail.style.left)).toBeGreaterThanOrEqual(0)
      const rowTrigger = screen.getByRole('button', { name: '当前行操作' })
      expect(parseFloat(rowTrigger.style.left)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(rowTrigger.style.left)).toBeLessThanOrEqual(600 - 20)
      const bottomRail = screen.getByRole('button', { name: '在表格底部新增行' })
      expect(parseFloat(bottomRail.style.left)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(bottomRail.style.width) + parseFloat(bottomRail.style.left)).toBeLessThanOrEqual(600)
    })
  })

  it('rails: 右缘 + 通过 edgeTableCell 增列，底缘 + 增行', async () => {
    const { editor } = mountTable()
    fireEvent.click(await screen.findByRole('button', { name: '在表格右侧新增列' }))
    await waitFor(() => expect(TableMap.get(tableNode(editor)!)).toMatchObject({ width: 4 }))
    fireEvent.click(screen.getByRole('button', { name: '在表格底部新增行' }))
    await waitFor(() => expect(tableNode(editor)?.childCount).toBe(4))
  })

  it.each([
    ['在上方插入行', 'row', (editor: Editor) => expect(tableNode(editor)?.childCount).toBe(4)],
    ['在下方插入行', 'row', (editor: Editor) => expect(tableNode(editor)?.childCount).toBe(4)],
    ['切换表头行', 'row', (editor: Editor) => expect(nodesNamed(editor, 'tableHeader')).toBe(6)],
    ['删除行', 'row', (editor: Editor) => expect(tableNode(editor)?.childCount).toBe(2)],
    ['在左侧插入列', 'column', (editor: Editor) => expect(TableMap.get(tableNode(editor)!).width).toBe(4)],
    ['在右侧插入列', 'column', (editor: Editor) => expect(TableMap.get(tableNode(editor)!).width).toBe(4)],
    ['切换表头列', 'column', (editor: Editor) => expect(nodesNamed(editor, 'tableHeader')).toBe(5)],
    ['删除列', 'column', (editor: Editor) => expect(TableMap.get(tableNode(editor)!).width).toBe(2)],
    ['删除整表', 'row', (editor: Editor) => expect(tableNode(editor)).toBeNull()],
  ] as const)('actions: %s', async (action, axis, assert) => {
    const { editor } = mountTable()
    await screen.findByRole('button', { name: '在表格右侧新增列' })
    await choose(action, axis)
    await waitFor(() => assert(editor))
  })

  it('undo: 菜单打开时 Undo 删除表格，菜单自动关闭不残留', async () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: '<p>start</p>' })
    editors.push(editor)
    document.body.append(editor.view.dom)
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    const host = document.createElement('div')
    host.setAttribute('data-document-overlays', '')
    document.body.append(host)
    setRect(host, 0, 0, 800, 600)
    const table = editor.view.dom.querySelector('table')!
    const wrapper = table.closest<HTMLElement>('.tableWrapper') ?? table
    setRect(wrapper, 0, 0, 600, 260)
    setRect(table, 20, 20, 560, 180)
    const cells = [...table.querySelectorAll<HTMLTableCellElement>('td, th')]
    cells.forEach((cell, index) => {
      setRect(cell, 20 + (index % 3) * (560 / 3), 20 + Math.floor(index / 3) * 60, 560 / 3, 60)
    })
    const target = cells[4]!
    const $cell = cellAround(editor.state.doc.resolve(editor.view.posAtDOM(target, 0)))
    if ($cell) editor.commands.setTextSelection($cell.pos + 1)
    render(<TableControlsOverlay editor={editor} host={host} />)
    fireEvent.click(await screen.findByRole('button', { name: '当前行操作' }))
    await waitFor(() => expect(document.querySelector('.table-action-menu')).not.toBeNull())
    act(() => editor.commands.undo())
    await waitFor(() => expect(document.querySelector('.table-action-menu')).toBeNull())
    expect(editor.view.dom.querySelector('table')).toBeNull()
  })
})

import { Editor } from '@tiptap/core'
import { CellSelection, TableMap, columnResizingPluginKey } from '@tiptap/pm/tables'
import { describe, expect, it, onTestFinished } from 'vitest'
import { runTableAction } from './enhanced-table'
import { createEditorExtensions } from './index'

function tableEditor(content: string) {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  onTestFinished(() => editor.destroy())
  return editor
}

describe('enhanced table', () => {
  // @partition nested: round-trips multiple blocks in body cells and headers
  // @partition grow-shrink: row and column commands preserve a valid grid
  // @partition headers: an overlay action targets the current row or column
  it('nested: preserves a paragraph plus list in headers and a paragraph plus task list in cells', () => {
    const editor = tableEditor('<table><tbody><tr><th><p>Header</p><ul><li><p>Item</p></li></ul></th></tr>' +
      '<tr><td><p>Body</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Done</p></div></li></ul>' +
      '</td></tr></tbody></table>')
    const table = editor.state.doc.firstChild!
    expect(table.child(0).child(0).children.map(node => node.type.name)).toEqual(['paragraph', 'bulletList'])
    expect(table.child(1).child(0).children.map(node => node.type.name)).toEqual(['paragraph', 'taskList'])
    expect(tableEditor(editor.getHTML()).getJSON()).toEqual(editor.getJSON())
    expect(editor.getHTML()).not.toMatch(/<input\b/)
    expect(columnResizingPluginKey.getState(editor.state)?.activeHandle).toBe(-1)
    editor.state.doc.check()
  })

  it('grow-shrink: adds and deletes rows and columns around the selected cell', () => {
    const editor = tableEditor('<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr>' +
      '<tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p>After</p>')
    function dimensions() {
      const { width, height } = TableMap.get(editor.state.doc.firstChild!)
      return [width, height]
    }
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 2)))
    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(editor.commands.addRowAfter()).toBe(true)
    expect(dimensions()).toEqual([3, 3])
    expect(editor.commands.deleteColumn()).toBe(true)
    expect(editor.commands.deleteRow()).toBe(true)
    expect(dimensions()).toEqual([2, 2])
    expect(editor.state.doc.lastChild?.textContent).toBe('After')
    editor.state.doc.check()
  })

  it('headers: toggles the chosen row and column even when they are not the first', () => {
    const editor = tableEditor('<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr>' +
      '<tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>')
    const anchor = () => editor.view.dom.querySelector<HTMLTableCellElement>('tr:nth-child(2) :is(td, th):nth-child(2)')!
    const types = () => editor.state.doc.firstChild?.children.map(row => row.children.map(cell => cell.type.name))
    expect(runTableAction(editor, anchor(), 'toggleHeaderRow')).toBe(true)
    expect(types()).toEqual([['tableCell', 'tableCell'], ['tableHeader', 'tableHeader']])
    expect(runTableAction(editor, anchor(), 'toggleHeaderColumn')).toBe(true)
    expect(types()).toEqual([['tableCell', 'tableHeader'], ['tableHeader', 'tableHeader']])
    editor.state.doc.check()
  })
})

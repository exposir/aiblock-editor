import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createColumns, createEditorExtensions, insertBlockIntoColumnEdge } from './index'

const editors: Editor[] = []

function editor(content: string | JSONContent = '<p></p>') {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

function column(text: string, width?: number) {
  return `<div data-column${width === undefined ? '' : ` data-width="${width}"`}><p>${text}</p></div>`
}

function layout(...columns: string[]) {
  return `<div data-column-list>${columns.join('')}</div>`
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('columns', () => {
  // @partition create: editable columns at supported limits
  // @partition remove: singleton unwrap, deletion and cursor mapping
  // @partition import: over-limit, empty and singleton lists
  // @partition resize: adjacent widths and clamping
  // @partition edge: create a new list and grow one using current transaction positions
  it('create: keeps blank columns for authoring and rejects unsupported counts', () => {
    const instance = editor()
    expect(instance.commands.insertColumns(5)).toBe(true)
    const list = instance.state.doc.firstChild!
    expect(list.childCount).toBe(5)
    expect(list.firstChild?.firstChild?.type.name).toBe('paragraph')
    expect(createColumns(instance.schema, 1)).toBeNull()
    expect(createColumns(instance.schema, 6)).toBeNull()
  })

  it('remove: unwraps the remaining blocks in order and preserves a cursor inside them', () => {
    const instance = editor(layout(column('Remove'), '<div data-column><p>One</p><h2>Two</h2></div>'))
    const headingPos = 1 + instance.state.doc.firstChild!.firstChild!.nodeSize + 1 + 5
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, headingPos + 2)))
    expect(instance.commands.removeColumn(0, 0)).toBe(true)
    expect(instance.state.doc.childCount).toBe(2)
    expect(instance.state.doc.firstChild?.textContent).toBe('One')
    expect(instance.state.doc.lastChild?.type.name).toBe('heading')
    expect(instance.state.selection.$head.parentOffset).toBe(1)
  })

  it('import: folds overflow into the fifth column and removes an empty list', () => {
    const instance = editor(layout(...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(text => column(text))))
    expect(instance.state.doc.firstChild?.childCount).toBe(5)
    expect(instance.state.doc.firstChild?.lastChild?.textContent).toBe('EFG')

    const empty = instance.schema.nodes.columnList!.create()
    instance.view.dispatch(instance.state.tr.insert(instance.state.doc.content.size, empty))
    expect(instance.state.doc.childCount).toBe(1)
    instance.state.doc.check()
  })

  it('import: repairs a nested empty list and unwraps a singleton list in the initial JSON', () => {
    const instance = editor({
      type: 'doc',
      content: [{
        type: 'callout',
        content: [{ type: 'columnList' }],
      }, {
        type: 'columnList',
        content: [{
          type: 'column',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unwrapped' }] }],
        }],
      }],
    })

    instance.state.doc.check()
    expect(instance.state.doc.firstChild?.firstChild?.type.name).toBe('paragraph')
    expect(instance.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(instance.state.doc.lastChild?.textContent).toBe('Unwrapped')
    expect(instance.state.doc.lastChild?.attrs.blockId).toEqual(expect.any(String))
  })

  it('resize: clamps to 15 percent and changes only the adjacent pair', () => {
    const instance = editor(layout(column('A', 20), column('B', 30), column('C', 50)))
    expect(instance.commands.resizeColumns(0, 0, 100)).toBe(true)
    const list = instance.state.doc.firstChild!
    expect([list.child(0).attrs.width, list.child(1).attrs.width, list.child(2).attrs.width]).toEqual([35, 15, 50])
    expect(instance.commands.resizeColumns(0, 2, 1)).toBe(false)
  })

  it('edge: inserts beside a block, then inserts within the same list in a shared transaction', () => {
    const instance = editor('<p>A</p>')
    const block = (text: string) => instance.schema.node('paragraph', null, instance.schema.text(text))
    const tr = instance.state.tr
    expect(insertBlockIntoColumnEdge(instance.state, tr, { blockPos: 0, side: 'left' }, [block('B')])).toBe(true)
    expect(insertBlockIntoColumnEdge(instance.state, tr, { columnListPos: 0, columnIndex: 1, side: 'right' }, [block('C')]))
      .toBe(true)
    instance.view.dispatch(tr)
    const list = instance.state.doc.firstChild!
    expect([list.child(0).textContent, list.child(1).textContent, list.child(2).textContent]).toEqual(['B', 'A', 'C'])
  })

  it('edge: refuses a sixth column without changing the transaction', () => {
    const instance = editor(layout(...['A', 'B', 'C', 'D', 'E'].map(text => column(text))))
    const tr = instance.state.tr
    const block = instance.schema.nodes.paragraph!.create()
    expect(insertBlockIntoColumnEdge(instance.state, tr, { columnListPos: 0, columnIndex: 4, side: 'right' }, [block]))
      .toBe(false)
    expect(tr.steps).toEqual([])
  })

  it('remove: checks unwrapping without mutation and lifts all columns in source order', () => {
    const instance = editor(layout(column('One'), column('Two'), column('Three')))
    const before = instance.state.doc
    expect(instance.can().unwrapColumnList(0)).toBe(true)
    expect(instance.state.doc).toBe(before)
    expect(instance.commands.unwrapColumnList(0)).toBe(true)
    expect(instance.state.doc.children.map(child => child.textContent)).toEqual(['One', 'Two', 'Three'])
  })
})

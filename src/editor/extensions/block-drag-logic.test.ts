import { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createBlockMoveTransaction, getBlockDropSide } from './block-drag-logic'
import type { BlockDropSide } from './block-drag-logic'
import { createEditorExtensions, MultiBlockSelection } from './index'

function editor(content: string) {
  const instance = new Editor({ content, extensions: createEditorExtensions() })
  onTestFinished(() => instance.destroy())
  return instance
}

function columnList(...columns: string[]) {
  return `<div data-column-list>${columns.map(text => `<div data-column><p>${text}</p></div>`).join('')}</div>`
}

function paragraphPos({ doc }: EditorState, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' && node.textContent === text) found = pos
  })
  if (found === -1) throw new Error(`Missing paragraph ${text}`)
  return found
}

function move(instance: Editor, anchor: string, head: string, target: number, side: BlockDropSide) {
  const { state } = instance
  const tr = createBlockMoveTransaction(state, {
    anchorBlockPos: paragraphPos(state, anchor),
    headBlockPos: paragraphPos(state, head),
  }, { blockPos: target, side })
  if (!tr) throw new Error('Expected a move transaction')
  instance.view.dispatch(tr)
  instance.state.doc.check()
}

function texts({ doc }: EditorState) {
  return doc.children.map(node => node.textContent)
}

describe('block drag geometry', () => {
  // @partition direction: four sides and vertical fallback at disabled edges
  // @partition width: proportional edge for narrow blocks, 56px cap for wide blocks
  const bounds = { left: 100, right: 500, top: 100, bottom: 200 }

  it.each([
    [101, 185, true, 'left'],
    [499, 110, true, 'right'],
    [200, 120, true, 'top'],
    [400, 190, true, 'bottom'],
    [101, 185, false, 'bottom'],
    [499, 110, false, 'top'],
  ] as const)('direction: (%s, %s), edges %s → %s', (x, y, allowEdges, side) => {
    expect(getBlockDropSide(bounds, { x, y }, allowEdges)).toBe(side)
  })

  it('width: uses 22% for narrow blocks and caps each edge at 56px', () => {
    const narrow = { ...bounds, right: 200 }
    expect(getBlockDropSide(narrow, { x: 122, y: 120 }, true)).toBe('left')
    expect(getBlockDropSide(narrow, { x: 123, y: 120 }, true)).toBe('top')
    expect(getBlockDropSide(bounds, { x: 156, y: 120 }, true)).toBe('left')
    expect(getBlockDropSide(bounds, { x: 157, y: 120 }, true)).toBe('top')
  })
})

describe('block move transaction', () => {
  // @partition reorder: destination order, identity and selection direction
  // @partition side: two-column layouts at both edges and a third existing column
  // @partition nested: moves into and out of schema-constrained block containers
  // @partition repair: source column removal, unwrapping and undo
  // @partition invalid: selected subtrees, adjacent no-ops and structural edge limits

  it('reorder: moves one block above or below another, preserving its ID', () => {
    const instance = editor('<p>A</p><p>B</p><p>C</p>')
    const id = instance.state.doc.firstChild?.attrs.blockId
    move(instance, 'A', 'A', paragraphPos(instance.state, 'C'), 'bottom')
    expect(texts(instance.state)).toEqual(['B', 'C', 'A'])
    expect(instance.state.doc.lastChild?.attrs.blockId).toBe(id)
    move(instance, 'A', 'A', paragraphPos(instance.state, 'B'), 'top')
    expect(texts(instance.state)).toEqual(['A', 'B', 'C'])
  })

  it('reorder: moves a reversed multi-block range in source order, with one undo', () => {
    const instance = editor('<p>A</p><p>B</p><p>C</p><p>D</p>')
    instance.commands.selectBlockRange(6, 3)
    move(instance, 'C', 'B', 0, 'top')
    expect(texts(instance.state)).toEqual(['B', 'C', 'A', 'D'])
    expect(instance.state.selection.toJSON()).toEqual({ type: 'multiBlock', anchorBlockPos: 3, headBlockPos: 0 })
    expect(instance.commands.undo()).toBe(true)
    expect(texts(instance.state)).toEqual(['A', 'B', 'C', 'D'])
    expect(instance.state.selection.toJSON()).toEqual({ type: 'multiBlock', anchorBlockPos: 6, headBlockPos: 3 })
  })

  it.each([['left', ['Drag', 'Target']], ['right', ['Target', 'Drag']]] as const)(
    'side: %s wraps the target and moved block in a normalized two-column list',
    (side, order) => {
      const instance = editor('<p>Drag</p><p>Target</p>')
      move(instance, 'Drag', 'Drag', paragraphPos(instance.state, 'Target'), side)
      const list = instance.state.doc.firstChild!
      expect(list.type.name).toBe('columnList')
      expect(list.children.map(node => node.textContent)).toEqual(order)
      expect(list.children.map(node => node.attrs.width)).toEqual([50, 50])
      expect(instance.state.selection).toBeInstanceOf(MultiBlockSelection)
      expect(instance.state.selection.content().content.textBetween(0, 6)).toBe('Drag')
    },
  )

  it('side: inserts both source blocks into one new column between existing columns', () => {
    const instance = editor(columnList('One', 'Two') + '<p>Move A</p><p>Move B</p>')
    move(instance, 'Move A', 'Move B', paragraphPos(instance.state, 'Two'), 'left')
    const list = instance.state.doc.firstChild!
    expect(list.children.map(column => column.children.map(block => block.textContent))).toEqual([
      ['One'], ['Move A', 'Move B'], ['Two'],
    ])
    expect(list.children.reduce((total, column) => total + Number(column.attrs.width), 0)).toBeCloseTo(100)
  })

  it.each([
    ['callout', '<aside data-callout><p>Inside</p></aside>'],
    ['toggleContent', '<div data-toggle data-open="true"><div data-toggle-summary>Title</div>' +
      '<div data-toggle-content><p>Inside</p></div></div>'],
    ['tableCell', '<table><tbody><tr><td><p>Inside</p></td><td><p>Adjacent cell</p></td></tr></tbody></table>'],
  ])('nested: moves a block into and out of %s with reversible selections', (parent, content) => {
    const instance = editor('<p>Move</p>' + content + '<p>Outside</p>')
    const original = instance.getJSON()
    const id = instance.state.doc.firstChild?.attrs.blockId

    move(instance, 'Move', 'Move', paragraphPos(instance.state, 'Inside'), 'top')
    const movedPos = paragraphPos(instance.state, 'Move')
    const container = instance.state.doc.resolve(movedPos).parent
    expect(container.type.name).toBe(parent)
    expect(container.children.map(node => node.textContent)).toEqual(['Move', 'Inside'])
    expect(instance.state.doc.nodeAt(movedPos)?.attrs.blockId).toBe(id)
    const nested = instance.getJSON()

    move(instance, 'Move', 'Move', paragraphPos(instance.state, 'Outside'), 'bottom')
    expect(instance.state.doc.lastChild?.attrs.blockId).toBe(id)
    expect(instance.state.doc.resolve(paragraphPos(instance.state, 'Inside')).parent.textContent).toBe('Inside')
    expect(instance.commands.undo()).toBe(true)
    expect(instance.getJSON()).toEqual(nested)
    expect(instance.commands.undo()).toBe(true)
    expect(instance.getJSON()).toEqual(original)
  })

  it('repair: moving the only source block out unwraps the other column and one undo restores the layout', () => {
    const instance = editor(columnList('Drag', 'Stay') + '<p>Target</p>')
    const before = instance.getJSON()
    move(instance, 'Drag', 'Drag', paragraphPos(instance.state, 'Target'), 'bottom')
    expect(texts(instance.state)).toEqual(['Stay', 'Target', 'Drag'])
    expect(instance.state.doc.children.map(node => node.type.name)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(instance.commands.undo()).toBe(true)
    expect(instance.getJSON()).toEqual(before)
    expect(instance.commands.redo()).toBe(true)
    expect(texts(instance.state)).toEqual(['Stay', 'Target', 'Drag'])
  })

  it('repair: moving an entire column beside a sibling keeps two columns', () => {
    const instance = editor(columnList('A', 'B'))
    move(instance, 'A', 'A', paragraphPos(instance.state, 'B'), 'right')
    expect(instance.state.doc.firstChild?.children.map(node => node.textContent)).toEqual(['B', 'A'])
  })

  it.each([
    ['ordinary block', '<p>Target</p>', ['Drag', 'Target']],
    ['existing column', columnList('Left', 'Target'), ['Left', 'Drag', 'Target']],
  ] as const)('repair: sideways drop onto an %s unwraps the source layout and undoes atomically',
    (_target, destination, columns) => {
      const instance = editor(columnList('Drag', 'Stay') + destination)
      const original = instance.getJSON()
      const sourcePos = paragraphPos(instance.state, 'Drag')
      instance.commands.selectBlock(sourcePos)
      move(instance, 'Drag', 'Drag', paragraphPos(instance.state, 'Target'), 'left')

      expect(instance.state.doc.children.map(node => node.type.name)).toEqual(['paragraph', 'columnList'])
      expect(instance.state.doc.firstChild?.textContent).toBe('Stay')
      expect(instance.state.doc.lastChild?.children.map(node => node.textContent)).toEqual(columns)
      const selection = instance.state.selection
      expect(selection).toBeInstanceOf(MultiBlockSelection)
      expect(selection.from).toBe(paragraphPos(instance.state, 'Drag'))
      expect(instance.commands.undo()).toBe(true)
      expect(instance.getJSON()).toEqual(original)
      expect(instance.state.selection.toJSON())
        .toEqual({ type: 'multiBlock', anchorBlockPos: sourcePos, headBlockPos: sourcePos })
    },
  )

  it('invalid: rejects moves into the source, its descendants, or the same sibling slot', () => {
    const instance = editor('<blockquote><p>Inside</p></blockquote><p>After</p>')
    const { state } = instance
    const source = { anchorBlockPos: 0, headBlockPos: 0 }
    expect(createBlockMoveTransaction(state, source, { blockPos: 0, side: 'top' })).toBeNull()
    expect(createBlockMoveTransaction(state, source, { blockPos: 1, side: 'right' })).toBeNull()
    expect(createBlockMoveTransaction(state, source, { blockPos: paragraphPos(state, 'After'), side: 'top' })).toBeNull()
    expect(instance.state).toBe(state)
  })

  it('invalid: rejects a sixth column and dragging a column list sideways', () => {
    const instance = editor(columnList('A', 'B', 'C', 'D', 'E') + '<p>Outside</p>')
    const { state } = instance
    const outside = paragraphPos(state, 'Outside')
    const source = { anchorBlockPos: outside, headBlockPos: outside }
    expect(createBlockMoveTransaction(state, source, { blockPos: 2, side: 'left' })).toBeNull()
    expect(createBlockMoveTransaction(state, source, { blockPos: 0, side: 'left' })).toBeNull()
    expect(createBlockMoveTransaction(state, { anchorBlockPos: 0, headBlockPos: 0 },
      { blockPos: outside, side: 'right' })).toBeNull()
  })
})

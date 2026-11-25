import { Editor } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createEditorExtensions, MultiBlockSelection } from './index'

function editor(content: string) {
  const instance = new Editor({ content, extensions: createEditorExtensions() })
  onTestFinished(() => instance.destroy())
  return instance
}

function key(instance: Editor, name: string, shiftKey = false) {
  instance.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }))
}

function selected(instance: Editor) {
  const { selection } = instance.state
  expect(selection).toBeInstanceOf(MultiBlockSelection)
  return (selection as MultiBlockSelection).blockRange.blocks.map(block => block.textContent)
}

describe('MultiBlockSelection', () => {
  // @partition keyboard: nearest block, direction changes, exit, and edit keys
  // @partition siblings: rejects cross-container selection
  // @partition commands: deletion, non-destructive duplicate, color, and wrapping
  // @partition map: mapped range and loss of selected endpoints
  // @partition serialization: direction and closed clipboard slice
  // @partition replace: block and inline replacements

  it('keyboard: Escape selects the nearest block and returns to text on the next Escape', () => {
    const instance = editor('<blockquote><p>A</p><p>B</p></blockquote><p>C</p>')
    key(instance, 'Escape')
    expect(selected(instance)).toEqual(['A'])
    expect(instance.view.dom.querySelector('.aiblock-block-selected')?.textContent).toBe('A')
    key(instance, 'Escape')
    expect(instance.state.selection).toBeInstanceOf(TextSelection)
    expect(instance.state.selection.$head.parent.textContent).toBe('A')
    expect(instance.view.dom.querySelector('.aiblock-block-selected')).toBeNull()
  })

  it('keyboard: Shift+Arrow extends and shrinks from the head in both directions', () => {
    const instance = editor('<p>A</p><p>B</p><p>C</p>')
    expect(instance.commands.selectBlock(3)).toBe(true)
    key(instance, 'ArrowUp', true)
    expect(selected(instance)).toEqual(['A', 'B'])
    expect(instance.state.selection.toJSON()).toMatchObject({ anchorBlockPos: 3, headBlockPos: 0 })
    key(instance, 'ArrowDown', true)
    expect(selected(instance)).toEqual(['B'])
    key(instance, 'ArrowDown', true)
    expect(selected(instance)).toEqual(['B', 'C'])
  })

  it('siblings: rejects positions in separate parents', () => {
    const instance = editor('<blockquote><p>A</p></blockquote><p>B</p>')
    const before = instance.state.selection
    expect(instance.commands.selectBlockRange(1, 5)).toBe(false)
    expect(instance.state.selection.eq(before)).toBe(true)
  })

  it.each(['Backspace', 'Delete'])('commands: %s deletes the range and leaves one legal paragraph', name => {
    const instance = editor('<p>A</p><p>B</p>')
    instance.commands.selectBlockRange(0, 3)
    key(instance, name)
    expect(instance.state.doc.children.map(node => [node.type.name, node.textContent])).toEqual([['paragraph', '']])
    expect(instance.state.selection.$head.parent.type.name).toBe('paragraph')
    instance.state.doc.check()
  })

  it('commands: deleting the only block in a column keeps the parent valid', () => {
    const instance = editor('<div data-column-list><div data-column><p>A</p></div><div data-column><p>B</p></div></div>')
    instance.commands.selectBlock(2)
    expect(instance.commands.deleteSelectedBlocks()).toBe(true)
    expect(instance.state.doc.firstChild?.firstChild?.firstChild?.textContent).toBe('')
    expect(instance.state.doc.firstChild?.childCount).toBe(2)
    instance.state.doc.check()
  })

  it('commands: duplicates all selected blocks with fresh IDs throughout nested content', () => {
    const instance = editor('<p>A</p><blockquote><p>B</p></blockquote><p>C</p>')
    instance.commands.selectBlockRange(3, 0)
    expect(instance.commands.duplicateSelectedBlocks()).toBe(true)
    expect(instance.state.doc.children.map(node => node.textContent)).toEqual(['A', 'B', 'A', 'B', 'C'])
    expect(selected(instance)).toEqual(['A', 'B'])
    const ids: string[] = []
    instance.state.doc.descendants(node => {
      if (node.isBlock) ids.push(node.attrs.blockId)
    })
    expect(new Set(ids).size).toBe(ids.length)
    expect(instance.commands.undo()).toBe(true)
    expect(instance.state.selection.toJSON()).toEqual({ type: 'multiBlock', anchorBlockPos: 3, headBlockPos: 0 })
  })

  it('commands: sets background on the range and serializes it with HTML', () => {
    const instance = editor('<p>A</p><h2>B</h2><p>C</p>')
    instance.commands.selectBlockRange(0, 3)
    expect(instance.commands.setSelectedBlocksBg('purple')).toBe(true)
    const restored = editor(instance.getHTML())
    expect(restored.state.doc.children.map(node => node.attrs.blockBg)).toEqual(['purple', 'purple', 'default'])
  })

  it('commands: wraps text and nested content in one themed callout with original block IDs', () => {
    const instance = editor('<h2>A</h2><ul><li><p>B</p></li></ul>')
    const ids = instance.state.doc.children.map(node => node.attrs.blockId)
    instance.commands.selectBlockRange(0, 3)
    expect(instance.commands.wrapSelectedBlocksInCallout('yellow')).toBe(true)
    const callout = instance.state.doc.firstChild!
    expect(callout.type.name).toBe('callout')
    expect(callout.attrs.theme).toBe('yellow')
    expect(callout.children.map(node => node.attrs.blockId)).toEqual(ids)
    expect(selected(instance)).toEqual(['AB'])
  })

  it('map: tracks a reverse range through a preceding insert and endpoint deletion', () => {
    const instance = editor('<p>A</p><p>B</p><p>C</p><p>D</p>')
    instance.commands.selectBlockRange(6, 3)
    instance.view.dispatch(instance.state.tr.insert(0, instance.schema.nodes.paragraph!.create()))
    expect(instance.state.selection.toJSON()).toMatchObject({ anchorBlockPos: 8, headBlockPos: 5 })
    instance.view.dispatch(instance.state.tr.delete(8, 11))
    expect(selected(instance)).toEqual(['B'])
    instance.view.dispatch(instance.state.tr.delete(5, 8))
    expect(instance.state.selection).toBeInstanceOf(TextSelection)
    expect(instance.state.selection.$head.parent.textContent).toBe('D')
  })

  it('serialization: restores direction and copies whole blocks without their parent', () => {
    const instance = editor('<blockquote><p>A</p><p>B</p></blockquote><p>C</p>')
    const selection = MultiBlockSelection.create(instance.state.doc, 4, 1)
    const json = selection.toJSON()
    expect(json).toEqual({ type: 'multiBlock', anchorBlockPos: 4, headBlockPos: 1 })
    expect(Selection.fromJSON(instance.state.doc, json).eq(selection)).toBe(true)
    expect(selection.content().openStart).toBe(0)
    expect(selection.content().openEnd).toBe(0)
    expect(selection.content().content.content.map(node => node.type.name)).toEqual(['paragraph', 'paragraph'])
  })

  it('replace: replaces whole blocks from a clipboard slice and wraps typed text in a paragraph', () => {
    const instance = editor('<p>A</p><p>B</p><h2>C</h2>')
    const slice = MultiBlockSelection.create(instance.state.doc, 6).content()
    instance.commands.selectBlockRange(0, 3)
    instance.view.dispatch(instance.state.tr.replaceSelection(slice))
    expect(instance.state.doc.children.map(node => node.type.name)).toEqual(['heading', 'heading'])
    instance.commands.selectBlock(0)
    instance.view.dispatch(instance.state.tr.replaceSelectionWith(instance.schema.text('Typed'), false))
    expect(instance.state.doc.children.map(node => [node.type.name, node.textContent])).toEqual([
      ['paragraph', 'Typed'], ['heading', 'C'],
    ])
  })
})

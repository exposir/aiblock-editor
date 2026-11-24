import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions, extractOutline } from './index'

const editors: Editor[] = []

function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('block identity', () => {
  // @partition initial: existing and missing IDs in nested blocks
  // @partition paste: duplicated IDs before or after an existing block
  // @partition outline: heading levels, nested order, positions and inline text
  it('initial: gives nested blocks IDs immediately and serializes them to HTML', () => {
    const instance = editor('<p data-block-id="keep">Start</p><ul><li><p>Item<br>continued</p></li></ul><hr>')
    const ids: string[] = []
    instance.state.doc.descendants(node => {
      if (!node.isBlock) {
        expect(node.attrs).not.toHaveProperty('blockId')
        return
      }
      expect(node.attrs.blockId).toEqual(expect.any(String))
      ids.push(node.attrs.blockId)
    })
    expect(ids[0]).toBe('keep')
    expect(new Set(ids).size).toBe(5)
    expect(instance.getHTML().match(/data-block-id=/g)).toHaveLength(5)
  })

  it('paste: keeps the first occurrence in document order and assigns fresh IDs to the rest', () => {
    const instance = editor('<p data-block-id="source">Original</p><p>End</p>')
    const duplicate = instance.schema.node('paragraph', { blockId: 'source' }, instance.schema.text('Pasted'))
    const tr = instance.state.tr.insert(0, duplicate)
    tr.insert(tr.doc.content.size, duplicate)
    instance.view.dispatch(tr)

    const ids = Array.from({ length: 4 }, (_, index) => instance.state.doc.child(index).attrs.blockId)
    expect(ids[0]).toBe('source')
    expect(new Set(ids).size).toBe(4)
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 1)))
    expect(Array.from({ length: 4 }, (_, index) => instance.state.doc.child(index).attrs.blockId)).toEqual(ids)
  })

  it('outline: returns titles in document order with ProseMirror positions', () => {
    const instance = editor(
      '<h1 data-block-id="root">A<strong>B</strong></h1><blockquote><h3 data-block-id="nested">C</h3></blockquote>',
    )
    expect(extractOutline(instance.state.doc)).toEqual([
      { blockId: 'root', level: 1, text: 'AB', pos: 0 },
      { blockId: 'nested', level: 3, text: 'C', pos: 5 },
    ])
  })
})

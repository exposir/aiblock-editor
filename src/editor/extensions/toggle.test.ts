import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from './index'

const editors: Editor[] = []

function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('toggle', () => {
  // @partition insert: required summary and body, rich text and HTML round trip
  // @partition collapse: retained content and selection moved into the summary
  // @partition enter: focuses the body when starting from the collapsed summary
  it('insert: uses a rich-text summary followed by a block body', () => {
    const instance = editor('<p></p>')
    expect(instance.commands.insertToggle()).toBe(true)
    const inserted = instance.state.doc.firstChild!
    expect(inserted.attrs.open).toBe(true)
    expect(inserted.firstChild?.type.name).toBe('toggleSummary')
    expect(inserted.lastChild?.type.name).toBe('toggleContent')
    expect(inserted.lastChild?.firstChild?.type.name).toBe('paragraph')

    const rich = editor('<div data-toggle data-open="false"><div data-toggle-summary><strong>Title</strong></div>' +
      '<div data-toggle-content><p>Body</p><p>More</p></div></div>')
    expect(rich.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
    expect(editor(rich.getHTML()).getJSON()).toEqual(rich.getJSON())
  })

  it('collapse: moves the cursor to the summary, preserves the body and reopens', () => {
    const instance = editor('<div data-toggle><div data-toggle-summary>Title</div>' +
      '<div data-toggle-content><p>Body</p></div></div>')
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 10)))
    expect(instance.commands.setToggleOpen(0, false)).toBe(true)
    expect(instance.state.doc.firstChild?.attrs.open).toBe(false)
    expect(instance.state.selection.$head.parent.type.name).toBe('toggleSummary')
    expect(instance.state.doc.firstChild?.lastChild?.textContent).toBe('Body')
    expect(instance.commands.setToggleOpen(0, true)).toBe(true)
    expect(instance.state.doc.firstChild?.attrs.open).toBe(true)
  })

  it('enter: opens a closed toggle and places the cursor before the body text', () => {
    const instance = editor('<div data-toggle data-open="false"><div data-toggle-summary>Title</div>' +
      '<div data-toggle-content><p>Body</p></div></div><p>Outside</p>')
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 7)))
    instance.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(instance.state.doc.firstChild?.attrs.open).toBe(true)
    expect(instance.state.selection.$head.parent.textContent).toBe('Body')
    expect(instance.state.selection.$head.parentOffset).toBe(0)
  })
})

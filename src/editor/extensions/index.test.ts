import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from './index'

describe('editor extension composition', () => {
  // @partition schema: starter and extra extensions share one valid schema
  const editors: Editor[] = []

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy()
  })

  it('schema: applies IDs to table and task structures and preserves explicit mark extensions', () => {
    const content = '<table><tbody><tr><th><p>Task</p></th><td><p>Done</p></td></tr></tbody></table>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Ship</p></li></ul>' +
      '<p><a href="https://example.com"><u>Release notes</u></a></p>'
    const editor = new Editor({ content, extensions: createEditorExtensions() })
    editors.push(editor)
    editor.state.doc.check()

    const ids = new Map<string, unknown>()
    editor.state.doc.descendants(node => {
      if (node.isBlock) ids.set(node.type.name, node.attrs.blockId)
    })
    for (const type of ['table', 'tableRow', 'tableHeader', 'tableCell', 'taskList', 'taskItem']) {
      expect(ids.get(type)).toEqual(expect.any(String))
    }
    expect(editor.state.doc.lastChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['link', 'underline'])
    expect(new Set(editor.extensionManager.extensions.map(extension => extension.name)).size)
      .toBe(editor.extensionManager.extensions.length)
  })
})

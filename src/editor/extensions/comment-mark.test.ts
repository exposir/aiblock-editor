import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { describe, expect, it, onTestFinished } from 'vitest'
import { commentAnchor, createEditorExtensions } from './index'

function editorWithText(content: string) {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  onTestFinished(() => editor.destroy())
  return editor
}

describe('comment mark', () => {
  // @partition anchor: inline range serialization and active styling
  // @partition remove: clears only the indicated identifier including overlaps
  // @partition history: deleting a thread prevents orphan marks after undo
  it('anchor: marks the selected text and decorates the active identifier', () => {
    const editor = editorWithText('<p>Alpha beta</p>')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
    expect(editor.commands.addCommentMark('first')).toBe(true)
    expect(editor.commands.setActiveComment('first')).toBe(true)
    expect(commentAnchor(editor.state.doc, 'first')).toBe(1)
    expect(editor.view.dom.querySelector('.comment-active')?.textContent).toBe('Alpha')
    expect(editorWithText(editor.getHTML()).getJSON()).toEqual(editor.getJSON())
  })

  it('anchor: annotates inline code while retaining its formatting', () => {
    const editor = editorWithText('<p><code>alpha()</code></p>')
    editor.commands.setTextSelection({ from: 1, to: 8 })
    expect(editor.commands.addCommentMark('inline-code')).toBe(true)
    expect(editor.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name))
      .toEqual(['code', 'comment'])
    expect(editorWithText(editor.getHTML()).getJSON()).toEqual(editor.getJSON())
  })

  it('remove: clears the requested mark and preserves overlapping comment anchors', () => {
    const editor = editorWithText('<p>Alpha beta</p>')
    editor.chain().setTextSelection({ from: 1, to: 6 }).addCommentMark('first').run()
    editor.chain().setTextSelection({ from: 4, to: 10 }).addCommentMark('second').run()
    expect(editor.commands.removeCommentMark('first')).toBe(true)
    expect(commentAnchor(editor.state.doc, 'first')).toBeNull()
    expect(commentAnchor(editor.state.doc, 'second')).toBe(4)
    expect(editor.state.doc.textContent).toBe('Alpha beta')
  })

  it('remove: reattaches a retired ID to a new selection in the same document', () => {
    const editor = editorWithText('<p><span data-comment-id="x">Alpha</span> beta</p>')
    expect(editor.commands.removeCommentMark('x')).toBe(true)
    expect(commentAnchor(editor.state.doc, 'x')).toBeNull()
    expect(editor.chain().setTextSelection({ from: 7, to: 11 }).addCommentMark('x').setActiveComment('x').run())
      .toBe(true)
    expect(commentAnchor(editor.state.doc, 'x')).toBe(7)
    expect(editor.view.dom.querySelector('.comment-active')?.textContent).toBe('beta')
  })

  it('remove: a host can clear retired IDs when loading a replacement document', () => {
    const editor = editorWithText('<p><span data-comment-id="x">Old</span></p>')
    editor.commands.removeCommentMark('x')
    expect(editor.chain().setContent('<p><span data-comment-id="x">New</span></p>').clearRetiredComments().run())
      .toBe(true)
    expect(editor.view.dom.querySelector('[data-comment-id="x"]')?.textContent).toBe('New')
  })

  it('history: restores edited text without reinstating a removed comment mark', () => {
    const editor = editorWithText('<p><span data-comment-id="retired">Alpha</span> beta</p>')
    editor.view.dispatch(editor.state.tr.delete(2, 5))
    editor.commands.removeCommentMark('retired')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).toBe('Alpha beta')
    expect(commentAnchor(editor.state.doc, 'retired')).toBeNull()
  })
})

import { Editor } from '@tiptap/core'
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

describe('callout schema', () => {
  // @partition nested: mixed block types survive HTML round trip
  // @partition insert: command supplies default attributes and editable content
  it('nested: preserves paragraph, heading, list and code as separate blocks', () => {
    const instance = editor(
      '<aside data-callout data-icon="📌" data-theme="purple"><p>Note</p><h3>Title</h3>' +
      '<ul><li><p>Item</p></li></ul><pre><code>let x = 1</code></pre></aside>',
    )
    const node = instance.state.doc.firstChild!
    expect(node.type.name).toBe('callout')
    expect(node.attrs).toMatchObject({ icon: '📌', theme: 'purple' })
    expect(Array.from({ length: node.childCount }, (_, i) => node.child(i).type.name)).toEqual([
      'paragraph', 'heading', 'bulletList', 'codeBlock',
    ])
    expect(editor(instance.getHTML()).getJSON()).toEqual(instance.getJSON())
  })

  it('insert: creates one editable paragraph with the default icon and theme', () => {
    const instance = editor('<p></p>')
    expect(instance.commands.insertCallout()).toBe(true)
    const node = instance.state.doc.firstChild!
    expect(node.type.name).toBe('callout')
    expect(node.attrs).toMatchObject({ icon: '💡', theme: 'blue' })
    expect(node.childCount).toBe(1)
    expect(node.firstChild?.type.name).toBe('paragraph')
  })
})

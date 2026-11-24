import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from './index'

const editors: Editor[] = []

function editor(content = '<p></p>') {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

function typeText(instance: Editor, text: string) {
  for (const character of text) {
    const { from, to } = instance.state.selection
    const handled = instance.view.someProp('handleTextInput', handler =>
      handler(instance.view, from, to, character, () => instance.state.tr.insertText(character, from, to)))
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(character, from, to))
  }
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('MarkdownInputRules', () => {
  it('turns >> + space into a toggle and focuses its summary', () => {
    const instance = editor()
    typeText(instance, '>> ')
    expect(instance.state.doc.firstChild?.type.name).toBe('toggle')
    expect(instance.state.doc.firstChild?.attrs.open).toBe(true)
    expect(instance.state.selection.$from.parent.type.name).toBe('toggleSummary')
  })

  it('turns [! + space into a callout and focuses its first paragraph', () => {
    const instance = editor()
    typeText(instance, '[! ')
    expect(instance.state.doc.firstChild?.type.name).toBe('callout')
    expect(instance.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(instance.state.selection.$from.node(1).type.name).toBe('callout')
  })

  it('leaves the standard > quote shortcut intact', () => {
    const instance = editor()
    typeText(instance, '> ')
    expect(instance.state.doc.firstChild?.type.name).toBe('blockquote')
  })

  it('does not transform markdown shortcuts inside code blocks', () => {
    const instance = editor('<pre><code></code></pre>')
    typeText(instance, '>> ')
    typeText(instance, '[! ')
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(instance.state.doc.textContent).toBe('>> [! ')
  })
})

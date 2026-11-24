import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { BlockConversion } from '../types'
import { createEditorExtensions } from './index'

function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  onTestFinished(() => instance.destroy())
  return instance
}

describe('block menu commands', () => {
  // @partition convert: every menu conversion applies to the complete selection
  // @partition quick-insert: paragraph inserted as a sibling with a caret inside
  const formats: readonly BlockConversion[] = [
    { type: 'paragraph' }, { type: 'heading', level: 1 }, { type: 'heading', level: 2 },
    { type: 'heading', level: 3 }, { type: 'bulletList' }, { type: 'orderedList' },
    { type: 'taskList' }, { type: 'blockquote' }, { type: 'callout' }, { type: 'toggle' }, { type: 'codeBlock' },
  ]

  it.each(formats)('convert: preserves both blocks and the following sibling in $type', format => {
    const instance = editor('<h4><strong>A</strong></h4><p>B</p><p>C</p>')
    instance.commands.selectBlockRange(0, 3)
    const before = instance.state.doc
    expect(instance.can().convertSelectedBlocks(format)).toBe(true)
    expect(instance.state.doc).toBe(before)
    expect(instance.commands.convertSelectedBlocks(format)).toBe(true)
    expect(instance.state.selection.content().content.textBetween(0, instance.state.selection.content().size)).toBe('AB')
    expect(instance.state.doc.firstChild?.type.name).toBe(format.type)
    expect(instance.state.doc.lastChild?.eq(before.lastChild!)).toBe(true)
    instance.state.doc.check()

    if (format.type === 'heading') expect(instance.state.doc.firstChild?.attrs.level).toBe(format.level)
    const containsBold = /<strong>A<\/strong>/.test(instance.getHTML())
    expect(containsBold).toBe(format.type !== 'codeBlock')
  })

  it('quick-insert: inserts an empty paragraph below the designated block within its column', () => {
    const instance = editor('<div data-column-list><div data-column><h2>A</h2><p>B</p></div>' +
      '<div data-column><p>C</p></div></div>')
    expect(instance.commands.insertParagraphAfterBlock(2)).toBe(true)
    expect(instance.state.doc.firstChild?.firstChild?.children.map(node => node.textContent)).toEqual(['A', '', 'B'])
    expect(instance.state.selection).toBeInstanceOf(TextSelection)
    expect(instance.state.selection.from).toBe(6)
    expect(instance.state.selection.$head.parent.textContent).toBe('')
  })
})

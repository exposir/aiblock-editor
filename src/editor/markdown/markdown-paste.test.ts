import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { looksLikeMarkdown } from './markdown-paste'

const editors: Editor[] = []

function editor(content = '<p></p>') {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

function paste(instance: Editor, text: string, html = '') {
  const values = new Map<string, string>([['text/plain', text]])
  if (html) values.set('text/html', html)
  const clipboard = {
    getData: (type: string) => values.get(type) ?? '',
    types: [...values.keys()],
  }
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: clipboard })
  instance.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

describe('looksLikeMarkdown', () => {
  it.each([
    '# Heading',
    '> [!NOTE]\n> body',
    '- [x] done',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    '<details>\n<summary>More</summary>\n\ntext\n</details>',
    '::::columns\n:::column{width=50}\ntext\n:::\n::::',
    'A **bold** statement',
    '_italic_ and *emphasis*',
    '1. first',
    '[label](https://example.com)',
    '`inline code`',
  ])('accepts %s', text => expect(looksLikeMarkdown(text)).toBe(true))

  it.each([
    '普通自然语言，没有任何 Markdown 结构。',
    'https://example.com/path',
    '{"a":1,"b":true}',
    'const value = foo - bar;',
    'Portal > Detail selection',
    'one-two-three',
    '3 items',
    '2026 release',
    'foo_bar_baz',
    'See https://example.com/a_b_c for details',
    'const x = a*b*c;',
    '2**3**4',
  ])('rejects %s', text => expect(looksLikeMarkdown(text)).toBe(false))
})

describe('MarkdownPaste', () => {
  it('does not parse markdown pasted inside a code block', () => {
    const instance = editor('<pre><code>const x = 1</code></pre>')
    const event = paste(instance, '**not bold**')
    expect(event).toBe(true)
    expect(instance.state.doc.textContent).toContain('const x = 1')
  })

  it('pastes inline and display formulas as native nodes and undoes them together', () => {
    const instance = editor()
    expect(paste(instance, '定义 $f(x)$。\n\n$$\nf(x)=x^2\n$$')).toBe(true)
    expect(instance.state.doc.firstChild?.child(1).attrs.latex).toBe('f(x)')
    expect(instance.state.doc.lastChild?.attrs.language).toBe('math')
    expect(instance.state.doc.lastChild?.textContent).toBe('f(x)=x^2')
    expect(instance.commands.undo()).toBe(true)
    expect(instance.state.doc.childCount).toBe(1)
    expect(instance.state.doc.firstChild?.content.size).toBe(0)
  })

  it('does not intercept html-rich clipboard data', () => {
    const instance = editor()
    const richer = '<p><strong>already formatted</strong></p>'
    paste(instance, '**bold**', richer)
    expect(instance.getHTML()).toContain('<strong>already formatted</strong>')
  })

  it('inserts markdown as one undoable transaction', () => {
    const instance = editor()
    instance.commands.focus('end')
    expect(paste(instance, '# Heading\n\n- item')).toBe(true)
    expect(instance.state.doc.textContent).toContain('Heading')
    instance.commands.undo()
    expect(instance.state.doc.textContent).toBe('')
  })
})

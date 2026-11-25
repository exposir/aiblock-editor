import { mockViewport } from '../../test/viewport-fixture'
import { Editor, getSchema } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { InlineMathOverlay } from '../components/InlineMathOverlay'
import { docToMarkdown, markdownToDoc, markdownToSlice } from '../markdown/markdown-codec'
import { looksLikeMarkdown } from '../markdown/markdown-paste'
import { renderMath } from '../preview/math'
import { createEditorExtensions } from './index'

const schema = getSchema(createEditorExtensions())

function editor(content = '<p></p>') {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  onTestFinished(() => instance.destroy())
  return instance
}

function typeText(instance: Editor, text: string) {
  for (const character of text) {
    const { from, to } = instance.state.selection
    const insert = () => instance.state.tr.insertText(character, from, to)
    if (!instance.view.someProp('handleTextInput', handler => handler(instance.view, from, to, character, insert))) {
      instance.view.dispatch(insert())
    }
  }
}

describe('LaTeX in the editor', () => {
  // @partition markup: input rules, Markdown conversion, and money/escape boundaries
  // @partition rendering: Katex's MathML and failure are both usable
  // @partition editing: external dialog, save, and cancel
  it('types an inline atom with raw LaTeX and leaves the caret after it', () => {
    const instance = editor()
    typeText(instance, String.raw`当 $\frac{a}{b}$ 时`)
    const paragraph = instance.state.doc.firstChild!
    expect(paragraph.child(1)).toMatchObject({ attrs: { latex: String.raw`\frac{a}{b}` } })
    expect(paragraph.child(1).type.name).toBe('inlineMath')
    expect(paragraph.lastChild?.text).toBe(' 时')
  })

  it.each(['$100', '付款 $100 或 $200', '$ x$', '$x $', String.raw`\$x$`, '$$x$$'])('leaves %s unchanged while typing', text => {
    const instance = editor()
    typeText(instance, text)
    expect(instance.state.doc.firstChild?.firstChild?.type.name).toBe('text')
    expect(instance.state.doc.textContent).toBe(text)
  })

  it('preserves inline math, multiline display math and fenced aliases through Markdown', () => {
    const value = [
      String.raw`公式$x_i = \alpha$与 **$n^2$**`,
      String.raw`$$` + '\n' + String.raw`\begin{aligned} a&=b \\ c&=d \end{aligned}` + '\n$$',
      '~~~latex\nx^2 + y^2\n~~~',
      '~~~mmd\nflowchart LR\n  A --> B\n  %% 保留原始源码\n~~~',
    ].join('\n\n')
    const doc = markdownToDoc(schema, value)
    const blocks = doc.children.map(node => [node.type.name, node.attrs.language, node.textContent])
    expect(blocks).toEqual([
      ['paragraph', undefined, '公式与 '],
      ['codeBlock', 'math', String.raw`\begin{aligned} a&=b \\ c&=d \end{aligned}`],
      ['codeBlock', 'math', 'x^2 + y^2'],
      ['codeBlock', 'mermaid', 'flowchart LR\n  A --> B\n  %% 保留原始源码'],
    ])
    const atoms = doc.firstChild!.children.filter(node => node.type.name === 'inlineMath')
    expect(atoms.map(node => node.attrs.latex)).toEqual([String.raw`x_i = \alpha`, 'n^2'])
    expect(atoms[1]?.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(markdownToDoc(schema, docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('preserves literal dollar text, standalone display math and fenced source', () => {
    const paragraph = markdownToDoc(schema, '价格 $100，备选 $200；\\$x$ 与 `$z$`').firstChild!
    expect(paragraph.children.filter(node => !node.isText).map(node => node.attrs.latex)).toEqual([])
    expect(paragraph.textContent).toBe('价格 $100，备选 $200；$x$ 与 $z$')
    const display = markdownToDoc(schema, '$$x+y$$').firstChild!
    expect(display.type.name).toBe('codeBlock')
    expect(display.attrs.language).toBe('math')
    const code = markdownToDoc(schema, '~~~mermaid\n> [!NOTE]\n$$\na+b\n$$\n~~~').firstChild!
    expect(code.textContent).toBe('> [!NOTE]\n$$\na+b\n$$')
  })

  it('round-trips adjacent atoms and a numeric suffix using GitHub’s explicit inline delimiters', () => {
    const formula = schema.nodes.inlineMath!
    const doc = schema.topNodeType.create(null, schema.nodes.paragraph!.create(null, [
      formula.create({ latex: 'x' }), formula.create({ latex: 'n' }), schema.text('2'),
    ]))
    const markdown = docToMarkdown(doc)
    expect(markdown).toContain('$`x`$$`n`$2')
    expect(markdownToDoc(schema, markdown).eq(doc)).toBe(true)
  })

  it('recognizes formulas for smart paste and keeps display blocks sealed', () => {
    expect(looksLikeMarkdown('$a^2 + b^2 = c^2$')).toBe(true)
    expect(looksLikeMarkdown('$$\n\'a + b\'\n$$')).toBe(true)
    expect(looksLikeMarkdown('The total is $100 or $200.')).toBe(false)
    const block = markdownToSlice(schema, '$$\na+b\n$$')
    expect([block.openStart, block.openEnd]).toEqual([0, 0])
    expect(block.content.firstChild?.attrs.language).toBe('math')
    const inline = markdownToSlice(schema, 'See $a+b$')
    expect(inline.content.firstChild?.lastChild?.type.name).toBe('inlineMath')
  })

  it('renders accessible math for valid LaTeX and reports an invalid expression', async () => {
    const html = await renderMath(String.raw`\frac{1}{2}`, true)
    const panel = document.createElement('div')
    panel.innerHTML = html ?? ''
    expect(panel.querySelector('.katex-display math mfrac')).not.toBeNull()
    expect(panel.querySelectorAll('button,input,select,textarea')).toHaveLength(0)
    expect(await renderMath(String.raw`\invalidCommand{`, false)).toBeNull()
  })

  it('saves or cancels LaTeX through the external dialog while keeping the atom control-free', async () => {
    const instance = editor('<p>值为 <span data-inline-math data-latex="x+1">x+1</span></p>')
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    onTestFinished(() => scroll.mockRestore())
    document.body.append(instance.view.dom)
    render(<InlineMathOverlay editor={instance} />)
    const click = () => {
      const pos = 4
      const node = instance.state.doc.nodeAt(pos)!
      act(() => {
        instance.view.someProp('handleClickOn', handle =>
          handle(instance.view, pos, node, pos, new MouseEvent('click'), true))
      })
    }
    click()
    const input = await screen.findByRole('textbox', { name: 'LaTeX 源码' })
    expect(input).toHaveValue('x+1')
    expect(input).toHaveFocus()
    expect(instance.view.dom.querySelectorAll('button,input,select,textarea')).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'x^2' } })
    fireEvent.submit(input.closest('form')!)
    expect(instance.state.doc.firstChild?.lastChild?.attrs.latex).toBe('x^2')
    click()
    const reopened = await screen.findByRole('textbox', { name: 'LaTeX 源码' })
    fireEvent.change(reopened, { target: { value: 'y^3' } })
    fireEvent.keyDown(reopened, { key: 'Escape' })
    expect(instance.state.doc.firstChild?.lastChild?.attrs.latex).toBe('x^2')
    expect(screen.queryByRole('dialog', { name: '编辑数学公式' })).not.toBeInTheDocument()
  })
})

describe('inline math viewport rendering', () => {
  // @partition proximity: retain readable text until the observer admits a formula
  it('renders a formula only after its placeholder enters the viewport buffer', async () => {
    const viewport = mockViewport()
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] }] },
    })
    document.body.append(editor.view.dom)
    try {
      const formula = editor.view.dom.querySelector('[data-inline-math]')!
      expect(formula).toHaveTextContent('x^2')
      expect(formula.querySelector('.katex')).toBeNull()
      await viewport.flush()
      viewport.show(formula, true, 300)
      await waitFor(() => expect(formula.querySelector('.katex')).not.toBeNull())
    } finally {
      editor.destroy()
      vi.unstubAllGlobals()
    }
  })
})

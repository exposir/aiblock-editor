import { Editor } from '@tiptap/core'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CODE_LANGUAGES, codeHighlightKey, highlightCode } from './code-block'
import { createEditorExtensions } from './index'

function editorWithCode(content: string) {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  onTestFinished(() => editor.destroy())
  return editor
}

describe('code block', () => {
  // @partition attributes: HTML language alias, wrap and text serialization
  // @partition grammar: all supported languages and unknown-language fallback
  // @partition decorations: exact offsets and update on language change
  it('attributes: restores legacy languages and round-trips wrap without altering text', () => {
    const editor = editorWithCode('<pre><code class="language-ts">const a = 1\nconst b = 2</code></pre>')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ language: 'typescript', wrap: false })
    expect(editor.commands.updateCodeBlock(0, { language: 'python', wrap: true })).toBe(true)
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ language: 'python', wrap: true })
    expect(editorWithCode(editor.getHTML()).getJSON()).toEqual(editor.getJSON())
    expect(editor.state.doc.firstChild?.textContent).toBe('const a = 1\nconst b = 2')
  })

  it('grammar: registers the requested language set and falls back to plain text', () => {
    for (const language of CODE_LANGUAGES) {
      expect(highlightCode(language, 'const name = "汉字 ☀️"').every(token => token.to > token.from)).toBe(true)
    }
    expect(highlightCode('unrecognized', 'const x = 1')).toEqual([])
  })

  it('decorations: decorates TypeScript tokens at their document offsets and clears for plain text', () => {
    const editor = editorWithCode('<p>Lead</p><pre data-language="typescript"><code>const x = 1</code></pre>')
    const { doc } = editor.state
    const highlights = codeHighlightKey.getState(editor.state)?.find()
    expect(highlights?.some(token => doc.textBetween(token.from, token.to) === 'const')).toBe(true)
    expect(highlights?.some(token => doc.textBetween(token.from, token.to) === '1')).toBe(true)
    expect(editor.view.dom.querySelector('pre > code > .hljs-keyword')?.textContent).toBe('const')
    editor.commands.updateCodeBlock(doc.firstChild!.nodeSize, { language: 'plaintext' })
    expect(codeHighlightKey.getState(editor.state)?.find()).toEqual([])
    expect(editor.state.doc.lastChild?.textContent).toBe('const x = 1')
  })
})

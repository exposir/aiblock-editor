import { Editor } from '@tiptap/core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CODE_LANGUAGES, codeHighlightKey, highlightCode } from './code-block'
import { docToMarkdown, markdownToDoc } from '../markdown/markdown-codec'
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

  it('keeps display view mode in the document while Markdown carries only the formula', () => {
    const editor = editorWithCode('<pre data-language="tex" data-view-mode="split"><code>x^2</code></pre>')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ language: 'math', viewMode: 'split' })
    expect(editorWithCode(editor.getHTML()).getJSON()).toEqual(editor.getJSON())
    const markdown = docToMarkdown(editor.state.doc)
    expect(markdown).toBe('$$\nx^2\n$$\n')
    expect(markdownToDoc(editor.schema, markdown).firstChild?.attrs.viewMode).toBe('preview')
  })

  it('marks only huge code blocks for layout isolation', () => {
    const small = editorWithCode('<pre data-language="typescript"><code>const x = 1</code></pre>')
    expect(small.view.dom.querySelector('pre')).not.toHaveAttribute('data-long-code')
    const huge = editorWithCode('<pre data-language="typescript"><code>' +
      Array.from({ length: 2_000 }, (_, index) => `const value${index} = ${index};`).join('\n') + '</code></pre>')
    expect(huge.view.dom.querySelector('pre')).toHaveAttribute('data-long-code', 'true')
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

describe('deferred large code highlighting', () => {
  // @partition transactional: no synchronous highlight; worker replies must match the current node
  it('keeps a 2,500-line edit immediately editable and drops the earlier worker reply', async () => {
    vi.useFakeTimers()
    const replies: { send(tokens: unknown): void }[] = []
    class WorkerBoundary {
      onmessage?: (event: { data: unknown }) => void
      terminate() {}
      postMessage() { replies.push({ send: data => this.onmessage?.({ data }) }) }
    }
    vi.stubGlobal('Worker', WorkerBoundary)
    const script = Array.from({ length: 2500 }, (_, index) => 'const revision' + index + ' = 1;').join('\n')
    const current = new Editor({
      extensions: createEditorExtensions(),
      content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'typescript' },
        content: [{ type: 'text', text: script }] }] },
    })
    try {
      expect(current.view.dom.querySelector('pre')).toHaveAttribute('data-long-code', 'true')
      await vi.advanceTimersByTimeAsync(140)
      expect(replies).toHaveLength(1)
      const start = process.hrtime.bigint()
      current.view.dispatch(current.state.tr.insertText('a', 3))
      expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(100)
      expect(current.state.doc.textContent).toMatch(/^coanst/)
      replies[0]!.send([{ from: 0, to: 5, className: 'hljs-keyword' }])
      await vi.advanceTimersByTimeAsync(200)
      expect(codeHighlightKey.getState(current.state)?.find()).toHaveLength(0)
      expect(replies).toHaveLength(2)
      replies[1]!.send([{ from: 9, to: 17, className: 'hljs-title' }])
      await vi.advanceTimersByTimeAsync(0)
      expect(codeHighlightKey.getState(current.state)?.find().map(token => [token.from, token.to])).toEqual([[10, 18]])
    } finally {
      current.destroy()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

it('recovers a timed-out worker for a fresh edit without repeatedly retrying the same node', async () => {
  vi.useFakeTimers()
  const replies: Array<{ answer(): void; terminated: boolean }> = []
  class WorkerBoundary {
    onmessage?: (event: { data: unknown }) => void
    terminated = false
    terminate() { this.terminated = true }
    postMessage() {
      const worker = this
      replies.push({
        get terminated() { return worker.terminated },
        answer() { worker.onmessage?.({ data: [{ from: 0, to: 5, className: 'hljs-keyword' }] }) },
      })
    }
  }
  vi.stubGlobal('Worker', WorkerBoundary)
  const text = 'const value = 1\n'.repeat(2500)
  const editor = editorWithCode('<pre data-language="typescript"><code>' + text + '</code></pre>')
  try {
    await vi.advanceTimersByTimeAsync(140)
    expect(replies).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5200)
    expect(replies).toHaveLength(1)
    expect(replies[0]?.terminated).toBe(true)
    expect(codeHighlightKey.getState(editor.state)?.find()).toHaveLength(0)
    editor.view.dispatch(editor.state.tr.insertText('x', 8))
    await vi.advanceTimersByTimeAsync(140)
    expect(replies).toHaveLength(2)
    replies[1]?.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(codeHighlightKey.getState(editor.state)?.find()).toHaveLength(1)
  } finally {
    editor.destroy()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

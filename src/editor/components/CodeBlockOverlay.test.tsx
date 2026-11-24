import { Editor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { CodeBlockOverlay } from './CodeBlockOverlay'

const editors: Editor[] = []

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function mountEditor(content = '<pre data-language="typescript"><code>const x = 1</code></pre>') {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(editor)
  document.body.append(editor.view.dom)
  const host = document.createElement('div')
  host.setAttribute('data-document-overlays', '')
  document.body.append(host)
  const pre = editor.view.dom.querySelector('pre')!
  const view = render(<CodeBlockOverlay editor={editor} host={host} />)
  return { editor, host, pre, view }
}

function codeBlockAttrs(editor: Editor): Record<string, unknown> | null {
  const found: Record<string, unknown>[] = []
  editor.state.doc.descendants(node => {
    if (node.type.name === 'codeBlock') found.push(node.attrs)
  })
  return found[0] ?? null
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const zero = domRect(0, 0, 0, 0)
  const hostRect = domRect(0, 0, 800, 600)
  const preRect = domRect(40, 24, 640, 200)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'PRE') return preRect
    if (this.hasAttribute('data-document-overlays')) return hostRect
    return zero
  })
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CodeBlockOverlay', () => {
  /*
   * Testing strategy
   * @partition portal: 工具条在外部 host，代码块 contenteditable 内零原生控件
   * @partition language: select 更新 language 并把焦点/选区还给代码块
   * @partition wrap: wrap 属性与 aria-pressed 双向同步
   * @partition copy: 剪贴板、已复制反馈、1.5s 复位、改文清除、卸载清理
   */
  it('portal: 工具条挂载在外部 host，代码块内没有原生控件', async () => {
    const { editor, host } = mountEditor()
    const strip = host.querySelector<HTMLElement>('.code-control-strip')
    expect(strip).not.toBeNull()
    expect(strip).toHaveAttribute('data-editor-overlay')
    expect(strip!.style.visibility).toBe('visible')
    expect(host.querySelector('select[aria-label="代码语言"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="自动换行"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="复制代码"]')).not.toBeNull()
    expect(editor.view.dom.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })

  it('language: 切换语言更新节点属性并把焦点归还编辑器代码块', async () => {
    const { editor, host } = mountEditor()
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="代码语言"]')!
    const focus = vi.spyOn(editor.view, 'focus')
    fireEvent.change(select, { target: { value: 'python' } })
    await waitFor(() => expect(codeBlockAttrs(editor)?.language).toBe('python'))
    expect(codeBlockAttrs(editor)?.language).toBe('python')
    expect(focus).toHaveBeenCalled()
    const from = editor.state.selection.from
    expect(from).toBeGreaterThan(0)
    expect(from).toBeLessThan(editor.state.doc.content.size)
    expect(editor.state.doc.textBetween(1, editor.state.doc.content.size)).toContain('const x = 1')
    expect(screen.getByRole('combobox', { name: '代码语言' })).toHaveValue('python')
  })

  it('wrap: 自动换行按钮切换 wrap 属性并同步 aria-pressed', async () => {
    const { editor, host } = mountEditor()
    const wrap = host.querySelector<HTMLButtonElement>('button[aria-label="自动换行"]')!
    expect(wrap).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(wrap)
    await waitFor(() => expect(codeBlockAttrs(editor)?.wrap).toBe(true))
    expect(screen.getByRole('button', { name: '自动换行' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '自动换行' }))
    await waitFor(() => expect(codeBlockAttrs(editor)?.wrap).toBe(false))
    expect(screen.getByRole('button', { name: '自动换行' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('copy: 写入剪贴板、显示已复制并在 1.5s 后复位', async () => {
    const { host } = mountEditor()
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="复制代码"]')!)
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('const x = 1')
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
    act(() => vi.advanceTimersByTime(1499))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('copy: 节点文本变化立即清除已复制状态并清理计时器', async () => {
    const { editor, host } = mountEditor()
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="复制代码"]')!)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
    expect(vi.getTimerCount()).toBe(1)
    act(() => editor.commands.insertContentAt(1, '!'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('copy: 卸载时清理反馈计时器', async () => {
    const { host, view } = mountEditor()
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="复制代码"]')!)
    await act(async () => { await Promise.resolve() })
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.runOnlyPendingTimers())
  })
})

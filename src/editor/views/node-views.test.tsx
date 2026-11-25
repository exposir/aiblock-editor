import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockViewport } from '../../test/viewport-fixture'
import { createEditorExtensions } from '../extensions'

const extensions = createEditorExtensions()

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function Harness({ content }: { content: string }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const editor = useEditor({
    extensions,
    content,
    editorProps: {
      attributes: { class: 'document-editor', 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' },
    },
  })
  return (
    <main data-document-surface="">
      <EditorContent editor={editor}>
        <div ref={setHost} className="document-overlays" data-document-overlays="" />
      </EditorContent>
    </main>
  )
}

function mount(content: string) {
  const view = render(<Harness content={content} />)
  const pm = screen.getByRole('textbox', { name: '文档正文' }) as HTMLElement & { editor: Editor }
  return { view, editor: pm.editor }
}

function columnWidths(editor: Editor) {
  const found: import('@tiptap/pm/model').Node[] = []
  editor.state.doc.descendants(node => { if (node.type.name === 'columnList') found.push(node) })
  const list = found[0]
  return list ? [...list.children].map(column => column.attrs.width) : []
}

function pointer(element: Element, type: string, init: { clientX?: number; button?: number; pointerId?: number } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(event, 'isPrimary', { value: true })
  fireEvent(element, event)
}

const calloutContent = '<aside data-callout data-icon="📌" data-theme="blue"><p>Callout body</p></aside>'
const columnsContent = `<div data-column-list>
  <div data-column data-width="50"><p>Left</p></div>
  <div data-column data-width="50"><p>Right</p></div>
</div>`
const taskContent = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Task A</p></div></li></ul>'
const toggleContent = `<div data-toggle data-open="false">
  <div data-toggle-summary>More</div>
  <div data-toggle-content>
    <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Nested task</p></div></li></ul>
  </div>
</div>`

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const base = domRect(0, 0, 100, 20)
  const layout = domRect(0, 0, 800, 100)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('column-layout') ? layout : base
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('node views & floating block controls', () => {
  /*
   * Testing strategy
   * @partition callout: 外部主题按钮悬停/聚焦揭示，循环 6 主题；图标不可编辑
   * @partition columns: 指针拖拽（capture/lost 清理）与键盘 ArrowLeft/Right
   * @partition task: 外部复选框同步 checked/aria-checked
   * @partition toggle: 收起 inert 时嵌套控件 hidden，展开后恢复
   * @partition portal: contenteditable 内零原生控件
   */
  it('callout: 渲染图标，悬停或聚焦时揭示外部主题按钮并循环六个主题', async () => {
    const { editor } = mount(calloutContent)
    const callout = await waitFor(() => {
      const element = editor.view.dom.querySelector<HTMLElement>('.callout')
      expect(element).not.toBeNull()
      return element!
    })
    expect(callout.querySelector('.callout-icon')).toHaveTextContent('📌')
    expect(callout.querySelector('.callout-icon')).toHaveAttribute('contenteditable', 'false')
    const button = () => document.querySelector<HTMLButtonElement>('.floating-block-control.callout-theme')!
    await waitFor(() => expect(button()).not.toBeNull())
    expect(button().className).not.toContain('is-revealed')

    fireEvent.pointerEnter(callout)
    await waitFor(() => expect(button().className).toContain('is-revealed'))
    fireEvent.pointerLeave(callout)
    await waitFor(() => expect(button().className).not.toContain('is-revealed'), { timeout: 1000 })

    fireEvent.focus(button())
    await waitFor(() => expect(button().className).toContain('is-revealed'))
    fireEvent.blur(button())

    for (const theme of ['gray', 'yellow', 'green', 'red', 'purple', 'blue']) {
      fireEvent.click(button())
      await waitFor(() => expect(callout).toHaveAttribute('data-theme', theme))
    }
    expect(editor.view.dom.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
    expect(editor.view.dom.contains(button())).toBe(false)
  })

  it('columns: 指针拖拽调整相邻列宽，lostpointercapture 取消未提交的拖动', async () => {
    const { editor } = mount(columnsContent)
    const separator = await screen.findByRole('separator', { name: '调整第 1 和第 2 列的宽度' })
    const layout = editor.view.dom.querySelector<HTMLElement>('.column-layout')!
    const capture = vi.fn()
    Object.defineProperty(separator, 'setPointerCapture', { configurable: true, value: capture })

    pointer(separator, 'pointerdown', { clientX: 100 })
    expect(capture).toHaveBeenCalled()
    pointer(separator, 'pointermove', { clientX: 180 })
    await waitFor(() => expect(layout.style.getPropertyValue('--column-tracks')).toBe('60% 40%'))
    pointer(separator, 'pointerup', { clientX: 180 })
    await waitFor(() => expect(columnWidths(editor)).toEqual([60, 40]))

    pointer(separator, 'pointerdown', { clientX: 100 })
    pointer(separator, 'pointermove', { clientX: 180 })
    await waitFor(() => expect(layout.style.getPropertyValue('--column-tracks')).toBe('70% 30%'))
    const lost = new Event('lostpointercapture', { bubbles: true })
    Object.defineProperty(lost, 'pointerId', { value: 1 })
    fireEvent(separator, lost)
    await waitFor(() => expect(layout.style.getPropertyValue('--column-tracks')).toBe('60% 40%'))
    pointer(separator, 'pointerup', { clientX: 180 })
    expect(columnWidths(editor)).toEqual([60, 40])
  })

  it('columns: 键盘 ArrowLeft/ArrowRight 调整列宽', async () => {
    const { editor } = mount(columnsContent)
    const separator = await screen.findByRole('separator', { name: '调整第 1 和第 2 列的宽度' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    await waitFor(() => expect(columnWidths(editor)).toEqual([51, 49]))
    expect(separator).toHaveAttribute('aria-valuenow', '51')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    await waitFor(() => expect(columnWidths(editor)).toEqual([50, 50]))
    expect(separator).toHaveAttribute('aria-valuenow', '50')
  })

  it('task: 点击外部 Portal 复选框同步 checked 与 aria-checked', async () => {
    const { editor } = mount(taskContent)
    const checkbox = await screen.findByRole('checkbox', { name: 'Task A' })
    expect(checkbox).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(checkbox)
    await waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'true'))
    let checked: unknown = null
    editor.state.doc.descendants(node => { if (node.type.name === 'taskItem') checked = node.attrs.checked })
    expect(checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'false'))
  })

  it('toggle: 收起时内容 inert 且嵌套控件 hidden，展开后恢复', async () => {
    const { editor } = mount(toggleContent)
    const toggleButton = await screen.findByRole('button', { name: '折叠块内容' })
    const content = await waitFor(() => {
      const element = editor.view.dom.querySelector<HTMLElement>('[data-toggle-content]')
      expect(element).not.toBeNull()
      return element!
    })
    const checkbox = () => document.querySelector<HTMLButtonElement>('.floating-block-control.task-checkbox')!
    await waitFor(() => expect(content).toHaveAttribute('inert'))
    await waitFor(() => expect(checkbox()).not.toBeNull())
    await waitFor(() => expect(checkbox().hidden).toBe(true))
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggleButton)
    await waitFor(() => expect(toggleButton).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(content).not.toHaveAttribute('inert'))
    await waitFor(() => expect(checkbox().hidden).toBe(false))

    fireEvent.click(toggleButton)
    await waitFor(() => expect(toggleButton).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(content).toHaveAttribute('inert'))
    await waitFor(() => expect(checkbox().hidden).toBe(true))
    expect(editor.view.dom.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })
  it('mounts the task control near the viewport or for the current selection, then releases it', async () => {
    const viewport = mockViewport()
    try {
      const { editor } = mount('<p>先读正文</p>' + taskContent)
      const item = editor.view.dom.querySelector('[data-type="taskItem"]')!
      const anchor = item.querySelector('.block-control-anchor')!
      expect(screen.queryByRole('checkbox')).toBeNull()
      act(() => viewport.show(anchor, true, 300))
      expect(await screen.findByRole('checkbox')).toHaveAccessibleName('Task A')
      act(() => viewport.show(anchor, false, 300))
      expect(screen.queryByRole('checkbox')).toBeNull()
      const from = editor.view.posAtDOM(item.querySelector('p')!, 0)
      act(() => { editor.commands.setTextSelection(from) })
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
      act(() => { editor.commands.setTextSelection(1) })
      expect(screen.queryByRole('checkbox')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

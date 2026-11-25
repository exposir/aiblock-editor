import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { mockViewport } from '../../test/viewport-fixture'
import { createEditorExtensions } from '../extensions'
import { ImageOverlay } from './ImageOverlay'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mountImages() {
  const surface = document.createElement('main')
  surface.dataset.documentSurface = ''
  const host = document.createElement('div')
  host.dataset.documentOverlays = ''
  const mount = document.createElement('div')
  const outside = document.createElement('button')
  surface.append(mount, host, outside)
  document.body.append(surface)
  const editor = new Editor({ element: mount, extensions: createEditorExtensions(),
    content: '<img src="https://example.test/first.png" alt="first"><img src="https://example.test/second.png" alt="second">' })
  const [first, second] = Array.from(editor.view.dom.querySelectorAll('figure'))
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(94, 128, 700, 0))
  vi.spyOn(first!, 'getBoundingClientRect').mockReturnValue(new DOMRect(103, 149, 320, 200))
  vi.spyOn(second!, 'getBoundingClientRect').mockReturnValue(new DOMRect(128, 370, 450, 290))
  const view = render(<ImageOverlay editor={editor} host={host} />)
  onTestFinished(() => { view.unmount(); editor.destroy(); surface.remove() })
  act(() => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1))))
  return { editor, second: second!, outside }
}

describe('the single image toolbar', () => {
  // @partition selection: only the selected image changes, and all inputs remain outside ProseMirror
  // @partition focus: viewport exit retains keyboard focus until blur
  // @partition files: clipboard receives bytes and a real download gets a suitable filename
  it('switches alignment and display width, edits alt text and removes only the selected image', async () => {
    const { editor } = mountImages()
    expect(await screen.findAllByRole('group', { name: '图片工具' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '右对齐' }))
    fireEvent.change(screen.getByRole('combobox', { name: '图片显示宽度' }), { target: { value: '360' } })
    const alt = screen.getByRole('textbox', { name: '图片替代文本' })
    fireEvent.change(alt, { target: { value: '更新后的配图' } })
    fireEvent.blur(alt)
    expect(editor.state.doc.child(0).attrs).toMatchObject({ alt: 'first', align: 'center' })
    expect(editor.state.doc.child(1).attrs).toMatchObject({ alt: '更新后的配图', align: 'right', displayWidth: 360 })
    expect(editor.view.dom.querySelector('button,input,select,textarea')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除图片' }))
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.attrs.alt).toBe('first')
  })

  it('keeps the focused input and its typed value offscreen, then unmounts on blur', async () => {
    const viewport = mockViewport()
    const { editor, second, outside } = mountImages()
    act(() => viewport.show(second, true, 300))
    const tools = await screen.findByRole('group', { name: '图片工具' })
    expect(tools).toHaveStyle({ left: '34px', top: '246px' })
    const alt = screen.getByRole('textbox', { name: '图片替代文本' })
    act(() => alt.focus())
    fireEvent.change(alt, { target: { value: '滚动中编辑的说明' } })
    act(() => viewport.show(second, false, 300))
    expect(alt).toHaveFocus()
    expect(alt).toHaveValue('滚动中编辑的说明')
    expect(screen.getByRole('group', { name: '图片工具' })).toBe(tools)
    act(() => outside.focus())
    expect(screen.queryByRole('group', { name: '图片工具' })).not.toBeInTheDocument()
    expect(editor.state.doc.child(1).attrs.alt).toBe('滚动中编辑的说明')
  })

  it('copies PNG bytes and downloads the selected source with its filename', async () => {
    mountImages()
    const bytes = new Blob(['png-bytes'], { type: 'image/png' })
    const fetched = vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes })
    vi.stubGlobal('fetch', fetched)
    class ClipboardEntry {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', ClipboardEntry)
    const copied = vi.fn()
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async write(entries: ClipboardEntry[]) { copied(await entries[0]?.items['image/png']) },
    } })
    onTestFinished(() => {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:downloaded-image')
    const downloaded = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded(this.download, this.href)
    })
    fireEvent.click(await screen.findByRole('button', { name: '复制图片' }))
    expect(await screen.findByText('已复制')).toBeInTheDocument()
    expect(copied).toHaveBeenCalledExactlyOnceWith(bytes)
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }))
    await waitFor(() => expect(downloaded).toHaveBeenCalledExactlyOnceWith('second.png', 'blob:downloaded-image'))
    expect(create).toHaveBeenCalledExactlyOnceWith(bytes)
    expect(fetched.mock.calls).toEqual([
      ['https://example.test/second.png', { credentials: 'omit' }],
      ['https://example.test/second.png', { credentials: 'omit' }],
    ])
  })
})

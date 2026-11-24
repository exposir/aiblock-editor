import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent } from '@tiptap/react'
import { useRef, useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { MultiBlockSelection } from '../extensions/multi-block-selection'
import { firstLineCenter } from './block-geometry'
import { BlockHandleOverlay } from './BlockHandleOverlay'

const a = { x: 240, y: 120 }
const b = { x: 240, y: 180 }
const c = { x: 240, y: 240 }
const content = '<p data-block-id="a">甲</p><p data-block-id="b">乙</p><p data-block-id="c">丙</p>'

function Fixture({ editor, onQuickInsert }: {
  editor: Editor
  onQuickInsert: (editor: Editor, cursor: number) => void
}) {
  const surface = useRef<HTMLElement>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  return <>
    <header><button type="button">编辑器外部</button></header>
    <main ref={surface} data-document-surface="">
      <EditorContent editor={editor} />
      <div ref={setHost} data-document-overlays="" />
      {host && <BlockHandleOverlay editor={editor} surface={surface} host={host}
        blockHash={id => `#page=test&block=${id}`} onQuickInsert={onQuickInsert} />}
    </main>
  </>
}

function mountOverlay() {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  const onQuickInsert = vi.fn()
  const view = render(<Fixture editor={editor} onQuickInsert={onQuickInsert} />)
  onTestFinished(() => {
    view.unmount()
    editor.destroy()
  })
  const surface = screen.getByRole('main')
  const host = surface.querySelector<HTMLElement>('[data-document-overlays]')!
  const body = editor.view.dom
  surface.getBoundingClientRect = () => new DOMRect(24, 60, 520, 240)
  for (const [index, block] of Array.from(body.children).entries()) {
    block.getBoundingClientRect = () => new DOMRect(120, 100 + index * 60, 300, 40)
  }
  return { editor, onQuickInsert, host, body }
}

function pointer(target: Node, type: string, { x, y }: { x: number; y: number }, pointerId = 1) {
  // JSDOM has MouseEvent coordinates but no native PointerEvent or pointer capture.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: pointerId === 1 } })
  fireEvent(target, event)
}

function handle() {
  return screen.getByRole('button', { name: '拖动块或打开块操作' })
}

async function hover(point = a) {
  pointer(document, 'pointermove', point)
  return screen.findByRole('button', { name: '拖动块或打开块操作' })
}

function blockTexts(editor: Editor) {
  return editor.state.doc.children.map(node => node.textContent)
}

function selectedTexts(editor: Editor) {
  const { selection } = editor.state
  expect(selection).toBeInstanceOf(MultiBlockSelection)
  return (selection as MultiBlockSelection).blockRange.blocks.map(node => node.textContent)
}

describe('BlockHandleOverlay', () => {
  // @partition controls: hover, gutter, quick insertion and menu focus/dismissal
  // @partition drag: reorder in either direction, add columns on either edge, undo and cancel
  // @partition marquee: select across blocks from the left gutter, keep selection on release or restore on cancel
  // @partition alignment: ignore hidden text and fall back to the visible text block
  it('悬停显示纸页外部控件，离开纸页收起，正文始终没有原生控件', async () => {
    const { host, body } = mountOverlay()
    expect(screen.queryByRole('button', { name: '拖动块或打开块操作' })).not.toBeInTheDocument()
    await hover()
    expect(within(host).getByRole('button', { name: '在下方插入段落' })).toBeInTheDocument()
    expect(host).toContainElement(handle())
    expect(body.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
    pointer(document, 'pointermove', { x: 240, y: 320 })
    await waitFor(() => expect(screen.queryByRole('button', { name: '拖动块或打开块操作' })).not.toBeInTheDocument())
  })

  it('点击 + 在目标块下方插段落，快速插入收到新光标', async () => {
    const user = userEvent.setup()
    const { editor, onQuickInsert, body } = mountOverlay()
    await hover(b)
    await user.click(screen.getByRole('button', { name: '在下方插入段落' }))
    expect(blockTexts(editor)).toEqual(['甲', '乙', '', '丙'])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.$from.parent.textContent).toBe('')
    expect(onQuickInsert).toHaveBeenCalledExactlyOnceWith(editor, 7)
    expect(body).toHaveFocus()
  })

  it('短按手柄选中目标块并打开菜单，Escape 把焦点交还手柄', async () => {
    const user = userEvent.setup()
    const { editor, host } = mountOverlay()
    const grip = await hover(b)
    const point = { x: 92, y: b.y }
    pointer(grip, 'pointerdown', point)
    pointer(grip, 'pointerup', point)
    const dialog = await within(host).findByRole('dialog', { name: '块操作' })
    expect(dialog).toHaveFocus()
    expect(selectedTexts(editor)).toEqual(['乙'])
    expect(grip).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(grip).toHaveFocus()
    expect(grip).toHaveAttribute('aria-expanded', 'false')
  })

  it('再次短按同一个手柄会收起已打开的菜单', async () => {
    const { editor } = mountOverlay()
    const grip = await hover(b)
    const point = { x: 92, y: b.y }
    pointer(grip, 'pointerdown', point)
    pointer(grip, 'pointerup', point)
    const dialog = await screen.findByRole('dialog', { name: '块操作' })

    pointer(grip, 'pointerdown', point)
    pointer(grip, 'pointerup', point)
    expect(dialog).not.toBeInTheDocument()
    expect(grip).toHaveAttribute('aria-expanded', 'false')
    expect(selectedTexts(editor)).toEqual(['乙'])
  })

  it('键盘打开块菜单，点纸页外部关闭且不修改正文', async () => {
    const user = userEvent.setup()
    const { editor } = mountOverlay()
    const grip = await hover(b)
    grip.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '块操作' })
    await user.click(screen.getByRole('button', { name: '编辑器外部' }))
    expect(dialog).not.toBeInTheDocument()
    expect(grip).toHaveAttribute('aria-expanded', 'false')
    expect(blockTexts(editor)).toEqual(['甲', '乙', '丙'])
  })

  it.each([
    { side: 'top', end: { x: a.x, y: 105 }, expected: ['乙', '甲', '丙'] },
    { side: 'bottom', end: { x: c.x, y: 255 }, expected: ['甲', '丙', '乙'] },
    { side: 'left', end: { x: 125, y: a.y }, expected: ['乙甲', '丙'], columns: ['乙', '甲'] },
    { side: 'right', end: { x: 415, y: a.y }, expected: ['甲乙', '丙'], columns: ['甲', '乙'] },
  ])('拖向 $side 预览落点，松手原子提交，一次 Undo 还原', async ({ side, end, expected, columns }) => {
    const { editor, host } = mountOverlay()
    const grip = await hover(b)
    const original = editor.getJSON()
    const documentUpdates = vi.fn()
    editor.on('update', documentUpdates)

    pointer(grip, 'pointerdown', { x: 92, y: b.y })
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector(`[data-side="${side}"]`)).toBeInTheDocument())
    expect(editor.getJSON()).toEqual(original)
    expect(documentUpdates).not.toHaveBeenCalled()

    pointer(document, 'pointerup', end)
    expect(blockTexts(editor)).toEqual(expected)
    expect(selectedTexts(editor)).toEqual(['乙'])
    expect(documentUpdates).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-side]')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    if (columns) {
      const list = editor.state.doc.firstChild
      expect(list?.type.name).toBe('columnList')
      expect(list?.children.map(column => column.textContent)).toEqual(columns)
    }

    act(() => { expect(editor.commands.undo()).toBe(true) })
    expect(editor.getJSON()).toEqual(original)
  })

  it('拖拽时滚动纸页，按指针下的新目标预览和落位', async () => {
    const { editor, host, body } = mountOverlay()
    const grip = await hover(b)
    const point = { x: a.x, y: 105 }
    pointer(grip, 'pointerdown', { x: 92, y: b.y })
    pointer(document, 'pointermove', point)
    const indicator = () => host.querySelector('[data-side]')
    await waitFor(() => expect(indicator()).toHaveAttribute('data-side', 'top'))

    // 模拟纸页上移，使同一视口坐标从甲的上半部变成丙的下半部。
    Array.from(body.children).forEach((block, index) => {
      block.getBoundingClientRect = () => new DOMRect(120, -40 + index * 60, 300, 40)
    })
    fireEvent.scroll(window)
    await waitFor(() => expect(indicator()).toHaveAttribute('data-side', 'bottom'))
    pointer(document, 'pointerup', point)
    expect(blockTexts(editor)).toEqual(['甲', '丙', '乙'])
    expect(selectedTexts(editor)).toEqual(['乙'])
  })

  it('拖动选区内的手柄时，整组选中块一起移动', async () => {
    const { editor, host } = mountOverlay()
    act(() => { editor.commands.selectBlockRange(0, 3) })
    const grip = await hover(b)
    const end = { x: c.x, y: 255 }
    pointer(grip, 'pointerdown', { x: 92, y: b.y })
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector('[data-side="bottom"]')).toBeInTheDocument())
    pointer(document, 'pointerup', end)
    expect(blockTexts(editor)).toEqual(['丙', '甲', '乙'])
    expect(selectedTexts(editor)).toEqual(['甲', '乙'])
  })

  it.each(['Escape', 'pointercancel', 'lostpointercapture'] as const)('%s 取消拖拽并移除落点，之后的松手不移动块', async cancel => {
    const { editor, host } = mountOverlay()
    const grip = await hover(b)
    const start = { x: 92, y: b.y }
    const end = { x: a.x, y: 105 }
    pointer(grip, 'pointerdown', start)
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector('[data-side="top"]')).toBeInTheDocument())

    if (cancel === 'Escape') fireEvent.keyDown(grip, { key: 'Escape' })
    else pointer(document, cancel, end)
    expect(host.querySelector('[data-side]')).not.toBeInTheDocument()
    pointer(document, 'pointerup', end)
    expect(blockTexts(editor)).toEqual(['甲', '乙', '丙'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    pointer(grip, 'pointerdown', start)
    pointer(document, 'pointerup', start)
    expect(await screen.findByRole('dialog', { name: '块操作' })).toBeInTheDocument()
  })

  it('拖拽期间正文改变时放弃旧落点，保留新编辑', async () => {
    const { editor, host } = mountOverlay()
    const grip = await hover(b)
    const end = { x: a.x, y: 105 }
    pointer(grip, 'pointerdown', { x: 92, y: b.y })
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector('[data-side="top"]')).toBeInTheDocument())
    act(() => { editor.commands.insertContentAt(1, '新') })
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector('[data-side]')).not.toBeInTheDocument())
    pointer(document, 'pointerup', end)
    expect(blockTexts(editor)).toEqual(['新甲', '乙', '丙'])
  })

  it('无目标的落点不会重排，别的指针也不能结束手势', async () => {
    const { editor, host } = mountOverlay()
    const grip = await hover(b)
    const end = { x: a.x, y: 105 }
    pointer(grip, 'pointerdown', { x: 92, y: b.y })
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(host.querySelector('[data-side="top"]')).toBeInTheDocument())
    pointer(document, 'pointerup', end, 2)
    expect(host.querySelector('[data-side="top"]')).toBeInTheDocument()
    pointer(document, 'pointerup', { x: 40, y: 85 })
    expect(blockTexts(editor)).toEqual(['甲', '乙', '丙'])
    expect(host.querySelector('[data-side]')).not.toBeInTheDocument()
  })

  it.each([
    { end: b, cancel: false },
    { end: a, cancel: true },
  ])('从左侧空白框选两块（取消 $cancel）', async ({ end, cancel }) => {
    const { editor, body } = mountOverlay()
    const originalSelection = editor.state.selection
    const start = { x: 80, y: cancel ? b.y : a.y }
    pointer(body, 'pointerdown', start)
    pointer(document, 'pointermove', end)
    await waitFor(() => expect(selectedTexts(editor)).toEqual(['甲', '乙']))
    const selection = editor.state.selection as MultiBlockSelection
    expect(selection.headBlockPos < selection.anchorBlockPos).toBe(cancel)

    pointer(document, cancel ? 'pointercancel' : 'pointerup', end)
    if (cancel) expect(editor.state.selection.eq(originalSelection)).toBe(true)
    else expect(selectedTexts(editor)).toEqual(['甲', '乙'])
    expect(blockTexts(editor)).toEqual(['甲', '乙', '丙'])
  })

  it('快速框选在第一帧前松手也选中经过的块', () => {
    const { editor, body } = mountOverlay()
    pointer(body, 'pointerdown', { x: 80, y: a.y })
    pointer(document, 'pointerup', c)
    expect(selectedTexts(editor)).toEqual(['甲', '乙', '丙'])
    expect(body).toHaveFocus()
  })

  it('框选移到块外恢复原选区，再移回仍可选择', async () => {
    const { editor, body } = mountOverlay()
    const original = editor.state.selection
    pointer(body, 'pointerdown', { x: 80, y: a.y })
    pointer(document, 'pointermove', b)
    await waitFor(() => expect(selectedTexts(editor)).toEqual(['甲', '乙']))
    const outside = { x: 85, y: b.y }
    pointer(document, 'pointermove', outside)
    await waitFor(() => expect(editor.state.selection.eq(original)).toBe(true))
    pointer(document, 'pointerup', c)
    expect(selectedTexts(editor)).toEqual(['甲', '乙', '丙'])
  })

  it('firstLineCenter 跳过空白、inert、aria-hidden 和不可编辑文本，采用正文首行的中心', () => {
    const block = document.createElement('div')
    block.innerHTML = '<p> </p><p inert>折叠内容</p><p aria-hidden="true">辅助图标</p>' +
      '<p contenteditable="false">控件文字</p><p>正文首行</p>'
    const rangeBounds = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      return new DOMRect(120, this.startContainer.textContent === '正文首行' ? 95 : 10, 12, 10)
    })
    onTestFinished(() => rangeBounds.mockRestore())
    expect(firstLineCenter(block)).toBe(100)
  })

  it('firstLineCenter 无可测字形时回退到第一个可见文本块，不使用折叠内容的几何信息', () => {
    const block = document.createElement('div')
    block.innerHTML = '<p inert>折叠内容</p><p aria-hidden="true">辅助图标</p><p></p>'
    Array.from(block.children).forEach((child, index) => {
      child.getBoundingClientRect = () => new DOMRect(120, 20 + index * 40, 300, 20)
    })
    expect(firstLineCenter(block)).toBe(110)
  })
})

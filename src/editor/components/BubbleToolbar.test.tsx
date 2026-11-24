import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { MultiBlockSelection } from '../extensions/multi-block-selection'
import { BubbleToolbar } from './BubbleToolbar'

const editors: Editor[] = []

function editor(content = '<p>选中文字</p>') {
  const instance = new Editor({
    extensions: createEditorExtensions(),
    content,
    editorProps: { attributes: { class: 'test-editor', 'aria-label': '测试编辑器', role: 'textbox' } },
  })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

function select(instance: Editor, from: number, to: number) {
  act(() => {
    instance.view.dom.focus()
    instance.commands.setTextSelection({ from, to })
  })
}

function renderToolbar(instance: Editor, onComment = vi.fn()) {
  document.body.append(instance.view.dom)
  return render(<BubbleToolbar editor={instance} onComment={onComment} />)
}

function marks(instance: Editor) {
  return instance.state.selection.$from.marks().map(mark => mark.type.name)
}

describe('BubbleToolbar', () => {
  /*
   * @partition visibility: empty, non-empty, code, multi-block, unfocused
   * @partition formatting: block type and five inline marks
   * @partition palette: text/highlight color set and clear
   * @partition links: valid, invalid, remove, IME
   * @partition comment: callback contract
   */
  it('visibility: 空选区不弹出，非空 TextSelection 聚焦后弹出', async () => {
    const instance = editor()
    renderToolbar(instance)
    instance.view.dom.focus()
    expect(screen.queryByRole('group', { name: '选区格式' })).not.toBeInTheDocument()
    select(instance, 1, 3)
    await waitFor(() => expect(screen.getByRole('group', { name: '选区格式' })).toBeInTheDocument())
  })

  it('visibility: 代码块内选区与 MultiBlockSelection 不显示', async () => {
    const instance = editor('<pre><code>代码内容</code></pre>')
    renderToolbar(instance)
    select(instance, 2, 4)
    await waitFor(() => expect(screen.queryByRole('group', { name: '选区格式' })).not.toBeInTheDocument())
    act(() => {
      instance.commands.setContent('<p>一</p><p>二</p>')
      instance.commands.selectBlockRange(0, 3)
    })
    expect(instance.state.selection).toBeInstanceOf(MultiBlockSelection)
    await waitFor(() => expect(screen.queryByRole('group', { name: '选区格式' })).not.toBeInTheDocument())
  })

  it('visibility: 焦点移出编辑器后隐藏，返回选区后再显示', async () => {
    const user = userEvent.setup()
    const instance = editor()
    renderToolbar(instance)
    select(instance, 1, 3)
    const toolbar = await screen.findByRole('group', { name: '选区格式' })
    const outside = document.createElement('button')
    document.body.append(outside)
    await user.click(outside)
    await waitFor(() => expect(toolbar).not.toBeInTheDocument())
    select(instance, 1, 3)
    expect(await screen.findByRole('group', { name: '选区格式' })).toBeInTheDocument()
  })

  it('formatting: 块类型切换段落、一级/二级/三级标题与引用', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>标题正文</p>')
    renderToolbar(instance)
    select(instance, 2, 5)
    const selectControl = await screen.findByRole('combobox', { name: '块类型' })
    await user.selectOptions(selectControl, 'h1')
    expect(instance.state.selection.$from.parent.type.name).toBe('heading')
    expect(instance.state.selection.$from.parent.attrs.level).toBe(1)
    await user.selectOptions(screen.getByRole('combobox', { name: '块类型' }), 'h2')
    expect(instance.state.selection.$from.parent.attrs.level).toBe(2)
    await user.selectOptions(screen.getByRole('combobox', { name: '块类型' }), 'h3')
    expect(instance.state.selection.$from.parent.attrs.level).toBe(3)
    await user.selectOptions(screen.getByRole('combobox', { name: '块类型' }), 'quote')
    expect(instance.isActive('blockquote')).toBe(true)
    await user.selectOptions(screen.getByRole('combobox', { name: '块类型' }), 'paragraph')
    expect(instance.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('formatting: 五个行内格式按钮可开启，再点可关闭', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>格式文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '加粗' }))
    await user.click(screen.getByRole('button', { name: '斜体' }))
    await user.click(screen.getByRole('button', { name: '下划线' }))
    await user.click(screen.getByRole('button', { name: '删除线' }))
    expect(marks(instance)).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'strike']))
    for (const label of ['加粗', '斜体', '下划线', '删除线']) {
      await user.click(screen.getByRole('button', { name: label }))
    }
    expect(marks(instance)).toEqual([])
    const code = screen.getByRole('button', { name: '行内代码' })
    await user.click(code)
    expect(marks(instance)).toEqual(['code'])
    await user.click(code)
    expect(marks(instance)).toEqual([])
  })

  it('palette: 文字色选色与清除；重复点按钮收起面板', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>颜色文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '文字色' }))
    expect(screen.getByRole('group', { name: '文字色色板' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '文字色' }))
    expect(screen.queryByRole('group', { name: '文字色色板' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '文字色' }))
    const palette = screen.getByRole('group', { name: '文字色色板' })
    await user.click(within(palette).getByRole('button', { name: '绿色' }))
    expect(instance.getAttributes('textStyle').color).toBe('#16734a')
    expect(screen.queryByRole('group', { name: '文字色色板' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '文字色' }))
    await user.click(screen.getByRole('button', { name: '清除' }))
    expect(instance.getAttributes('textStyle').color).toBeFalsy()
  })

  it('palette: 高亮色选色与清除', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>高亮文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '高亮色' }))
    expect(screen.getByRole('group', { name: '高亮色色板' })).toBeInTheDocument()
    const palette = screen.getByRole('group', { name: '高亮色色板' })
    await user.click(within(palette).getByRole('button', { name: '粉色' }))
    expect(instance.getAttributes('highlight').color).toBe('#f9d8e1')
    await user.click(screen.getByRole('button', { name: '高亮色' }))
    await user.click(screen.getByRole('button', { name: '清除' }))
    expect(instance.getAttributes('highlight').color).toBeFalsy()
  })

  it('links: 打开、合法 URL 保存、非法 URL 报错并拒绝', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>链接文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '编辑链接' }))
    const input = screen.getByRole('textbox', { name: '链接地址' })
    expect(input).toHaveFocus()
    await user.type(input, 'https://example.com')
    await user.click(screen.getByRole('button', { name: '应用' }))
    expect(instance.getAttributes('link').href).toBe('https://example.com')
    expect(screen.queryByRole('textbox', { name: '链接地址' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑链接' }))
    await user.clear(screen.getByRole('textbox', { name: '链接地址' }))
    await user.type(screen.getByRole('textbox', { name: '链接地址' }), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getByRole('status')).toHaveTextContent('请输入有效链接')
    expect(instance.getAttributes('link').href).toBe('https://example.com')
  })

  it('links: 移除 removes link mark and closes panel', async () => {
    const user = userEvent.setup()
    const instance = editor('<p><a href="https://example.com">已有链接</a></p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '编辑链接' }))
    await user.click(screen.getByRole('button', { name: '移除' }))
    expect(instance.getAttributes('link').href).toBeFalsy()
    expect(screen.queryByRole('textbox', { name: '链接地址' })).not.toBeInTheDocument()
  })

  it('links: Escape 关闭面板', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>链接文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '编辑链接' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: '链接地址' })).not.toBeInTheDocument()
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])('links: IME Escape (%j) 不关闭链接面板', async init => {
    const user = userEvent.setup()
    const instance = editor('<p>链接文字</p>')
    renderToolbar(instance)
    select(instance, 1, 3)
    await screen.findByRole('group', { name: '选区格式' })
    await user.click(screen.getByRole('button', { name: '编辑链接' }))
    const event = new KeyboardEvent('keydown', { ...init, key: 'Escape', bubbles: true, cancelable: true })
    expect(fireEvent(screen.getByRole('textbox', { name: '链接地址' }), event)).toBe(true)
    expect(screen.getByRole('textbox', { name: '链接地址' })).toBeInTheDocument()
  })

  it('comment: 点击评论按钮只回调上层一次', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>评论文字</p>')
    const onComment = vi.fn()
    renderToolbar(instance, onComment)
    select(instance, 1, 3)
    await user.click(await screen.findByRole('button', { name: '评论' }))
    expect(onComment).toHaveBeenCalledOnce()
  })
})

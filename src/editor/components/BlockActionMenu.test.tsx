import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { MultiBlockSelection } from '../extensions/multi-block-selection'
import { BlockActionMenu } from './BlockActionMenu'

const documentContent = '<h4 data-block-id="alpha">甲</h4><p data-block-id="beta">乙</p><p data-block-id="gamma">丙</p>'

interface MenuOptions {
  count?: number
  content?: string
  start?: number
  end?: number
}

async function openMenu({ count = 1, content = documentContent, start = 0, end = count === 2 ? 3 : start }: MenuOptions = {}) {
  const user = userEvent.setup()
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  const anchor = document.createElement('button')
  anchor.textContent = '块手柄'
  document.body.append(editor.view.dom, anchor)
  onTestFinished(() => {
    editor.destroy()
    anchor.remove()
  })
  expect(editor.commands.selectBlockRange(start, end)).toBe(true)
  const onClose = vi.fn()
  render(<BlockActionMenu editor={editor} anchor={anchor} id="block-test-actions"
    blockHash={id => `#page=test&block=${id}`} onClose={onClose} />)
  const dialog = await screen.findByRole('dialog', { name: '块操作' })
  const button = (name: string) => within(dialog).getByRole('button', { name })
  return { user, editor, dialog, button, onClose }
}

describe('BlockActionMenu', () => {
  // @partition conversion: all advertised formats, both selection sizes, schema-restricted targets
  // @partition background: apply and reset, mixed selections
  // @partition editing: duplicate with distinct links, delete without losing other blocks
  // @partition links: single and ordered multi-block clipboard output, failure and retry
  // @partition dismissal: Escape returns focus to the handle via the parent
  it.each([
    ['段落', 'paragraph'], ['一级标题', 'heading', 1], ['二级标题', 'heading', 2],
    ['三级标题', 'heading', 3], ['无序列表', 'bulletList'], ['有序列表', 'orderedList'],
    ['待办列表', 'taskList'], ['引用', 'blockquote'], ['高亮块', 'callout'],
    ['折叠块', 'toggle'], ['代码块', 'codeBlock'],
  ] as const)('单块转换为%s，保留正文和后续兄弟块', async (label, type, level?: number) => {
    const { user, editor, button, onClose } = await openMenu()
    const previous = editor.state.doc.children.slice(1)
    await user.click(button(label))
    const [converted, ...rest] = editor.state.doc.children
    expect(converted?.type.name).toBe(type)
    expect(converted?.textContent).toBe('甲')
    if (level) expect(converted?.attrs.level).toBe(level)
    expect(rest).toEqual(previous)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('多块可一次转换为待办列表，保留原顺序和未选中段落', async () => {
    const { user, editor, button, onClose } = await openMenu({ count: 2 })
    await user.click(button('待办列表'))
    const [list, untouched] = editor.state.doc.children
    expect(list?.type.name).toBe('taskList')
    expect(list?.children.map(item => [item.textContent, item.attrs.checked])).toEqual([['甲', false], ['乙', false]])
    expect(untouched?.attrs.blockId).toBe('gamma')
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('列表项要求首块是段落时禁用标题转换', async () => {
    const { user, editor, button, onClose } = await openMenu({ content: '<ul><li><p>必需段落</p></li></ul>', start: 2 })
    const before = editor.getJSON()
    expect(button('一级标题')).toBeDisabled()
    expect(button('段落')).toBeEnabled()
    await user.click(button('一级标题'))
    expect(editor.getJSON()).toEqual(before)
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    { count: 1, name: '黄色背景', expected: ['yellow', 'default', 'default'] },
    { count: 2, name: '紫色背景', expected: ['purple', 'purple', 'default'] },
  ])('$count 块背景仅应用到选中的块', async ({ count, name, expected }) => {
    const { user, editor, button, onClose } = await openMenu({ count })
    expect(button('默认背景')).toHaveAttribute('aria-pressed', 'true')
    expect(button(name)).toHaveAttribute('aria-pressed', 'false')
    await user.click(button(name))
    expect(editor.state.doc.children.map(node => node.attrs.blockBg)).toEqual(expected)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('混合背景显示为未一致选中，清除背景把两块还原默认值', async () => {
    const { user, editor, button } = await openMenu({
      count: 2, content: '<h4 data-block-bg="yellow">甲</h4><p data-block-bg="purple">乙</p>',
    })
    expect(button('默认背景')).toHaveAttribute('aria-pressed', 'false')
    expect(button('黄色背景')).toHaveAttribute('aria-pressed', 'false')
    expect(button('紫色背景')).toHaveAttribute('aria-pressed', 'false')
    await user.click(button('默认背景'))
    expect(editor.state.doc.children.map(node => node.attrs.blockBg)).toEqual(['default', 'default'])
  })

  it.each([
    { count: 1, order: ['甲', '甲', '乙', '丙'], copied: ['甲'] },
    { count: 2, order: ['甲', '乙', '甲', '乙', '丙'], copied: ['甲', '乙'] },
  ])('为 $count 块创建副本，副本各有独立的块链接', async ({ count, order, copied }) => {
    const { user, editor, button, onClose } = await openMenu({ count })
    await user.click(button('复制副本'))
    const { doc, selection } = editor.state
    expect(doc.children.map(node => node.textContent)).toEqual(order)
    const ids = doc.children.map(node => node.attrs.blockId)
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(order.length)
    expect(selection).toBeInstanceOf(MultiBlockSelection)
    expect(selection.content().content.content.map(node => node.textContent)).toEqual(copied)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('删除文档中唯一的块后仍能继续输入', async () => {
    const { user, editor, button } = await openMenu({ content: '<h4>最后一块</h4>' })
    await user.click(button('删除'))
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(editor.state.doc.textContent).toBe('')
    editor.view.focus()
    await user.keyboard('A')
    expect(editor.state.doc.textContent).toBe('A')
  })

  it.each([
    { count: 1, remaining: ['乙', '丙'] },
    { count: 2, remaining: ['丙'] },
  ])('删除 $count 个选中块，其他块保留', async ({ count, remaining }) => {
    const { user, editor, button, onClose } = await openMenu({ count })
    await user.click(button('删除'))
    expect(editor.state.doc.children.map(node => node.textContent)).toEqual(remaining)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it.each([
    { count: 1, hashes: ['#page=test&block=alpha'] },
    { count: 2, hashes: ['#page=test&block=alpha', '#page=test&block=beta'] },
  ])('复制 $count 个可直接导航的块链接', async ({ count, hashes }) => {
    const { user, button, onClose } = await openMenu({ count })
    await user.click(button('复制块链接'))
    const links = (await navigator.clipboard.readText()).split('\n').map(text => new URL(text))
    expect(links.map(link => link.hash)).toEqual(hashes)
    expect(links.every(link => link.origin === location.origin && link.pathname === location.pathname)).toBe(true)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('剪贴板拒绝写入时保留菜单并提示，可重试复制', async () => {
    const { user, button, onClose } = await openMenu()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    onTestFinished(() => writeText.mockRestore())
    await user.click(button('复制块链接'))
    expect(await screen.findByRole('status')).toHaveTextContent('剪贴板不可用，未能复制链接。')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(button('复制块链接'))
    expect(new URL(await navigator.clipboard.readText()).hash).toBe('#page=test&block=alpha')
    expect(onClose).toHaveBeenCalledExactlyOnceWith('editor')
  })

  it('Escape 请求关闭并将焦点交还块手柄，普通按键保持菜单打开', async () => {
    const { user, dialog, onClose } = await openMenu()
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledExactlyOnceWith('handle')
  })
})

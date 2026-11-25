import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorContent } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SlashMenu } from '../components/SlashMenu'
import { matchSlashCommand, openSlashMenu, slashCommandKey } from './slash-command'
import { SLASH_ITEMS } from './slash-search'
import { createEditorExtensions } from './index'

const editors: Editor[] = []
function editor(content = '<p></p>') {
  const instance = new Editor({
    extensions: createEditorExtensions(),
    content,
    editorProps: {
      attributes: { class: 'test-editor', 'aria-label': '测试编辑器', role: 'textbox' },
    },
  })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
})

beforeAll(() => {
  const hitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => screen.queryByRole('textbox', { name: '测试编辑器' }),
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  return () => {
    if (hitTest) Object.defineProperty(document, 'elementFromPoint', hitTest)
    else Reflect.deleteProperty(document, 'elementFromPoint')
    if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

function insertText(instance: Editor, text: string) {
  const end = TextSelection.atEnd(instance.state.doc)
  instance.commands.setTextSelection(end)
  instance.commands.insertContent(text)
}

function matchAt($position: TextSelection['$from']) {
  return matchSlashCommand({
    char: '/',
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes: [' '],
    startOfLine: false,
    $position,
  })
}

function activeOption() {
  return screen.getByRole('option', { selected: true })
}

function menu() {
  return screen.getByRole('listbox', { name: '插入块' })
}

describe('SlashMenu', () => {
  /*
   * @partition rendering: empty, grouped and active items
   * @partition selection: mouse choose and active scroll
   */
  it('rendering: 空结果显示状态，分组只在组首出现', () => {
    const { rerender } = render(<SlashMenu items={[]} activeIndex={0} choose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的块')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    rerender(<SlashMenu items={[SLASH_ITEMS[0]!, SLASH_ITEMS[1]!, SLASH_ITEMS[9]!]} activeIndex={1} choose={vi.fn()} />)
    expect(menu()).toBeInTheDocument()
    expect(screen.getAllByText('基础块')).toHaveLength(1)
    expect(screen.getByText('容器与布局')).toBeInTheDocument()
    expect(activeOption()).toHaveTextContent('一级标题')
  })
  it('selection: 鼠标选项回传完整项，mousedown 保持编辑器焦点', async () => {
    const choose = vi.fn()
    const anchor = document.createElement('button')
    document.body.append(anchor)
    anchor.focus()
    render(<SlashMenu items={[SLASH_ITEMS[0]!, SLASH_ITEMS[1]!]} activeIndex={0} choose={choose} />)
    const option = screen.getByRole('option', { name: /一级标题/ })
    expect(fireEvent.mouseDown(option)).toBe(false)
    expect(anchor).toHaveFocus()
    await userEvent.setup().click(option)
    expect(choose).toHaveBeenCalledWith(SLASH_ITEMS[1])
  })
})

describe('slash-command 交互', () => {
  /*
   * @partition trigger: slash, Chinese comma, code block rejection
   * @partition filter: Chinese label, pinyin, unmatched
   * @partition navigation: down/up wrap, Enter, Esc, IME
   * @partition insertion: all block types
   * @partition helpers: open menu and matcher ranges
   */
  it('trigger: 输入 / 弹出菜单，输入 、 同样触发', async () => {
    const instance = editor()
    const user = userEvent.setup()
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    await user.keyboard('/')
    await screen.findByRole('listbox', { name: '插入块' })
    expect(screen.getAllByRole('option').length).toBe(17)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '插入块' })).not.toBeInTheDocument())
    await user.keyboard(' 、')
    await screen.findByRole('listbox', { name: '插入块' })
  })

  it('filter: 拼音过滤且查询变化重置活动项', async () => {
    const user = userEvent.setup()
    const instance = editor('<p></p>')
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ' /gl')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(activeOption()).toHaveTextContent('高亮块')
    await user.keyboard('{Backspace}')
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1))
  })

  it('navigation: 上下键循环，Enter 插入，Esc 退出', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>前文</p>')
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ' /')
    await waitFor(() => screen.getByRole('listbox', { name: '插入块' }))
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowDown}')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '插入块' })).not.toBeInTheDocument())
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock')
    instance.commands.setContent('<p></p>')
    insertText(instance, ' /')
    await waitFor(() => screen.getByRole('listbox', { name: '插入块' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '插入块' })).not.toBeInTheDocument())
  })

  it('navigation: 零匹配 Enter 不被建议菜单吞掉', async () => {
    const user = userEvent.setup()
    const instance = editor('<p>前文</p>')
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ' /qqqqqq')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('没有匹配的块'))
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(instance.state.doc.textContent).toContain('qqqqqq')
    expect(instance.state.doc.children.map(node => node.textContent.trim())).toEqual(['前文 /qqqqqq', ''])
    expect(instance.state.selection.$from.parent.textContent).toBe('')
  })

  it('navigation: IME composing/keyCode 229 时上下键与 Enter 不劫持', async () => {
    const instance = editor()
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ' /')
    await screen.findByRole('listbox', { name: '插入块' })

    const suggestion = slashCommandKey.get(instance.state)!
    for (const init of [{ key: 'ArrowDown', isComposing: true }, { key: 'ArrowUp', keyCode: 229 }, { key: 'Enter', keyCode: 229 }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      expect(suggestion.props.handleKeyDown?.call(suggestion, instance.view, event)).toBe(false)
      expect(activeOption()).toHaveTextContent('正文')
      expect(instance.state.doc.textContent).toContain('/')
    }
  })

  it('trigger: 代码块内不弹出菜单', async () => {
    const user = userEvent.setup()
    const instance = editor('<pre><code>代码</code></pre>')
    render(<EditorContent editor={instance} />)
    instance.commands.setTextSelection(TextSelection.atEnd(instance.state.doc))
    instance.view.dom.focus()
    await user.keyboard('/gl')
    expect(screen.queryByRole('listbox', { name: '插入块' })).not.toBeInTheDocument()
    expect(instance.state.doc.textContent).toContain('/gl')
  })

  it.each([
    ['正文', 'paragraph', 'paragraph'],
    ['一级标题', 'heading 1', 'heading', 1],
    ['二级标题', 'h2', 'heading', 2],
    ['三级标题', 'h3', 'heading', 3],
    ['无序列表', 'bullet', 'bulletList'],
    ['有序列表', 'ordered', 'orderedList'],
    ['待办列表', 'task', 'taskList'],
    ['引用', 'quote', 'blockquote'],
    ['分割线', 'divider', 'horizontalRule'],
    ['高亮块', 'callout', 'callout'],
    ['折叠块', 'toggle', 'toggle'],
    ['双栏', '2 columns', 'columnList', 2],
    ['三栏', '3 columns', 'columnList', 3],
    ['表格', 'TABLE', 'table'],
    ['代码块', 'code block', 'codeBlock'],
  ] as const)('insertion: %s 清除查询并插入对应的块', async (label, query, type, detail?: number) => {
    const instance = editor()
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ` /${query}`)
    const option = await screen.findByRole('option', { name: new RegExp(`^${label}`) })
    await userEvent.setup().click(option)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    const block = instance.state.doc.children.find(child => child.type.name === type)
    expect(block).toBeDefined()
    expect(instance.state.doc.textContent).not.toContain(`/${query}`)
    if (type === 'heading') expect(block?.attrs.level).toBe(detail)
    if (type === 'columnList') expect(block?.childCount).toBe(detail)
    if (type === 'table') {
      expect(block?.childCount).toBe(3)
      expect(block?.firstChild?.childCount).toBe(3)
      expect(block?.firstChild?.firstChild?.type.name).toBe('tableHeader')
    }
  })

  it.each([
    ['lct', 'mermaid', /^flowchart/], ['mermaid', 'mermaid', /^flowchart/],
    ['gs', 'math', /n\(n\+1\)/], ['math', 'math', /n\(n\+1\)/],
  ] as const)('insertion: /%s inserts a previewable Markdown code block', async (query, language, example) => {
    const instance = editor()
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ` /${query}`)
    await screen.findByRole('option', { selected: true })
    await userEvent.setup().keyboard('{Enter}')
    const block = instance.state.doc.children.find(child => child.type.name === 'codeBlock')
    expect(block?.attrs).toMatchObject({ language, viewMode: 'preview' })
    expect(block?.textContent).toMatch(example)
    expect(instance.state.doc.textContent).not.toContain(`/${query}`)
  })

  it.each([
    ['无序列表', 'bullet', 'bulletList', '<ul><li><p>已在列表</p></li></ul>'],
    ['有序列表', 'ordered', 'orderedList', '<ol><li><p>已在列表</p></li></ol>'],
    ['待办列表', 'task', 'taskList', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>已在列表</p></li></ul>'],
  ])('在已有%s中运行同一命令，保留列表与勾选状态', async (label, query, type, html) => {
    const instance = editor(html)
    render(<EditorContent editor={instance} />)
    instance.view.dom.focus()
    insertText(instance, ` /${query}`)
    await userEvent.setup().click(await screen.findByRole('option', { name: new RegExp(`^${label}`) }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    const list = instance.state.doc.firstChild
    expect(list?.type.name).toBe(type)
    expect(list?.childCount).toBe(1)
    expect(list?.textContent).toBe('已在列表 ')
    if (type === 'taskList') expect(list?.firstChild?.attrs.checked).toBe(true)
  })

  it('helpers: openSlashMenu 在指定段落插入斜杠并打开菜单', async () => {
    const instance = editor('<p>前缀 后文</p><p>下一段</p>')
    render(<EditorContent editor={instance} />)
    act(() => openSlashMenu(instance, 4))
    expect(instance.state.doc.firstChild?.textContent).toBe('前缀 /后文')
    expect(instance.state.doc.lastChild?.textContent).toBe('下一段')
    expect(await screen.findByRole('listbox', { name: '插入块' })).toBeInTheDocument()
    await waitFor(() => expect(instance.view.dom).toHaveFocus())
  })

  it('helpers: 两种触发符都返回准确范围，并排除单词内斜杠和非文本位置', () => {
    const instance = editor('<p>甲 、一2</p><p>/h2 后文</p><p>path/to</p>')
    const doc = instance.state.doc
    expect(matchAt(doc.resolve(6))).toEqual({ range: { from: 3, to: 6 }, query: '一2', text: '、一2' })
    expect(matchAt(doc.resolve(11))).toEqual({ range: { from: 8, to: 11 }, query: 'h2', text: '/h2' })
    expect(matchAt(TextSelection.atEnd(doc).$from)).toBeNull()
    expect(matchAt(doc.resolve(0))).toBeNull()
  })
})

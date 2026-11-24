import { Editor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import App from '../App'
import { createEditorExtensions } from '../editor/extensions'
import type { CommentThread } from '../editor/comments'
import type { PageRecord } from './page-store'
import { PageEditor } from './PageEditor'
import type { EditPage } from './PageEditor'

const extensions = createEditorExtensions()

function makePage(overrides: Partial<PageRecord> & Pick<PageRecord, 'id' | 'title'>): PageRecord {
  return {
    parentId: null, icon: '📄', comments: [], content: { type: 'doc', content: [{ type: 'paragraph' }] },
    createdAt: 1, updatedAt: 1, order: 0, ...overrides,
  }
}

function textDoc(text: string, marks: { commentId: string } | null = null) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: marks
        ? [{ type: 'text', text, marks: [{ type: 'comment', attrs: marks }] }]
        : [{ type: 'text', text }],
    }],
  }
}

const thread: CommentThread = {
  id: 'c1', quote: 'Beta', resolved: false,
  messages: [{ id: 'm1', author: '同事', text: '看看这里' }],
}

interface HarnessProps {
  readonly initial: PageRecord[]
  readonly startCommentsOpen?: boolean
  readonly onImport?: (file: File) => void
  readonly onEditor?: (editor: Editor) => void
}

function Harness({ initial, startCommentsOpen = false, onImport = () => {}, onEditor }: HarnessProps) {
  const [pages, setPages] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0]!.id)
  const [commentsOpen, setCommentsOpen] = useState(startCommentsOpen)
  const active = pages.find(page => page.id === activeId)!
  const edit: EditPage = (id, patch, deferred) => {
    void deferred
    setPages(current => current.map(page => page.id === id
      ? { ...page, ...(typeof patch === 'function' ? patch(page) : patch) }
      : page))
  }
  return (
    <>
      <PageEditor key={active.id} page={active} extensions={extensions} anchor={null} commentsOpen={commentsOpen}
        onCommentsOpen={setCommentsOpen} onEditorReady={(_id, editor) => onEditor?.(editor)}
        onEdit={edit} onImport={onImport} />
      <button type="button" onClick={() => setActiveId(current => {
        const index = initial.findIndex(page => page.id === current)
        return initial[(index + 1) % initial.length]!.id
      })}>切换页面</button>
    </>
  )
}

function mount(props: HarnessProps) {
  let editor: Editor | null = null
  const view = render(<Harness {...props} onEditor={instance => { editor = instance; props.onEditor?.(instance) }} />)
  return { view, editor: () => editor! }
}

async function selectText(editor: Editor, from: number, to: number) {
  await act(async () => {
    editor.view.focus()
    editor.commands.setTextSelection({ from, to })
  })
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() })),
  })
})

afterEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('PageEditor comments', () => {
  /*
   * Testing strategy
   * @partition create: 划词 → Bubble 评论 → 新建 thread 并打开评论栏
   * @partition locate: 点击引用定位、滚动与 active decoration
   * @partition reply: 草稿首发与后续回复
   * @partition resolve: 清理正文 comment mark 并保留 resolved thread
   * @partition delete: 删除 thread
   */
  it('create: 划词发起评论，打开评论栏并写入正文 mark 与草稿 thread', async () => {
    const page = makePage({ id: '11111111-1111-4111-8111-111111111111', title: '评论页', content: textDoc('Alpha content') })
    const { editor } = mount({ initial: [page], startCommentsOpen: false })
    await waitFor(() => expect(editor()).toBeTruthy())
    await selectText(editor(), 1, 6)
    const commentButton = await screen.findByRole('button', { name: '评论' })
    await userEvent.setup().click(commentButton)
    const sidebar = await screen.findByRole('complementary', { name: '评论' })
    expect(within(sidebar).getByText('Alpha')).toBeInTheDocument()
    expect(within(sidebar).getByLabelText('评论内容')).toBeInTheDocument()
    expect(editor().view.dom.querySelector('[data-comment-id]')).not.toBeNull()
    expect(editor().view.dom.querySelector('[data-comment-id]')?.textContent).toBe('Alpha')

    const draft = within(sidebar).getByLabelText('评论内容')
    await userEvent.setup().type(draft, '第一条反馈')
    await userEvent.setup().click(within(sidebar).getByRole('button', { name: '发表评论' }))
    expect(await within(sidebar).findByText('第一条反馈')).toBeInTheDocument()
    expect(within(sidebar).getByLabelText('回复内容')).toBeInTheDocument()
  })

  it('locate/reply/resolve/delete: 定位引用、回复、解决清理 mark、删除 thread', async () => {
    const page = makePage({
      id: '22222222-2222-4222-8222-222222222222', title: '已有评论', content: textDoc('Beta', { commentId: 'c1' }),
      comments: [thread],
    })
    const { editor } = mount({ initial: [page], startCommentsOpen: true })
    await waitFor(() => expect(editor()).toBeTruthy())
    const sidebar = await screen.findByRole('complementary', { name: '评论' })
    const quote = within(sidebar).getByRole('button', { name: 'Beta' })

    await userEvent.setup().click(quote)
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    await waitFor(() => expect(within(sidebar).getByText('Beta').closest('.comment-thread')).toHaveAttribute('data-active', 'true'))
    await waitFor(() => expect(editor().view.dom.querySelector('.comment-active')).not.toBeNull())

    const reply = within(sidebar).getByLabelText('回复内容')
    await userEvent.setup().type(reply, '收到，我来修')
    await userEvent.setup().click(within(sidebar).getByRole('button', { name: '回复' }))
    expect(await within(sidebar).findByText('收到，我来修')).toBeInTheDocument()

    await userEvent.setup().click(within(sidebar).getByRole('button', { name: '解决评论' }))
    await waitFor(() => expect(editor().view.dom.querySelector('[data-comment-id="c1"]')).toBeNull())
    const resolved = await within(sidebar).findByText('已解决')
    expect(resolved).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Beta' })).toBeDisabled()

    await userEvent.setup().click(within(sidebar).getByRole('button', { name: '删除评论' }))
    await waitFor(() => expect(within(sidebar).queryByText('Beta')).not.toBeInTheDocument())
    expect(within(sidebar).getByText('选中文字后可发表评论')).toBeInTheDocument()
  })
})

describe('PageEditor drag import', () => {
  /*
   * @partition hint: 文件 dragenter 显示提示，dragleave 收起
   * @partition import: .md drop 调用 onImport 且阻止默认
   * @partition reject: 非 .md drop 阻止默认跳转但不导入
   */
  it('dragenter/leave: 显示和隐藏 Markdown 拖放提示', async () => {
    const { editor } = mount({ initial: [makePage({ id: '33333333-3333-4333-8333-333333333333', title: '拖拽页' })] })
    await waitFor(() => expect(editor()).toBeTruthy())
    const surface = screen.getByRole('textbox', { name: '文档正文' }).closest('main')!
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['# hi'], 'note.md', { type: 'text/markdown' }))
    await act(async () => { surface.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true })) })
    expect(screen.getByText('拖放 Markdown 文件以新建页面')).toBeInTheDocument()
    expect(surface).toHaveAttribute('data-dragging-md', 'true')
    await act(async () => { surface.dispatchEvent(new DragEvent('dragleave', { dataTransfer, bubbles: true })) })
    expect(screen.queryByText('拖放 Markdown 文件以新建页面')).not.toBeInTheDocument()
  })

  it('drop: .md 交给 onImport，非 .md 阻止默认但不导入', async () => {
    const onImport = vi.fn()
    const { editor } = mount({
      initial: [makePage({ id: '44444444-4444-4444-8444-444444444444', title: '导入页' })], onImport,
    })
    await waitFor(() => expect(editor()).toBeTruthy())
    const surface = screen.getByRole('textbox', { name: '文档正文' }).closest('main')!
    const md = new File(['# 导入'], 'note.md', { type: 'text/markdown' })
    const mdTransfer = new DataTransfer()
    mdTransfer.items.add(md)
    const mdDrop = new DragEvent('drop', { dataTransfer: mdTransfer, bubbles: true, cancelable: true })
    await act(async () => { surface.dispatchEvent(mdDrop) })
    expect(mdDrop.defaultPrevented).toBe(true)
    expect(onImport).toHaveBeenCalledWith(md)

    const txt = new File(['plain'], 'note.txt', { type: 'text/plain' })
    const txtTransfer = new DataTransfer()
    txtTransfer.items.add(txt)
    const txtDrop = new DragEvent('drop', { dataTransfer: txtTransfer, bubbles: true, cancelable: true })
    await act(async () => { surface.dispatchEvent(txtDrop) })
    expect(txtDrop.defaultPrevented).toBe(true)
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('拖放 Markdown 文件以新建页面')).not.toBeInTheDocument()
  })
})

describe('PageEditor page isolation', () => {
  /*
   * @partition key: 切页后 PageEditor 重建，正文/评论互不串扰
   * @partition history: 重建后的编辑器历史为空，撤销不回滚已保存内容
   */
  it('switch: 正文与评论隔离，重建后的 Undo 不回滚既有内容', async () => {
    const pageA = makePage({
      id: '55555555-5555-4555-8555-555555555555', title: 'A 页', content: textDoc('A content'),
    })
    const pageB = makePage({
      id: '66666666-6666-4666-8666-666666666666', title: 'B 页', content: textDoc('B content'),
      comments: [{ id: 'cB', quote: 'B content', resolved: false, messages: [] }],
    })
    const seen: Editor[] = []
    const { editor } = mount({ initial: [pageA, pageB], startCommentsOpen: true, onEditor: instance => seen.push(instance) })
    await waitFor(() => expect(editor()).toBeTruthy())
    let first = editor()
    await act(async () => { first.commands.insertContentAt(1, 'MARKER ') })
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('MARKER'))

    await userEvent.setup().click(screen.getByRole('button', { name: '切换页面' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('B content'))
    expect(screen.getByRole('textbox', { name: '文档正文' })).not.toHaveTextContent('MARKER')
    expect(screen.getByRole('complementary', { name: '评论' })).toHaveTextContent('B content')
    expect(screen.getByRole('complementary', { name: '评论' })).not.toHaveTextContent('A content')

    await userEvent.setup().click(screen.getByRole('button', { name: '切换页面' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('MARKER'))
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3))
    const rebuilt = seen.at(-1)!
    expect(rebuilt).not.toBe(first)
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('MARKER')
    await act(async () => { rebuilt.commands.undo() })
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('MARKER')
  })
})


describe('Workspace markdown actions', () => {
  /*
   * @partition copy: 复制 Markdown 反馈与 1.5s 复位
   * @partition export: 导出 .md 与 .json 下载名
   * @partition save-failure: localStorage 失败时提示条展示
   */
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  async function mountApp() {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toBeInTheDocument())
    return user
  }

  it('copy: 显示已复制 Markdown 并在 1.5s 后复位', async () => {
    const user = await mountApp()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(screen.getByRole('button', { name: '复制为 Markdown' }))
    expect(await screen.findByText('已复制 Markdown')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('复制为 Markdown', undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('export: 导出 Markdown 与 JSON 使用当前页标题作为下载名', async () => {
    const user = await mountApp()
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(screen.getByRole('button', { name: /导出 Markdown/ }))
    expect(downloads[0]).toBe('文档协作与发布手册.md')
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(screen.getByRole('button', { name: /导出 JSON/ }))
    expect(downloads[1]).toBe('文档协作与发布手册.json')
  })

  it('save-failure: localStorage 写入失败时展示工作区保存失败提示', async () => {
    const user = await mountApp()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const title = screen.getByRole('textbox', { name: '文档标题' })
    await user.clear(title)
    await user.type(title, '无法保存')
    expect(await screen.findByText('浏览器无法保存工作区。')).toBeInTheDocument()
    setItem.mockRestore()
  })
})

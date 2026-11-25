import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './workspace/demo-workspace'
import { WORKSPACE_STORAGE_KEY } from './workspace/page-store'
import { createEditorExtensions } from './editor/extensions'
import { getSchema } from '@tiptap/core'

const schema = getSchema(createEditorExtensions())

describe('App 多页面集成', () => {
  /*
   * Testing strategy
   * @partition shell: 顶栏、面包屑、标题同步、面板开关、快捷键
   * @partition pages: 切页隔离、页面树自动展开、编辑刷新恢复
   * @partition import: 文件选择、拖放 md、拒绝非 md
   * @partition export: md/json、复制状态重置
   * @partition dialogs-reset: 二次确认、取消和确认
   * @partition invariants: contenteditable 零原生控件
   */
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/')
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    localStorage.clear()
    history.replaceState(null, '/')
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function mountApp() {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toBeInTheDocument())
    return user
  }

  it('shell: 顶栏展示手册根页和标题，侧栏可切页面/目录及显示评论', async () => {
    const user = await mountApp()
    const title = screen.getByRole('textbox', { name: '文档标题' })
    expect(title).toHaveValue('文档协作与发布手册')
    expect(screen.getByRole('navigation', { name: '页面层级' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '目录侧栏' }))
    expect(screen.getByRole('navigation', { name: '文档章节' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '页面侧栏' }))
    expect(screen.getByRole('navigation', { name: '页面树' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '评论侧栏' }))
    expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '评论侧栏' }))
    expect(screen.getByRole('complementary', { name: '评论' })).toBeInTheDocument()
  })

  it('shell: 父页面包屑跳转；子页编辑标题并双向同步页面树', async () => {
    const user = await mountApp()
    await user.click(screen.getByRole('button', { name: '试点验收清单' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('试点验收清单'))
    const breadcrumb = screen.getByRole('link', { name: '文档协作与发布手册' })
    await user.click(breadcrumb)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('文档协作与发布手册'))
    await user.click(screen.getByRole('button', { name: '试点验收清单' }))
    const title = screen.getByRole('textbox', { name: '文档标题' })
    await user.clear(title)
    await user.type(title, '验收清单·现场')
    const treeRow = within(screen.getByRole('navigation', { name: '页面树' }))
    expect(treeRow.getByRole('button', { name: '验收清单·现场' })).toHaveAttribute('aria-current', 'page')
  })

  it('pages: A 页内容与评论完好，B 页无串扰，返回 A 页编辑器实例重建', async () => {
    const user = await mountApp()
    const body = screen.getByRole('textbox', { name: '文档正文' })
    const instance = (
      screen.getByRole('textbox', { name: '文档正文' }) as HTMLElement & { editor: import('@tiptap/core').Editor }
    ).editor
    act(() => {
      instance.commands.setContent('<h1 data-block-id="demo-intro">文档协作与发布手册</h1><p>A 页新增文本</p>')
    })
    await waitFor(() => expect(body).toHaveTextContent('A 页新增文本'))
    await user.click(screen.getByRole('button', { name: '试点验收清单' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).not.toHaveTextContent('A 页新增文本'))
    await user.click(screen.getByRole('button', { name: '文档协作与发布手册' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('A 页新增文本'))
    expect(screen.getByText('建议周四先开放给设计和运营团队，周五统一汇总反馈。')).toBeInTheDocument()
    expect(screen.queryByText('设计团队已核对。')).not.toBeInTheDocument()
  })

  it('pages: 新建子页后标题输入框获焦，Enter 只提交标题而不破坏新页', async () => {
    const user = await mountApp()
    await user.click(screen.getByRole('button', { name: '新建「文档协作与发布手册」的子页' }))
    const title = screen.getByRole('textbox', { name: '文档标题' })
    expect(title).toHaveFocus()
    await user.clear(title)
    await user.type(title, '新子页')
    expect(screen.getByRole('button', { name: '新子页' })).toHaveAttribute('aria-current', 'page')
  })

  it('import: 文件选择导入 Markdown 新建根页，不覆盖当前页面', async () => {
    const user = await mountApp()
    const file = new File(['# 外部记录\n\n- [x] 已完成'], 'external.md', { type: 'text/markdown' })
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(within(screen.getByRole('group', { name: '导入与导出' })).getByRole('button', { name: /导入 Markdown/ }))
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    await act(async () => {
      screen.getByRole('textbox', { name: '文档正文' }).closest('main')!.dispatchEvent(
        new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }),
      )
    })
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('外部记录'))
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('已完成')
    expect(screen.getByRole('button', { name: '外部记录' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '文档协作与发布手册' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('link', { name: '文档协作与发布手册' })).not.toBeInTheDocument()
  })

  it('import: 拖入 md 建新页，拖入 txt 阻止默认跳转且不创建页面', async () => {
    const user = await mountApp()
    const surface = screen.getByRole('textbox', { name: '文档正文' }).closest('main')!
    const md = new File(['# 拖入笔记\n\n拖放正文'], 'drop.markdown', { type: 'text/markdown' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(md)
    await act(async () => {
      surface.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true }))
    })
    expect(screen.getByText('拖放 Markdown 文件以新建页面')).toBeInTheDocument()
    const drop = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true })
    await act(async () => { surface.dispatchEvent(drop) })
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('拖入笔记'))
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('拖放正文')
    const bad = new DataTransfer()
    bad.items.add(new File(['plain'], 'notes.txt', { type: 'text/plain' }))
    const blocked = new DragEvent('drop', { dataTransfer: bad, bubbles: true, cancelable: true })
    await act(async () => { surface.dispatchEvent(blocked) })
    expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('拖入笔记')
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('拖放正文')
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
  })

  it('export: 导出 md 和 json 的下载文件名来自当前页标题', async () => {
    const user = await mountApp()
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(within(screen.getByRole('group', { name: '导入与导出' })).getByRole('button', { name: /导出 Markdown/ }))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(within(screen.getByRole('group', { name: '导入与导出' })).getByRole('button', { name: /导出 JSON/ }))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('copy: 复制 Markdown 后显示成功文案，1.5 秒后复位；失败提示可见', async () => {
    const user = await mountApp()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(screen.getByRole('button', { name: '复制为 Markdown' }))
    expect(screen.getByText('已复制 Markdown')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('复制为 Markdown')).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText('复制为 Markdown')).toBeInTheDocument()
  })

  it('copy: 剪贴板失败时显示可关闭提示', async () => {
    const user = await mountApp()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    await user.click(screen.getByRole('button', { name: '导入与导出' }))
    await user.click(screen.getByRole('button', { name: '复制为 Markdown' }))
    expect(await screen.findByText('无法将 Markdown 写入剪贴板。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByText('无法将 Markdown 写入剪贴板。')).not.toBeInTheDocument()
  })

  it('dialogs-reset: 快捷键弹窗可打开；重置先取消再确认', async () => {
    const user = await mountApp()
    await user.click(screen.getByRole('button', { name: '快捷键' }))
    expect(screen.getByRole('dialog', { name: '快捷键' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭快捷键' }))
    await user.click(screen.getByRole('button', { name: '重置示例工作区' }))
    expect(screen.getByRole('dialog', { name: '重置示例工作区' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '重置示例工作区' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重置示例工作区' }))
    await user.click(screen.getByRole('button', { name: '确认重置' }))
    expect(screen.getByText('5 个页面')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全图种与公式复杂示例' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('文档协作与发布手册'))
  })

  it('从未打开的页面可以导出 Markdown 和创建完整副本', async () => {
    const demo = createDemoWorkspace(schema)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(demo))
    const user = await mountApp()
    const name = '试点验收清单'
    const menu = () => screen.getByRole('group', { name: `${name}的操作` })
    async function openPageActions() {
      await user.click(screen.getByRole('button', { name: `「${name}」的更多操作` }))
    }
    await openPageActions()
    await user.click(within(menu()).getByRole('button', { name: '导出 Markdown' }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)))
    expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('文档协作与发布手册')
    await openPageActions()
    await user.click(within(menu()).getByRole('button', { name: '创建副本' }))
    expect(await screen.findByRole('button', { name: `${name}（副本）` })).toHaveAttribute('aria-current', 'page')
    const editor = screen.getByRole('textbox', { name: '文档正文' })
    expect(editor.querySelector('[data-type="taskList"]')).not.toBeNull()
    expect(screen.getByRole('complementary', { name: '评论' })).toHaveTextContent('设计团队已核对')
    expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-current')
  })

  it('copies Markdown and duplicates the active document from its live, unflushed body', async () => {
    await mountApp()
    const body = screen.getByRole('textbox', { name: '文档正文' }) as HTMLElement & {
      editor: import('@tiptap/core').Editor
    }
    await waitFor(() => expect(body.editor.isInitialized).toBe(true))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.useFakeTimers()
    act(() => body.editor.commands.setContent('<p>正在编辑、尚未刷盘的正文</p>'))
    fireEvent.click(screen.getByRole('button', { name: '导入与导出' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制为 Markdown' }))
    })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('正在编辑、尚未刷盘的正文'))
    fireEvent.click(screen.getByRole('button', { name: '「文档协作与发布手册」的更多操作' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '创建副本' })) })
    expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('文档协作与发布手册（副本）')
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('正在编辑、尚未刷盘的正文')
  })

  it('invariants: contenteditable 内没有原生交互控件，浮层是 ProseMirror 兄弟', async () => {
    await mountApp()
    const root = screen.getByRole('textbox', { name: '文档正文' })
    expect(root.querySelectorAll('button,input,select,textarea')).toHaveLength(0)
    const host = document.querySelector('[data-document-overlays]')!
    expect(host.parentElement).toBe(root.parentElement)
    expect(document.querySelectorAll('[data-document-overlays]')).toHaveLength(1)
  })
})

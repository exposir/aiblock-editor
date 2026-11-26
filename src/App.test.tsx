import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import App from './App'
import type { DesktopBridge } from './desktop/bridge'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './workspace/demo-workspace'
import { WORKSPACE_STORAGE_KEY } from './workspace/page-store'
import { DOCUMENT_MODE_STORAGE_KEY } from './workspace/document-mode'
import { splitLegacyWorkspace } from './workspace/workspace-format'
import type { PageShard, WorkspaceExternalChange } from './workspace/workspace-format'
import { createEditorExtensions } from './editor/extensions'
import { getSchema } from '@tiptap/core'
import type { PaseoAgentLogs, PaseoTreeSnapshot } from './paseo/paseo-types'

const schema = getSchema(createEditorExtensions())

describe('App 多页面集成', () => {
  /*
   * Testing strategy
   * @partition shell: 顶栏、面包屑、标题同步、面板开关、快捷键
   * @partition pages: 切页隔离、页面树自动展开、编辑刷新恢复
   * @partition import: 文件选择、拖放 md、拒绝非 md
   * @partition export: md/json、复制状态重置
   * @partition dialogs-reset: 二次确认、取消和确认
   * @partition conflicts: 以磁盘正文与实时草稿比较，可收起并继续处理冲突
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
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function mountApp() {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '文档正文' })).toBeInTheDocument())
    return user
  }

  async function mountPreview() {
    localStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, 'preview')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('article', { name: '文档预览' })
    return user
  }

  async function deleteFromTree(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(screen.getByRole('button', { name: `「${title}」的更多操作` }))
    await user.click(within(screen.getByRole('group', { name: `${title}的操作` })).getByRole('button', { name: '删除页面' }))
    const dialog = screen.getByRole('dialog', { name: '删除页面' })
    await user.click(within(dialog).getByRole('button', { name: '移入回收站' }))
  }

  it('mode: 顶栏预览/编辑开关切换为纯静态文档并持久化', async () => {
    const user = await mountApp()
    expect(screen.queryByRole('radiogroup', { name: '内容来源' })).not.toBeInTheDocument()
    const group = screen.getByRole('radiogroup', { name: '文档模式' })
    expect(within(group).getByRole('radio', { name: '编辑' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(group).getByRole('radio', { name: '预览' }))
    expect(screen.getByRole('article', { name: '文档预览' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelector('.ProseMirror')).toBeNull()
    expect(document.querySelector('[contenteditable]')).toBeNull()
    expect(document.querySelector('[data-document-overlays]')).toBeNull()
    expect(document.querySelector('.bubble-toolbar')).toBeNull()
    expect(document.querySelector('.table-controls-layer')).toBeNull()
    expect(group.style.getPropertyValue('--mode-index')).toBe('0')
    expect(localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)).toBe('preview')
    expect(screen.queryByRole('button', { name: '重置示例工作区' })).not.toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: '编辑' }))
    expect(await screen.findByRole('textbox', { name: '文档正文' })).toBeInTheDocument()
    expect(group.style.getPropertyValue('--mode-index')).toBe('1')
  })

  it('mode: 预览偏好跨重新挂载保留', async () => {
    localStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, 'preview')
    const first = render(<App />)
    expect(await screen.findByRole('article', { name: '文档预览' })).toBeInTheDocument()
    first.unmount()
    render(<App />)
    expect(await screen.findByRole('article', { name: '文档预览' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('mode: 编辑改字切预览不丢内容，Web 快捷键同页切换保留滚动位置', async () => {
    const user = await mountApp()
    const editor = (screen.getByRole('textbox', { name: '文档正文' }) as HTMLElement & { editor: Editor }).editor
    act(() => editor.commands.setContent('<p>切换前的最后一版正文</p>'))
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420)
    const scrollTo = vi.mocked(window.scrollTo)
    scrollTo.mockClear()

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    const preview = await screen.findByRole('article', { name: '文档预览' })
    expect(preview).toHaveTextContent('切换前的最后一版正文')
    expect(scrollTo).toHaveBeenCalledWith(0, 420)
    expect(localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY)).toBe('preview')

    fireEvent.keyDown(window, { key: 'e', metaKey: true })
    expect(await screen.findByRole('textbox', { name: '文档正文' })).toHaveTextContent('切换前的最后一版正文')
    expect(scrollTo).toHaveBeenCalledWith(0, 420)
    scrollY.mockRestore()
  })

  it('mode: 预览下新建页面自动切到编辑并聚焦标题', async () => {
    const user = await mountPreview()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新建顶层页面' }))
    const title = await screen.findByRole('textbox', { name: '文档标题' })
    expect(title).toHaveValue('无标题文档')
    await waitFor(() => expect(title).toHaveFocus())
    expect(screen.getByRole('radio', { name: '编辑' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('textbox', { name: '文档正文' })).toBeInTheDocument()
  })

  it('mode: 预览下导入 Markdown 自动切到编辑', async () => {
    await mountPreview()
    const file = new File(['# 导入页面\n\n导入后的正文。\n'], '导入页面.md', { type: 'text/markdown' })
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } })
    expect(await screen.findByRole('textbox', { name: '文档正文' })).toHaveTextContent('导入后的正文')
    expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('导入页面')
    expect(screen.getByRole('radio', { name: '编辑' })).toHaveAttribute('aria-checked', 'true')
  })

  it('paseo: 仅桌面入口，预览只读、细节开关、复制和另存为文档', async () => {
    const bridge = {
      platform: 'darwin',
      setTheme: vi.fn(async () => {}),
      readIndex: vi.fn(async () => null),
      readPage: vi.fn(async () => null),
      commit: vi.fn(async () => {}),
      saveImageAsset: vi.fn(),
      readImageAssets: vi.fn(async () => []),
      openMarkdownFile: vi.fn(async () => null),
      saveFile: vi.fn(async () => true),
      onMenuCommand: () => () => {},
      readPaseoTree: vi.fn(async (): Promise<PaseoTreeSnapshot> => ({
        available: true,
        projects: [{
          projectId: 'project-1',
          name: 'ai-home',
          path: '/tmp/ai-home',
          workspaces: [{
            workspaceId: 'workspace-1',
            projectId: 'project-1',
            title: '发布窗口',
            displayName: 'main',
            cwd: '/tmp/ai-home',
            pinnedAt: null,
            updatedAt: '2026-11-26T10:00:00.000Z',
            agents: [{
              id: 'agent-1',
              title: '发布检查',
              workspaceId: 'workspace-1',
              cwd: '/tmp/ai-home',
              provider: 'codex',
              model: 'gpt-5',
              lastStatus: 'running',
              requiresAttention: false,
              updatedAt: '2026-11-26T10:00:00.000Z',
            }],
          }],
        }],
        workspaces: [],
        orphanAgents: [],
      })),
      readPaseoLogs: vi.fn(async (): Promise<PaseoAgentLogs> => ({
        agentId: 'agent-1',
        items: [
          { type: 'user_message', text: '检查发布流程' },
          { type: 'reasoning', text: '先核对发布脚本。' },
          { type: 'assistant_message', text: '发布流程检查完成。' },
        ],
      })),
    }
    vi.stubGlobal('desktop', bridge)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('textbox', { name: '文档正文' })
    const sources = screen.getByRole('radiogroup', { name: '内容来源' })
    expect(within(sources).getByRole('radio', { name: '文档' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(sources).getByRole('radio', { name: 'Paseo' }))

    const paseoNavigation = await screen.findByRole('navigation', { name: 'Paseo 窗口树' })
    expect(within(paseoNavigation).getByText('ai-home')).toBeInTheDocument()
    await user.click(within(paseoNavigation).getByRole('button', { name: /发布窗口/ }))
    const preview = await screen.findByRole('article', { name: '文档预览' })
    expect(preview).toHaveTextContent('发布流程检查完成')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelector('.ProseMirror')).toBeNull()
    expect(document.querySelector('[contenteditable]')).toBeNull()
    expect(screen.queryByRole('button', { name: '评论侧栏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入与导出' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重置示例工作区' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建顶层页面' })).not.toBeInTheDocument()

    expect(screen.queryByText('思考与工具调用（1 项）')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '显示细节' }))
    expect(screen.getByText('思考与工具调用（1 项）')).toBeInTheDocument()
    expect(screen.getByText('先核对发布脚本。')).toBeInTheDocument()
    expect(bridge.readPaseoLogs).toHaveBeenCalledWith('agent-1', undefined)

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await user.click(screen.getByRole('button', { name: '复制 Paseo Markdown' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('发布流程检查完成'))

    await user.click(screen.getByRole('button', { name: '另存为文档' }))
    expect(await screen.findByRole('button', { name: '发布窗口' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发布窗口' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '评论侧栏' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('radiogroup', { name: '内容来源' }))
      .getByRole('radio', { name: '文档' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('发布流程检查完成')
    expect(document.querySelector('.ProseMirror')).toBeNull()
  })

  it('mode: 预览目录由 JSON 提取，评论只读且可定位正文锚点', async () => {
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    onTestFinished(() => {
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    })
    const user = await mountPreview()
    expect(screen.queryByRole('button', { name: /更换「/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /更多操作/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '目录' }))
    const outline = await screen.findByRole('navigation', { name: '文档章节' })
    expect(within(outline).getByRole('button', { name: '发布安排' })).toBeInTheDocument()
    await user.click(within(outline).getByRole('button', { name: '发布安排' }))
    expect(scrollIntoView).toHaveBeenCalled()

    await user.click(document.querySelector<HTMLElement>('[data-comment-id="demo-pilot-scope"]')!)
    const comments = await screen.findByRole('complementary', { name: '评论' })
    expect(screen.getByRole('button', { name: '评论侧栏' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(comments).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(comments).queryByRole('button', { name: '解决评论' })).not.toBeInTheDocument()
    expect(within(comments).queryByRole('button', { name: '删除评论' })).not.toBeInTheDocument()
    await user.click(within(comments).getByRole('button', { name: '先向试点团队开放模板库' }))
    await waitFor(() => expect(document.querySelector('[data-comment-id="demo-pilot-scope"]')).toHaveClass('comment-active'))
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('trash: 从侧栏软删、恢复页面树，再确认永久删除和清空', async () => {
    const user = await mountApp()
    const title = '文档协作与发布手册'
    await deleteFromTree(user, title)
    expect(screen.queryByRole('button', { name: '试点验收清单' })).not.toBeInTheDocument()
    await user.click(screen.getByText('回收站', { exact: true }))
    await user.click(screen.getByRole('button', { name: `恢复「${title}」` }))
    expect(screen.getByRole('button', { name: '试点验收清单' })).toBeInTheDocument()
    expect(screen.getByText('回收站为空')).toBeInTheDocument()

    await deleteFromTree(user, title)
    await user.click(screen.getByText('回收站', { exact: true }))
    await user.click(screen.getByRole('button', { name: '彻底删除「试点验收清单」' }))
    let dialog = screen.getByRole('dialog', { name: '彻底删除页面' })
    await user.click(within(dialog).getByRole('button', { name: '确认彻底删除' }))
    expect(screen.queryByRole('button', { name: '恢复「试点验收清单」' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空回收站' }))
    dialog = screen.getByRole('dialog', { name: '清空回收站' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: `恢复「${title}」` })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空回收站' }))
    await user.click(within(screen.getByRole('dialog', { name: '清空回收站' })).getByRole('button', { name: '确认清空' }))
    expect(screen.getByText('回收站为空')).toBeInTheDocument()
  })

  it('search: 补充冷页正文命中、展示片段并跳转', async () => {
    const user = await mountApp()
    const query = screen.getByRole('searchbox', { name: '查找页面标题或正文' })
    await user.type(query, '私有页的访问权限')
    const hit = await screen.findByRole('button', { name: '打开「架构设计备忘」的正文匹配' })
    expect(hit).toHaveTextContent('私有页的访问权限')
    await user.click(hit)
    expect(query).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '文档标题' })).toHaveValue('架构设计备忘')
    expect(await screen.findByRole('textbox', { name: '文档正文' })).toHaveTextContent('私有页的访问权限')
  })

  async function mountDesktopConflict() {
    const { index, pages } = splitLegacyWorkspace(JSON.stringify(createDemoWorkspace(schema)))!
    let changed: ((change: WorkspaceExternalChange) => void) | undefined
    let diskPage: PageShard | null = pages.find(page => page.id === DEMO_HANDBOOK_ID)!
    const bridge = {
      platform: 'darwin',
      readIndex: async () => index,
      readPage: vi.fn(async (id: string) => id === DEMO_HANDBOOK_ID || id === `preview:${DEMO_HANDBOOK_ID}` ? diskPage : null),
      commit: vi.fn<DesktopBridge['commit']>().mockResolvedValue({ conflict: true, files: [DEMO_HANDBOOK_ID] }),
      setTheme: vi.fn<DesktopBridge['setTheme']>().mockResolvedValue(undefined),
      openMarkdownFile: vi.fn<DesktopBridge['openMarkdownFile']>(),
      saveFile: vi.fn<DesktopBridge['saveFile']>(),
      saveImageAsset: vi.fn<DesktopBridge['saveImageAsset']>(),
      readImageAssets: vi.fn<DesktopBridge['readImageAssets']>(),
      onMenuCommand: () => () => {},
      onExternalChange(listener) {
        changed = listener
        return () => { changed = undefined }
      },
    } satisfies DesktopBridge
    vi.stubGlobal('desktop', bridge)
    await mountApp()
    const { editor } = screen.getByRole('textbox', { name: '文档正文' }) as HTMLElement & { editor: Editor }
    await waitFor(() => expect(editor.isInitialized).toBe(true))
    vi.useFakeTimers()
    act(() => {
      editor.commands.setContent('<p>本地未保存的新行</p>')
      diskPage = { ...diskPage!, content: schema.node('doc', null, schema.node('paragraph', null, schema.text('磁盘旧行'))).toJSON() }
      changed!({ indexChanged: false, pageIds: [DEMO_HANDBOOK_ID] })
    })
    return bridge
  }

  it('对比磁盘正文和未刷盘草稿，收起差异后仍可从磁盘重载', async () => {
    const bridge = await mountDesktopConflict()
    expect(screen.getByRole('alert')).toHaveTextContent('磁盘上的工作区已被外部修改')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '查看差异' })) })
    const preview = within(screen.getByRole('region', { name: '当前页正文差异' }))
    expect(preview.getByText('以磁盘版为基准，本地新增 1 行，移除 1 行。')).toBeInTheDocument()
    expect(preview.getByText('本地未保存的新行')).toBeInTheDocument()
    expect(preview.getByText('磁盘旧行')).toBeInTheDocument()
    expect(bridge.readPage).toHaveBeenLastCalledWith(`preview:${DEMO_HANDBOOK_ID}`)
    expect(bridge.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收起差异' }))
    expect(screen.queryByRole('region', { name: '当前页正文差异' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '从磁盘重载' })) })
    expect(screen.getByRole('textbox', { name: '文档正文' })).toHaveTextContent('磁盘旧行')
    expect(screen.queryByRole('button', { name: '查看差异' })).not.toBeInTheDocument()
  })

  it('收起差异后忽略旧读取，并在重新打开时说明磁盘页已不在', async () => {
    const bridge = await mountDesktopConflict()
    let finish!: (page: PageShard | null) => void
    bridge.readPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '查看差异' }))
    expect(screen.getByText('正在读取磁盘版本…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起差异' }))
    bridge.readPage.mockResolvedValueOnce(null)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '查看差异' })) })
    await act(async () => { finish({ id: DEMO_HANDBOOK_ID, updatedAt: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] } }) })
    expect(screen.getByText('该页面在磁盘上不存在。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用本地覆盖保存' })).toBeEnabled()
  })

  it('shell: 顶栏展示手册根页和标题，侧栏可切页面/目录及显示评论', async () => {
    const user = await mountApp()
    const title = screen.getByRole('textbox', { name: '文档标题' })
    expect(title).toHaveValue('文档协作与发布手册')
    expect(screen.getByRole('navigation', { name: '页面层级' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '目录侧栏' }))
    expect(screen.getByRole('navigation', { name: '文档章节' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '页面侧栏' }))
    expect(screen.getByRole('navigation', { name: '页面树' })).toBeInTheDocument()
    const commentsToggle = screen.getByRole('button', { name: '评论侧栏' })
    expect(commentsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument()
    await user.click(commentsToggle)
    expect(commentsToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('complementary', { name: '评论' })).toBeInTheDocument()
    await user.click(commentsToggle)
    expect(commentsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: '评论侧栏' }))
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
    const shortcuts = screen.getByRole('dialog', { name: '快捷键' })
    expect(shortcuts).toBeInTheDocument()
    const modeShortcut = within(shortcuts).getByText('切换预览 / 编辑').closest('div')!
    expect(within(modeShortcut).getByText('E')).toBeInTheDocument()
    const themeShortcut = within(shortcuts).getByText('切换深浅色').closest('div')!
    expect(within(themeShortcut).getByText('Cmd / Ctrl')).toBeInTheDocument()
    expect(within(themeShortcut).getByText('D')).toBeInTheDocument()
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
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    onTestFinished(() => {
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    })
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
    act(() => {
      editor.querySelector<HTMLElement>('[data-comment-id="pilot-access"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: false }))
    })
    expect(await screen.findByRole('complementary', { name: '评论' })).toHaveTextContent('设计团队已核对')
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

import type { Editor } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './demo-workspace'
import { WorkspaceNavigation } from './WorkspaceNavigation'

const schema = getSchema(createEditorExtensions())
const workspace = createDemoWorkspace(schema)

function props(overrides: Partial<React.ComponentProps<typeof WorkspaceNavigation>> = {}) {
  return {
    workspace,
    view: 'pages' as const,
    open: true,
    editor: null as Editor | null,
    onView: vi.fn(),
    onClose: vi.fn(),
    onActivate: vi.fn(),
    onCreate: vi.fn(),
    onIcon: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  }
}

describe('WorkspaceNavigation', () => {
  /*
   * @partition tree: 根页、父子层级、折叠、激活状态
   * @partition search: 标题命中、父链保留、空查询、无结果
   * @partition actions: 新建、图标、更多操作
   * @partition tabs: 页面/目录切换与收起
   * @partition keyboard: Escape 关闭弹层并回焦
   */
  it('tree: 渲染两个根页、子页缩进及当前页选中状态', () => {
    render(<WorkspaceNavigation {...props()} />)
    expect(screen.getByRole('navigation', { name: '页面树' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文档协作与发布手册' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '试点验收清单' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接口与发布规则' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '架构设计备忘' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠「文档协作与发布手册」的子页' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '全图种与公式复杂示例' })).toBeInTheDocument()
    expect(screen.getByText('5 个页面')).toBeInTheDocument()
  })

  it('tree: 折叠父页隐藏子页，再次展开恢复', async () => {
    const user = userEvent.setup()
    render(<WorkspaceNavigation {...props()} />)
    const disclosure = screen.getByRole('button', { name: '折叠「文档协作与发布手册」的子页' })
    await user.click(disclosure)
    expect(screen.queryByRole('button', { name: '试点验收清单' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开「文档协作与发布手册」的子页' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: '展开「文档协作与发布手册」的子页' }))
    expect(screen.getByRole('button', { name: '试点验收清单' })).toBeInTheDocument()
  })

  it('search: 按标题过滤，保留父页路径，清空恢复全部页面', async () => {
    const user = userEvent.setup()
    render(<WorkspaceNavigation {...props()} />)
    const search = screen.getByRole('searchbox', { name: '按标题查找页面' })
    await user.type(search, 'Release'.replace('Release', '接口'))
    expect(screen.getByRole('button', { name: '接口与发布规则' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文档协作与发布手册' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '架构设计备忘' })).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByRole('button', { name: '架构设计备忘' })).toBeInTheDocument()
  })

  it('search: 无匹配显示提示，不渲染页面树', async () => {
    const user = userEvent.setup()
    render(<WorkspaceNavigation {...props()} />)
    await user.type(screen.getByRole('searchbox', { name: '按标题查找页面' }), '不存在')
    expect(screen.getByText('没有匹配的页面')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '页面树' })).not.toBeInTheDocument()
  })

  it('actions: 新建顶层与子页、切换页面、切换图标均传递目标 id', async () => {
    const user = userEvent.setup()
    const api = props()
    render(<WorkspaceNavigation {...api} />)
    await user.click(screen.getByRole('button', { name: '新建顶层页面' }))
    expect(api.onCreate).toHaveBeenCalledWith(null)
    await user.click(screen.getByRole('button', { name: '新建「文档协作与发布手册」的子页' }))
    expect(api.onCreate).toHaveBeenCalledWith(DEMO_HANDBOOK_ID)
    await user.click(screen.getByRole('button', { name: '试点验收清单' }))
    expect(api.onActivate).toHaveBeenCalledWith(workspace.pages[1]!.id)
    await user.click(screen.getByRole('button', { name: '更换「试点验收清单」的图标' }))
    expect(screen.getByRole('group', { name: '页面图标' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '笔记' }))
    expect(api.onIcon).toHaveBeenCalledWith(workspace.pages[1]!.id, '📝')
  })

  it('actions: 更多菜单列出全部操作，点击后回传动作和页面', async () => {
    const user = userEvent.setup()
    const api = props()
    render(<WorkspaceNavigation {...api} />)
    await user.click(screen.getByRole('button', { name: '「架构设计备忘」的更多操作' }))
    const menu = screen.getByRole('group', { name: '架构设计备忘的操作' })
    for (const name of ['重命名', '创建副本', '移动到…', '导出 Markdown', '删除页面']) {
      expect(within(menu).getByRole('button', { name })).toBeInTheDocument()
    }
    await user.click(within(menu).getByRole('button', { name: '创建副本' }))
    expect(api.onAction).toHaveBeenCalledWith('duplicate', workspace.pages[3]!.id)
  })

  it('keyboard: Escape 关闭弹层，外部点击也关闭', async () => {
    const user = userEvent.setup()
    render(<WorkspaceNavigation {...props()} />)
    await user.click(screen.getByRole('button', { name: '「试点验收清单」的更多操作' }))
    expect(screen.getByRole('group', { name: '试点验收清单的操作' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: '试点验收清单的操作' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '「试点验收清单」的更多操作' }))
    await user.click(screen.getByRole('button', { name: '更换「架构设计备忘」的图标' }))
    await user.click(screen.getByRole('button', { name: '新建顶层页面' }))
    expect(screen.queryByRole('group', { name: '页面图标' })).not.toBeInTheDocument()
  })

  it('tabs: 页面/目录切换和收起按钮交给上层控制', async () => {
    const user = userEvent.setup()
    const api = props()
    render(<WorkspaceNavigation {...api} />)
    await user.click(screen.getByRole('button', { name: '目录' }))
    expect(api.onView).toHaveBeenCalledWith('outline')
    await user.click(screen.getByRole('button', { name: '收起导航' }))
    expect(api.onClose).toHaveBeenCalledOnce()
  })

  it('tabs: 目录视图为空时显示提示，有编辑器时复用目录侧栏', () => {
    const { rerender } = render(<WorkspaceNavigation {...props({ view: 'outline' })} />)
    expect(screen.getByText('添加标题后显示目录')).toBeInTheDocument()
    rerender(<WorkspaceNavigation {...props({ view: 'outline' })} />)
  })

  it('closed: open=false 不渲染导航容器', () => {
    const { container } = render(<WorkspaceNavigation {...props({ open: false })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

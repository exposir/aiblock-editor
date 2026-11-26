import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { PaseoNavigation } from './PaseoNavigation'
import type { PaseoAgent, PaseoTreeSnapshot, PaseoWorkspace } from './paseo-types'

const agent = (id: string, title: string, status = 'idle'): PaseoAgent => ({
  id,
  title,
  workspaceId: `workspace-${id}`,
  cwd: '/tmp/project',
  provider: 'codex',
  model: 'gpt-5',
  lastStatus: status,
  requiresAttention: false,
  updatedAt: '2026-11-26T10:00:00.000Z',
})

const workspace = (workspaceId: string, title: string, agents: PaseoAgent[]): PaseoWorkspace => ({
  workspaceId,
  projectId: 'project-1',
  title,
  displayName: 'main',
  cwd: '/tmp/project',
  pinnedAt: null,
  updatedAt: '2026-11-26T10:00:00.000Z',
  agents,
})

const tree: PaseoTreeSnapshot = {
  available: true,
  projects: [{
    projectId: 'project-1',
    name: 'ai-home',
    path: '/Users/expo/ai-home',
    workspaces: [
      workspace('workspace-single', '单会话窗口', [agent('single', '单会话')]),
      workspace('workspace-multi', '多会话窗口', [
        { ...agent('multi-a', '会话 A'), workspaceId: 'workspace-multi' },
        { ...agent('multi-b', '会话 B', 'running'), workspaceId: 'workspace-multi', requiresAttention: true },
      ]),
    ],
  }],
  workspaces: [],
  orphanAgents: [],
}

function renderNavigation(content: JSONContent) {
  const onSelect = vi.fn()
  const view = render(<PaseoNavigation tree={tree} open view="windows" selectedAgentId="single"
    content={content} onView={() => {}} onClose={() => {}} onSelect={onSelect} />)
  return { ...view, onSelect }
}

function renderTree(snapshot: PaseoTreeSnapshot, selectedAgentId: string | null = null) {
  const onSelect = vi.fn()
  const view = render(<PaseoNavigation tree={snapshot} open view="windows" selectedAgentId={selectedAgentId}
    content={{ type: 'doc', content: [{ type: 'paragraph' }] }} onView={() => {}} onClose={() => {}} onSelect={onSelect} />)
  return { ...view, onSelect }
}

describe('PaseoNavigation', () => {
  it('renders the project/workspace tree, status dots and single-agent direct selection', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderNavigation({ type: 'doc', content: [{ type: 'paragraph' }] })
    const nav = screen.getByRole('navigation', { name: 'Paseo 窗口树' })
    expect(within(nav).getByRole('button', { name: /ai-home/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('img', { name: '空闲' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('button', { name: /单会话窗口/ }))
    expect(onSelect).toHaveBeenCalledWith('single')
  })

  it('expands multi-agent workspaces and searches projects, windows and sessions', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderNavigation({ type: 'doc', content: [{ type: 'paragraph' }] })
    const nav = screen.getByRole('navigation', { name: 'Paseo 窗口树' })
    const multi = within(nav).getByRole('button', { name: /多会话窗口/ })
    expect(multi).toHaveAttribute('aria-expanded', 'false')
    await user.click(multi)
    expect(multi).toHaveAttribute('aria-expanded', 'true')
    const session = within(nav).getByRole('button', { name: /会话 B/ })
    expect(within(session).getByRole('img', { name: '等待处理' })).toBeInTheDocument()
    await user.click(session)
    expect(onSelect).toHaveBeenCalledWith('multi-b')

    const search = screen.getByRole('searchbox', { name: '搜索 Paseo 项目或窗口' })
    await user.type(search, '会话 A')
    expect(screen.queryByText('单会话窗口')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /会话 A/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /会话 B/ })).not.toBeInTheDocument()
  })

  it('shows the converted Paseo document outline and locates headings', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    onTestFinished(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    })
    const user = userEvent.setup()
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, blockId: 'heading-1' }, content: [{ type: 'text', text: '窗口标题' }] },
        { type: 'heading', attrs: { level: 2, blockId: 'heading-2' }, content: [{ type: 'text', text: '第一轮' }] },
        {
          type: 'paragraph', attrs: { blockId: 'paragraph' },
          content: [{ type: 'text', marks: [{ type: 'bold' }], text: '正文' }],
        },
      ],
    }
    const { container } = render(<>
      <PaseoNavigation tree={tree} open view="outline" selectedAgentId="single" content={content}
        onView={() => {}} onClose={() => {}} onSelect={() => {}} />
      <article className="document-preview">
        <h1 data-block-id="heading-1">窗口标题</h1>
        <h2 data-block-id="heading-2">第一轮</h2>
      </article>
    </>)
    const outline = screen.getByRole('navigation', { name: '文档章节' })
    expect(within(outline).getByRole('button', { name: '窗口标题' })).toBeInTheDocument()
    await user.click(within(outline).getByRole('button', { name: '第一轮' }))
    expect(scrollIntoView).toHaveBeenCalled()
    expect(container.querySelector('[data-block-id="heading-2"]')).toBeInTheDocument()
    fireEvent.scroll(window)
  })

  it('renders orphan agents, selects them and filters them by keyword', async () => {
    const user = userEvent.setup()
    const orphan = { ...agent('orphan', '孤儿任务', 'closed'), workspaceId: 'workspace-missing' }
    const { onSelect } = renderTree({
      available: true, projects: [], workspaces: [], orphanAgents: [orphan],
    })
    expect(screen.getByText('未归属窗口')).toBeInTheDocument()
    const orphanButton = screen.getByRole('button', { name: /孤儿任务/ })
    expect(within(orphanButton).getByRole('img', { name: '已关闭' })).toBeInTheDocument()
    await user.click(orphanButton)
    expect(onSelect).toHaveBeenCalledWith('orphan')

    const search = screen.getByRole('searchbox', { name: '搜索 Paseo 项目或窗口' })
    await user.type(search, '孤儿')
    expect(screen.getByRole('button', { name: /孤儿任务/ })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, '不存在')
    expect(screen.getByText('没有匹配的 Paseo 窗口')).toBeInTheDocument()
  })

  it('collapses projects and lets search penetrate the collapsed state', async () => {
    const user = userEvent.setup()
    renderTree(tree, 'single')
    const project = screen.getByRole('button', { name: /ai-home/ })
    expect(project).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /单会话窗口/ })).toBeInTheDocument()
    await user.click(project)
    expect(project).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /单会话窗口/ })).not.toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: '搜索 Paseo 项目或窗口' })
    await user.type(search, '单会话')
    expect(screen.getByRole('button', { name: /单会话窗口/ })).toBeInTheDocument()
    await user.clear(search)
    expect(screen.queryByRole('button', { name: /单会话窗口/ })).not.toBeInTheDocument()

    await user.click(project)
    expect(project).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /单会话窗口/ })).toBeInTheDocument()
  })

  it('renders the empty-tree state and no-match state distinctly', async () => {
    const user = userEvent.setup()
    renderTree({ available: true, projects: [], workspaces: [], orphanAgents: [] })
    expect(screen.getByText('Paseo 中没有活动窗口')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: '搜索 Paseo 项目或窗口' }), 'missing')
    expect(screen.getByText('没有匹配的 Paseo 窗口')).toBeInTheDocument()
  })

  it('aggregates multi-agent status, renders closed windows and disables empty workspaces', () => {
    const makeWorkspace = (workspaceId: string, title: string, agents: PaseoAgent[]): PaseoWorkspace => ({
      ...workspace(workspaceId, title, agents.map(value => ({ ...value, workspaceId }))),
    })
    const mixed = [
      { ...agent('idle', '空闲会话'), workspaceId: 'workspace-running' },
      { ...agent('running', '运行会话', 'running'), workspaceId: 'workspace-running' },
    ]
    const attention = [
      { ...agent('busy', '忙碌会话', 'running'), workspaceId: 'workspace-attention' },
      {
        ...agent('attention', '待处理会话', 'running'), workspaceId: 'workspace-attention',
        requiresAttention: true,
      },
    ]
    const closed = [
      { ...agent('closed-a', '关闭 A', 'closed'), workspaceId: 'workspace-closed' },
      { ...agent('closed-b', '关闭 B', 'closed'), workspaceId: 'workspace-closed' },
    ]
    const snapshot: PaseoTreeSnapshot = {
      available: true,
      projects: [{
        projectId: 'project-status',
        name: '状态项目',
        path: '/tmp/status',
        workspaces: [
          makeWorkspace('workspace-running', '运行窗口', mixed),
          makeWorkspace('workspace-attention', '等待窗口', attention),
          makeWorkspace('workspace-closed', '关闭窗口', closed),
          makeWorkspace('workspace-empty', '空窗口', []),
        ],
      }],
      workspaces: [],
      orphanAgents: [],
    }
    renderTree(snapshot)
    const running = screen.getByRole('button', { name: /运行窗口/ })
    expect(within(running).getByRole('img', { name: '运行中' })).toBeInTheDocument()
    const waiting = screen.getByRole('button', { name: /等待窗口/ })
    expect(within(waiting).getByRole('img', { name: '等待处理' })).toBeInTheDocument()
    const closedWindow = screen.getByRole('button', { name: /关闭窗口/ })
    expect(within(closedWindow).getByRole('img', { name: '已关闭' })).toBeInTheDocument()
    const empty = screen.getByRole('button', { name: /空窗口/ })
    expect(empty).toBeDisabled()
    expect(empty).toHaveTextContent('—')
  })
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/core'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  PASEO_WINDOW_FILTER_STORAGE_KEY,
  PASEO_WINDOW_SORT_STORAGE_KEY,
  PaseoNavigation,
} from './PaseoNavigation'
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
  createdAt: '2026-11-26T09:00:00.000Z',
  lastActivityAt: '2026-11-26T10:00:00.000Z',
  updatedAt: '2026-11-26T10:00:00.000Z',
})

const workspace = (
  workspaceId: string,
  title: string,
  agents: PaseoAgent[],
  overrides: Partial<PaseoWorkspace> = {},
): PaseoWorkspace => ({
  workspaceId,
  projectId: 'project-1',
  title,
  displayName: 'main',
  cwd: '/tmp/project',
  parentWorkspaceId: null,
  pinnedAt: null,
  createdAt: '2026-11-26T09:00:00.000Z',
  lastActivityAt: '2026-11-26T10:00:00.000Z',
  updatedAt: '2026-11-26T10:00:00.000Z',
  agents,
  ...overrides,
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

beforeEach(() => localStorage.clear())

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
    expect(within(running.closest('[data-workspace-id]') as HTMLElement).getByRole('img', { name: '运行中' })).toBeInTheDocument()
    const waiting = screen.getByRole('button', { name: /等待窗口/ })
    expect(within(waiting.closest('[data-workspace-id]') as HTMLElement).getByRole('img', { name: '等待处理' })).toBeInTheDocument()
    const closedWindow = screen.getByRole('button', { name: /关闭窗口/ })
    expect(within(closedWindow.closest('[data-workspace-id]') as HTMLElement).getByRole('img', { name: '已关闭' })).toBeInTheDocument()
    const empty = screen.getByRole('button', { name: /空窗口/ })
    expect(empty).toBeDisabled()
    expect(empty).toHaveTextContent('—')
  })

  it('filters all, active and attention windows with persisted controls', async () => {
    const user = userEvent.setup()
    const snapshot: PaseoTreeSnapshot = {
      available: true,
      projects: [{
        projectId: 'project-filter',
        name: '筛选项目',
        path: '/tmp/filter',
        workspaces: [
          workspace('ws-y-idle', '空闲窗', [{ ...agent('a-idle', '空闲'), workspaceId: 'ws-y-idle' }]),
          workspace('ws-y-running', '运行窗', [{ ...agent('a-running', '运行', 'running'), workspaceId: 'ws-y-running' }]),
          workspace('ws-y-attention', '待办窗', [{
            ...agent('a-attention', '待办', 'running'), workspaceId: 'ws-y-attention', requiresAttention: true,
          }]),
          workspace('ws-y-closed', '关闭窗', [{ ...agent('a-closed', '关闭', 'closed'), workspaceId: 'ws-y-closed' }]),
          workspace('ws-y-empty', '空窗', []),
        ],
      }],
      workspaces: [],
      orphanAgents: [],
    }
    const first = renderTree(snapshot)
    const nav = screen.getByRole('navigation', { name: 'Paseo 窗口树' })
    const filter = screen.getByRole('group', { name: '窗口筛选' })
    expect(within(filter).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(nav).getByRole('button', { name: /空闲窗/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /关闭窗/ })).toBeInTheDocument()

    await user.click(within(filter).getByRole('button', { name: '活跃' }))
    expect(within(filter).getByRole('button', { name: '活跃' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(nav).getByRole('button', { name: /空闲窗/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /运行窗/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /待办窗/ })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: /关闭窗/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: /空窗/ })).not.toBeInTheDocument()

    await user.click(within(filter).getByRole('button', { name: '待处理' }))
    expect(within(nav).queryByRole('button', { name: /空闲窗/ })).not.toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /运行窗/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /待办窗/ })).toBeInTheDocument()
    expect(localStorage.getItem(PASEO_WINDOW_FILTER_STORAGE_KEY)).toBe('attention')
    first.unmount()
    renderTree(snapshot)
    expect(within(screen.getByRole('group', { name: '窗口筛选' }))
      .getByRole('button', { name: '待处理' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sorts by recent activity, status priority and creation time with pinned windows first', async () => {
    const user = userEvent.setup()
    const make = (workspaceId: string, title: string, status: string, activity: string, created: string,
      overrides: Partial<PaseoWorkspace> = {}, attention = false) => workspace(workspaceId, title, [{
      ...agent(`${workspaceId}-agent`, title, status), workspaceId, lastActivityAt: activity,
      ...(attention ? { requiresAttention: true } : {}),
    }], { lastActivityAt: activity, createdAt: created, ...overrides })
    const snapshot: PaseoTreeSnapshot = {
      available: true,
      projects: [{
        projectId: 'project-sort',
        name: '排序项目',
        path: '/tmp/sort',
        workspaces: [
          make('ws-idle', '空闲', 'idle', '2026-11-26T10:12:00.000Z', '2026-11-26T10:08:00.000Z'),
          make('ws-running', '运行', 'running', '2026-11-26T10:11:00.000Z', '2026-11-26T10:09:00.000Z'),
          make('ws-attention', '待处理', 'running', '2026-11-26T10:10:00.000Z', '2026-11-26T10:10:00.000Z', {}, true),
          make('ws-closed', '关闭', 'closed', '2026-11-26T10:08:00.000Z', '2026-11-26T10:11:00.000Z'),
          make('ws-pinned', '置顶', 'idle', '2026-11-26T10:09:00.000Z', '2026-11-26T10:07:00.000Z', {
            pinnedAt: '2026-11-26T10:30:00.000Z',
          }),
        ],
      }],
      workspaces: [],
      orphanAgents: [],
    }
    const sorted = renderTree(snapshot)
    const nav = screen.getByRole('navigation', { name: 'Paseo 窗口树' })
    const ids = () => [...nav.querySelectorAll<HTMLElement>('[data-workspace-id]')].map(node => node.dataset.workspaceId)
    expect(ids()).toEqual(['ws-pinned', 'ws-idle', 'ws-running', 'ws-attention', 'ws-closed'])

    const sort = screen.getByRole('combobox', { name: '窗口排序' })
    await user.selectOptions(sort, 'status')
    expect(ids()).toEqual(['ws-pinned', 'ws-attention', 'ws-running', 'ws-idle', 'ws-closed'])
    expect(localStorage.getItem(PASEO_WINDOW_SORT_STORAGE_KEY)).toBe('status')

    await user.selectOptions(sort, 'created')
    expect(ids()).toEqual(['ws-pinned', 'ws-closed', 'ws-attention', 'ws-running', 'ws-idle'])
    sorted.unmount()
    renderTree(snapshot)
    expect(screen.getByRole('combobox', { name: '窗口排序' })).toHaveValue('created')
  })

  it('nests child workspaces, promotes missing parents and prevents cycles from losing windows', async () => {
    const user = userEvent.setup()
    const snapshot: PaseoTreeSnapshot = {
      available: true,
      projects: [{
        projectId: 'project-tree',
        name: '树项目',
        path: '/tmp/tree',
        workspaces: [
          workspace('parent', 'Parent', [{
            ...agent('parent-agent', 'Parent agent', 'closed'), workspaceId: 'parent',
          }], { lastActivityAt: '2026-11-26T20:00:00.000Z' }),
          workspace('child', 'Child', [{
            ...agent('child-agent', 'Child agent', 'running'), workspaceId: 'child',
          }], { parentWorkspaceId: 'parent', lastActivityAt: '2026-11-26T19:00:00.000Z' }),
          workspace('missing-parent-child', 'Missing parent child', [{
            ...agent('missing-agent', 'Missing agent'), workspaceId: 'missing-parent-child',
          }], { parentWorkspaceId: 'does-not-exist', lastActivityAt: '2026-11-26T18:00:00.000Z' }),
          workspace('cycle-a', 'Cycle A', [{ ...agent('cycle-a-agent', 'Cycle A agent'), workspaceId: 'cycle-a' }], {
            parentWorkspaceId: 'cycle-b', lastActivityAt: '2026-11-26T17:00:00.000Z',
          }),
          workspace('cycle-b', 'Cycle B', [{ ...agent('cycle-b-agent', 'Cycle B agent'), workspaceId: 'cycle-b' }], {
            parentWorkspaceId: 'cycle-a', lastActivityAt: '2026-11-26T16:00:00.000Z',
          }),
          workspace('cross-project-child', 'Cross project child', [{
            ...agent('cross-agent', 'Cross agent'), workspaceId: 'cross-project-child',
          }], { parentWorkspaceId: 'other-project-parent', lastActivityAt: '2026-11-26T15:00:00.000Z' }),
        ],
      }, {
        projectId: 'project-other',
        name: 'Other',
        path: '/tmp/other',
        workspaces: [workspace('other-project-parent', 'Other parent', [], { projectId: 'project-other' })],
      }],
      workspaces: [],
      orphanAgents: [],
    }
    renderTree(snapshot)
    const nav = screen.getByRole('navigation', { name: 'Paseo 窗口树' })
    expect(within(nav).queryByRole('button', { name: /^Child/ })).not.toBeInTheDocument()
    await user.click(within(nav).getByRole('button', { name: '展开「Parent」的子窗口' }))
    const parentShell = nav.querySelector<HTMLElement>('[data-workspace-id="parent"]')!
    const childShell = nav.querySelector<HTMLElement>('[data-workspace-id="child"]')!
    expect(childShell.parentElement?.closest('[data-workspace-id]')).toBe(parentShell)

    for (const id of ['missing-parent-child', 'cycle-a', 'cycle-b', 'cross-project-child']) {
      const shell = nav.querySelector<HTMLElement>(`[data-workspace-id="${id}"]`)!
      expect(shell).toBeInTheDocument()
      expect(shell.parentElement?.closest('[data-workspace-id]')).toBeNull()
    }

    await user.click(within(screen.getByRole('group', { name: '窗口筛选' })).getByRole('button', { name: '活跃' }))
    const promoted = nav.querySelector<HTMLElement>('[data-workspace-id="child"]')!
    expect(promoted.parentElement?.closest('[data-workspace-id]')).toBeNull()
    expect(nav.querySelector('[data-workspace-id="parent"]')).toBeNull()
  })
})

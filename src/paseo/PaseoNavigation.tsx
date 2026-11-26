import type { JSONContent } from '@tiptap/core'
import { ChevronRight, List, PanelLeftClose, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { OutlineSidebar } from '../components/OutlineSidebar'
import type { PaseoAgent, PaseoAgentStatus, PaseoProject, PaseoTreeSnapshot, PaseoWorkspace } from './paseo-types'

export type PaseoNavigationView = 'windows' | 'outline'
export type PaseoWindowFilter = 'all' | 'active' | 'attention'
export type PaseoWindowSort = 'activity' | 'status' | 'created'

export const PASEO_WINDOW_FILTER_STORAGE_KEY = 'aiblock-editor.paseo.window-filter.v1'
export const PASEO_WINDOW_SORT_STORAGE_KEY = 'aiblock-editor.paseo.window-sort.v1'

interface PaseoNavigationProps {
  readonly tree: PaseoTreeSnapshot
  readonly open: boolean
  readonly view: PaseoNavigationView
  readonly selectedAgentId: string | null
  readonly content?: JSONContent
  readonly onView: (view: PaseoNavigationView) => void
  readonly onClose: () => void
  readonly onSelect: (agentId: string) => void
}

interface WorkspaceNode {
  readonly workspace: PaseoWorkspace
  readonly agents: readonly PaseoAgent[]
  readonly children: WorkspaceNode[]
}

interface ProjectView {
  readonly project: PaseoProject
  readonly workspaces: readonly WorkspaceNode[]
}

function normalized(value: string): string {
  return value.toLocaleLowerCase()
}

function includes(value: string, query: string): boolean {
  return normalized(value).includes(query)
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function workspaceTitle(workspace: PaseoWorkspace): string {
  return workspace.title.trim() || workspace.displayName.trim() || '未命名窗口'
}

function agentTitle(agent: PaseoAgent): string {
  return agent.title.trim() || '未命名会话'
}

export function paseoStatus(agent: PaseoAgent | undefined): PaseoAgentStatus {
  if (!agent) return 'idle'
  if (agent.requiresAttention) return 'requiresAttention'
  if (agent.lastStatus.toLowerCase() === 'running') return 'running'
  if (agent.lastStatus.toLowerCase() === 'closed') return 'closed'
  return 'idle'
}

function visibleStatus(agents: readonly PaseoAgent[]): PaseoAgentStatus {
  if (!agents.length) return 'closed'
  if (agents.some(agent => agent.requiresAttention)) return 'requiresAttention'
  if (agents.some(agent => agent.lastStatus.toLowerCase() === 'running')) return 'running'
  if (agents.length && agents.every(agent => agent.lastStatus.toLowerCase() === 'closed')) return 'closed'
  return 'idle'
}

const statusRank: Record<PaseoAgentStatus, number> = {
  requiresAttention: 0,
  running: 1,
  idle: 2,
  closed: 3,
}

const statusLabels: Record<PaseoAgentStatus, string> = {
  running: '运行中',
  requiresAttention: '等待处理',
  idle: '空闲',
  closed: '已关闭',
}

function StatusDot({ status }: { readonly status: PaseoAgentStatus }) {
  return <span className="paseo-status-dot" data-status={status} role="img" aria-label={statusLabels[status]}
    title={statusLabels[status]} />
}

function passesAgentFilter(agent: PaseoAgent, filter: PaseoWindowFilter): boolean {
  if (filter === 'active') return agent.lastStatus.toLowerCase() !== 'closed'
  if (filter === 'attention') return agent.requiresAttention || agent.lastStatus.toLowerCase() === 'running'
  return true
}

function passesWorkspaceFilter(workspace: PaseoWorkspace, filter: PaseoWindowFilter): boolean {
  if (filter === 'active') return !workspace.agents.every(agent => agent.lastStatus.toLowerCase() === 'closed')
  if (filter === 'attention') return workspace.agents.some(agent =>
    agent.requiresAttention || agent.lastStatus.toLowerCase() === 'running')
  return true
}

function pinnedFirst(left: { readonly pinnedAt: string | null }, right: { readonly pinnedAt: string | null }) {
  return Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt))
}

function activityOrder(left: { readonly lastActivityAt: string; readonly updatedAt: string },
  right: { readonly lastActivityAt: string; readonly updatedAt: string }) {
  return timestamp(right.lastActivityAt || right.updatedAt) - timestamp(left.lastActivityAt || left.updatedAt)
}

function compareWorkspaces(left: PaseoWorkspace, right: PaseoWorkspace, sort: PaseoWindowSort): number {
  const pinned = pinnedFirst(left, right)
  if (pinned) return pinned
  if (sort === 'status') {
    const rank = statusRank[visibleStatus(left.agents)] - statusRank[visibleStatus(right.agents)]
    if (rank) return rank
    return activityOrder(left, right) || timestamp(right.createdAt) - timestamp(left.createdAt)
  }
  if (sort === 'created') return timestamp(right.createdAt) - timestamp(left.createdAt) || activityOrder(left, right)
  return activityOrder(left, right) || timestamp(right.createdAt) - timestamp(left.createdAt)
}

function compareAgents(left: PaseoAgent, right: PaseoAgent, sort: PaseoWindowSort): number {
  if (sort === 'status') {
    const rank = statusRank[paseoStatus(left)] - statusRank[paseoStatus(right)]
    if (rank) return rank
    return activityOrder(left, right) || timestamp(right.createdAt) - timestamp(left.createdAt)
  }
  if (sort === 'created') return timestamp(right.createdAt) - timestamp(left.createdAt) || activityOrder(left, right)
  return activityOrder(left, right) || timestamp(right.createdAt) - timestamp(left.createdAt)
}

function buildWorkspaceNodes(
  entries: readonly { readonly workspace: PaseoWorkspace; readonly agents: readonly PaseoAgent[] }[],
  sort: PaseoWindowSort,
): WorkspaceNode[] {
  const ordered = [...entries].sort((left, right) => compareWorkspaces(left.workspace, right.workspace, sort))
  const byId = new Map(ordered.map(entry => [entry.workspace.workspaceId, entry] as const))
  const nodes = new Map<string, WorkspaceNode>()
  for (const entry of ordered) nodes.set(entry.workspace.workspaceId, {
    workspace: entry.workspace, agents: entry.agents, children: [],
  })
  const roots: WorkspaceNode[] = []
  for (const entry of ordered) {
    const node = nodes.get(entry.workspace.workspaceId)!
    const parentId = entry.workspace.parentWorkspaceId
    const parent = parentId ? nodes.get(parentId) : undefined
    const cycle = parent ? wouldCreateCycle(node, parent, nodes) : false
    if (parent && !cycle) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function wouldCreateCycle(node: WorkspaceNode, parent: WorkspaceNode, nodes: ReadonlyMap<string, WorkspaceNode>): boolean {
  const visited = new Set([node.workspace.workspaceId])
  let current: WorkspaceNode | undefined = parent
  while (current) {
    const id = current.workspace.workspaceId
    if (visited.has(id)) return true
    visited.add(id)
    current = current.workspace.parentWorkspaceId ? nodes.get(current.workspace.parentWorkspaceId) : undefined
  }
  return false
}

function nodeCount(nodes: readonly WorkspaceNode[]): number {
  return nodes.reduce((total, node) => total + 1 + nodeCount(node.children), 0)
}

function hasMatchingAncestor(
  workspace: PaseoWorkspace,
  projectWorkspaces: ReadonlyMap<string, PaseoWorkspace>,
  query: string,
): boolean {
  const visited = new Set<string>()
  let parentId = workspace.parentWorkspaceId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = projectWorkspaces.get(parentId)
    if (!parent) return false
    if (includes(workspaceTitle(parent), query) || includes(parent.displayName, query) || includes(parent.cwd, query)) {
      return true
    }
    parentId = parent.parentWorkspaceId
  }
  return false
}

function filteredTree(
  tree: PaseoTreeSnapshot,
  query: string,
  filter: PaseoWindowFilter,
  sort: PaseoWindowSort,
): { projects: ProjectView[]; orphanAgents: PaseoAgent[] } {
  const projects = tree.projects.flatMap(project => {
    const projectMatch = Boolean(query) && (includes(project.name, query) || includes(project.path, query))
    const projectWorkspaces = new Map(project.workspaces.map(workspace => [workspace.workspaceId, workspace] as const))
    const entries = project.workspaces.flatMap(workspace => {
      if (!passesWorkspaceFilter(workspace, filter)) return []
      const workspaceMatch = Boolean(query) && (
        includes(workspaceTitle(workspace), query) ||
        includes(workspace.displayName, query) ||
        includes(workspace.cwd, query)
      )
      const matchingAgents = query ? workspace.agents.filter(agent =>
        includes(agentTitle(agent), query) || includes(agent.provider, query) || includes(agent.model, query)) : workspace.agents
      const ancestorMatch = query ? hasMatchingAncestor(workspace, projectWorkspaces, query) : false
      const visible = !query || projectMatch || workspaceMatch || ancestorMatch || matchingAgents.length > 0
      if (!visible) return []
      return [{
        workspace,
        agents: projectMatch || workspaceMatch || ancestorMatch || !query ? workspace.agents : matchingAgents,
      }]
    })
    const workspaces = buildWorkspaceNodes(entries, sort)
    return workspaces.length ? [{ project, workspaces }] : []
  })
  const orphanAgents = tree.orphanAgents.filter(agent =>
    passesAgentFilter(agent, filter) && (!query ||
      includes(agentTitle(agent), query) || includes(agent.provider, query) || includes(agent.model, query)))
    .sort((left, right) => compareAgents(left, right, sort))
  return { projects, orphanAgents }
}

function readFilter(): PaseoWindowFilter {
  try {
    const value = localStorage.getItem(PASEO_WINDOW_FILTER_STORAGE_KEY)
    return value === 'active' || value === 'attention' ? value : 'all'
  } catch {
    return 'all'
  }
}

function readSort(): PaseoWindowSort {
  try {
    const value = localStorage.getItem(PASEO_WINDOW_SORT_STORAGE_KEY)
    return value === 'status' || value === 'created' ? value : 'activity'
  } catch {
    return 'activity'
  }
}

export function PaseoNavigation({ tree, open, view, selectedAgentId, content, onView, onClose, onSelect }:
  PaseoNavigationProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaseoWindowFilter>(readFilter)
  const [sort, setSort] = useState<PaseoWindowSort>(readSort)
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedChildren, setExpandedChildren] = useState<ReadonlySet<string>>(() => new Set())
  const keyword = normalized(query.trim())
  const filtered = useMemo(() => filteredTree(tree, keyword, filter, sort), [tree, keyword, filter, sort])
  const workspaceCount = useMemo(() => {
    const ids = new Set(tree.workspaces.map(workspace => workspace.workspaceId))
    for (const project of tree.projects) {
      for (const workspace of project.workspaces) ids.add(workspace.workspaceId)
    }
    return ids.size
  }, [tree])

  useEffect(() => {
    if (!selectedAgentId) return
    const workspaces = [...tree.projects.flatMap(project => project.workspaces), ...tree.workspaces]
    const workspace = workspaces.find(value => value.agents.some(agent => agent.id === selectedAgentId))
    if (!workspace) return
    setExpandedWorkspaces(previous => {
      if (previous.has(workspace.workspaceId)) return previous
      return new Set([...previous, workspace.workspaceId])
    })
    setExpandedChildren(previous => {
      const next = new Set(previous)
      const byId = new Map(workspaces.map(value => [value.workspaceId, value] as const))
      const visited = new Set<string>()
      let parentId = workspace.parentWorkspaceId
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId)
        next.add(parentId)
        parentId = byId.get(parentId)?.parentWorkspaceId ?? null
      }
      return next
    })
  }, [selectedAgentId, tree.projects, tree.workspaces])

  useEffect(() => {
    try { localStorage.setItem(PASEO_WINDOW_FILTER_STORAGE_KEY, filter) } catch { /* Current view still updates. */ }
  }, [filter])

  useEffect(() => {
    try { localStorage.setItem(PASEO_WINDOW_SORT_STORAGE_KEY, sort) } catch { /* Current view still updates. */ }
  }, [sort])

  function toggleProject(projectId: string) {
    setCollapsedProjects(previous => {
      const next = new Set(previous)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  function toggleWorkspace(workspaceId: string) {
    setExpandedWorkspaces(previous => {
      const next = new Set(previous)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }

  function toggleChildren(workspaceId: string) {
    setExpandedChildren(previous => {
      const next = new Set(previous)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }

  function select(agentId: string) {
    setQuery('')
    onSelect(agentId)
  }

  if (!open) return null

  function workspaceRows(nodes: readonly WorkspaceNode[], depth: number, seen = new Set<string>()): ReactElement[] {
    return nodes.flatMap(node => {
      const workspace = node.workspace
      if (seen.has(workspace.workspaceId)) return []
      const nestedSeen = new Set(seen)
      nestedSeen.add(workspace.workspaceId)
      const title = workspaceTitle(workspace)
      const multi = workspace.agents.length > 1
      const expanded = keyword ? true : expandedWorkspaces.has(workspace.workspaceId)
      const childrenExpanded = keyword ? true : expandedChildren.has(workspace.workspaceId)
      const selected = workspace.agents.some(agent => agent.id === selectedAgentId)
      return [<div className="paseo-workspace" data-active={selected} data-workspace-id={workspace.workspaceId}
        data-workspace-depth={depth} key={workspace.workspaceId}>
        <div className="paseo-workspace-row">
          {node.children.length
            ? <button type="button" className="icon-control paseo-child-disclosure"
                aria-expanded={childrenExpanded} aria-label={`${childrenExpanded ? '折叠' : '展开'}「${title}」的子窗口`}
                onClick={() => toggleChildren(workspace.workspaceId)}>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            : <span className="paseo-workspace-spacer" aria-hidden="true" />}
          <StatusDot status={visibleStatus(workspace.agents)} />
          <button type="button" className="paseo-workspace-main"
            title={workspace.cwd || title}
            aria-current={!multi && selected ? 'page' : undefined}
            aria-expanded={multi ? expanded : undefined}
            disabled={!workspace.agents[0]}
            onClick={() => {
              if (multi) toggleWorkspace(workspace.workspaceId)
              else if (workspace.agents[0]) select(workspace.agents[0].id)
            }}>
            {multi && <ChevronRight className="paseo-main-chevron" size={13} aria-hidden="true" />}
            <span>{title}</span><small>{workspace.agents.length || '—'}</small>
          </button>
        </div>
        {multi && expanded && <div className="paseo-agents">
          {node.agents.map(agent => <button type="button" key={agent.id} className="paseo-agent-row"
            data-active={agent.id === selectedAgentId} aria-current={agent.id === selectedAgentId ? 'page' : undefined}
            onClick={() => select(agent.id)}>
            <StatusDot status={paseoStatus(agent)} />
            <span><strong>{agentTitle(agent)}</strong><small>{agent.provider}{agent.model ? ` · ${agent.model}` : ''}</small></span>
          </button>)}
        </div>}
        {node.children.length > 0 && childrenExpanded &&
          <div className="paseo-workspace-children">{workspaceRows(node.children, depth + 1, nestedSeen)}</div>}
      </div>]
    })
  }

  return <aside className="workspace-sidebar workspace-navigation paseo-navigation" id="workspace-navigation"
    aria-label="Paseo 导航">
    <div className="navigation-bar">
      <div className="navigation-segment" role="group" aria-label="Paseo 导航视图">
        <button type="button" aria-pressed={view === 'windows'} onClick={() => onView('windows')}>窗口</button>
        <button type="button" aria-pressed={view === 'outline'} onClick={() => onView('outline')}>目录</button>
      </div>
      <button type="button" className="icon-control" aria-label="收起 Paseo 导航" title="收起导航" onClick={onClose}>
        <PanelLeftClose size={16} aria-hidden="true" />
      </button>
    </div>
    {view === 'outline' ? <>
      <div className="sidebar-heading navigation-outline-heading"><List size={16} aria-hidden="true" /><h2>目录</h2></div>
      <OutlineSidebar editor={null} content={content} />
    </> : <>
      <div className="sidebar-heading page-tree-heading"><h2>窗口</h2></div>
      <label className="page-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} type="search" aria-label="搜索 Paseo 项目或窗口"
          placeholder="搜索项目、窗口或会话…" onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="paseo-controls">
        <div className="paseo-filter" role="group" aria-label="窗口筛选">
          {([
            ['all', '全部'],
            ['active', '活跃'],
            ['attention', '待处理'],
          ] as const).map(([value, label]) => <button type="button" key={value}
            aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <select className="paseo-sort" aria-label="窗口排序" value={sort}
          onChange={event => {
            const value = event.target.value
            if (value === 'activity' || value === 'status' || value === 'created') setSort(value)
          }}>
          <option value="activity">最近活跃</option>
          <option value="status">状态优先</option>
          <option value="created">创建时间</option>
        </select>
      </div>
      <div className="workspace-navigation-body paseo-window-tree">
        {filtered.projects.length > 0 && <nav aria-label="Paseo 窗口树">
          {filtered.projects.map(({ project, workspaces }) => {
            const collapsed = !keyword && collapsedProjects.has(project.projectId)
            return <section className="paseo-project" data-collapsed={collapsed} key={project.projectId}>
              <button type="button" className="paseo-project-row" aria-expanded={!collapsed}
                title={project.path} onClick={() => toggleProject(project.projectId)}>
                <ChevronRight size={14} aria-hidden="true" />
                <span>{project.name}</span>
                <small>{nodeCount(workspaces)}</small>
              </button>
              {!collapsed && <div className="paseo-workspaces">
                {workspaceRows(workspaces, 0)}
              </div>}
            </section>
          })}
        </nav>}
        {filtered.orphanAgents.length > 0 && <section className="paseo-orphans" aria-label="未归属窗口">
          <h3>未归属窗口</h3>
          {filtered.orphanAgents.map(agent => <button type="button" key={agent.id} className="paseo-agent-row"
            data-active={agent.id === selectedAgentId} aria-current={agent.id === selectedAgentId ? 'page' : undefined}
            onClick={() => select(agent.id)}>
            <StatusDot status={paseoStatus(agent)} />
            <span><strong>{agentTitle(agent)}</strong><small>{agent.provider}{agent.model ? ` · ${agent.model}` : ''}</small></span>
          </button>)}
        </section>}
        {filtered.projects.length === 0 && filtered.orphanAgents.length === 0 &&
          <p className="sidebar-empty">{keyword ? '没有匹配的 Paseo 窗口'
            : filter !== 'all' ? '没有符合筛选条件的 Paseo 窗口' : 'Paseo 中没有活动窗口'}</p>}
      </div>
      <div className="page-count">{workspaceCount} 个窗口 · {tree.orphanAgents.length ? `${tree.orphanAgents.length} 个未归属` : 'Paseo'}</div>
    </>}
  </aside>
}

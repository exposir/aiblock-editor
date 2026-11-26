import type { JSONContent } from '@tiptap/core'
import { ChevronRight, List, PanelLeftClose, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { OutlineSidebar } from '../components/OutlineSidebar'
import type { PaseoAgent, PaseoAgentStatus, PaseoProject, PaseoTreeSnapshot, PaseoWorkspace } from './paseo-types'

export type PaseoNavigationView = 'windows' | 'outline'

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

interface ProjectView {
  readonly project: PaseoProject
  readonly workspaces: readonly {
    readonly workspace: PaseoWorkspace
    readonly agents: readonly PaseoAgent[]
  }[]
}

function normalized(value: string): string {
  return value.toLocaleLowerCase()
}

function includes(value: string, query: string): boolean {
  return normalized(value).includes(query)
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

function filteredTree(tree: PaseoTreeSnapshot, query: string): { projects: ProjectView[]; orphanAgents: PaseoAgent[] } {
  if (!query) {
    return {
      projects: tree.projects.map(project => ({
        project,
        workspaces: project.workspaces.map(workspace => ({ workspace, agents: workspace.agents })),
      })),
      orphanAgents: [...tree.orphanAgents],
    }
  }
  const projects = tree.projects.flatMap(project => {
    const projectMatch = includes(project.name, query) || includes(project.path, query)
    const workspaces = project.workspaces.flatMap(workspace => {
      const workspaceMatch = includes(workspaceTitle(workspace), query) ||
        includes(workspace.displayName, query) || includes(workspace.cwd, query)
      const agents = workspace.agents.filter(agent =>
        includes(agentTitle(agent), query) || includes(agent.provider, query) || includes(agent.model, query))
      return projectMatch || workspaceMatch || agents.length
        ? [{ workspace, agents: projectMatch || workspaceMatch ? workspace.agents : agents }]
        : []
    })
    return projectMatch || workspaces.length ? [{ project, workspaces }] : []
  })
  return {
    projects,
    orphanAgents: tree.orphanAgents.filter(agent =>
      includes(agentTitle(agent), query) || includes(agent.provider, query) || includes(agent.model, query)),
  }
}

export function PaseoNavigation({ tree, open, view, selectedAgentId, content, onView, onClose, onSelect }:
  PaseoNavigationProps) {
  const [query, setQuery] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<ReadonlySet<string>>(() => new Set())
  const keyword = normalized(query.trim())
  const filtered = useMemo(() => filteredTree(tree, keyword), [tree, keyword])
  const workspaceCount = useMemo(() => {
    const ids = new Set(tree.workspaces.map(workspace => workspace.workspaceId))
    for (const project of tree.projects) {
      for (const workspace of project.workspaces) ids.add(workspace.workspaceId)
    }
    return ids.size
  }, [tree])

  useEffect(() => {
    if (!selectedAgentId) return
    setExpandedWorkspaces(previous => {
      const workspace = [...tree.projects.flatMap(project => project.workspaces), ...tree.workspaces]
        .find(value => value.agents.some(agent => agent.id === selectedAgentId))
      if (!workspace || previous.has(workspace.workspaceId)) return previous
      return new Set([...previous, workspace.workspaceId])
    })
  }, [selectedAgentId, tree.workspaces])

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

  function select(agentId: string) {
    setQuery('')
    onSelect(agentId)
  }

  if (!open) return null

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
      <div className="workspace-navigation-body paseo-window-tree">
        {filtered.projects.length > 0 && <nav aria-label="Paseo 窗口树">
          {filtered.projects.map(({ project, workspaces }) => {
            const collapsed = !keyword && collapsedProjects.has(project.projectId)
            return <section className="paseo-project" data-collapsed={collapsed} key={project.projectId}>
              <button type="button" className="paseo-project-row" aria-expanded={!collapsed}
                title={project.path} onClick={() => toggleProject(project.projectId)}>
                <ChevronRight size={14} aria-hidden="true" />
                <span>{project.name}</span>
                <small>{workspaces.length}</small>
              </button>
              {!collapsed && <div className="paseo-workspaces">
                {workspaces.map(({ workspace, agents }) => {
                  const title = workspaceTitle(workspace)
                  const multi = workspace.agents.length > 1
                  const expanded = keyword ? true : expandedWorkspaces.has(workspace.workspaceId)
                  const selected = agents.some(agent => agent.id === selectedAgentId)
                  return <div className="paseo-workspace" data-active={selected} key={workspace.workspaceId}>
                    {multi
                      ? <button type="button" className="paseo-workspace-row" aria-expanded={expanded}
                          title={workspace.cwd || title} onClick={() => toggleWorkspace(workspace.workspaceId)}>
                          <ChevronRight size={13} aria-hidden="true" />
                          <StatusDot status={visibleStatus(agents)} />
                          <span>{title}</span>
                          <small>{agents.length}</small>
                        </button>
                      : <button type="button" className="paseo-workspace-row" title={workspace.cwd || title}
                          aria-current={selected ? 'page' : undefined} disabled={!agents[0]}
                          onClick={() => agents[0] && select(agents[0].id)}>
                          <span className="paseo-workspace-spacer" aria-hidden="true" />
                          <StatusDot status={visibleStatus(agents)} />
                          <span>{title}</span>
                          <small>{agents.length || '—'}</small>
                        </button>}
                    {multi && expanded && <div className="paseo-agents">
                      {agents.map(agent => <button type="button" key={agent.id} className="paseo-agent-row"
                        data-active={agent.id === selectedAgentId} aria-current={agent.id === selectedAgentId ? 'page' : undefined}
                        onClick={() => select(agent.id)}>
                        <StatusDot status={paseoStatus(agent)} />
                        <span><strong>{agentTitle(agent)}</strong><small>{agent.provider}{agent.model ? ` · ${agent.model}` : ''}</small></span>
                      </button>)}
                    </div>}
                  </div>
                })}
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
          <p className="sidebar-empty">{keyword ? '没有匹配的 Paseo 窗口' : 'Paseo 中没有活动窗口'}</p>}
      </div>
      <div className="page-count">{workspaceCount} 个窗口 · {tree.orphanAgents.length ? `${tree.orphanAgents.length} 个未归属` : 'Paseo'}</div>
    </>}
  </aside>
}

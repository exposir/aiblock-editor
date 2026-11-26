import type { Schema } from '@tiptap/pm/model'
import { ArrowDownUp, Check, ClipboardCopy, FilePlus2, FileText, List, Lock, PanelLeft, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ThemeControl, SourceControl } from '../components/EditorControls'
import type { Appearance, DocumentSource } from '../components/EditorControls'
import type { DesktopBridge } from '../desktop/bridge'
import { PagePreview } from '../workspace/PagePreview'
import type { PageRecord } from '../workspace/page-store'
import { paseoLogsToDocument } from './paseo-doc'
import { PaseoNavigation } from './PaseoNavigation'
import type { PaseoNavigationView } from './PaseoNavigation'
import type { PaseoAgent, PaseoAgentLogs, PaseoTreeSnapshot, PaseoWorkspace as PaseoWorkspaceRecord } from './paseo-types'

export const PASEO_SELECTION_STORAGE_KEY = 'aiblock-editor.paseo.agent.v1'
export const PASEO_MESSAGE_ORDER_STORAGE_KEY = '{{SECRET_x8m96b1o}}'
const emptyTree: PaseoTreeSnapshot = { available: true, projects: [], workspaces: [], orphanAgents: [] }

type PaseoBridge = DesktopBridge & Required<Pick<DesktopBridge, 'readPaseoTree' | 'readPaseoLogs'>>

export interface PaseoSaveRequest {
  readonly title: string
  readonly content: PageRecord['content']
  readonly markdown: string
  readonly agent: PaseoAgent
}

export type PaseoMessageOrder = 'asc' | 'desc'

interface PaseoWorkspaceProps {
  readonly bridge: PaseoBridge
  readonly schema: Schema
  readonly appearance: Appearance
  readonly onSourceChange: (source: DocumentSource) => void
  readonly onSaveDocument: (request: PaseoSaveRequest) => void
}

function readSelectedAgent(): string | null {
  try {
    return localStorage.getItem(PASEO_SELECTION_STORAGE_KEY)
  } catch {
    return null
  }
}

function rememberSelectedAgent(id: string) {
  try {
    localStorage.setItem(PASEO_SELECTION_STORAGE_KEY, id)
  } catch {
    // Selection remains available for this mounted view.
  }
}

function readMessageOrder(): PaseoMessageOrder {
  try {
    return localStorage.getItem(PASEO_MESSAGE_ORDER_STORAGE_KEY) === 'desc' ? 'desc' : 'asc'
  } catch {
    return 'asc'
  }
}

function rememberMessageOrder(order: PaseoMessageOrder) {
  try {
    localStorage.setItem(PASEO_MESSAGE_ORDER_STORAGE_KEY, order)
  } catch {
    // Ordering still applies to this mounted view.
  }
}

export function formatPaseoError(error: unknown): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'
  let previous = ''
  while (previous !== message) {
    previous = message
    for (const prefix of [
      /^Error invoking remote method '[^']+':\s*/i,
      /^Unable to read Paseo logs:\s*/i,
      /^Error:\s*/i,
    ]) message = message.replace(prefix, '')
  }
  const provider = /references unavailable provider ['"]?([a-z0-9._-]+)['"]?/i.exec(message)
  if (provider?.[1]) return `Provider '${provider[1]}' 不可用`
  const meaningful = message.split(/\r?\n/).map(line => line.trim()).find(line =>
    line && !/^Command failed:/i.test(line) && !/^at\s/.test(line))
  const normalized = meaningful || message.trim() || '未知错误'
  const characters = Array.from(normalized)
  return characters.length > 240 ? `${characters.slice(0, 239).join('')}…` : normalized
}

function wideViewport() {
  return window.matchMedia('(min-width: 1080px)').matches
}

function allAgents(tree: PaseoTreeSnapshot): PaseoAgent[] {
  const workspaces = new Map<string, PaseoWorkspaceRecord>()
  for (const project of tree.projects) {
    for (const workspace of project.workspaces) workspaces.set(workspace.workspaceId, workspace)
  }
  for (const workspace of tree.workspaces) workspaces.set(workspace.workspaceId, workspace)
  const agents = new Map<string, PaseoAgent>()
  for (const workspace of workspaces.values()) {
    for (const agent of workspace.agents) agents.set(agent.id, agent)
  }
  for (const agent of tree.orphanAgents) agents.set(agent.id, agent)
  return [...agents.values()]
}

function firstAgent(tree: PaseoTreeSnapshot): PaseoAgent | undefined {
  return tree.projects.flatMap(project => project.workspaces).flatMap(workspace => workspace.agents)[0] ??
    tree.workspaces.flatMap(workspace => workspace.agents)[0] ??
    tree.orphanAgents[0]
}

function selectedWorkspace(tree: PaseoTreeSnapshot, agent: PaseoAgent | undefined): PaseoWorkspaceRecord | undefined {
  if (!agent) return undefined
  return tree.workspaces.find(workspace => workspace.workspaceId === agent.workspaceId) ??
    tree.projects.flatMap(project => project.workspaces)
      .find(workspace => workspace.workspaceId === agent.workspaceId)
}

function workspaceLabel(workspace: PaseoWorkspaceRecord | undefined, agent: PaseoAgent | undefined): string {
  return workspace?.title.trim() || workspace?.displayName.trim() || agent?.title.trim() || 'Paseo 窗口'
}

function selectedProject(tree: PaseoTreeSnapshot, workspace: PaseoWorkspaceRecord | undefined) {
  return workspace ? tree.projects.find(project => project.projectId === workspace.projectId) : undefined
}

function updateDate(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function PaseoWorkspace({ bridge, schema, appearance, onSourceChange, onSaveDocument }: PaseoWorkspaceProps) {
  const [tree, setTree] = useState<PaseoTreeSnapshot | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(readSelectedAgent)
  const [logs, setLogs] = useState<PaseoAgentLogs | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [logsFailed, setLogsFailed] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [includeDetails, setIncludeDetails] = useState(false)
  const [messageOrder, setMessageOrder] = useState<PaseoMessageOrder>(readMessageOrder)
  const [navigationOpen, setNavigationOpen] = useState(wideViewport)
  const [navigationView, setNavigationView] = useState<PaseoNavigationView>('windows')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const treeRequest = useRef(0)
  const logsRequest = useRef(0)
  const selectedRef = useRef(selectedAgentId)
  const scrollRestore = useRef<number | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)

  selectedRef.current = selectedAgentId

  const empty = tree ?? emptyTree
  const agent = selectedAgentId ? allAgents(empty).find(value => value.id === selectedAgentId) : undefined
  const workspace = selectedWorkspace(empty, agent)
  const project = selectedProject(empty, workspace)
  const title = workspaceLabel(workspace, agent)
  const agentId = agent?.id
  const agentTitleValue = agent?.title
  const agentCwd = agent?.cwd
  const agentProvider = agent?.provider
  const agentModel = agent?.model
  const agentStatus = agent?.lastStatus
  const agentAttention = agent?.requiresAttention
  const agentUpdatedAt = agent?.updatedAt
  const document = useMemo(() => paseoLogsToDocument(
    schema, title, agent ?? null, logs?.items ?? [],
    {
      includeDetails,
      order: messageOrder,
      ...(logsFailed ? {
        emptyMessage: logsError
          ? `无法读取这个 Paseo 窗口的日志：${logsError}`
          : '无法读取这个 Paseo 窗口的日志。请稍后刷新重试。',
      } : {}),
    },
  ), [schema, title, agentId, agentTitleValue, agentCwd, agentProvider, agentModel, agentStatus, agentAttention,
    agentUpdatedAt, logs, includeDetails, logsFailed, logsError, messageOrder])

  const fetchLogs = useCallback(async (selectedId: string, options: { silent?: boolean; force?: boolean } = {}) => {
    const sequence = ++logsRequest.current
    if (options.silent) {
      scrollRestore.current = window.scrollY
    } else {
      setLogs(null)
      setLogsFailed(false)
      setLogsError('')
    }
    try {
      const value = await bridge.readPaseoLogs(selectedId, options.force ? { force: true } : undefined)
      if (!mounted.current || sequence !== logsRequest.current) return
      setLogs(value)
      setLogsFailed(false)
      setLogsError('')
      setNotice('')
    } catch (error) {
      if (!mounted.current || sequence !== logsRequest.current) return
      const detail = formatPaseoError(error)
      scrollRestore.current = null
      if (options.silent) setNotice(`无法刷新这个 Paseo 窗口，当前仍显示上一次的内容：${detail}`)
      else {
        setLogs(null)
        setLogsFailed(true)
        setLogsError(detail)
      }
    }
  }, [bridge])

  const applyTree = useCallback((next: PaseoTreeSnapshot, refreshCurrent: boolean, force = false) => {
    setTree(next)
    setTreeLoading(false)
    const available = allAgents(next)
    const current = selectedRef.current
    const nextId = current && available.some(value => value.id === current)
      ? current
      : firstAgent(next)?.id ?? null
    if (nextId !== current) {
      selectedRef.current = nextId
      setLogs(null)
      setLogsFailed(false)
      setLogsError('')
      setSelectedAgentId(nextId)
      if (nextId) rememberSelectedAgent(nextId)
    } else if (refreshCurrent && nextId) {
      void fetchLogs(nextId, { silent: true, force })
    }
  }, [fetchLogs])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    const sequence = ++treeRequest.current
    void bridge.readPaseoTree().then(next => {
      if (cancelled || !mounted.current || sequence !== treeRequest.current) return
      applyTree(next, false)
    }).catch(() => {
      if (cancelled || !mounted.current || sequence !== treeRequest.current) return
      setTreeLoading(false)
      setNotice('无法读取 Paseo 目录树，请确认本机 Paseo 是否可用。')
    })
    return () => { cancelled = true }
  }, [applyTree, bridge])

  const treeReady = tree !== null
  const selectedExists = Boolean(agent)
  useEffect(() => {
    if (!selectedAgentId || !treeReady || !selectedExists) {
      setLogs(null)
      return
    }
    void fetchLogs(selectedAgentId)
  }, [selectedAgentId, treeReady, selectedExists, fetchLogs])

  useEffect(() => {
    if (!bridge.onPaseoChange) return
    return bridge.onPaseoChange(() => {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        void bridge.readPaseoTree().then(next => {
          if (!mounted.current) return
          applyTree(next, true)
        }).catch(() => setNotice('Paseo 窗口更新时刷新失败。'))
      }, 500)
    })
  }, [applyTree, bridge])

  useEffect(() => () => {
    clearTimeout(refreshTimer.current)
    clearTimeout(copiedTimer.current)
  }, [])

  useLayoutEffect(() => {
    const y = scrollRestore.current
    if (y === null) return
    scrollRestore.current = null
    window.scrollTo(0, y)
  }, [logs])

  function selectAgent(id: string) {
    if (id === selectedRef.current) {
      if (!wideViewport()) setNavigationOpen(false)
      return
    }
    selectedRef.current = id
    setLogs(null)
    setLogsFailed(false)
    setLogsError('')
    setSelectedAgentId(id)
    rememberSelectedAgent(id)
    if (!wideViewport()) setNavigationOpen(false)
  }

  function toggleNavigation(view: PaseoNavigationView) {
    if (navigationOpen && navigationView === view) setNavigationOpen(false)
    else {
      setNavigationView(view)
      setNavigationOpen(true)
    }
  }

  function refresh() {
    void bridge.readPaseoTree().then(next => applyTree(next, true, true))
      .catch(() => setNotice('无法刷新 Paseo 目录树。'))
  }

  function toggleMessageOrder() {
    const next = messageOrder === 'asc' ? 'desc' : 'asc'
    setMessageOrder(next)
    rememberMessageOrder(next)
    window.scrollTo(0, 0)
  }

  async function copyMarkdown() {
    clearTimeout(copiedTimer.current)
    try {
      await navigator.clipboard.writeText(document.markdown)
      setCopied(true)
      setNotice('')
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setNotice('无法将 Paseo Markdown 写入剪贴板。')
    }
  }

  function saveDocument() {
    if (!agent) return
    onSaveDocument({ title, content: document.content, markdown: document.markdown, agent })
    onSourceChange('document')
  }

  const page: PageRecord | null = agent ? {
    id: `paseo-${agent.id}`,
    parentId: null,
    title,
    icon: '◈',
    content: document.content,
    comments: [],
    createdAt: updateDate(agent.updatedAt),
    updatedAt: updateDate(agent.updatedAt),
    order: 0,
  } : null

  return <>
    <header className="app-header workspace-header paseo-header" data-editor-sticky-header="">
      <nav className="document-identity" aria-label="Paseo 层级">
        <span className="document-logo" aria-hidden="true">{agent ? '◈' : '◌'}</span>
        {project && <div className="document-ancestors">
          <span className="breadcrumb-step"><span>{project.name}</span></span>
          {workspace && <span className="breadcrumb-step">
            <span>{workspace.displayName || workspace.title}</span>
          </span>}
        </div>}
        <h1 className="document-title-readonly" aria-label="Paseo 窗口">{title}</h1>
      </nav>
      <div className="workspace-tools" role="group" aria-label="Paseo 工具">
        <button type="button" className="icon-control" aria-label="窗口侧栏" title="窗口"
          aria-expanded={navigationOpen && navigationView === 'windows'}
          aria-controls={navigationOpen ? 'workspace-navigation' : undefined}
          onClick={() => toggleNavigation('windows')}><PanelLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="icon-control" aria-label="目录侧栏" title="目录"
          aria-expanded={navigationOpen && navigationView === 'outline'}
          aria-controls={navigationOpen ? 'workspace-navigation' : undefined}
          onClick={() => toggleNavigation('outline')}><List size={18} aria-hidden="true" /></button>
        <SourceControl source="paseo" setSource={onSourceChange} />
        <span className="paseo-readonly" title="Paseo 只读预览">
          <Lock size={13} aria-hidden="true" /><span className="paseo-readonly-label">只读</span>
        </span>
        <button type="button" className="paseo-order-toggle" aria-label="切换消息顺序" title="切换消息顺序"
          onClick={toggleMessageOrder}>
          <ArrowDownUp size={14} aria-hidden="true" />
          <span>{messageOrder === 'desc' ? '最新在前' : '正序'}</span>
        </button>
        <button type="button" className={`icon-control${includeDetails ? ' is-active' : ''}`}
          aria-label="显示细节" aria-pressed={includeDetails} title="显示思考与工具调用"
          disabled={!logs} onClick={() => setIncludeDetails(value => !value)}>
          <FileText size={17} aria-hidden="true" />
        </button>
        <button type="button" className="icon-control" aria-label="刷新 Paseo 窗口" title="刷新"
          disabled={!selectedAgentId} onClick={refresh}><RefreshCw size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-control" aria-label="复制 Paseo Markdown" title="复制 Markdown"
          disabled={!logs} onClick={() => void copyMarkdown()}>
          {copied ? <Check size={17} aria-hidden="true" /> : <ClipboardCopy size={17} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-control" aria-label="另存为文档" title="另存为文档"
          disabled={!agent} onClick={saveDocument}><FilePlus2 size={17} aria-hidden="true" /></button>
        <ThemeControl {...appearance} />
      </div>
    </header>
    <div className="workspace paseo-workspace-shell" data-navigation={navigationOpen} data-comments="false">
      <PaseoNavigation tree={empty} open={navigationOpen} view={navigationView} selectedAgentId={selectedAgentId}
        content={document.content} onView={setNavigationView} onClose={() => setNavigationOpen(false)} onSelect={selectAgent} />
      {(treeLoading && !tree) || (selectedAgentId && !logs && !logsFailed)
        ? <main className="document-surface paseo-load" aria-busy="true">
            <div className="workspace-load" role="status">正在读取 Paseo 窗口…</div>
          </main>
        : !tree?.available
          ? <main className="document-surface paseo-load">
              <div className="workspace-load" role="status">未找到本机 Paseo 数据（~/.paseo）。</div>
            </main>
          : page
            ? <PagePreview key={`paseo-${agent!.id}`} page={page} anchor={null} commentsOpen={false}
                onCommentsOpen={() => {}} restoreScrollY={null} />
            : <main className="document-surface paseo-load">
                <div className="workspace-load" role="status">Paseo 中没有可预览的活动窗口。</div>
              </main>}
    </div>
    {notice && <div className="workspace-notice" role="status">{notice}</div>}
  </>
}

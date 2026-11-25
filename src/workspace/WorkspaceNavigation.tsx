import type { Editor } from '@tiptap/core'
import { ChevronRight, Copy, Ellipsis, FileDown, FolderInput, List, PanelLeftClose, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { OutlineSidebar } from '../components/OutlineSidebar'
import { useAnchoredPosition } from '../editor/components/editor-ui'
import { findPage, pageAncestors, pagesByParent, pageTitle } from './page-store'
import type { WorkspaceState } from './page-store'
import type { PageMetadata } from './workspace-format'
import type { JSONContent } from '@tiptap/core'
import { searchWorkspacePages } from './workspace-search'
import type { WorkspaceSearchHit } from './workspace-search'

export type NavigationView = 'pages' | 'outline'
export type PageAction = 'rename' | 'duplicate' | 'move' | 'export' | 'delete'

const iconOptions = [
  ['📄', '文档'], ['📝', '笔记'], ['🧪', '试验'], ['📐', '设计'],
  ['🗂️', '归档'], ['📚', '手册'], ['📌', '重点'], ['💡', '创意'],
  ['📋', '清单'], ['✅', '完成'], ['🛠️', '工具'], ['🚀', '发布'],
] as const

const pageActions = [
  { action: 'rename', label: '重命名', Icon: Pencil },
  { action: 'duplicate', label: '创建副本', Icon: Copy },
  { action: 'move', label: '移动到…', Icon: FolderInput },
  { action: 'export', label: '导出 Markdown', Icon: FileDown },
  { action: 'delete', label: '删除页面', Icon: Trash2 },
] as const

interface NavigationProps {
  readonly workspace: WorkspaceState<PageMetadata>
  readonly view: NavigationView
  readonly open: boolean
  readonly editor: Editor | null
  readonly onView: (view: NavigationView) => void
  readonly onClose: () => void
  readonly onActivate: (id: string) => void
  readonly onCreate: (parentId: string | null) => void
  readonly onIcon: (id: string, icon: string) => void
  readonly onAction: (action: PageAction, id: string) => void
  readonly searchContent?: (id: string) => Promise<JSONContent | null>
  readonly onRestore?: (id: string) => void
  readonly onPurge?: (id: string) => void
  readonly onEmptyTrash?: () => void
}

interface OpenPopover {
  readonly kind: 'icons' | 'actions'
  readonly pageId: string
  readonly anchor: HTMLButtonElement
}

function PagePopover({ popover, page, id, onClose, onIcon, onAction }: {
  popover: OpenPopover
  page: PageMetadata
  id: string
  onClose: () => void
  onIcon: NavigationProps['onIcon']
  onAction: NavigationProps['onAction']
}) {
  const panel = useRef<HTMLDivElement>(null)
  const { anchor, kind } = popover
  const pickIcon = kind === 'icons'
  useAnchoredPosition(panel, anchor, pickIcon ? 'bottom-start' : 'bottom-end')

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => panel.current?.querySelector('button')?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function closeWithFocus() {
    anchor.focus({ preventScroll: true })
    onClose()
  }

  useEffect(() => {
    function onOutside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.contains(event.target)) onClose()
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      anchor.focus({ preventScroll: true })
      onClose()
    }
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('focusin', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('focusin', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={panel} id={id} className={`page-popover${pickIcon ? ' page-icon-picker' : ''}`} role="group"
      aria-label={pickIcon ? '页面图标' : `${pageTitle(page)}的操作`}>
      {pickIcon ? iconOptions.map(([icon, label]) => (
        <button type="button" key={icon} aria-label={label} title={label} aria-pressed={page.icon === icon}
          onClick={() => { closeWithFocus(); onIcon(page.id, icon) }}>{icon}</button>
      )) : pageActions.map(({ action, label, Icon }) => (
        <button type="button" key={action} className={action === 'delete' ? 'page-delete-action' : undefined}
          onClick={() => { closeWithFocus(); onAction(action, page.id) }}>
          <Icon size={15} aria-hidden="true" />{label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

function matchingPages(workspace: WorkspaceState<PageMetadata>, query: string): Set<string> | null {
  if (!query) return null
  const matches = new Set<string>()
  for (const page of workspace.pages) {
    if (!pageTitle(page).toLocaleLowerCase().includes(query)) continue
    matches.add(page.id)
    for (const ancestor of pageAncestors(workspace, page.id)) matches.add(ancestor.id)
  }
  return matches
}

export function WorkspaceNavigation({ workspace, view, open, editor, onView, onClose, onActivate, onCreate, onIcon, onAction,
  searchContent, onRestore, onPurge, onEmptyTrash }: NavigationProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [popover, setPopover] = useState<OpenPopover | null>(null)
  const [bodySearch, setBodySearch] = useState<{
    query: string; pages: readonly PageMetadata[]; hits: readonly WorkspaceSearchHit[]; failed: boolean
  } | null>(null)
  const popoverId = useId()
  const index = useMemo(() => pagesByParent(workspace), [workspace.pages])
  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => matchingPages(workspace, keyword), [workspace.pages, keyword])
  const bodyResults = bodySearch?.query === keyword && bodySearch.pages === workspace.pages ? bodySearch : null
  const searching = keyword && searchContent && !bodyResults
  const trash = workspace.trash ?? []
  const activePath = pageAncestors(workspace, workspace.activePageId).map(page => page.id).join('/')
  const popoverPage = popover && findPage(workspace, popover.pageId)

  useEffect(() => {
    const ancestors = activePath.split('/')
    setCollapsed(previous => {
      if (!ancestors.some(id => previous.has(id))) return previous
      const next = new Set(previous)
      for (const id of ancestors) next.delete(id)
      return next
    })
  }, [workspace.activePageId, activePath])

  useEffect(() => { setPopover(null) }, [open, view, workspace.activePageId])

  useEffect(() => {
    if (!open || view !== 'pages' || !keyword || !searchContent) {
      setBodySearch(null)
      return
    }
    const controller = new AbortController()
    const pages = workspace.pages
    const timer = setTimeout(() => {
      void searchWorkspacePages(pages, searchContent, keyword, { signal: controller.signal, limit: Infinity }).then(
        hits => {
          if (!controller.signal.aborted) setBodySearch({ query: keyword, pages, hits: hits.filter(hit => hit.match === 'body').slice(0, 50), failed: false })
        },
        () => {
          if (!controller.signal.aborted) setBodySearch({ query: keyword, pages, hits: [], failed: true })
        },
      )
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, view, keyword, searchContent, workspace.pages])

  function toggleBranch(id: string) {
    setPopover(null)
    setCollapsed(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function add(parentId: string | null) {
    setQuery('')
    onCreate(parentId)
  }

  function activateResult(id: string) {
    setQuery('')
    onActivate(id)
  }

  function togglePopover(anchor: HTMLButtonElement, pageId: string, kind: OpenPopover['kind']) {
    setPopover(previous => previous?.anchor === anchor ? null : { anchor, pageId, kind })
  }

  function rows(parentId: string | null, depth: number) {
    return (index.get(parentId) ?? []).filter(page => !visible || visible.has(page.id)).map(page => {
      const title = pageTitle(page)
      const active = page.id === workspace.activePageId
      const hasChildren = index.get(page.id)?.some(child => !visible || visible.has(child.id)) ?? false
      const expanded = !!visible || !collapsed.has(page.id)
      const iconOpen = popoverPage?.id === page.id && popover?.kind === 'icons'
      const actionsOpen = popoverPage?.id === page.id && popover?.kind === 'actions'
      return <li key={page.id}>
        <div className="page-tree-row" data-active={active} data-popover={iconOpen || actionsOpen}
          style={{ '--page-depth': depth } as CSSProperties}>
          {hasChildren && !visible ? <button type="button" className="icon-control page-disclosure" aria-expanded={expanded}
            aria-label={`${expanded ? '折叠' : '展开'}「${title}」的子页`}
            onClick={() => toggleBranch(page.id)}><ChevronRight size={14} aria-hidden="true" /></button>
            : <span className="page-disclosure" aria-hidden="true" />}
          <button type="button" className="icon-control page-emoji" aria-label={`更换「${title}」的图标`} title="更换图标"
            aria-expanded={iconOpen} aria-controls={iconOpen ? popoverId : undefined}
            onClick={event => togglePopover(event.currentTarget, page.id, 'icons')}>{page.icon}</button>
          <button type="button" className="page-tree-title" aria-current={active ? 'page' : undefined} title={title}
            onClick={() => onActivate(page.id)}>{title}</button>
          <div className="page-row-actions">
            <button type="button" className="icon-control" aria-label={`新建「${title}」的子页`} title="新建子页"
              onClick={() => add(page.id)}><Plus size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-control" aria-label={`「${title}」的更多操作`} title="更多操作"
              aria-expanded={actionsOpen} aria-controls={actionsOpen ? popoverId : undefined}
              onClick={event => togglePopover(event.currentTarget, page.id, 'actions')}><Ellipsis size={16} aria-hidden="true" /></button>
          </div>
        </div>
        {hasChildren && expanded && <ul>{rows(page.id, depth + 1)}</ul>}
      </li>
    })
  }

  if (!open) return null

  return (
    <aside className="workspace-sidebar workspace-navigation" id="workspace-navigation" aria-label="工作区导航">
      <div className="navigation-bar">
        <div className="navigation-segment" role="group" aria-label="导航视图">
          <button type="button" aria-pressed={view === 'pages'} onClick={() => onView('pages')}>页面</button>
          <button type="button" aria-pressed={view === 'outline'} onClick={() => onView('outline')}>目录</button>
        </div>
        <button type="button" className="icon-control" aria-label="收起导航" title="收起导航" onClick={onClose}>
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
      </div>
      {view === 'pages' ? <>
        <div className="sidebar-heading page-tree-heading">
          <h2>页面</h2>
          <button type="button" className="icon-control" aria-label="新建顶层页面" title="新建顶层页面"
            onClick={() => add(null)}><Plus size={17} aria-hidden="true" /></button>
        </div>
        <label className="page-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} type="search" aria-label="查找页面标题或正文" placeholder="查找页面…"
            onChange={event => { setQuery(event.target.value); setPopover(null) }} />
        </label>
        <div className="workspace-navigation-body">
          {visible?.size !== 0 && <nav className="page-tree" aria-label="页面树">
            <ul>{rows(null, 0)}</ul>
          </nav>}
          {searching && <p className="sidebar-empty" role="status">正在搜索正文…</p>}
          {bodyResults?.failed && <p className="sidebar-empty" role="status">无法完成正文搜索。</p>}
          {!!bodyResults?.hits.length && <section className="workspace-search-results" aria-label="正文匹配">
            <h3>正文匹配</h3>
            <ul>{bodyResults.hits.map(hit => <li key={hit.pageId}>
              <button type="button" aria-label={`打开「${hit.title}」的正文匹配`} onClick={() => activateResult(hit.pageId)}>
                <strong>{hit.title}</strong><span>{hit.snippet}</span>
              </button>
            </li>)}</ul>
          </section>}
          {visible?.size === 0 && !searching && !bodyResults?.failed && !bodyResults?.hits.length &&
            <p className="sidebar-empty">没有匹配的页面</p>}
        </div>
        {trash.length ? <details className="workspace-trash">
          <summary><Trash2 size={14} aria-hidden="true" />回收站 <span>{trash.length}</span></summary>
          <ul aria-label="已删除页面">
            {trash.map(page => <li key={page.id}>
              <span title={pageTitle(page)}>{page.icon} {pageTitle(page)}</span>
              <button type="button" aria-label={`恢复「${pageTitle(page)}」`} onClick={() => onRestore?.(page.id)}>恢复</button>
              <button type="button" aria-label={`彻底删除「${pageTitle(page)}」`} onClick={() => onPurge?.(page.id)}>彻底删除</button>
            </li>)}
          </ul>
          <button type="button" className="workspace-trash-empty" onClick={onEmptyTrash}>清空回收站</button>
        </details> : <p className="workspace-trash-muted">回收站为空</p>}
        <div className="page-count">{workspace.pages.length} 个页面</div>
        {popover && popoverPage && <PagePopover key={`${popover.kind}-${popover.pageId}`} popover={popover} page={popoverPage}
          id={popoverId} onClose={() => setPopover(null)} onIcon={onIcon} onAction={onAction} />}
      </> : <>
        <div className="sidebar-heading navigation-outline-heading"><List size={16} aria-hidden="true" /><h2>目录</h2></div>
        <OutlineSidebar key={workspace.activePageId} editor={editor} />
      </>}
    </aside>
  )
}

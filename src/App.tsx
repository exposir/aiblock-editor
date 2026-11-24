import { getSchema } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Download, FileDown, FileUp, Keyboard, List, MessagesSquare, PanelLeft, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createEditorExtensions } from './editor/extensions'
import { docToMarkdown } from './editor/markdown/markdown-codec'
import { downloadMarkdown, isMarkdownFile } from './editor/markdown/markdown-files'
import { PageEditor } from './workspace/PageEditor'
import type { EditPage } from './workspace/PageEditor'
import { WorkspaceDialog } from './workspace/WorkspaceDialog'
import type { WorkspaceDialogRequest } from './workspace/WorkspaceDialog'
import { WorkspaceNavigation } from './workspace/WorkspaceNavigation'
import type { NavigationView, PageAction } from './workspace/WorkspaceNavigation'
import {
  DEFAULT_PAGE_TITLE, activatePage, addPage, copyPage, findPage, formatPageHash, hasPageContent,
  importMarkdownPage, movePage, pageAncestors, pageTitle, removePage, updatePage,
} from './workspace/page-store'
import type { PageRecord } from './workspace/page-store'
import { newPageIdentity, useWorkspace } from './workspace/useWorkspace'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)

function wideViewport() {
  return window.matchMedia('(min-width: 1080px)').matches
}

function Workspace({ workspace, anchor, saveFailed, change, reset }: ReturnType<typeof useWorkspace>) {
  const help = useRef<HTMLDialogElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const focusTitleFor = useRef<string | null>(null)
  const markdownInput = useRef<HTMLInputElement>(null)
  const toolsMenu = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [navigationOpen, setNavigationOpen] = useState(wideViewport)
  const [navigationView, setNavigationView] = useState<NavigationView>('pages')
  const [commentsOpen, setCommentsOpen] = useState(wideViewport)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<WorkspaceDialogRequest | null>(null)
  const [binding, setBinding] = useState<{ pageId: string; editor: Editor } | null>(null)
  const activePage = findPage(workspace, workspace.activePageId)!
  const copied = copiedPageId === activePage.id
  const editor = binding?.pageId === activePage.id && !binding.editor.isDestroyed ? binding.editor : null
  const ancestors = pageAncestors(workspace, activePage.id)

  const editorReady = useCallback((pageId: string, editor: Editor) => { setBinding({ pageId, editor }) }, [])

  useLayoutEffect(() => {
    if (focusTitleFor.current !== activePage.id) return
    focusTitleFor.current = null
    titleInput.current?.focus({ preventScroll: true })
    titleInput.current?.select()
  }, [activePage.id])

  useEffect(() => {
    setToolsOpen(false)
    setCopiedPageId(null)
    clearTimeout(copyTimer.current)
  }, [activePage.id])

  useEffect(() => {
    if (!toolsOpen) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolsMenu.current?.contains(event.target)) setToolsOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    }
  }, [toolsOpen])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const editPage: EditPage = (id, patch, deferred) => {
    change(current => {
      const page = findPage(current, id)
      return page ? updatePage(current, id, typeof patch === 'function' ? patch(page) : patch, Date.now()) : current
    }, deferred)
  }

  function selectNavigation(view: NavigationView) {
    setNavigationView(view)
    setNavigationOpen(true)
    if (!wideViewport()) setCommentsOpen(false)
  }

  function toggleNavigation(view: NavigationView) {
    if (navigationOpen && navigationView === view) setNavigationOpen(false)
    else selectNavigation(view)
  }

  function showComments(open: boolean) {
    setCommentsOpen(open)
    if (open && !wideViewport()) setNavigationOpen(false)
  }

  function openPage(id: string) {
    change(current => activatePage(current, id))
    if (!wideViewport()) setNavigationOpen(false)
  }

  function newPage(parentId: string | null) {
    const identity = newPageIdentity()
    focusTitleFor.current = identity.id
    change(current => addPage(current, identity, { parentId }))
    if (!wideViewport()) setNavigationOpen(false)
  }

  function documentFor(page: PageRecord) {
    return page.id === activePage.id && editor ? editor.state.doc : schema.nodeFromJSON(page.content)
  }

  function pageAction(action: PageAction, id: string) {
    const page = findPage(workspace, id)
    if (!page) return
    switch (action) {
      case 'duplicate':
        change(current => copyPage(current, id, newPageIdentity()))
        if (!wideViewport()) setNavigationOpen(false)
        return
      case 'export':
        downloadMarkdown(documentFor(page), pageTitle(page))
        return
      case 'delete':
        if (!hasPageContent(page) && pageTitle(page) === DEFAULT_PAGE_TITLE && !workspace.pages.some(child => child.parentId === id)) {
          change(current => removePage(current, id, newPageIdentity()))
          return
        }
        break
    }
    setDialog({ kind: action, pageId: id })
  }

  function confirmDialog(value: string) {
    if (!dialog) return
    switch (dialog.kind) {
      case 'rename': editPage(dialog.pageId, { title: value.trim() }); break
      case 'move': change(current => movePage(current, dialog.pageId, value || null, Date.now())); break
      case 'delete': change(current => removePage(current, dialog.pageId, newPageIdentity())); break
      case 'reset': reset(); break
    }
  }

  async function chooseMarkdownFile(file: File | undefined) {
    if (!file || !isMarkdownFile(file)) return
    setNotice('')
    try {
      const markdown = await file.text()
      change(current => importMarkdownPage(current, schema, newPageIdentity(), file.name, markdown))
      if (!wideViewport()) setNavigationOpen(false)
      setToolsOpen(false)
    } catch {
      setNotice('无法导入这个 Markdown 文件。')
    }
  }

  function exportJSON() {
    const name = pageTitle(activePage)
    const data = { title: name, document: documentFor(activePage).toJSON(), comments: activePage.comments }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function copyMarkdown() {
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(docToMarkdown(documentFor(activePage)))
      setCopiedPageId(activePage.id)
      copyTimer.current = setTimeout(() => setCopiedPageId(null), 1500)
    } catch {
      setCopiedPageId(null)
      setNotice('无法将 Markdown 写入剪贴板。')
    }
  }

  return (
    <>
      <header className="app-header workspace-header" data-editor-sticky-header="">
        <nav className="document-identity" aria-label="页面层级">
          <span className="document-logo" aria-hidden="true">{activePage.icon}</span>
          {ancestors.length > 0 && <div className="document-ancestors">
            {ancestors.map(page => <span className="breadcrumb-step" key={page.id}>
              <a href={formatPageHash(page.id)} title={pageTitle(page)} onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                openPage(page.id)
              }}>{pageTitle(page)}</a>
              <ChevronRight size={13} aria-hidden="true" />
            </span>)}
          </div>}
          <input ref={titleInput} aria-label="文档标题" aria-current="page" value={activePage.title} placeholder={DEFAULT_PAGE_TITLE}
            onChange={event => editPage(activePage.id, { title: event.target.value })} />
        </nav>
        <div className="workspace-tools" role="group" aria-label="文档工具">
          <button type="button" className="icon-control" aria-label="页面侧栏" title="页面"
            aria-expanded={navigationOpen && navigationView === 'pages'} aria-controls={navigationOpen ? 'workspace-navigation' : undefined}
            onClick={() => toggleNavigation('pages')}><PanelLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="icon-control" aria-label="目录侧栏" title="目录"
            aria-expanded={navigationOpen && navigationView === 'outline'} aria-controls={navigationOpen ? 'workspace-navigation' : undefined}
            onClick={() => toggleNavigation('outline')}><List size={18} aria-hidden="true" /></button>
          <button type="button" className="icon-control" aria-label="评论侧栏" title="评论侧栏" aria-expanded={commentsOpen}
            aria-controls={commentsOpen ? 'document-comments' : undefined} onClick={() => showComments(!commentsOpen)}>
            <MessagesSquare size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-control" aria-label="快捷键" title="快捷键"
            onClick={() => help.current?.showModal()}><Keyboard size={18} aria-hidden="true" /></button>
          <div className="workspace-export" ref={toolsMenu}>
            <button type="button" className="icon-control export-trigger" aria-label="导入与导出" title="导入与导出"
              aria-expanded={toolsOpen} onClick={() => { setToolsOpen(open => !open); setCopiedPageId(null) }}>
              <Download size={18} aria-hidden="true" />
              <ChevronDown className="export-chevron" size={11} aria-hidden="true" />
            </button>
            {toolsOpen && (
              <div className="export-menu" role="group" aria-label="导入与导出">
                <button type="button" onClick={() => markdownInput.current?.click()}>
                  <FileUp size={15} aria-hidden="true" /><span>导入 Markdown</span><small>.md</small>
                </button>
                <button type="button" onClick={() => { downloadMarkdown(documentFor(activePage), pageTitle(activePage)); setToolsOpen(false) }}>
                  <FileDown size={15} aria-hidden="true" /><span>导出 Markdown</span><small>.md</small>
                </button>
                <button type="button" onClick={() => void copyMarkdown()}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
                  <span aria-live="polite">{copied ? '已复制 Markdown' : '复制为 Markdown'}</span>
                </button>
                <button type="button" onClick={() => { exportJSON(); setToolsOpen(false) }}>
                  <Download size={15} aria-hidden="true" /><span>导出 JSON</span><small>.json</small>
                </button>
              </div>
            )}
            <input ref={markdownInput} type="file" accept=".md,.markdown,text/markdown" hidden
              onChange={event => {
                void chooseMarkdownFile(event.target.files?.[0])
                event.target.value = ''
              }} />
          </div>
          <button type="button" className="icon-control" aria-label="重置示例工作区" title="重置示例工作区"
            onClick={() => setDialog({ kind: 'reset' })}><RotateCcw size={17} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="workspace" data-navigation={navigationOpen} data-comments={commentsOpen}>
        <WorkspaceNavigation workspace={workspace} view={navigationView} open={navigationOpen} editor={editor}
          onView={selectNavigation} onClose={() => setNavigationOpen(false)} onActivate={openPage} onCreate={newPage}
          onIcon={(id, icon) => editPage(id, { icon })} onAction={pageAction} />
        <PageEditor key={activePage.id} page={activePage} extensions={extensions} anchor={anchor} commentsOpen={commentsOpen}
          onCommentsOpen={showComments} onEditorReady={editorReady} onEdit={editPage} onImport={file => void chooseMarkdownFile(file)} />
      </div>
      {(notice || saveFailed) && <div className="workspace-notice" role="status">
        {notice || '浏览器无法保存工作区。'}
        {notice && <button type="button" className="icon-control" aria-label="关闭提示" onClick={() => setNotice('')}>
          <X size={15} aria-hidden="true" />
        </button>}
      </div>}
      {dialog && <WorkspaceDialog request={dialog} workspace={workspace} onClose={() => setDialog(null)} onConfirm={confirmDialog} />}
      <dialog ref={help} className="shortcut-dialog" aria-labelledby="shortcut-heading">
        <div className="sidebar-heading"><h2 id="shortcut-heading">快捷键</h2>
          <form method="dialog"><button type="submit" className="icon-control" aria-label="关闭快捷键">
            <X size={17} aria-hidden="true" />
          </button></form>
        </div>
        <dl>
          <div><dt>打开插块菜单</dt><dd><kbd>/</kbd> 或 <kbd>、</kbd></dd></div>
          <div><dt>在菜单中选择</dt><dd><kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd></dd></div>
          <div><dt>切换文本与块选区</dt><dd><kbd>Esc</kbd></dd></div>
          <div><dt>扩展或缩小块选区</dt><dd><kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></dd></div>
          <div><dt>删除选中块</dt><dd><kbd>Backspace</kbd> / <kbd>Delete</kbd></dd></div>
          <div><dt>撤销</dt><dd><kbd>Cmd / Ctrl</kbd> + <kbd>Z</kbd></dd></div>
          <div><dt>折叠块快捷输入</dt><dd><kbd>&gt;&gt; </kbd></dd></div>
          <div><dt>高亮块快捷输入</dt><dd><kbd>[! </kbd></dd></div>
          <div><dt>智能粘贴 Markdown</dt><dd><kbd>Cmd / Ctrl</kbd> + <kbd>V</kbd>，纯文本生效</dd></div>
        </dl>
      </dialog>
    </>
  )
}

export default function App() {
  const store = useWorkspace(schema)
  return <Workspace key={store.revision} {...store} />
}

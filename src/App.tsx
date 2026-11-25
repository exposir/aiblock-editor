import { EditorState, Selection } from '@tiptap/pm/state'
import { imageUploadFailures, retryImageUploads, subscribeImageUploads } from './editor/extensions/image-assets'
import { insertImageBlocks } from './editor/extensions/image-block'
import type { ImageAttributes } from './editor/extensions/image-attributes'
import { getSchema } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Download, FileDown, FileUp, Keyboard, List, MessagesSquare, Monitor, Moon, PanelLeft, RotateCcw, Sun, X } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDesktopBridge, openMarkdownFile, saveDocumentFile, suggestedFileName } from './desktop/bridge'
import type { DesktopMenuCommand, DocumentFileFormat, MarkdownFile } from './desktop/bridge'
import { createEditorExtensions } from './editor/extensions'
import { docToMarkdown } from './editor/markdown/markdown-codec'
import { downloadBlob, isMarkdownFile } from './editor/markdown/markdown-files'
import { isThemeMode, readThemeMode, syncTheme, themeLabels } from './theme/theme'
import type { ThemeMode } from './theme/theme'
import { PageEditor } from './workspace/PageEditor'
import type { EditPage } from './workspace/PageEditor'
import { WorkspaceDialog } from './workspace/WorkspaceDialog'
import type { WorkspaceDialogRequest } from './workspace/WorkspaceDialog'
import { WorkspaceNavigation } from './workspace/WorkspaceNavigation'
import type { NavigationView, PageAction } from './workspace/WorkspaceNavigation'
import { conflictPreviewPrefix, markdownDiff, maxMarkdownDiffCharacters } from './workspace/markdown-diff'
import type { MarkdownDiff } from './workspace/markdown-diff'
import {
  DEFAULT_PAGE_TITLE, activatePage, addPage, copyPage, findPage, formatPageHash, hasPageContent,
  importMarkdownPage, movePage, pageAncestors, pageTitle, restoreTrashedPage, trashPage, updatePage,
} from './workspace/page-store'
import type { WorkspacePage, WorkspaceState } from './workspace/page-store'
import type { WorkspacePersistence } from './workspace/workspace-format'
import { newPageIdentity, useWorkspace } from './workspace/useWorkspace'
import type { WorkspaceConflict } from './workspace/useWorkspace'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)

function wideViewport() {
  return window.matchMedia('(min-width: 1080px)').matches
}

interface Appearance {
  readonly mode: ThemeMode
  setMode(mode: ThemeMode): void
}

const themeControls = {
  system: { icon: Monitor, next: 'light' },
  light: { icon: Sun, next: 'dark' },
  dark: { icon: Moon, next: 'system' },
} as const

function ThemeControl({ mode, setMode }: Appearance) {
  const { icon: Icon, next } = themeControls[mode]
  const label = `外观：${themeLabels[mode]}，切换为${themeLabels[next]}`
  return <button type="button" className="icon-control" aria-label={label} title={label} onClick={() => setMode(next)}>
    <Icon size={18} aria-hidden="true" />
  </button>
}

type ConflictPreview = MarkdownDiff | { readonly message: string }

function ConflictDiff({ page, editor, conflict }: {
  page: WorkspacePage; editor: Editor | null; conflict: WorkspaceConflict
}) {
  const [result, setResult] = useState<ConflictPreview | null>(null)
  const readLocalDocument = useEffectEvent(() => editor && !editor.isDestroyed
    ? editor.state.doc : page.content ? schema.nodeFromJSON(page.content) : null)

  useEffect(() => {
    let disposed = false
    setResult(null)
    async function compare(): Promise<ConflictPreview | undefined> {
      const bridge = getDesktopBridge()
      if (!bridge) return { message: '无法读取磁盘版本。' }
      const shard = await bridge.readPage(conflictPreviewPrefix + page.id)
      if (disposed) return
      if (!shard) return { message: '该页面在磁盘上不存在。' }
      const local = readLocalDocument()
      if (!local) return { message: '当前页面尚未载入。' }
      const disk = schema.nodeFromJSON(shard.content)
      disk.check()
      if (Math.max(disk.content.size, local.content.size) > maxMarkdownDiffCharacters) return { truncated: true }
      return markdownDiff(docToMarkdown(disk), docToMarkdown(local))
    }
    void compare().then(
      value => { if (!disposed && value) setResult(value) },
      () => { if (!disposed) setResult({ message: '无法读取磁盘版本。可收起差异后重试。' }) },
    )
    return () => { disposed = true }
  }, [page.id, conflict])

  return <section id="workspace-conflict-diff" className="workspace-conflict-diff" aria-labelledby="workspace-diff-label">
    <h2 id="workspace-diff-label">当前页正文差异</h2>
    {!result ? <p role="status">正在读取磁盘版本…</p>
      : 'message' in result ? <p role="status">{result.message}</p>
      : result.truncated ? <p role="status">正文超出可比较的长度，差异预览已截断。</p>
      : result.added === 0 && result.removed === 0 ? <p role="status">当前页正文没有差异。请另行核对标题、评论或其他页面。</p>
      : <>
          <p>以磁盘版为基准，本地新增 {result.added} 行，移除 {result.removed} 行。</p>
          <pre className="workspace-diff-lines" tabIndex={0} aria-label="Markdown 差异">{result.lines.map((line, index) =>
            <span key={index} data-change={line.kind}><span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text}</span>,
          )}</pre>
        </>}
  </section>
}

function ExternalConflictNotice({ conflict, page, editor, keepLocal, reloadExternal }: {
  conflict: WorkspaceConflict; page: WorkspacePage; editor: Editor | null
  keepLocal(): void; reloadExternal(): void
}) {
  const [expanded, setExpanded] = useState(false)
  return <div className="workspace-conflict">
    <div className="workspace-conflict-actions">
      <span role="alert">{conflict.locked ? '工作区正被另一个写入方占用。' : '磁盘上的工作区已被外部修改，本地还有未保存的编辑。'}</span>
      <button type="button" aria-expanded={expanded} aria-controls={expanded ? 'workspace-conflict-diff' : undefined}
        onClick={() => setExpanded(open => !open)}>{expanded ? '收起差异' : '查看差异'}</button>
      <button type="button" onClick={reloadExternal}>从磁盘重载</button>
      <button type="button" onClick={keepLocal}>用本地覆盖保存</button>
    </div>
    {expanded && <ConflictDiff page={page} editor={editor} conflict={conflict} />}
  </div>
}

function Workspace({ workspace, anchor, saveFailed, loadFailed, retry, change, reset, stageContent, loadPage, deferTitle,
  externalConflict, keepLocal, reloadExternal, searchContent, purgeTrash, holdEditorAssets, appearance }:
  Omit<ReturnType<typeof useWorkspace>, 'workspace'> & { workspace: WorkspaceState<WorkspacePage>; appearance: Appearance },
) {
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
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const failedImages = useSyncExternalStore(subscribeImageUploads, imageUploadFailures)
  const activePage = findPage(workspace, workspace.activePageId)!
  const loadedPage = activePage.content && { ...activePage, content: activePage.content }
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
    setBinding(previous => previous?.pageId === activePage.id ? previous : null)
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
    if (deferred && typeof patch !== 'function' && typeof patch.title === 'string') {
      deferTitle(id, patch.title)
      return
    }
    change(current => {
      const page = findPage(current, id)
      if (!page) return current
      if (typeof patch !== 'function') return updatePage(current, id, patch, Date.now())
      return page.content ? updatePage(current, id, patch({ ...page, content: page.content }), Date.now()) : current
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

  function liveDocument(id: string) {
    return id === activePage.id && editor ? editor.state.doc : null
  }

  async function pageAction(action: PageAction, id: string) {
    const page = findPage(workspace, id)
    if (!page) return
    try {
      switch (action) {
        case 'duplicate': {
          const live = liveDocument(id)
          const content = live?.toJSON() ?? (await loadPage(id))?.content
          if (!content) return
          change(current => copyPage(current, id, newPageIdentity(), content))
          if (!wideViewport()) setNavigationOpen(false)
          return
        }
        case 'export':
          void exportPage(page, 'markdown')
          return
        case 'delete': {
          const leaf = !workspace.pages.some(child => child.parentId === id)
          if (leaf && pageTitle(page) === DEFAULT_PAGE_TITLE) {
            const live = liveDocument(id)
            const candidate = live ? { ...page, content: live.toJSON() } : page.content ? page : await loadPage(id)
            if (candidate && !hasPageContent(candidate)) {
              change(current => {
                const latest = findPage(current, id)
                if (!latest || pageTitle(latest) !== DEFAULT_PAGE_TITLE ||
                    current.pages.some(child => child.parentId === id) ||
                    hasPageContent(latest.content ? latest : { ...latest, content: candidate.content })) return current
                return trashPage(current, id, newPageIdentity())
              })
              return
            }
          }
          break
        }
      }
    } catch {
      setNotice('无法读取页面正文。')
      if (action !== 'delete') return
    }
    setDialog({ kind: action, pageId: id })
  }

  function confirmDialog(value: string) {
    if (!dialog) return
    switch (dialog.kind) {
      case 'rename': editPage(dialog.pageId, { title: value.trim() }); break
      case 'move': change(current => movePage(current, dialog.pageId, value || null, Date.now())); break
      case 'delete': change(current => trashPage(current, dialog.pageId, newPageIdentity())); break
      case 'purge': purgeTrash(dialog.pageId); break
      case 'empty-trash': purgeTrash(); break
      case 'reset': reset(); break
    }
  }

  async function importFile(read: () => Promise<MarkdownFile | null>) {
    setNotice('')
    try {
      const file = await read()
      if (!file) return
      change(current => importMarkdownPage(current, schema, newPageIdentity(), file.name, file.contents))
      if (!wideViewport()) setNavigationOpen(false)
      setToolsOpen(false)
    } catch {
      setNotice('无法导入这个 Markdown 文件。')
    }
  }

  function chooseMarkdownFile(file: File | undefined) {
    if (file && isMarkdownFile(file)) return importFile(async () => ({ name: file.name, contents: await file.text() }))
  }

  function pickMarkdown() {
    void importFile(() => openMarkdownFile(() => markdownInput.current?.click()))
  }

  async function exportPage(page: WorkspacePage, format: DocumentFileFormat) {
    setToolsOpen(false)
    try {
      const name = pageTitle(page)
      const live = liveDocument(page.id)
      const body = live ? page : await loadPage(page.id)
      if (!body) return
      const doc = live ?? schema.nodeFromJSON(body.content)
      const contents = format === 'markdown' ? docToMarkdown(doc)
        : JSON.stringify({ title: name, document: doc.toJSON(), comments: body.comments }, null, 2)
      await saveDocumentFile({ name, format, contents }, file => {
        const type = file.format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json'
        downloadBlob(new Blob([file.contents], { type }), suggestedFileName(file.name, file.format))
      })
    } catch {
      setNotice(format === 'markdown' ? '无法导出 Markdown。' : '无法导出 JSON。')
    }
  }

  const runMenuCommand = useEffectEvent((command: DesktopMenuCommand) => {
    switch (command) {
      case 'new-page': newPage(null); break
      case 'import-markdown': pickMarkdown(); break
      case 'export-markdown': void exportPage(activePage, 'markdown'); break
      case 'export-json': void exportPage(activePage, 'json'); break
      case 'toggle-pages': toggleNavigation('pages'); break
      case 'toggle-outline': toggleNavigation('outline'); break
      case 'toggle-comments': showComments(!commentsOpen); break
    }
  })

  useEffect(() => getDesktopBridge()?.onMenuCommand(command => runMenuCommand(command)), [])

  async function insertDetachedImages(id: string, images: readonly ImageAttributes[], position: number) {
    const page = await loadPage(id)
    if (!page) return
    const binding = bindingRef.current
    function insert(state: EditorState) {
      const selection = Selection.near(state.doc.resolve(Math.min(position, state.doc.content.size)))
      return insertImageBlocks(state, images, selection)
    }
    if (binding?.pageId === id && !binding.editor.isDestroyed && binding.editor.view.dom.isConnected) {
      binding.editor.view.dispatch(insert(binding.editor.state))
      return
    }
    change(workspace => {
      const current = findPage(workspace, id)
      if (!current) return workspace
      const state = EditorState.create({ doc: schema.nodeFromJSON(current.content ?? page.content) })
      return updatePage(workspace, id, { content: insert(state).doc.toJSON() }, Date.now())
    })
  }

  async function copyMarkdown() {
    clearTimeout(copyTimer.current)
    try {
      const live = liveDocument(activePage.id)
      const body = live ? activePage : await loadPage(activePage.id)
      if (!body) return
      await navigator.clipboard.writeText(docToMarkdown(live ?? schema.nodeFromJSON(body.content)))
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
            onChange={event => editPage(activePage.id, { title: event.target.value }, true)} />
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
          <ThemeControl {...appearance} />
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
                <button type="button" onClick={pickMarkdown}>
                  <FileUp size={15} aria-hidden="true" /><span>导入 Markdown</span><small>.md</small>
                </button>
                <button type="button" onClick={() => void exportPage(activePage, 'markdown')}>
                  <FileDown size={15} aria-hidden="true" /><span>导出 Markdown</span><small>.md</small>
                </button>
                <button type="button" onClick={() => void copyMarkdown()}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
                  <span aria-live="polite">{copied ? '已复制 Markdown' : '复制为 Markdown'}</span>
                </button>
                <button type="button" onClick={() => void exportPage(activePage, 'json')}>
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
          onIcon={(id, icon) => editPage(id, { icon })} onAction={(action, id) => void pageAction(action, id)}
          searchContent={searchContent} onRestore={id => change(current => restoreTrashedPage(current, id))}
          onPurge={id => setDialog({ kind: 'purge', pageId: id })} onEmptyTrash={() => setDialog({ kind: 'empty-trash' })} />
        {loadedPage ? <PageEditor key={activePage.id} page={loadedPage} extensions={extensions} anchor={anchor} commentsOpen={commentsOpen}
          onCommentsOpen={showComments} onEditorReady={editorReady} onEdit={editPage} onStageContent={stageContent} onHoldImageAssets={holdEditorAssets}
          onImport={file => void chooseMarkdownFile(file)} onDetachedImages={insertDetachedImages} onNotice={setNotice} />
          : <main className="document-surface" aria-busy={!loadFailed}>
            <div className="workspace-load" role="status">
              {loadFailed ? <>无法读取页面正文。 <button type="button" onClick={retry}>重试</button></> : '正在加载页面…'}
            </div>
          </main>}
      </div>
      {externalConflict && <ExternalConflictNotice key={activePage.id} conflict={externalConflict} page={activePage} editor={editor}
        keepLocal={keepLocal} reloadExternal={reloadExternal} />}
      {(notice || saveFailed) && <div className="workspace-notice" role="status">
        {notice || (getDesktopBridge() ? '无法保存工作区。' : '浏览器无法保存工作区。')}
        {notice && <button type="button" className="icon-control" aria-label="关闭提示" onClick={() => setNotice('')}>
          <X size={15} aria-hidden="true" />
        </button>}
      </div>}
      {failedImages > 0 && <div className="workspace-notice image-save-notice" role="status">
        有 {failedImages} 张图片尚未保存。图片暂存于当前会话，正文会独立保存。
        <button type="button" onClick={() => void retryImageUploads()}>重试保存图片</button>
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

function WorkspaceApp({ persistence, appearance }: { persistence?: WorkspacePersistence; appearance: Appearance }) {
  const store = useWorkspace(schema, persistence)
  if (!store.workspace) return <div className="workspace-load" role="status">
    {store.loadFailed ? <>{persistence ? '无法读取桌面工作区。' : '无法读取工作区。'}
      <button type="button" onClick={store.retry}>重试</button></> : '正在加载工作区…'}
  </div>
  return <Workspace key={store.revision} {...store} workspace={store.workspace} appearance={appearance} />
}

export default function App() {
  const bridge = getDesktopBridge()
  const [mode, setMode] = useState(() => readThemeMode(window))
  useLayoutEffect(() => syncTheme(window, mode), [mode])
  useEffect(() => bridge?.onMenuCommand(command => {
    if (!command.startsWith('theme-')) return
    const selection = command.slice('theme-'.length)
    if (isThemeMode(selection)) setMode(selection)
  }), [bridge])

  const appearance = { mode, setMode }
  return <WorkspaceApp persistence={bridge} appearance={appearance} />
}

import { EditorContent, useEditor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { Check, ChevronDown, ClipboardCopy, Download, FileDown, FileText, FileUp, Keyboard, MessagesSquare, PanelLeft, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CommentSidebar } from './components/CommentSidebar'
import { OutlineSidebar } from './components/OutlineSidebar'
import type { CommentThread } from './editor/comments'
import { BlockHandleOverlay } from './editor/components/BlockHandleOverlay'
import { BubbleToolbar } from './editor/components/BubbleToolbar'
import { CodeBlockOverlay } from './editor/components/CodeBlockOverlay'
import { TableControlsOverlay } from './editor/components/TableControlsOverlay'
import { revealAnchor } from './editor/components/reveal-anchor'
import { demoComments, demoDocument, demoTitle } from './editor/demo-document'
import { commentAnchor, createEditorExtensions, openSlashMenu } from './editor/extensions'
import {
  commentsForMarkdownImport,
  downloadMarkdown,
  importMarkdown,
  importedTitle,
  isMarkdownFile,
} from './editor/markdown/markdown-files'
import { docToMarkdown } from './editor/markdown/markdown-codec'

const extensions = createEditorExtensions()

function showPanelsInitially() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1080px)').matches
}

function commentId() {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16)).join('-')
}

function hasFilePayload(data: DataTransfer) {
  return data.types.includes('Files') || [...data.items].some(item => item.kind === 'file')
}

function Workspace({ onReset }: { onReset: () => void }) {
  const surface = useRef<HTMLElement>(null)
  const help = useRef<HTMLDialogElement>(null)
  const reset = useRef<HTMLDialogElement>(null)
  const markdownInput = useRef<HTMLInputElement>(null)
  const toolsMenu = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null)
  const [title, setTitle] = useState(demoTitle)
  const [outlineOpen, setOutlineOpen] = useState(showPanelsInitially)
  const [commentsOpen, setCommentsOpen] = useState(showPanelsInitially)
  const [threads, setThreads] = useState<readonly CommentThread[]>(demoComments)
  const [active, setActive] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [dragDepth, setDragDepth] = useState(0)
  const editor = useEditor({
    extensions,
    content: demoDocument,
    editorProps: {
      attributes: { class: 'document-editor', 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' },
    },
  })

  useEffect(() => {
    if (!toolsOpen) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolsMenu.current?.contains(event.target)) {
        setToolsOpen(false)
        setCopied(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setToolsOpen(false)
      setCopied(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    }
  }, [toolsOpen])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  function beginComment() {
    if (!editor) return
    const { selection, doc } = editor.state
    if (!(selection instanceof TextSelection) || selection.empty) return
    const quote = doc.textBetween(selection.from, selection.to, '\n').trim()
    if (!quote) return
    const id = commentId()
    if (!editor.chain().addCommentMark(id).setActiveComment(id).run()) return
    setThreads(previous => [...previous, { id, quote, messages: [], resolved: false }])
    setActive(id)
    setCommentsOpen(true)
  }

  function locateComment(thread: CommentThread) {
    if (!editor || thread.resolved) return
    setActive(thread.id)
    editor.commands.setActiveComment(thread.id)
    const pos = commentAnchor(editor.state.doc, thread.id)
    if (pos === null) return
    revealAnchor(editor, pos, () =>
      editor.view.dom.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(thread.id)}"]`))
  }

  function reply(id: string, text: string) {
    const message = { author: '我', id: commentId(), text }
    setThreads(previous => previous.map(thread => thread.id === id && !thread.resolved
      ? { ...thread, messages: [...thread.messages, message] } : thread))
  }

  function closeThread(id: string, resolved: boolean) {
    editor?.commands.removeCommentMark(id)
    setActive(previous => previous === id ? null : previous)
    setThreads(previous => resolved
      ? previous.map(thread => thread.id === id ? { ...thread, resolved: true } : thread)
      : previous.filter(thread => thread.id !== id))
  }

  function exportJSON() {
    if (!editor) return
    const name = title.trim() || '未命名文档'
    const data = { title: name, document: editor.getJSON(), comments: threads }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function resetForImportedMarkdown(fileName: string, markdown: string) {
    if (!editor) return
    importMarkdown(editor, markdown)
    setTitle(importedTitle(fileName, markdown))
    setThreads(commentsForMarkdownImport())
    setActive(null)
    setCopied(false)
    setToolsOpen(false)
  }

  function chooseMarkdownFile(file: File | undefined) {
    if (!file || !editor || !isMarkdownFile(file)) return
    file.text().then(markdown => resetForImportedMarkdown(file.name, markdown)).catch(() => undefined)
  }

  async function copyMarkdown() {
    if (!editor) return
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(docToMarkdown(editor.state.doc))
      setCopied(true)
      copyTimer.current = setTimeout(() => {
        setCopied(false)
        copyTimer.current = undefined
      }, 1500)
    } catch {
      copyTimer.current = undefined
      setCopied(false)
    }
  }

  return (
    <>
      <header className="app-header workspace-header" data-editor-sticky-header="">
        <div className="document-identity">
          <span className="document-logo"><FileText size={19} aria-hidden="true" /></span>
          <input aria-label="文档标题" value={title} placeholder="未命名文档" onChange={event => setTitle(event.target.value)} />
        </div>
        <div className="workspace-tools" role="group" aria-label="文档工具">
          <button type="button" className="icon-control" aria-label="目录" title="目录" aria-expanded={outlineOpen}
            aria-controls={outlineOpen ? 'document-outline' : undefined} onClick={() => setOutlineOpen(open => !open)}>
            <PanelLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-control" aria-label="评论侧栏" title="评论侧栏" aria-expanded={commentsOpen}
            aria-controls={commentsOpen ? 'document-comments' : undefined} onClick={() => setCommentsOpen(open => !open)}>
            <MessagesSquare size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-control" aria-label="快捷键" title="快捷键"
            onClick={() => help.current?.showModal()}><Keyboard size={18} aria-hidden="true" /></button>
          <div className="workspace-export" ref={toolsMenu}>
            <button type="button" className="icon-control export-trigger" aria-label="导入与导出" title="导入与导出"
              aria-expanded={toolsOpen} onClick={() => { setToolsOpen(open => !open); setCopied(false) }}>
              <Download size={18} aria-hidden="true" />
              <ChevronDown className="export-chevron" size={11} aria-hidden="true" />
            </button>
            {toolsOpen && (
              <div className="export-menu" role="menu" aria-label="导入与导出">
                <button type="button" role="menuitem" onClick={() => markdownInput.current?.click()}>
                  <FileUp size={15} aria-hidden="true" /><span>导入 Markdown</span><small>.md</small>
                </button>
                <button type="button" role="menuitem" onClick={() => { downloadMarkdown(editor!.state.doc, title); setToolsOpen(false) }}>
                  <FileDown size={15} aria-hidden="true" /><span>导出 Markdown</span><small>.md</small>
                </button>
                <button type="button" role="menuitem" onClick={() => void copyMarkdown()}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
                  <span>{copied ? '已复制 Markdown' : '复制为 Markdown'}</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { exportJSON(); setToolsOpen(false) }}>
                  <Download size={15} aria-hidden="true" /><span>导出 JSON</span><small>.json</small>
                </button>
              </div>
            )}
            <input ref={markdownInput} type="file" accept=".md,.markdown,text/markdown" hidden
              onChange={event => {
                chooseMarkdownFile(event.target.files?.[0])
                event.target.value = ''
              }} />
          </div>
          <button type="button" className="icon-control" aria-label="重置演示文档" title="重置演示文档"
            onClick={() => reset.current?.showModal()}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace" data-outline={outlineOpen} data-comments={commentsOpen}>
        {outlineOpen && <OutlineSidebar editor={editor} onClose={() => setOutlineOpen(false)} />}
        <main ref={surface} className="document-surface" data-document-surface=""
          data-dragging-md={dragDepth > 0 ? 'true' : undefined}
          onDragEnter={event => {
            if (hasFilePayload(event.dataTransfer)) {
              setDragDepth(depth => depth + 1)
            }
          }}
          onDragOver={event => {
            if (hasFilePayload(event.dataTransfer)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDragLeave={() => setDragDepth(depth => Math.max(0, depth - 1))}
          onDrop={event => {
            const files = [...event.dataTransfer.files]
            setDragDepth(0)
            if (!files.length && !hasFilePayload(event.dataTransfer)) return
            event.preventDefault()
            const file = files.find(isMarkdownFile)
            if (file) chooseMarkdownFile(file)
          }}>
          {dragDepth > 0 && <div className="markdown-drop-hint" aria-hidden="true">拖放以导入 Markdown</div>}
          <EditorContent editor={editor}>
            <div ref={setOverlayHost} className="document-overlays" data-document-overlays="" />
          </EditorContent>
        </main>
        {commentsOpen && <CommentSidebar threads={threads} active={active} onLocate={locateComment} onReply={reply}
          onResolve={id => closeThread(id, true)} onDelete={id => closeThread(id, false)} onClose={() => setCommentsOpen(false)} />}
      </div>
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
      <dialog ref={reset} className="shortcut-dialog reset-dialog" aria-labelledby="reset-heading"
        aria-describedby="reset-description">
        <div className="sidebar-heading"><h2 id="reset-heading">重置演示文档</h2></div>
        <p id="reset-description">当前标题、正文和评论将被演示内容替换。</p>
        <form method="dialog" className="reset-actions">
          <button type="submit" autoFocus>取消</button>
          <button type="button" className="reset-confirm" onClick={() => { reset.current?.close(); onReset() }}>
            确认重置
          </button>
        </form>
      </dialog>
      {editor && <>
        <BubbleToolbar editor={editor} onComment={beginComment} />
        {overlayHost && <>
          <BlockHandleOverlay editor={editor} surface={surface} host={overlayHost} onQuickInsert={openSlashMenu} />
          <TableControlsOverlay editor={editor} host={overlayHost} />
          <CodeBlockOverlay editor={editor} host={overlayHost} />
        </>}
      </>}
    </>
  )
}

export default function App() {
  const [version, setVersion] = useState(0)
  return <Workspace key={version} onReset={() => setVersion(previous => previous + 1)} />
}

import { EditorContent, useEditor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { Download, FileText, Keyboard, MessagesSquare, PanelLeft, RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
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

const extensions = createEditorExtensions()

function showPanelsInitially() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1080px)').matches
}

function commentId() {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16)).join('-')
}

function Workspace({ onReset }: { onReset: () => void }) {
  const surface = useRef<HTMLElement>(null)
  const help = useRef<HTMLDialogElement>(null)
  const reset = useRef<HTMLDialogElement>(null)
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null)
  const [title, setTitle] = useState(demoTitle)
  const [outlineOpen, setOutlineOpen] = useState(showPanelsInitially)
  const [commentsOpen, setCommentsOpen] = useState(showPanelsInitially)
  const [threads, setThreads] = useState<readonly CommentThread[]>(demoComments)
  const [active, setActive] = useState<string | null>(null)
  const editor = useEditor({
    extensions,
    content: demoDocument,
    editorProps: {
      attributes: { class: 'document-editor', 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' },
    },
  })

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
          <button type="button" className="icon-control" aria-label="导出 JSON" title="导出 JSON" onClick={exportJSON}>
            <Download size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-control" aria-label="重置演示文档" title="重置演示文档"
            onClick={() => reset.current?.showModal()}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace" data-outline={outlineOpen} data-comments={commentsOpen}>
        {outlineOpen && <OutlineSidebar editor={editor} onClose={() => setOutlineOpen(false)} />}
        <main ref={surface} className="document-surface" data-document-surface="">
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

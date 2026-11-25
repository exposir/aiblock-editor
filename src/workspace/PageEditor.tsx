import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CommentSidebar } from '../components/CommentSidebar'
import type { CommentThread } from '../editor/comments'
import { BlockHandleOverlay } from '../editor/components/BlockHandleOverlay'
import { BubbleToolbar } from '../editor/components/BubbleToolbar'
import { ImageOverlay } from '../editor/components/ImageOverlay'
import { pasteImageFiles, setImageTransferHost } from '../editor/extensions/image-block'
import type { ImageAttributes } from '../editor/extensions/image-attributes'
import { InlineMathOverlay } from '../editor/components/InlineMathOverlay'
import { CodeBlockOverlay } from '../editor/components/CodeBlockOverlay'
import { TableControlsOverlay } from '../editor/components/TableControlsOverlay'
import { revealAnchor, revealBlock } from '../editor/components/reveal-anchor'
import { commentAnchor, openSlashMenu } from '../editor/extensions'
import { isMarkdownFile } from '../editor/markdown/markdown-files'
import { formatPageHash } from './page-store'
import type { PageChanges, PageRecord } from './page-store'

export type EditPage = (id: string, patch: PageChanges | ((page: PageRecord) => PageChanges), deferred?: boolean) => void

interface PageEditorProps {
  readonly page: PageRecord
  readonly extensions: Extensions
  readonly anchor: { readonly id: string } | null
  readonly commentsOpen: boolean
  readonly onCommentsOpen: (open: boolean) => void
  readonly onEditorReady: (pageId: string, editor: Editor) => void
  readonly onEdit: EditPage
  readonly onStageContent: (id: string, read: () => JSONContent) => void
  readonly onImport: (file: File) => void
  readonly onDetachedImages?: (pageId: string, images: readonly ImageAttributes[], pos: number) => Promise<void>
  readonly onNotice?: (notice: string) => void
}

function commentId() {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16)).join('-')
}

function hasFilePayload(data: DataTransfer) {
  return data.types.includes('Files') || [...data.items].some(item => item.kind === 'file')
}

export function PageEditor({ page, extensions, anchor, commentsOpen, onCommentsOpen, onEditorReady, onEdit, onStageContent, onImport, onDetachedImages, onNotice }: PageEditorProps) {
  const surface = useRef<HTMLElement>(null)
  const initialContent = useRef(page.content)
  const normalizedOnMount = useRef(false)
  const cancelCommentReveal = useRef<(() => void) | undefined>(undefined)
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null)
  const [activeComment, setActiveComment] = useState<string | null>(null)
  const [dragDepth, setDragDepth] = useState(0)
  const editor = useEditor({
    extensions,
    content: initialContent.current,
    editorProps: {
      attributes: { class: 'document-editor', 'aria-label': '文档正文', role: 'textbox', 'aria-multiline': 'true' },
    },
    onTransaction: ({ editor, transaction, appendedTransactions }) => {
      if (!editor.isInitialized && (transaction.docChanged || appendedTransactions.some(tr => tr.docChanged))) {
        normalizedOnMount.current = true
      }
    },
    onCreate: ({ editor }) => {
      if (!surface.current?.contains(editor.view.dom)) return
      editor.commands.clearRetiredComments()
      if (normalizedOnMount.current) {
        normalizedOnMount.current = false
        onStageContent(page.id, () => editor.getJSON())
      }
    },
    onUpdate: ({ editor }) => {
      if (editor.isInitialized && surface.current?.contains(editor.view.dom)) {
        onStageContent(page.id, () => editor.getJSON())
      }
    },
    onUnmount: ({ editor }) => {
      // History can retain the last edited plugin array after TipTap destroys the view.
      editor.setOptions({ element: null })
    },
  })

  useLayoutEffect(() => { window.scrollTo(0, 0) }, [])
  useLayoutEffect(() => {
    if (editor) onEditorReady(page.id, editor)
  }, [editor, onEditorReady, page.id])

  useLayoutEffect(() => {
    if (!editor) return
    return setImageTransferHost(editor.view, {
      pageId: page.id,
      attached: () => !!surface.current?.contains(editor.view.dom),
      detached: (images, pos) => onDetachedImages?.(page.id, images, pos) ?? Promise.resolve(),
      notice: text => onNotice?.(text),
    })
  }, [editor, onDetachedImages, onNotice, page.id])

  useEffect(() => {
    if (editor && anchor) return revealBlock(editor, anchor.id)
  }, [anchor, editor])
  useEffect(() => () => cancelCommentReveal.current?.(), [])

  function beginComment() {
    if (!editor) return
    const { selection, doc } = editor.state
    if (!(selection instanceof TextSelection) || selection.empty) return
    const quote = doc.textBetween(selection.from, selection.to, '\n').trim()
    if (!quote) return
    const id = commentId()
    if (!editor.chain().addCommentMark(id).setActiveComment(id).run()) return
    onEdit(page.id, current => ({ comments: [...current.comments, { id, quote, messages: [], resolved: false }] }))
    setActiveComment(id)
    onCommentsOpen(true)
  }

  function locateComment(thread: CommentThread) {
    if (!editor || thread.resolved) return
    setActiveComment(thread.id)
    editor.commands.setActiveComment(thread.id)
    const pos = commentAnchor(editor.state.doc, thread.id)
    cancelCommentReveal.current?.()
    cancelCommentReveal.current = pos === null ? undefined : revealAnchor(editor, pos, () =>
      editor.view.dom.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(thread.id)}"]`))
  }

  function reply(id: string, text: string) {
    const message = { author: '我', id: commentId(), text }
    onEdit(page.id, current => ({ comments: current.comments.map(thread => thread.id === id && !thread.resolved
      ? { ...thread, messages: [...thread.messages, message] } : thread) }))
  }

  function closeThread(id: string, resolved: boolean) {
    editor?.commands.removeCommentMark(id)
    setActiveComment(previous => previous === id ? null : previous)
    onEdit(page.id, current => ({ comments: resolved
      ? current.comments.map(thread => thread.id === id ? { ...thread, resolved: true } : thread)
      : current.comments.filter(thread => thread.id !== id) }))
  }

  return (
    <>
      <main ref={surface} className="document-surface" data-document-surface=""
        data-dragging-md={dragDepth > 0 ? 'true' : undefined}
        onDragEnter={event => {
          if (hasFilePayload(event.dataTransfer)) setDragDepth(depth => depth + 1)
        }}
        onDragOver={event => {
          if (!hasFilePayload(event.dataTransfer)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => setDragDepth(depth => Math.max(0, depth - 1))}
        onDrop={event => {
          const files = [...event.dataTransfer.files]
          setDragDepth(0)
          if (!files.length && !hasFilePayload(event.dataTransfer)) return
          event.preventDefault()
          event.stopPropagation()
          const file = files.find(isMarkdownFile)
          if (file) onImport(file)
          else if (editor && !(event.target instanceof Node && editor.view.dom.contains(event.target))) {
            pasteImageFiles(editor.view, files)
          }
        }}>
        {dragDepth > 0 && <div className="markdown-drop-hint" aria-hidden="true">拖放 Markdown 文件以新建页面</div>}
        <EditorContent editor={editor}>
          <div ref={setOverlayHost} className="document-overlays" data-document-overlays="" />
        </EditorContent>
      </main>
      {commentsOpen && <CommentSidebar threads={page.comments} active={activeComment} onLocate={locateComment} onReply={reply}
        onResolve={id => closeThread(id, true)} onDelete={id => closeThread(id, false)} onClose={() => onCommentsOpen(false)} />}
      {editor && <>
        <BubbleToolbar editor={editor} onComment={beginComment} />
        <InlineMathOverlay editor={editor} />
        {overlayHost && <>
          <BlockHandleOverlay editor={editor} surface={surface} host={overlayHost}
            blockHash={id => formatPageHash(page.id, id)} onQuickInsert={openSlashMenu} />
          <TableControlsOverlay editor={editor} host={overlayHost} />
          <CodeBlockOverlay editor={editor} host={overlayHost} />
          <ImageOverlay editor={editor} host={overlayHost} />
        </>}
      </>}
    </>
  )
}

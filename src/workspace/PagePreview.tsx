import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CommentSidebar } from '../components/CommentSidebar'
import type { CommentThread } from '../editor/comments'
import { DocumentPreview } from '../editor/preview/DocumentPreview'
import type { PageRecord } from './page-store'

interface PagePreviewProps {
  readonly page: PageRecord
  readonly anchor: { readonly id: string } | null
  readonly commentsOpen: boolean
  readonly onCommentsOpen: (open: boolean) => void
  readonly restoreScrollY?: number | null
  readonly initialScroll?: 'top' | 'bottom'
}

function revealPreviewAnchor(root: HTMLElement, selector: string) {
  const win = root.ownerDocument.defaultView
  if (!win) return
  let target = root.querySelector<HTMLElement>(selector)
  if (!target) return
  const toggle = target.closest<HTMLElement>('.preview-toggle')
  if (toggle?.dataset.open === 'false') {
    toggle.querySelector<HTMLButtonElement>('.preview-toggle-button')?.click()
    target = root.querySelector<HTMLElement>(selector)
  }
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches
  win.requestAnimationFrame(() => target?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }))
}

export function PagePreview({ page, anchor, commentsOpen, onCommentsOpen, restoreScrollY = null, initialScroll = 'top' }: PagePreviewProps) {
  const surface = useRef<HTMLElement>(null)
  const pendingComment = useRef<string | null>(null)
  const [activeComment, setActiveComment] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (restoreScrollY !== null) {
      window.scrollTo(0, restoreScrollY)
      return
    }
    if (initialScroll === 'bottom') return
    window.scrollTo(0, 0)
  }, [page.id, restoreScrollY, initialScroll])

  useEffect(() => {
    if (!anchor || !surface.current) return
    revealPreviewAnchor(surface.current, `[data-block-id="${CSS.escape(anchor.id)}"]`)
  }, [anchor, page.id])

  function locateComment(thread: CommentThread) {
    if (!surface.current) return
    setActiveComment(thread.id)
    onCommentsOpen(true)
    pendingComment.current = thread.id
    revealPreviewAnchor(surface.current, `[data-comment-id="${CSS.escape(thread.id)}"]`)
  }

  function openComment(id: string) {
    const thread = page.comments.find(thread => thread.id === id)
    if (thread) locateComment(thread)
  }

  useEffect(() => {
    if (!commentsOpen || !pendingComment.current || !surface.current) return
    const id = pendingComment.current
    pendingComment.current = null
    revealPreviewAnchor(surface.current, `[data-comment-id="${CSS.escape(id)}"]`)
  }, [commentsOpen])

  return <>
    <main ref={surface} className="document-surface preview-surface" data-document-surface="" data-preview="true"
      onDragOver={event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault() }}
      onDrop={event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault() }}>
      <DocumentPreview content={page.content} activeComment={activeComment} onComment={openComment} eagerEdge={initialScroll} />
    </main>
    {commentsOpen && <CommentSidebar threads={page.comments} active={activeComment} onLocate={locateComment}
      onReply={() => {}} onResolve={() => {}} onDelete={() => {}} onClose={() => onCommentsOpen(false)} readOnly />}
  </>
}
